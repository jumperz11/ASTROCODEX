"use client";

import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineStyle,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

type AstroLevel = {
  label: string;
  value: string;
  kind: "entry" | "trim" | "risk";
};

type ParsedLevel = AstroLevel & {
  high: number;
  low: number;
  price: number;
  shortLabel: string;
};

type FeedState = "loading" | "live" | "delayed" | "error";

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
  levels,
  forecastTime,
}: {
  levels: AstroLevel[];
  forecastTime: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const currentCandleRef =
    useRef<CandlestickData<UTCTimestamp> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const [timeframe, setTimeframe] = useState(3600);
  const [price, setPrice] = useState<number | null>(null);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [feedNote, setFeedNote] = useState("Loading Coinbase candles…");

  const parsedLevels = useMemo(
    () =>
      levels
        .map(parseLevel)
        .filter((level): level is ParsedLevel => level !== null),
    [levels],
  );

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

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      priceLinesRef.current = [];
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

    priceLinesRef.current = parsedLevels.map((level) =>
      series.createPriceLine({
        price: level.price,
        color: levelColor(level.kind),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: level.shortLabel,
      }),
    );
  }, [parsedLevels]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const controller = new AbortController();
    let disposed = false;
    let socket: WebSocket | null = null;

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
          setFeedNote("Candles loaded · live feed paused");
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
          <p>Market candles with levels extracted from Astro’s public posts and charts.</p>
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
      </div>

      <div className="chart-source-note">
        <span>MARKET · Coinbase public BTC-USD feed</span>
        <span>ASTRO OVERLAYS · {forecastLabel}</span>
      </div>
    </section>
  );
}
