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
  trackRecord?: TrackRecord;
  degraded?: boolean;
};

type AuditedPlay = {
  id: string;
  name: string;
  direction: "LONG" | "SHORT";
  status: "win" | "loss" | "open" | "unscored";
  openedAt: string;
  closedAt: string | null;
  entry: string;
  targets: string;
  result: string;
  why: string;
  sources: Array<{ label: string; url: string }>;
};

type TrackRecord = {
  reviewedAt: string;
  method: string;
  astroClaim: { label: string; detail: string };
  plays: AuditedPlay[];
};

function shortDate(value?: string | null) {
  if (!value) return "Still open";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function outcomeLabel(status: AuditedPlay["status"]) {
  return {
    win: "RIGHT",
    loss: "WRONG",
    open: "OPEN",
    unscored: "NOT SCORED",
  }[status];
}

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
  const [mode, setMode] = useState<"record" | "days" | "plays">("record");
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
            : mode === "plays"
              ? payload.plays.at(-1)?.id
              : null;
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
        : mode === "plays"
          ? [...history.plays].reverse().map((item) => ({
            id: item.id,
            date: item.recordedAt.slice(0, 10),
            checkedAt: item.recordedAt,
            changed: true,
            market: item.market,
            forecast: item.forecast,
          }))
          : [],
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

  const scored = history.trackRecord?.plays.filter(
    (play) => play.status === "win" || play.status === "loss",
  ) ?? [];
  const wins = scored.filter((play) => play.status === "win").length;
  const losses = scored.filter((play) => play.status === "loss").length;
  const open = history.trackRecord?.plays.filter(
    (play) => play.status === "open",
  ).length ?? 0;
  const winRate = scored.length >= 5
    ? `${Math.round((wins / scored.length) * 100)}%`
    : "Too early";

  function switchMode(next: "record" | "days" | "plays") {
    setMode(next);
    setSelectedId(null);
  }

  return (
    <section className="history-view">
      <div className="history-intro">
        <span className="eyebrow">TRACK RECORD</span>
        <h1>What was right. What is still open.</h1>
        <p>
          A clean, evidence-backed record. Open trades never count as wins, and
          Astro&apos;s own claims stay separate from our verified score.
        </p>
      </div>

      <div className="history-switch" role="tablist" aria-label="History type">
        <button
          className={mode === "record" ? "active" : ""}
          onClick={() => switchMode("record")}
        >
          Results
        </button>
        <button
          className={mode === "days" ? "active" : ""}
          onClick={() => switchMode("days")}
        >
          Day by day
        </button>
        <button
          className={mode === "plays" ? "active" : ""}
          onClick={() => switchMode("plays")}
        >
          Thesis changes
        </button>
      </div>

      {mode === "record" ? (
        <div className="record-view">
          <div className="record-score-grid">
            <article className="record-score primary">
              <small>VERIFIED RIGHT</small>
              <strong>{wins}</strong>
              <span>Closed plays that passed our rules</span>
            </article>
            <article className="record-score">
              <small>VERIFIED WRONG</small>
              <strong>{losses}</strong>
              <span>Closed plays that failed</span>
            </article>
            <article className="record-score">
              <small>STILL OPEN</small>
              <strong>{open}</strong>
              <span>Not included in the score</span>
            </article>
            <article className="record-score">
              <small>SUCCESS RATE</small>
              <strong className="record-rate">{winRate}</strong>
              <span>{scored.length}/5 minimum verified results</span>
            </article>
          </div>

          <div className="record-truth-bar">
            <div>
              <small>ASTRO&apos;S PUBLIC CLAIM</small>
              <strong>{history.trackRecord?.astroClaim.label ?? "Not loaded"}</strong>
            </div>
            <p>
              {history.trackRecord?.astroClaim.detail ??
                "His claimed streak is not part of our verified score."}
            </p>
          </div>

          <div className="record-section-head">
            <div>
              <small>AUDITED PLAY LEDGER</small>
              <h2>One play = one result</h2>
            </div>
            <p>Entry → targets → outcome → proof</p>
          </div>

          <div className="play-ledger">
            {history.trackRecord?.plays.map((play) => (
              <article className={`play-record ${play.status}`} key={play.id}>
                <header>
                  <div>
                    <span className={`outcome-pill ${play.status}`}>
                      {outcomeLabel(play.status)}
                    </span>
                    <small>{play.direction}</small>
                  </div>
                  <time>
                    {shortDate(play.openedAt)} → {shortDate(play.closedAt)}
                  </time>
                </header>
                <h3>{play.name}</h3>
                <strong className="play-result">{play.result}</strong>
                <div className="play-route">
                  <div>
                    <small>ENTRY</small>
                    <strong>{play.entry}</strong>
                  </div>
                  <i aria-hidden="true">→</i>
                  <div>
                    <small>TARGETS / CLOSE</small>
                    <strong>{play.targets}</strong>
                  </div>
                </div>
                <p>{play.why}</p>
                <footer>
                  {play.sources.map((source) => (
                    <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
                      {source.label} ↗
                    </a>
                  ))}
                </footer>
              </article>
            ))}
          </div>

          <details className="score-method">
            <summary>How we count a result</summary>
            <p>{history.trackRecord?.method}</p>
            <ul>
              <li>The call must be public before the move.</li>
              <li>Direction and entry must be clear enough to freeze.</li>
              <li>A later post or market record must resolve it.</li>
              <li>Open, deleted, vague, or conflicting calls stay unscored.</li>
            </ul>
          </details>
        </div>
      ) : !selected ? (
        <div className="history-empty">
          <strong>No saved snapshots yet.</strong>
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
                <small>
                  {selected.date} · {mode === "days" ? "DAILY SNAPSHOT" : "THESIS CHANGE"}
                </small>
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
