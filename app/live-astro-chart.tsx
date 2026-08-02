"use client";

import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  LineData,
  LineSeries,
  LineType,
  LineStyle,
  SeriesMarker,
  UTCTimestamp,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

type AstroLevel = {
  label: string;
  value: string;
  kind: "entry" | "trim" | "risk";
};

type ThesisLevel = {
  label: string;
  value: string;
  kind: "watch" | "upside" | "downside";
  reason: string;
};

type ParsedLevel = AstroLevel & {
  completed: boolean;
  high: number;
  low: number;
  price: number;
  shortLabel: string;
};

type FeedState = "loading" | "live" | "delayed" | "error";
type OverlayMode = "astro" | "hermes";
type SignalState =
  | "wait"
  | "long"
  | "short"
  | "take_profit"
  | "exit"
  | "conflict";

type AstroEvent = {
  detail?: string;
  label: string;
  source?: string;
  time?: string;
};

type ZoneRect = ParsedLevel & {
  height: number;
  top: number;
};

type LevelPurpose = "entry" | "target" | "invalidation" | "context";

type HermesProjection = {
  scoringVersion: 2;
  direction: "down_then_up" | "up_then_down" | "up" | "down" | "range";
  horizonHours: number;
  confidence: number;
  checkpoints: Array<{
    label: string;
    price: number;
    kind: "transition" | "confirmation" | "target";
    horizonHours: number;
    condition: string;
  }>;
  invalidation: {
    price: number | null;
    condition: string;
  };
  behavior: {
    action:
      | "hold"
      | "trim"
      | "close"
      | "flip_long"
      | "flip_short"
      | "readd"
      | "silence"
      | "post_update";
    horizonHours: number;
    condition: string;
  };
};

type HermesAudit = {
  id: string;
  marketStatus:
    | "active"
    | "hit"
    | "partial"
    | "invalidated"
    | "expired"
    | "superseded";
  official: boolean;
  integrity: "valid" | "legacy" | "failed";
  evaluationQuality: "complete" | "gap";
  hitCheckpoints: number;
  totalCheckpoints: number;
  outcomeReason: string | null;
  behaviorAction: string | null;
  behaviorStatus: "active" | "hit" | "wrong" | "unscored";
};

const timeframes = [
  { label: "15M", seconds: 900 },
  { label: "1H", seconds: 3600 },
  { label: "6H", seconds: 21600 },
  { label: "1D", seconds: 86400 },
] as const;

