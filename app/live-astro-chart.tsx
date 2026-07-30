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
  high: number;
  low: number;
  price: number;
  shortLabel: string;
};

type FeedState = "loading" | "live" | "delayed" | "error";
type SignalState =
  | "wait"
  | "long"
  | "short"
  | "take_profit"
  | "exit"
  | "conflict";

type AstroEvent = {
  label: string;
  source?: string;
  time?: string;
};

type ZoneRect = ParsedLevel & {
  height: number;
  top: number;
};

const timeframes = [
  { label: "15M", seconds: 900 },
  { label: "1H", seconds: 3600 },
  { label: "6H", seconds: 21600 },
  { label: "1D", seconds: 86400 },
] as const;

function parseLevel(level: AstroLevel): ParsedLevel | null {
  const normalized = level.value.toLowerCase().replaceAll(",", "");
  const values = [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0]),
  );
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const usesThousands = normalized.includes("k");
  const prices = values.map((value) =>
    usesThousands && value < 1_000 ? value * 1_000 : value,
  );
  const low = Math.min(...prices);
  const high = Math.max(...prices);

  return {
    ...level,
    low,
    high,
    price: (low + high) / 2,
    shortLabel: compactLabel(level.label),
  };
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
}: {
  events: AstroEvent[];
  freshnessLabel: string;
  freshnessTone: string;
  levels: AstroLevel[];
  thesisLevels: ThesisLevel[];
  thesisTrigger: string;
  forecastTime: string;
  signalState: SignalState;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef =
    useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
  const currentCandleRef =
    useRef<CandlestickData<UTCTimestamp> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const updateZonesRef = useRef<() => void>(() => {});
  const [timeframe, setTimeframe] = useState(3600);
  const [price, setPrice] = useState<number | null>(null);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [feedNote, setFeedNote] = useState("Loading Coinbase candles…");
  const [zoneRects, setZoneRects] = useState<ZoneRect[]>([]);

  const parsedLevels = useMemo(
    () =>
      levels
        .map(parseLevel)
        .filter((level): level is ParsedLevel => level !== null),
    [levels],
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
    const next = parsedLevels
      .filter((level) => level.kind === "trim" && level.price > price + 5)
      .sort((left, right) => left.price - right.price)[0];
    if (!next) return null;
    return {
      ...next,
      distance: ((next.price - price) / price) * 100,
    };
  }, [parsedLevels, price]);

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
        rightOffset: 7,
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

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;

    return () => {
      markers.detach();
      priceLinesRef.current = [];
      markersRef.current = null;
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }

    priceLinesRef.current = [
      ...parsedLevels.map((level) =>
        series.createPriceLine({
          price: level.price,
          color: levelColor(level.kind),
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `ASTRO · ${level.shortLabel}`,
        }),
      ),
      ...parsedThesisLevels.map((level) =>
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
  }, [parsedLevels, parsedThesisLevels]);

  useEffect(() => {
    markersRef.current?.setMarkers(eventMarkers);
  }, [eventMarkers]);

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
        const zones = parsedLevels.flatMap((level) => {
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
  }, [parsedLevels]);

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
          <span className="eyebrow">LIVE ASTRO MAP</span>
          <h2>BTC / USD</h2>
          <p>Live market structure, Astro-confirmed levels, and a separate forward model.</p>
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
        <span>Drag to inspect · pinch to zoom</span>
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
        <div className={`chart-signal-pill ${signalState}`}>
          <small>ASTRO SIGNAL</small>
          <strong>{signalLabel(signalState)}</strong>
          <span className={freshnessTone}>{freshnessLabel}</span>
        </div>
        {nextAstroLevel && (
          <div className="next-level-pill">
            <small>NEXT ASTRO AREA</small>
            <strong>
              {nextAstroLevel.shortLabel} · {formatPrice(nextAstroLevel.price)}
            </strong>
            <span>{nextAstroLevel.distance.toFixed(1)}% away</span>
          </div>
        )}
        <div className="model-trigger-pill">
          <small>MODEL IS WATCHING</small>
          <strong>{thesisTrigger}</strong>
          <span>Inference · not an Astro quote</span>
        </div>
        {feedState === "error" && (
          <div className="chart-feed-error">
            Live market data is temporarily unavailable. Astro’s validated map remains below.
          </div>
        )}
      </div>

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

      <div className="chart-source-note">
        <span>MARKET · Coinbase public BTC-USD feed</span>
        <span>SOLID · ASTRO CONFIRMED</span>
        <span>DOTTED · MODEL THESIS</span>
        <span>READ · {forecastLabel}</span>
      </div>
    </section>
  );
}
