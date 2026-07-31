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
type OverlayMode = "focus" | "astro" | "model";
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
    !/historical|planned|virtual|residual|not public/.test(text)
  ) {
    return "entry";
  }
  return "context";
}

function focusLineLabel(level: ParsedLevel) {
  const purpose = levelPurpose(level);
  if (purpose === "entry") return "ENTRY";
  if (purpose === "target") return "TARGET";
  if (purpose === "invalidation") return "INVALID";
  return levelRole(level, null);
}

function compactLabel(label: string) {
  const lowered = label.toLowerCase();
  if (lowered.includes("weekly open")) return "WEEKLY OPEN";
  if (lowered.includes("long v")) return "LONG V ENTRY";
  if (lowered.includes("short iv")) return "SHORT IV · CLOSED";
  if (lowered.includes("initial long trim")) return "FIRST TRIM";
  if (lowered.includes("hv liquidity")) return "TP · CLOSE 30%";
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
  thesisTrigger,
  forecastTime,
  signalState,
  signalHeadline,
  riskText,
  predictedMove,
  predictedProbability,
  predictionSummary,
  predictionTrigger,
  readerStep,
}: {
  events: AstroEvent[];
  freshnessLabel: string;
  freshnessTone: string;
  levels: AstroLevel[];
  thesisLevels: ThesisLevel[];
  thesisTrigger: string;
  forecastTime: string;
  signalState: SignalState;
  signalHeadline: string;
  riskText: string;
  predictedMove: string;
  predictedProbability: number;
  predictionSummary: string;
  predictionTrigger: string;
  readerStep: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const projectionSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const projectionMarkersRef =
    useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
  const markersRef =
    useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
  const currentCandleRef =
    useRef<CandlestickData<UTCTimestamp> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const updateZonesRef = useRef<() => void>(() => {});
  const projectionFitKeyRef = useRef("");
  const [timeframe, setTimeframe] = useState(3600);
  const [price, setPrice] = useState<number | null>(null);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [feedNote, setFeedNote] = useState("Loading Coinbase candles…");
  const [zoneRects, setZoneRects] = useState<ZoneRect[]>([]);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("focus");
  const [latestCandleTime, setLatestCandleTime] = useState<number | null>(null);

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
  const nextAstroLevel = useMemo(() => {
    if (price === null) return null;
    const directional = parsedLevels
      .filter((level) => levelPurpose(level) === "target")
      .filter((level) =>
        signalState === "short"
          ? level.price < price - 5
          : signalState === "long"
            ? level.price > price + 5
            : true,
      )
      .sort(
        (left, right) =>
          Math.abs(left.price - price) - Math.abs(right.price - price),
      );
    const fallback = parsedLevels
      .filter((level) => levelPurpose(level) === "target")
      .sort(
        (left, right) =>
          Math.abs(left.price - price) - Math.abs(right.price - price),
      );
    const next = directional[0] ?? fallback[0];
    if (!next) return null;
    return {
      ...next,
      distance: (Math.abs(next.price - price) / price) * 100,
    };
  }, [parsedLevels, price, signalState]);
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
      overlayMode === "focus"
        ? focusAstroLevels
        : overlayMode === "astro"
          ? parsedLevels
          : [],
    [focusAstroLevels, overlayMode, parsedLevels],
  );
  const visibleThesisLevels = useMemo(
    () =>
      overlayMode === "model"
        ? parsedThesisLevels
        : [],
    [overlayMode, parsedThesisLevels],
  );
  const visibleEventMarkers = useMemo(
    () =>
      overlayMode === "model"
        ? []
        : overlayMode === "focus"
          ? eventMarkers.slice(-1)
          : eventMarkers.slice(-4),
    [eventMarkers, overlayMode],
  );
  const projectionPlan = useMemo(() => {
    if (price === null) return null;

    const combinedPrediction =
      `${predictedMove} ${predictionSummary} ${predictionTrigger}`.toLowerCase();
    const bias: "long" | "short" | "range" =
      signalState === "short" ||
      /\b(short|downside|dog|bear|reject|fomc)\b/.test(combinedPrediction)
        ? "short"
        : signalState === "long" ||
            /\b(long|upside|extension|bull|reclaim)\b/.test(combinedPrediction)
          ? "long"
          : "range";

    const snapshotAnchor = price;
    const forecastTimestamp = Math.floor(
      new Date(forecastTime).getTime() / 1000,
    );
    const anchorTimestamp =
      latestCandleTime ??
      (Number.isFinite(forecastTimestamp)
        ? Math.floor(forecastTimestamp / timeframe) * timeframe
        : 0);

    const reasonLevels = parsedThesisLevels.flatMap((level) =>
      [...level.reason.toLowerCase().matchAll(/(\d+(?:\.\d+)?)k\b/g)].map(
        (match) => Number(match[1]) * 1_000,
      ),
    );
    const confirmedTargets = parsedLevels
      .filter((level) => levelPurpose(level) === "target")
      .map((level) => ({
        price: level.price,
        kind: level.price < snapshotAnchor
          ? ("downside" as const)
          : ("upside" as const),
        confirmed: true,
      }));
    const candidateLevels = [
      ...confirmedTargets,
      ...parsedThesisLevels.map((level) => ({
        price: level.price,
        kind: level.thesisKind,
        confirmed: false,
      })),
      ...reasonLevels.map((reasonPrice) => ({
        price: reasonPrice,
        kind: reasonPrice < snapshotAnchor ? "downside" : "upside",
        confirmed: false,
      })),
    ].filter(
      (level) =>
        Number.isFinite(level.price) &&
        level.price > snapshotAnchor * 0.8 &&
        level.price < snapshotAnchor * 1.2,
    );
    const above = candidateLevels
      .filter((level) => level.price > snapshotAnchor * 1.001)
      .sort((left, right) => left.price - right.price);
    const below = candidateLevels
      .filter((level) => level.price < snapshotAnchor * 0.999)
      .sort((left, right) => right.price - left.price);
    const nearestWatchAbove = above.find((level) => level.kind === "watch");
    const nearestWatchBelow = below.find((level) => level.kind === "watch");
    const directionalTarget =
      bias === "long"
        ? above.find((level) => level.confirmed) ??
          above.find((level) => level.kind === "upside") ??
          above[0]
        : bias === "short"
          ? below.find((level) => level.confirmed) ??
            below.find((level) => level.kind === "downside") ??
            below[0]
          : nearestWatchAbove ?? nearestWatchBelow;

    if (!directionalTarget) return null;

    const waypoint =
      bias === "short"
        ? nearestWatchAbove
        : bias === "long"
          ? nearestWatchBelow
          : undefined;
    const targetPrice = directionalTarget.price;
    const points: LineData<UTCTimestamp>[] = [
      {
        time: anchorTimestamp as UTCTimestamp,
        value: snapshotAnchor,
      },
    ];

    if (waypoint) {
      points.push(
        {
          time: (anchorTimestamp + timeframe * 2) as UTCTimestamp,
          value: snapshotAnchor + (waypoint.price - snapshotAnchor) * 0.55,
        },
        {
          time: (anchorTimestamp + timeframe * 4) as UTCTimestamp,
          value: waypoint.price,
        },
        {
          time: (anchorTimestamp + timeframe * 7) as UTCTimestamp,
          value: waypoint.price + (targetPrice - waypoint.price) * 0.58,
        },
      );
    } else {
      points.push(
        {
          time: (anchorTimestamp + timeframe * 3) as UTCTimestamp,
          value: snapshotAnchor + (targetPrice - snapshotAnchor) * 0.42,
        },
        {
          time: (anchorTimestamp + timeframe * 6) as UTCTimestamp,
          value: snapshotAnchor + (targetPrice - snapshotAnchor) * 0.72,
        },
      );
    }

    points.push({
      time: (anchorTimestamp + timeframe * 10) as UTCTimestamp,
      value: targetPrice,
    });

    return {
      bias,
      points,
      targetPrice,
      anchorTimestamp,
      confidence: predictedProbability,
    };
  }, [
    forecastTime,
    latestCandleTime,
    parsedLevels,
    parsedThesisLevels,
    predictedMove,
    predictedProbability,
    predictionSummary,
    predictionTrigger,
    price,
    signalState,
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
      lineType: LineType.Curved,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      title: "MODEL PATH",
    });
    const projectionMarkers = createSeriesMarkers(projectionSeries, [], {
      autoScale: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;
    projectionSeriesRef.current = projectionSeries;
    projectionMarkersRef.current = projectionMarkers;

    return () => {
      markers.detach();
      projectionMarkers.detach();
      priceLinesRef.current = [];
      markersRef.current = null;
      projectionMarkersRef.current = null;
      projectionSeriesRef.current = null;
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const projectionSeries = projectionSeriesRef.current;
    const projectionMarkers = projectionMarkersRef.current;
    if (!projectionSeries || !projectionMarkers) return;

    const visible = overlayMode !== "astro" && Boolean(projectionPlan);
    projectionSeries.applyOptions({
      visible,
      color:
        projectionPlan?.bias === "short"
          ? "rgba(255, 107, 102, 0.62)"
          : projectionPlan?.bias === "long"
            ? "rgba(82, 230, 167, 0.62)"
            : "rgba(122, 162, 255, 0.58)",
    });
    if (!projectionPlan) {
      projectionSeries.setData([]);
      projectionMarkers.setMarkers([]);
      return;
    }

    projectionSeries.setData(projectionPlan.points);
    projectionMarkers.setMarkers([
      {
        color: "rgba(122, 162, 255, 0.72)",
        id: `model-path-${forecastTime}-${timeframe}`,
        position:
          projectionPlan.bias === "short" ? "belowBar" : "aboveBar",
        shape: "circle",
        size: 0.7,
        text: `MODEL ${projectionPlan.confidence}%`,
        time: projectionPlan.points.at(-1)!.time,
      },
    ]);
    const fitKey = `${forecastTime}-${timeframe}`;
    if (projectionFitKeyRef.current !== fitKey) {
      projectionFitKeyRef.current = fitKey;
      window.requestAnimationFrame(() => {
        chartRef.current?.timeScale().fitContent();
      });
    }
  }, [forecastTime, overlayMode, projectionPlan, timeframe]);

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
    ];
  }, [overlayMode, price, visibleAstroLevels, visibleThesisLevels]);

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
        setLatestCandleTime(
          currentCandleRef.current
            ? Number(currentCandleRef.current.time)
            : null,
        );
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
            setLatestCandleTime(bucket);
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
          <span className="eyebrow">LIVE ASTRO MAP</span>
          <h2>BTC / USD</h2>
          <p>Live price, the active Astro map, and one clearly separated model path.</p>
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
          {(["focus", "astro", "model"] as const).map((mode) => (
            <button
              aria-pressed={overlayMode === mode}
              className={overlayMode === mode ? "active" : ""}
              key={mode}
              onClick={() => setOverlayMode(mode)}
              type="button"
            >
              {mode === "focus" ? "Plan" : mode === "astro" ? "All Astro" : "Forecast"}
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
        {overlayMode === "focus" && (
          <div className={`chart-focus-hud ${signalState}`}>
            <div className="chart-hud-now">
              <small>ASTRO NOW</small>
              <strong>{signalHeadline || signalLabel(signalState)}</strong>
            </div>
            <div className="chart-hud-next">
              <small>MODEL NEXT · {predictedProbability}%</small>
              <strong>{predictedMove}</strong>
            </div>
          </div>
        )}
        {projectionPlan && overlayMode !== "astro" && (
          <div className={`chart-projection-key ${projectionPlan.bias}`}>
            <small>MODEL PATH · NOT ASTRO</small>
            <strong>
              {projectionPlan.bias === "short"
                ? `LOWER → ${formatPrice(projectionPlan.targetPrice)}`
                : projectionPlan.bias === "long"
                  ? `HIGHER → ${formatPrice(projectionPlan.targetPrice)}`
                  : `WATCH → ${formatPrice(projectionPlan.targetPrice)}`}
            </strong>
            <span>{projectionPlan.confidence}% MODEL WEIGHT</span>
          </div>
        )}
        {feedState === "error" && (
          <div className="chart-feed-error">
            Live market data is temporarily unavailable. Astro’s validated map remains below.
          </div>
        )}
      </div>

      <section
        className={`chart-mobile-brief ${signalState}`}
        aria-label="What the chart means now"
      >
        <header>
          <div>
            <small>ASTRO SIGNAL</small>
            <strong>{signalHeadline || signalLabel(signalState)}</strong>
          </div>
          <div>
            <small>NEXT-MOVE MODEL</small>
            <strong>{predictedProbability}%</strong>
          </div>
        </header>

        <article className="chart-mobile-prediction">
          <small>EXPECTED NEXT</small>
          <strong>{predictedMove}</strong>
          <p>{readerStep}</p>
        </article>

        <div className="chart-mobile-brief-grid">
          <article>
            <small>LIVE PRICE</small>
            <strong>{formatPrice(price)}</strong>
          </article>
          <article>
            <small>NEXT LEVEL</small>
            <strong>
              {nextAstroLevel
                ? formatPrice(nextAstroLevel.price)
                : "No confirmed target"}
            </strong>
            <span>
              {nextAstroLevel
                ? `${nextAstroLevel.distance.toFixed(1)}% away`
                : "Wait for direct evidence"}
            </span>
          </article>
        </div>

        <article className="chart-mobile-condition">
          <small>CONFIRMS IF</small>
          <strong>{predictionTrigger}</strong>
        </article>

        <article className="chart-mobile-condition risk">
          <small>WRONG / CHANGES IF</small>
          <strong>{riskText}</strong>
        </article>
      </section>

      <div className="chart-decision-strip">
        <div className={`chart-decision-now ${signalState}`}>
          <small>ASTRO SIGNAL · NOW</small>
          <strong>{signalHeadline || signalLabel(signalState)}</strong>
          <span className={freshnessTone}>{freshnessLabel}</span>
        </div>
        <div>
          <small>NEXT ASTRO AREA</small>
          {nextAstroLevel ? (
            <>
              <strong>
                {nextAstroLevel.shortLabel} · {formatPrice(nextAstroLevel.price)}
              </strong>
              <span>{nextAstroLevel.distance.toFixed(1)}% away</span>
            </>
          ) : (
            <>
              <strong>No confirmed target</strong>
              <span>Wait for a new direct update</span>
            </>
          )}
        </div>
        <div className="chart-model-watch">
          <small>PREDICTED ASTRO NEXT · MODEL</small>
          <strong>{predictedMove} · {predictedProbability}%</strong>
          <span>{thesisTrigger} · inference, not a quote</span>
        </div>
      </div>

      <details className="chart-levels-details">
        <summary>
          <span>All chart levels</span>
          <small>{parsedLevels.length} Astro · {parsedThesisLevels.length} model</small>
        </summary>
        <div className="astro-level-legend">
          {parsedLevels.map((level) => (
            <div key={`${level.label}-${level.value}`}>
              <i style={{ background: levelColor(level.kind) }} />
              <span>{level.shortLabel}</span>
              <strong>{level.value}</strong>
            </div>
          ))}
          {parsedThesisLevels.map((level) => (
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
        <span>MARKET · Coinbase public BTC-USD feed</span>
        <span>SOLID · ASTRO CONFIRMED</span>
        <span>DOTTED · MODEL THESIS</span>
        <span>GHOST PATH · MODEL PREDICTION</span>
        <span>READ · {forecastLabel}</span>
      </div>
    </section>
  );
}
