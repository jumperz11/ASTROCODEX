"use client";

import {
  CandlestickSeries,
  ColorType,
  IChartApi,
  LineStyle,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

type StoredForecast = {
  generatedAt: string | null;
  confidence: number | null;
  decision: {
    position: string;
    status: string;
    lookingFor: string;
    risk: string;
  } | null;
  signal: { state: string; plainSummary: string } | null;
  thesis: {
    horizon: string;
    regime: string;
    astroConfirmed: string;
    modelRead: string;
    nextTrigger: string;
    failure: string;
  } | null;
  levels: Array<{ label: string; value: string; kind: string }>;
  thesisLevels: Array<{
    label: string;
    value: string;
    kind: string;
    reason: string;
  }>;
  scenarios: Array<{
    name: string;
    probability: number;
    description: string;
    trigger: string;
  }>;
  sources: Array<{ label: string; url: string }>;
};

type MarketSnapshot = {
  price: number;
  high24h: number;
  low24h: number;
  weeklyOpen: number;
  change24hPct: number;
};

type DailySnapshot = {
  date: string;
  checkedAt: string;
  changed: boolean;
  market: MarketSnapshot;
  forecast: StoredForecast;
};

type PlaySnapshot = {
  id: string;
  recordedAt: string;
  market: MarketSnapshot;
  forecast: StoredForecast;
};

type HistoryPayload = {
  updatedAt: string | null;
  daily: DailySnapshot[];
  plays: PlaySnapshot[];
  degraded?: boolean;
};

function numericLevel(value: string) {
  const normalized = value.toLowerCase().replaceAll(",", "");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return normalized.includes("k") && parsed < 1_000 ? parsed * 1_000 : parsed;
}

function money(value?: number | null) {
  if (!Number.isFinite(value)) return "—";
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value as number)}`;
}

function HistoryDayChart({ snapshot }: { snapshot: DailySnapshot | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [note, setNote] = useState("Loading archived candles…");

  useEffect(() => {
    if (!containerRef.current || !snapshot) return;
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
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.09)",
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.09)",
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#52e6a7",
      downColor: "#5b6370",
      borderVisible: false,
      wickUpColor: "#52e6a7",
      wickDownColor: "#747d89",
    });
    const controller = new AbortController();

    for (const level of snapshot.forecast.levels ?? []) {
      const price = numericLevel(level.value);
      if (!price) continue;
      series.createPriceLine({
        price,
        color:
          level.kind === "entry"
            ? "#52e6a7"
            : level.kind === "risk"
              ? "#ff6b66"
              : "#ffb000",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `ASTRO · ${level.label.slice(0, 18).toUpperCase()}`,
      });
    }
    for (const level of snapshot.forecast.thesisLevels ?? []) {
      const price = numericLevel(level.value);
      if (!price) continue;
      series.createPriceLine({
        price,
        color: level.kind === "upside" ? "#7aa2ff" : "#c47dff",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `MODEL · ${level.label.slice(0, 18).toUpperCase()}`,
      });
    }

    async function load() {
      try {
        const start = new Date(`${snapshot.date}T00:00:00.000Z`);
        const end = new Date(start.getTime() + 86_400_000);
        const url = new URL(
          "https://api.exchange.coinbase.com/products/BTC-USD/candles",
        );
        url.searchParams.set("granularity", "900");
        url.searchParams.set("start", start.toISOString());
        url.searchParams.set("end", end.toISOString());
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Archived candles unavailable.");
        const rows = (await response.json()) as number[][];
        const candles = rows
          .filter(
            (row) =>
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
        series.setData(candles);
        chart.timeScale().fitContent();
        setNote(`${snapshot.date} · Coinbase 15-minute candles`);
      } catch {
        if (!controller.signal.aborted) {
          setNote("The stored thesis is available; archived candles are delayed.");
        }
      }
    }
    void load();

    return () => {
      controller.abort();
      chartRef.current = null;
      chart.remove();
    };
  }, [snapshot]);

  return (
    <div className="history-chart-wrap">
      <div ref={containerRef} />
      <small>{note}</small>
    </div>
  );
}

export default function AstroHistory() {
  const [history, setHistory] = useState<HistoryPayload>({
    updatedAt: null,
    daily: [],
    plays: [],
  });
  const [mode, setMode] = useState<"days" | "plays">("days");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/live-history?ts=${Date.now()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as HistoryPayload;
        if (!active) return;
        setHistory(payload);
        const newest =
          mode === "days"
            ? payload.daily.at(-1)?.date
            : payload.plays.at(-1)?.id;
        setSelectedId((current) => current ?? newest ?? null);
      } catch {
        // Keep the last successfully loaded VPS history.
      }
    }
    void load();
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [mode]);

  const entries = useMemo(
    () =>
      mode === "days"
        ? [...history.daily].reverse().map((item) => ({
            id: item.date,
            date: item.date,
            checkedAt: item.checkedAt,
            changed: item.changed,
            market: item.market,
            forecast: item.forecast,
          }))
        : [...history.plays].reverse().map((item) => ({
            id: item.id,
            date: item.recordedAt.slice(0, 10),
            checkedAt: item.recordedAt,
            changed: true,
            market: item.market,
            forecast: item.forecast,
          })),
    [history.daily, history.plays, mode],
  );
  const selected = entries.find((item) => item.id === selectedId) ?? entries[0] ?? null;
  const chartSnapshot: DailySnapshot | null = selected
    ? {
        date: selected.date,
        checkedAt: selected.checkedAt,
        changed: selected.changed,
        market: selected.market,
        forecast: selected.forecast,
      }
    : null;

  function switchMode(next: "days" | "plays") {
    setMode(next);
    setSelectedId(null);
  }

  return (
    <section className="history-view">
      <div className="history-intro">
        <span className="eyebrow">ASTRO MEMORY</span>
        <h1>Every day. Every thesis. Every change.</h1>
        <p>
          Daily market snapshots and materially changed Astro reads are stored on
          the VPS. Confirmed Astro levels stay separate from our forward model.
        </p>
      </div>

      <div className="history-switch" role="tablist" aria-label="History type">
        <button
          className={mode === "days" ? "active" : ""}
          onClick={() => switchMode("days")}
        >
          Daily charts
        </button>
        <button
          className={mode === "plays" ? "active" : ""}
          onClick={() => switchMode("plays")}
        >
          Astro play changes
        </button>
      </div>

      {!selected ? (
        <div className="history-empty">
          <strong>History starts with the next VPS scan.</strong>
          <p>The live system will add today automatically—nothing is stored on this device.</p>
        </div>
      ) : (
        <div className="history-workspace">
          <aside className="history-rail">
            {entries.map((entry) => (
              <button
                className={selected.id === entry.id ? "active" : ""}
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
              >
                <span>{entry.date}</span>
                <strong>{entry.forecast.decision?.position ?? "Read pending"}</strong>
                <small>
                  {entry.changed ? "THESIS CHANGED" : "NO MATERIAL CHANGE"} ·{" "}
                  {money(entry.market?.price)}
                </small>
              </button>
            ))}
          </aside>

          <div className="history-main">
            <div className="history-day-head">
              <div>
                <small>{selected.date} · VPS SNAPSHOT</small>
                <h2>{selected.forecast.decision?.position ?? "Position not public"}</h2>
                <p>{selected.forecast.decision?.status}</p>
              </div>
              <div>
                <span>{selected.forecast.confidence ?? "—"}%</span>
                <small>evidence confidence</small>
              </div>
            </div>

            <HistoryDayChart snapshot={chartSnapshot} />

            <div className="history-thesis-grid">
              <article className="confirmed">
                <small>ASTRO CONFIRMED</small>
                <p>
                  {selected.forecast.thesis?.astroConfirmed ??
                    selected.forecast.decision?.status}
                </p>
              </article>
              <article className="model">
                <small>OUR FORWARD READ</small>
                <p>
                  {selected.forecast.thesis?.modelRead ??
                    selected.forecast.scenarios?.[0]?.description}
                </p>
              </article>
              <article className="trigger">
                <small>NEXT TRIGGER</small>
                <p>
                  {selected.forecast.thesis?.nextTrigger ??
                    selected.forecast.decision?.lookingFor}
                </p>
              </article>
              <article className="failure">
                <small>READ BREAKS IF</small>
                <p>
                  {selected.forecast.thesis?.failure ??
                    selected.forecast.decision?.risk}
                </p>
              </article>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