function parseLevel(level: AstroLevel): ParsedLevel | null {
  const normalized = level.value
    .toLowerCase()
    .replaceAll(",", "")
    .replace(/\d+(?:\.\d+)?%/g, "");
  const values = [...normalized.matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const usesThousands = normalized.includes("k");
  const prices = values
    .map((value) => (usesThousands && value < 1_000 ? value * 1_000 : value))
    .filter((value) => value >= 10_000 && value <= 250_000);
  if (!prices.length) return null;

  const approximateObjective =
    /(?:≈|about|objective|drawdown)/i.test(level.value) &&
    prices.length > 1 &&
    Math.max(...prices) - Math.min(...prices) > 2_000;
  const selectedPrices = approximateObjective ? [prices.at(-1)!] : prices;
  const low = Math.min(...selectedPrices);
  const high = Math.max(...selectedPrices);

  return {
    ...level,
    completed: false,
    low,
    high,
    price: (low + high) / 2,
    shortLabel: compactLabel(level.label),
  };
}

function eventPrices(event: AstroEvent) {
  const text = `${event.label} ${event.detail ?? ""}`.replaceAll(",", "");
  return [...text.matchAll(/\b(\d{2,3}(?:\.\d+)?)k\b|\b(\d{5,6})\b/gi)]
    .map((match) =>
      match[1] ? Number(match[1]) * 1_000 : Number(match[2]),
    )
    .filter((value) => Number.isFinite(value));
}

function levelWasCompleted(level: ParsedLevel, events: AstroEvent[]) {
  if (level.kind !== "trim") return false;
  return events.some((event) => {
    const text = `${event.label} ${event.detail ?? ""}`.toLowerCase();
    if (!/\btrim\b|take profit|\btp\b|\block\b|piece is gone|fully closed/.test(text)) {
      return false;
    }
    return eventPrices(event).some(
      (eventPrice) => Math.abs(eventPrice - level.price) <= 150,
    );
  });
}

function levelPurpose(level: ParsedLevel): LevelPurpose {
  const text = `${level.label} ${level.value}`.toLowerCase();
  if (level.completed) return "context";
  if (
    /\bwrong\b|invalidat|read breaks|failure/.test(text) &&
    !/historical|virtual/.test(text)
  ) {
    return "invalidation";
  }
  if (
    /target|objective|drawdown/.test(text) &&
    !/historical|tapped|claimed|complete/.test(text)
  ) {
    return "target";
  }
  if (
    level.kind === "trim" &&
    !/historical|tapped|claimed|complete|taken/.test(text)
  ) {
    return "target";
  }
  if (
    level.kind === "entry" &&
    /active|still open|holding/.test(text) &&
    !/historical|planned|virtual|not public/.test(text)
  ) {
    return "entry";
  }
  return "context";
}

function focusLineLabel(level: ParsedLevel) {
  const purpose = levelPurpose(level);
  if (purpose === "entry") return "ENTRY";
  if (purpose === "target") return level.shortLabel;
  if (purpose === "invalidation") return "INVALID";
  return levelRole(level, null);
}

function compactLabel(label: string) {
  const lowered = label.toLowerCase();
  if (lowered.includes("weekly open")) return "TP / GOAL · WEEKLY OPEN";
  if (lowered.includes("long v")) return "LONG V ENTRY";
  if (lowered.includes("short iv")) return "SHORT IV · CLOSED";
  if (lowered.includes("initial long trim")) return "T1 · FIRST TRIM";
  if (lowered.includes("hv liquidity")) return "T2 · CLOSE 30%";
  if (/\btp\s*1\b/.test(lowered)) return "TP1";
  if (/\btp\s*2\b/.test(lowered)) return "TP2";
  return label.split("(")[0].trim().slice(0, 22).toUpperCase();
}

function levelColor(kind: AstroLevel["kind"]) {
  if (kind === "entry") return "#52e6a7";
  if (kind === "risk") return "#ff6b66";
  return "#ffb000";
}

function levelFill(kind: AstroLevel["kind"]) {
  if (kind === "entry") return "rgba(82, 230, 167, 0.08)";
  if (kind === "risk") return "rgba(255, 107, 102, 0.08)";
  return "rgba(255, 176, 0, 0.08)";
}

function thesisLevelColor(kind: ThesisLevel["kind"]) {
  if (kind === "upside") return "#7aa2ff";
  if (kind === "downside") return "#c47dff";
  return "#7c8798";
}

function signalLabel(state: SignalState) {
  const labels: Record<SignalState, string> = {
    wait: "WAIT",
    long: "LONG",
    short: "SHORT",
    take_profit: "TAKE PROFIT",
    exit: "EXIT",
    conflict: "WAIT · CONFLICT",
  };
  return labels[state];
}

function levelRole(level: ParsedLevel, currentPrice: number | null) {
  if (level.kind === "risk") return "RISK";
  if (level.kind === "entry") return "ASTRO ENTRY";
  if (currentPrice !== null && level.price <= currentPrice + 5) {
    return "TRIM / TAKEN";
  }
  return "NEXT TARGET";
}

function compactEventLabel(label: string) {
  const lowered = label.toLowerCase();
  if (lowered.includes("flip") || lowered.includes("close short")) return "FLIP";
  if (lowered.includes("initial") && lowered.includes("trim")) return "TRIM";
  if (lowered.includes("trim size")) return "40%";
  if (lowered.includes("pre-set") || lowered.includes("tp")) return "TP";
  if (lowered.includes("safe-house")) return "RUN";
  if (lowered.includes("64.7")) return "64.7";
  if (lowered.includes("win lock")) return "WIN";
  return "ASTRO";
}

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function compactChartPrice(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `$${(value / 1_000).toFixed(1)}K`;
}

function mapCandles(rows: unknown[]): CandlestickData<UTCTimestamp>[] {
  return rows
    .filter(
      (row): row is number[] =>
        Array.isArray(row) &&
        row.length >= 5 &&
        row.slice(0, 5).every((value) => Number.isFinite(Number(value))),
    )
    .map((row) => ({
      time: Number(row[0]) as UTCTimestamp,
      low: Number(row[1]),
      high: Number(row[2]),
      open: Number(row[3]),
      close: Number(row[4]),
    }))
    .sort((left, right) => Number(left.time) - Number(right.time));
}

export default function LiveAstroChart({
  events,
  freshnessLabel,
  freshnessTone,
  levels,
  thesisLevels,
  forecastTime,
  signalState,
  signalHeadline,
  riskText,
  predictedProbability,
  hermesHorizon,
  hermesCurrentPhase,
  hermesNextPhase,
  hermesLongerMove,
  hermesConfirmation,
  hermesFailure,
  astroPosition,
  astroConfirmed,
  astroTakeProfit,
  schoolMatch,
  marketContext,
  hermesProjection,
  hermesAudit,
  hermesAnchorPrice = null,
  hermesAnchorTime = null,
  onOpenHermes,
}: {
  events: AstroEvent[];
  freshnessLabel: string;
  freshnessTone: string;
  levels: AstroLevel[];
  thesisLevels: ThesisLevel[];
  forecastTime: string;
  signalState: SignalState;
  signalHeadline: string;
  riskText: string;
  predictedProbability: number;
  hermesHorizon: string;
  hermesCurrentPhase: string;
  hermesNextPhase: string;
  hermesLongerMove: string;
  hermesConfirmation: string;
  hermesFailure: string;
  astroPosition: string;
  astroConfirmed: string;
  astroTakeProfit: string;
  schoolMatch: string;
  marketContext: string;
  hermesProjection?: HermesProjection;
  hermesAudit?: HermesAudit | null;
  hermesAnchorPrice?: number | null;
  hermesAnchorTime?: string | null;
  onOpenHermes: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const projectionSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const hermesUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const hermesLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const projectionMarkersRef =
    useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
  const markersRef =
    useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
  const currentCandleRef =
    useRef<CandlestickData<UTCTimestamp> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const updateZonesRef = useRef<() => void>(() => {});
  const projectionFitKeyRef = useRef("");
  const [timeframe, setTimeframe] = useState(21_600);
  const [price, setPrice] = useState<number | null>(null);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [feedNote, setFeedNote] = useState("Loading Coinbase candles…");
  const [zoneRects, setZoneRects] = useState<ZoneRect[]>([]);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("hermes");
  const hermesMapUnavailable =
    hermesAudit?.integrity === "failed" ||
    ["partial", "invalidated", "expired", "superseded"].includes(
      hermesAudit?.marketStatus ?? "",
    );

  const parsedLevels = useMemo(
    () =>
      levels
        .map(parseLevel)
        .filter((level): level is ParsedLevel => level !== null)
        .map((level) => ({
          ...level,
          completed: levelWasCompleted(level, events),
        })),
    [events, levels],
  );
  const parsedThesisLevels = useMemo(
    () =>
      thesisLevels
        .map((level) => {
          const parsed = parseLevel({
            label: level.label,
            value: level.value,
            kind: "risk",
          });
          return parsed ? { ...parsed, thesisKind: level.kind, reason: level.reason } : null;
        })
        .filter(
          (
            level,
          ): level is ParsedLevel & {
            thesisKind: ThesisLevel["kind"];
            reason: string;
          } => level !== null,
        ),
    [thesisLevels],
  );
  const eventMarkers = useMemo<SeriesMarker<UTCTimestamp>[]>(
    () =>
      events
        .flatMap((event, index) => {
          if (!event.time) return [];
          const timestamp = Math.floor(new Date(event.time).getTime() / 1000);
          if (!Number.isFinite(timestamp)) return [];
          const bucket = Math.floor(timestamp / timeframe) * timeframe;
          return [
            {
              color: "#ffb000",
              id: `${event.source ?? event.label}-${index}`,
              position: "aboveBar" as const,
              shape: "circle" as const,
              size: 0.8,
              text: compactEventLabel(event.label),
              time: bucket as UTCTimestamp,
            },
          ];
        })
        .sort((left, right) => Number(left.time) - Number(right.time)),
    [events, timeframe],
  );
  const focusAstroLevels = useMemo(() => {
    if (price === null) return [];

    const nearestEntry = parsedLevels
      .filter((level) => levelPurpose(level) === "entry")
      .sort(
        (left, right) =>
          Math.abs(left.price - price) - Math.abs(right.price - price),
      )[0];
    const target = parsedLevels
      .filter((level) => levelPurpose(level) === "target")
      .filter((level) =>
        signalState === "short"
          ? level.price < price
          : signalState === "long"
            ? level.price > price
            : true,
      )
      .sort(
        (left, right) =>
          Math.abs(left.price - price) - Math.abs(right.price - price),
      )[0];
    const invalidation = parsedLevels
      .filter((level) => levelPurpose(level) === "invalidation")
      .sort(
        (left, right) =>
          Math.abs(left.price - price) - Math.abs(right.price - price),
      )[0];
    const selected = [target, nearestEntry, invalidation]
      .filter((level): level is ParsedLevel => Boolean(level))
      .filter((level) => Math.abs(level.price - price) / price <= 0.1)
      .filter(
        (level, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.label === level.label && candidate.value === level.value,
          ) === index,
      );

    return selected.slice(0, 3);
  }, [parsedLevels, price, signalState]);
  const visibleAstroLevels = useMemo(
    () =>
      overlayMode === "astro" ? focusAstroLevels : [],
    [focusAstroLevels, overlayMode],
  );
  const visibleThesisLevels = useMemo(
    () =>
      overlayMode === "hermes"
        ? parsedThesisLevels
        : [],
    [overlayMode, parsedThesisLevels],
  );
  const visibleHermesCheckpoints = useMemo(() => {
    if (overlayMode !== "hermes" || hermesMapUnavailable) return [];
    let transition = 0;
    let confirmation = 0;
    let target = 0;
    return (hermesProjection?.checkpoints || [])
      .filter(
        (checkpoint) =>
          Number.isFinite(checkpoint.price) &&
          checkpoint.price >= 10_000 &&
          checkpoint.price <= 250_000,
      )
      .map((checkpoint) => {
        if (checkpoint.kind === "target") {
          target += 1;
          return { ...checkpoint, chartLabel: `HERMES TP${target}` };
        }
        if (checkpoint.kind === "confirmation") {
          confirmation += 1;
          return { ...checkpoint, chartLabel: `HERMES C${confirmation}` };
        }
        transition += 1;
        return { ...checkpoint, chartLabel: `HERMES T${transition}` };
      });
  }, [hermesMapUnavailable, hermesProjection, overlayMode]);
  const visibleEventMarkers = useMemo(
    () =>
      overlayMode === "model"
        || overlayMode === "hermes"
        ? []
        : overlayMode === "focus"
          ? eventMarkers.slice(-1)
          : eventMarkers.slice(-4),
    [eventMarkers, overlayMode],
  );
  const hermesProjectionPlan = useMemo(() => {
    const mapAnchorPrice = Number(hermesAnchorPrice);
    if (!hermesProjection || !Number.isFinite(mapAnchorPrice)) return null;

    const mapTimestamp = new Date(hermesAnchorTime || forecastTime).getTime();
    if (!Number.isFinite(mapTimestamp)) return null;
    const anchorTimestamp = Math.floor(mapTimestamp / 1_000 / timeframe) * timeframe;
    const currentIsDown = ["down", "down_then_up"].includes(
      hermesProjection.direction,
    );
    const longerIsUp = ["up", "down_then_up"].includes(
      hermesProjection.direction,
    );
    const stableCheckpoints = hermesProjection.checkpoints
      .filter(
        (checkpoint) =>
          Number.isFinite(checkpoint.price) &&
          Number.isFinite(checkpoint.horizonHours),
      )
      .sort((left, right) => left.horizonHours - right.horizonHours);
    if (stableCheckpoints.length < 2) return null;

    const transitionCheckpoint = stableCheckpoints.find(
      (checkpoint) => checkpoint.kind === "transition",
    ) ?? stableCheckpoints[0];
    const confirmationCheckpoint = stableCheckpoints.find(
      (checkpoint) => checkpoint.kind === "confirmation",
    ) ?? stableCheckpoints.find(
      (checkpoint) => checkpoint.horizonHours > transitionCheckpoint.horizonHours,
    );
    const targetCheckpoint = [...(stableCheckpoints ?? [])]
      .reverse()
      .find((checkpoint) => checkpoint.kind === "target") ??
      stableCheckpoints.at(-1)!;
    const transitionTime =
      anchorTimestamp +
      Math.max(timeframe * 2, transitionCheckpoint.horizonHours * 3_600);
    const confirmationTime = confirmationCheckpoint
      ? Math.max(
          transitionTime + timeframe * 2,
          anchorTimestamp + confirmationCheckpoint.horizonHours * 3_600,
        )
      : null;
    const targetTime = Math.max(
      (confirmationTime ?? transitionTime) + timeframe * 2,
      anchorTimestamp + targetCheckpoint.horizonHours * 3_600,
    );
    const transitionPoint: LineData<UTCTimestamp> = {
      time: transitionTime as UTCTimestamp,
      value: transitionCheckpoint.price,
    };
    const confirmationPoint = confirmationCheckpoint && confirmationTime
      ? {
          time: confirmationTime as UTCTimestamp,
          value: confirmationCheckpoint.price,
        }
      : null;
    const targetPoint: LineData<UTCTimestamp> = {
      time: targetTime as UTCTimestamp,
      value: targetCheckpoint.price,
    };
    const frozenPoints: LineData<UTCTimestamp>[] = [
      { time: anchorTimestamp as UTCTimestamp, value: mapAnchorPrice },
      transitionPoint,
      ...(confirmationPoint ? [confirmationPoint] : []),
      targetPoint,
    ];

    return {
      points: frozenPoints,
      upper: [],
      lower: [],
      anchorPrice: mapAnchorPrice,
      transitionPoint,
      confirmationPoint,
      targetPoint,
      transitionPrice: transitionCheckpoint.price,
      campaignTarget: targetCheckpoint.price,
      currentIsDown,
      longerIsUp,
      confidence: hermesProjection.confidence ?? predictedProbability,
    };
  }, [
    forecastTime,
    hermesAnchorPrice,
    hermesAnchorTime,
    hermesProjection,
    predictedProbability,
    timeframe,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 430,
      layout: {
        background: { type: ColorType.Solid, color: "#0d0f13" },
        textColor: "#777e8a",
        fontFamily: '"SFMono-Regular", Consolas, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.055)" },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: "rgba(255,176,0,0.36)",
          labelBackgroundColor: "#ffb000",
        },
        horzLine: {
          color: "rgba(255,176,0,0.36)",
          labelBackgroundColor: "#ffb000",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.09)",
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.09)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 3,
      },
      localization: {
        priceFormatter: (value: number) =>
          `$${new Intl.NumberFormat("en-US", {
            maximumFractionDigits: 0,
          }).format(value)}`,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#52e6a7",
      downColor: "#5b6370",
      borderVisible: false,
      wickUpColor: "#52e6a7",
      wickDownColor: "#747d89",
      priceLineColor: "#f3f0e8",
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
      lastValueVisible: true,
    });
    const markers = createSeriesMarkers(series, [], {
      autoScale: false,
    });
    const projectionSeries = chart.addSeries(LineSeries, {
      color: "rgba(122, 162, 255, 0.58)",
      lineWidth: 3,
      lineStyle: LineStyle.Dashed,
      lineType: LineType.Simple,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      title: "MODEL PATH",
    });
    const hermesUpperSeries = chart.addSeries(LineSeries, {
      color: "rgba(122, 162, 255, 0.34)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      lineType: LineType.Simple,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });
    const hermesLowerSeries = chart.addSeries(LineSeries, {
      color: "rgba(196, 125, 255, 0.30)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      lineType: LineType.Simple,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });
    const projectionMarkers = createSeriesMarkers(projectionSeries, [], {
      autoScale: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;
    projectionSeriesRef.current = projectionSeries;
    hermesUpperSeriesRef.current = hermesUpperSeries;
    hermesLowerSeriesRef.current = hermesLowerSeries;
    projectionMarkersRef.current = projectionMarkers;

    return () => {
      markers.detach();
      projectionMarkers.detach();
      priceLinesRef.current = [];
      markersRef.current = null;
      projectionMarkersRef.current = null;
      projectionSeriesRef.current = null;
      hermesUpperSeriesRef.current = null;
      hermesLowerSeriesRef.current = null;
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const projectionSeries = projectionSeriesRef.current;
    const projectionMarkers = projectionMarkersRef.current;
    const hermesUpperSeries = hermesUpperSeriesRef.current;
    const hermesLowerSeries = hermesLowerSeriesRef.current;
    if (
      !projectionSeries ||
      !projectionMarkers ||
      !hermesUpperSeries ||
      !hermesLowerSeries
    ) return;

    const hermesVisible =
      overlayMode === "hermes" &&
      !hermesMapUnavailable &&
      Boolean(hermesProjectionPlan);
    projectionSeries.applyOptions({
      visible: hermesVisible,
      color: "rgba(142, 177, 255, 0.88)",
      lineStyle: LineStyle.Solid,
      lineWidth: 4,
      title: "HERMES PATH",
    });
    hermesUpperSeries.applyOptions({ visible: false });
    hermesLowerSeries.applyOptions({ visible: false });

    if (overlayMode === "hermes" && hermesProjectionPlan) {
      projectionSeries.setData(hermesProjectionPlan.points);
      hermesUpperSeries.setData([]);
      hermesLowerSeries.setData([]);
      projectionMarkers.setMarkers([
        {
          color: "#ffb000",
          id: `hermes-transition-${forecastTime}`,
          position: hermesProjectionPlan.currentIsDown ? "belowBar" : "aboveBar",
          shape: "circle",
          size: 1,
          text: `1 · ${compactChartPrice(
            hermesProjectionPlan.transitionPrice,
          )}`,
          time: hermesProjectionPlan.transitionPoint.time,
        },
        {
          color: "#f3f0e8",
          id: `hermes-confirm-${forecastTime}`,
          position: "aboveBar",
          shape: "square",
          size: 1,
          text: `2 · ${compactChartPrice(
            hermesProjectionPlan.confirmationPoint?.value ??
              hermesProjectionPlan.transitionPoint.value,
          )}`,
          time:
            hermesProjectionPlan.confirmationPoint?.time ??
            hermesProjectionPlan.transitionPoint.time,
        },
        {
          color: hermesProjectionPlan.longerIsUp ? "#52e6a7" : "#ff6b66",
          id: `hermes-campaign-${forecastTime}`,
          position: hermesProjectionPlan.longerIsUp ? "aboveBar" : "belowBar",
          shape: "arrowUp",
          size: 1,
          text: `3 · ${compactChartPrice(
            hermesProjectionPlan.targetPoint.value,
          )}`,
          time: hermesProjectionPlan.targetPoint.time,
        },
      ]);
    } else {
      projectionSeries.setData([]);
      projectionMarkers.setMarkers([]);
      hermesUpperSeries.setData([]);
      hermesLowerSeries.setData([]);
      return;
    }

    const fitKey = `${forecastTime}-${timeframe}-${overlayMode}`;
    if (projectionFitKeyRef.current !== fitKey) {
      projectionFitKeyRef.current = fitKey;
      window.requestAnimationFrame(() => {
        chartRef.current?.timeScale().fitContent();
      });
    }
  }, [
    forecastTime,
    hermesMapUnavailable,
    hermesProjectionPlan,
    overlayMode,
    timeframe,
  ]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }

    priceLinesRef.current = [
      ...visibleAstroLevels.map((level) =>
        series.createPriceLine({
          price: level.price,
          color: levelColor(level.kind),
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title:
            overlayMode === "focus"
              ? focusLineLabel(level)
              : `${levelRole(level, price)} · ${level.shortLabel}`,
        }),
      ),
      ...visibleThesisLevels.map((level) =>
        series.createPriceLine({
          price: level.price,
          color: thesisLevelColor(level.thesisKind),
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `MODEL · ${level.shortLabel}`,
        }),
      ),
      ...visibleHermesCheckpoints.map((checkpoint) =>
        series.createPriceLine({
          price: checkpoint.price,
          color:
            checkpoint.kind === "target"
              ? "#52e6a7"
              : checkpoint.kind === "confirmation"
                ? "#f3f0e8"
                : "#8eb1ff",
          lineWidth: checkpoint.kind === "target" ? 2 : 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: checkpoint.chartLabel,
        }),
      ),
    ];
  }, [
    overlayMode,
    price,
    visibleAstroLevels,
    visibleHermesCheckpoints,
    visibleThesisLevels,
  ]);

  useEffect(() => {
    markersRef.current?.setMarkers(visibleEventMarkers);
  }, [visibleEventMarkers]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container) return;

    let animationFrame = 0;
    const updateZones = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const chartHeight = container.clientHeight;
        const zones = visibleAstroLevels.flatMap((level) => {
          if (level.high - level.low < 10) return [];
          const highCoordinate = series.priceToCoordinate(level.high);
          const lowCoordinate = series.priceToCoordinate(level.low);
          if (highCoordinate === null || lowCoordinate === null) return [];
          const rawTop = Math.min(highCoordinate, lowCoordinate);
          const rawBottom = Math.max(highCoordinate, lowCoordinate);
          if (rawBottom < 0 || rawTop > chartHeight) return [];
          const top = Math.max(0, rawTop);
          const bottom = Math.min(chartHeight, rawBottom);
          return [
            {
              ...level,
              top,
              height: Math.max(3, bottom - top),
            },
          ];
        });
        setZoneRects(zones);
      });
    };

    updateZonesRef.current = updateZones;
    const rangeHandler = () => updateZones();
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
    const resizeObserver = new ResizeObserver(updateZones);
    resizeObserver.observe(container);
    updateZones();

    return () => {
      updateZonesRef.current = () => {};
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler);
    };
  }, [visibleAstroLevels]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const controller = new AbortController();
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;

    async function connect() {
      setFeedState("loading");
      setFeedNote("Loading Coinbase candles…");

      try {
        const response = await fetch(
          `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${timeframe}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`Candle feed returned ${response.status}.`);
        }

        const rows = (await response.json()) as unknown[];
        const candles = mapCandles(rows);
        if (!candles.length) throw new Error("No candle data returned.");
        if (disposed) return;

        series.setData(candles);
        currentCandleRef.current = candles.at(-1) ?? null;
        setPrice(currentCandleRef.current?.close ?? null);
        chart.timeScale().fitContent();
        updateZonesRef.current();
        setFeedState("delayed");
        setFeedNote("Candles loaded · connecting live price…");

        socket = new WebSocket("wss://ws-feed.exchange.coinbase.com");
        socket.addEventListener("open", () => {
          socket?.send(
            JSON.stringify({
              type: "subscribe",
              product_ids: ["BTC-USD"],
              channels: ["ticker_batch"],
            }),
          );
        });

        socket.addEventListener("message", (event) => {
          if (disposed) return;
          try {
            const message = JSON.parse(String(event.data)) as {
              type?: string;
              product_id?: string;
              price?: string;
              time?: string;
            };
            if (
              message.type !== "ticker" ||
              message.product_id !== "BTC-USD" ||
              !message.price
            ) {
              return;
            }

            const nextPrice = Number(message.price);
            const timestamp = message.time
              ? Math.floor(new Date(message.time).getTime() / 1000)
              : Math.floor(Date.now() / 1000);
            if (!Number.isFinite(nextPrice) || !Number.isFinite(timestamp)) {
              return;
            }

            const bucket = Math.floor(timestamp / timeframe) * timeframe;
            const current = currentCandleRef.current;
            const nextCandle: CandlestickData<UTCTimestamp> =
              current && Number(current.time) === bucket
                ? {
                    ...current,
                    high: Math.max(current.high, nextPrice),
                    low: Math.min(current.low, nextPrice),
                    close: nextPrice,
                  }
                : {
                    time: bucket as UTCTimestamp,
                    open: current?.close ?? nextPrice,
                    high: nextPrice,
                    low: nextPrice,
                    close: nextPrice,
                  };

            currentCandleRef.current = nextCandle;
            series.update(nextCandle);
            updateZonesRef.current();
            setPrice(nextPrice);
            setFeedState("live");
            setFeedNote("Live · Coinbase BTC-USD");
          } catch {
            // Ignore unsupported feed messages.
          }
        });

        socket.addEventListener("error", () => {
          if (disposed) return;
          setFeedState("delayed");
          setFeedNote("Candles loaded · live feed reconnect needed");
        });

        socket.addEventListener("close", () => {
          if (disposed) return;
          setFeedState("delayed");
          setFeedNote("Candles loaded · reconnecting live price…");
          reconnectTimer = window.setTimeout(() => void connect(), 3_000);
        });
      } catch (error) {
        if (controller.signal.aborted || disposed) return;
        setFeedState("error");
        setFeedNote(
          error instanceof Error ? error.message : "Market feed unavailable.",
        );
      }
    }

    void connect();

    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(reconnectTimer);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "unsubscribe",
            product_ids: ["BTC-USD"],
            channels: ["ticker_batch"],
          }),
        );
      }
      socket?.close();
    };
  }, [timeframe]);

  const forecastLabel = useMemo(() => {
    const date = new Date(forecastTime);
    if (Number.isNaN(date.getTime())) return "latest validated read";
    return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }, [forecastTime]);

  return (
    <section className="live-chart-panel" aria-label="Live BTC chart with Astro levels">
      <div className="chart-live-head">
        <div>
          <span className="eyebrow">ASTRO / HERMES MAP</span>
          <h2>One chart. Two honest views.</h2>
          <p>Astro shows direct public evidence. Hermes shows a separate, scored prediction.</p>
        </div>
        <div className="live-quote" aria-live="polite">
          <span className={`feed-dot ${feedState}`} />
          <div>
            <strong>{formatPrice(price)}</strong>
            <small>{feedNote}</small>
          </div>
        </div>
      </div>

      <div className="chart-controls">
        <div className="chart-timeframes" aria-label="Chart timeframe">
          {timeframes.map((option) => (
            <button
              className={timeframe === option.seconds ? "active" : ""}
              key={option.label}
              onClick={() => setTimeframe(option.seconds)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="chart-overlay-toggle" aria-label="Chart information layer">
          {(["astro", "hermes"] as const).map((mode) => (
            <button
              aria-pressed={overlayMode === mode}
              className={overlayMode === mode ? "active" : ""}
              key={mode}
              onClick={() => {
                setOverlayMode(mode);
                if (mode === "hermes" && timeframe < 21_600) {
                  setTimeframe(21_600);
                }
              }}
              type="button"
            >
              {mode === "astro" ? "Astro confirmed" : "Hermes prediction"}
            </button>
          ))}
        </div>
      </div>

      <div className="live-chart-stage">
        <div ref={containerRef} />
        <div className="chart-zone-layer" aria-hidden="true">
          {zoneRects.map((zone) => (
            <i
              key={`${zone.label}-${zone.value}`}
              style={{
                background: levelFill(zone.kind),
                borderColor: levelColor(zone.kind),
                height: `${zone.height}px`,
                top: `${zone.top}px`,
              }}
            />
          ))}
        </div>
        {overlayMode === "astro" && (
          <div className={`chart-focus-hud ${signalState}`}>
            <div className="chart-hud-now">
              <small>ASTRO · CONFIRMED</small>
              <strong>{signalHeadline || signalLabel(signalState)}</strong>
            </div>
            <div className="chart-hud-next">
              <small>PUBLIC POSITION</small>
              <strong>{astroPosition}</strong>
            </div>
          </div>
        )}
        {overlayMode === "hermes" &&
          !hermesMapUnavailable &&
          hermesProjectionPlan && (
          <>
            <div className="chart-hermes-hud">
              <small>HERMES · PROBABILITY MAP</small>
              <strong>
                {hermesProjectionPlan.currentIsDown ? "FINISH ↓" : "BUILD ↑"}
                <i>→</i>
                CONFIRM
                <i>→</i>
                {hermesProjectionPlan.longerIsUp ? "CAMPAIGN ↑" : "CAMPAIGN ↓"}
              </strong>
              <span>
                {hermesProjectionPlan.confidence}% LEADING PATH · ANCHORED AT {compactChartPrice(hermesProjectionPlan.anchorPrice)} · {hermesHorizon}
              </span>
            </div>
            <div className="chart-hermes-legend">
              <span><i className="main" />Expected route</span>
              <small>Frozen map from the saved review · not Astro’s drawing</small>
            </div>
          </>
        )}
        {overlayMode === "hermes" && hermesMapUnavailable && (
          <div className="chart-hermes-rebuilding">
            <small>
              {hermesAudit?.integrity === "failed"
                ? "MAP INTEGRITY FAILED"
                : `OLD MAP ${hermesAudit?.marketStatus.toUpperCase()}`}
            </small>
            <strong>Hermes is rebuilding the path</strong>
            <span>{hermesAudit.outcomeReason || "The expected route failed."}</span>
          </div>
        )}
        {overlayMode === "hermes" &&
          !hermesMapUnavailable &&
          !hermesProjectionPlan && (
            <div className="chart-hermes-rebuilding">
              <small>NO FROZEN MAP</small>
              <strong>Hermes has not saved an anchored route</strong>
              <span>The chart will not draw a live-price guess.</span>
            </div>
          )}
        {feedState === "error" && (
          <div className="chart-feed-error">
            Live market data is temporarily unavailable. Astro’s validated map remains below.
          </div>
        )}
      </div>

      {overlayMode === "hermes" ? (
        <section className="chart-hermes-brief" aria-label="Hermes longer-horizon chart thesis">
          <header>
            <div>
              <small>HERMES · CURRENT PREDICTION</small>
              <strong>
                {hermesProjection?.direction.replaceAll("_", " → ").toUpperCase() ||
                  "DIRECTION PENDING"}
              </strong>
            </div>
            <button type="button" onClick={onOpenHermes}>Back to summary →</button>
          </header>
          <div className="hermes-route-explained">
            {(hermesProjection?.checkpoints || []).map((checkpoint, index) => (
              <article
                className={
                  index < (hermesAudit?.hitCheckpoints ?? 0)
                    ? "reached"
                    : "watching"
                }
                key={`${checkpoint.label}-${checkpoint.price}`}
              >
                <header>
                  <i>{index + 1}</i>
                  <span>
                    {index < (hermesAudit?.hitCheckpoints ?? 0)
                      ? "REACHED"
                      : checkpoint.kind === "transition"
                        ? "FIRST"
                        : checkpoint.kind === "confirmation"
                          ? "THEN CONFIRM"
                          : "LATER TARGET"}
                  </span>
                </header>
                <strong>{formatPrice(checkpoint.price)}</strong>
                <h3>{checkpoint.label}</h3>
                <p>{checkpoint.condition}</p>
                <small>EXPECTED WITHIN {checkpoint.horizonHours}H</small>
              </article>
            ))}
            {hermesProjection?.invalidation && (
              <article className="invalid">
                <header>
                  <i>×</i>
                  <span>DRAWING IS WRONG IF</span>
                </header>
                <strong>
                  {formatPrice(hermesProjection.invalidation.price)}
                </strong>
                <h3>Hermes must draw a new route</h3>
                <p>{hermesProjection.invalidation.condition}</p>
              </article>
            )}
          </div>
          <section className="chart-visible-reasons">
            <header>
              <small>WHY HERMES DREW THIS ROUTE</small>
              <strong>Three different inputs—not one guess</strong>
            </header>
            <div>
              <article>
                <small>1 · WHAT ASTRO CONFIRMED</small>
                <p>{astroConfirmed}</p>
              </article>
              <article>
                <small>2 · WHAT HERMES LEARNED</small>
                <p>{schoolMatch}</p>
              </article>
              <article>
                <small>3 · WHAT PRICE MUST DO</small>
                <p>{hermesConfirmation}</p>
              </article>
            </div>
          </section>
          {hermesAudit && (
            <div className={`chart-hermes-audit ${hermesAudit.marketStatus}`}>
              <span>
                {hermesAudit.evaluationQuality === "gap"
                  ? "DATA GAP · EXCLUDED"
                  : !hermesAudit.official
                  ? "EXPERIMENTAL · NOT SCORED"
                  : hermesAudit.marketStatus === "active"
                    ? "OFFICIAL LIVE MAP"
                    : hermesAudit.marketStatus === "hit"
                      ? "OFFICIAL PATH HIT"
                      : `${hermesAudit.marketStatus.toUpperCase()} · REBUILDING`}
              </span>
              <strong>
                {hermesAudit.hitCheckpoints}/{hermesAudit.totalCheckpoints} checkpoints
              </strong>
              <small>
                {hermesAudit.official
                  ? `ASTRO ${hermesAudit.behaviorAction?.replaceAll("_", " ") ?? "behavior"} · ${hermesAudit.behaviorStatus}`
                  : "Excluded from official score · v2 starts next map"}
              </small>
            </div>
          )}
          <details className="chart-brain-details">
            <summary>
              <span>
                <small>WHY THIS PATH</small>
                <strong>Open Hermes reasoning</strong>
              </span>
              <b>+</b>
            </summary>
            <div className="chart-brain-body">
              <div className="hermes-checkpoint-grid">
                {(hermesProjection?.checkpoints || []).map((checkpoint, index) => (
                  <article key={`${checkpoint.label}-${checkpoint.price}`}>
                    <header>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <small>{checkpoint.kind.toUpperCase()}</small>
                    </header>
                    <strong>{formatPrice(checkpoint.price)}</strong>
                    <h3>{checkpoint.label}</h3>
                    <p>{checkpoint.condition}</p>
                    <small>WITHIN {checkpoint.horizonHours}H</small>
                  </article>
                ))}
                {hermesProjection?.invalidation.price && (
                  <article className="invalidation">
                    <header><span>×</span><small>MODEL INVALIDATION</small></header>
                    <strong>{formatPrice(hermesProjection.invalidation.price)}</strong>
                    <h3>Hermes must rebuild</h3>
                    <p>{hermesProjection.invalidation.condition}</p>
                  </article>
                )}
              </div>
              <div className="chart-hermes-path">
                <article>
                  <small>WHAT HAPPENS FIRST</small>
                  <strong>{hermesCurrentPhase}</strong>
                </article>
                <i>→</i>
                <article>
                  <small>WHAT MUST CONFIRM</small>
                  <strong>{hermesNextPhase}</strong>
                </article>
                <i>→</i>
                <article>
                  <small>WHAT COMES LATER</small>
                  <strong>{hermesLongerMove}</strong>
                </article>
              </div>
              <div className="hermes-reason-grid">
                <article>
                  <small>1 · ASTRO DIRECT</small>
                  <strong>{astroConfirmed}</strong>
                  <span>Only direct Astro evidence enters this box.</span>
                </article>
                <article>
                  <small>2 · ASTRO SCHOOL MATCH</small>
                  <strong>{schoolMatch}</strong>
                  <span>Historical pattern; never treated as a new Astro call.</span>
                </article>
                <article>
                  <small>3 · MARKET CONDITION</small>
                  <strong>{marketContext}</strong>
                  <span>Price context used by Hermes only.</span>
                </article>
              </div>
              <footer>
                <div>
                  <small>CONFIRMATION</small>
                  <strong>{hermesConfirmation}</strong>
                </div>
                <div>
                  <small>WRONG IF</small>
                  <strong>{hermesFailure}</strong>
                </div>
              </footer>
            </div>
          </details>
        </section>
      ) : (
        <>
      <section className="chart-astro-only-brief" aria-label="Astro confirmed chart facts">
        <header>
          <div>
            <small>ASTRO · CONFIRMED ONLY</small>
            <strong>{signalHeadline || signalLabel(signalState)}</strong>
          </div>
          <span className={freshnessTone}>{freshnessLabel}</span>
        </header>
        <div>
          <article>
            <small>PUBLIC POSITION</small>
            <strong>{astroPosition}</strong>
            <p>{astroConfirmed}</p>
          </article>
          <article>
            <small>PUBLIC TP / MANAGEMENT</small>
            <strong>{astroTakeProfit}</strong>
            <p>No Hermes or market-only level is labeled as Astro.</p>
          </article>
          <article>
            <small>WHAT CHANGES IT</small>
            <strong>{riskText}</strong>
            <p>If no exact price is public, the chart does not invent one.</p>
          </article>
        </div>
      </section>
        </>
      )}

      <details className="chart-levels-details">
        <summary>
          <span>{overlayMode === "astro" ? "All Astro evidence" : "All Hermes reasoning"}</span>
          <small>
            {overlayMode === "astro"
              ? `${parsedLevels.length} Astro items`
              : `${visibleHermesCheckpoints.length} checkpoints · ${parsedThesisLevels.length} market levels`}
          </small>
        </summary>
        <div className="astro-level-legend">
          {overlayMode === "astro" && parsedLevels.map((level) => (
            <div key={`${level.label}-${level.value}`}>
              <i style={{ background: levelColor(level.kind) }} />
              <span>{level.shortLabel}</span>
              <strong>{level.value}</strong>
            </div>
          ))}
          {overlayMode === "hermes" && parsedThesisLevels.map((level) => (
            <div className="model-level" key={`model-${level.label}-${level.value}`}>
              <i style={{ background: thesisLevelColor(level.thesisKind) }} />
              <span>MODEL · {level.shortLabel}</span>
              <strong>{level.value}</strong>
              <small>{level.reason}</small>
            </div>
          ))}
        </div>
      </details>

      <div className="chart-source-note">
        <span>LIVE PRICE · REFERENCE ONLY</span>
        {overlayMode === "astro" ? (
          <>
            <span>SOLID · ASTRO CONFIRMED</span>
            <span>NO HERMES OR MARKET-ONLY LEVELS SHOWN</span>
          </>
        ) : (
          <>
            <span>DOTTED · HERMES CHECKPOINTS</span>
            <span>FROZEN PATH · SAVED HERMES MAP</span>
          </>
        )}
        <span>READ · {forecastLabel}</span>
      </div>
    </section>
  );
}
