"use client";

import { useEffect, useMemo, useState } from "react";
import liveForecast from "./forecast.json";
import AstroHistory from "./astro-history";
import LiveAstroChart from "./live-astro-chart";

type Evidence = {
  type: "astro" | "framework" | "inference";
  label: string;
  detail: string;
  source?: string;
  time?: string;
};

type ExecutionLevel = {
  state: string;
  level: string;
  condition: string;
};

type SignalState =
  | "wait"
  | "long"
  | "short"
  | "take_profit"
  | "exit"
  | "conflict";

type SimpleSignal = {
  state: SignalState;
  plainSummary: string;
  astroMayDo: string;
  readerStep: string;
  changesWhen: string;
};

type Forecast = {
  generatedAt: string;
  mode: "live" | "demo";
  market: string;
  stance: string;
  stanceTone: "long" | "short" | "neutral";
  confidence: number;
  headline: string;
  summary: string;
  nextMove: string;
  invalidation: string;
  waitFor: string;
  decision: {
    position: string;
    status: string;
    lookingFor: string;
    playbookMove: string;
    risk: string;
  };
  signal: SimpleSignal;
  execution: {
    entry: ExecutionLevel;
    takeProfit: ExecutionLevel;
    exit: ExecutionLevel;
  };
  thesis: {
    horizon: string;
    regime: string;
    astroConfirmed: string;
    modelRead: string;
    nextTrigger: string;
    failure: string;
  };
  thesisLevels: Array<{
    label: string;
    value: string;
    kind: "watch" | "upside" | "downside";
    reason: string;
  }>;
  bias: {
    cyclical: string;
    weekly: string;
    swing: string;
  };
  framework: {
    phase: string;
    typeA: string;
    sentiment: string;
    score: string;
  };
  levels: Array<{ label: string; value: string; kind: "entry" | "trim" | "risk" }>;
  evidence: Evidence[];
  scenarios: Array<{
    name: string;
    probability: number;
    description: string;
    trigger: string;
  }>;
  sources: Array<{ label: string; url: string }>;
  caveat: string;
};

const initialForecast: Forecast = {
  generatedAt: "2026-07-30T12:30:00+01:00",
  mode: "demo",
  market: "BTC / USD",
  stance: "Long active · profits being realized",
  stanceTone: "long",
  confidence: 72,
  headline: "Protect the long. Do not chase the fifth win.",
  summary:
    "Astro publicly flipped his closed shorts into a long, then reported trims as price advanced. The observable behavior is execution-first: lock profit into strength while leaving room for the remaining thesis.",
  nextMove:
    "Most likely: protect the remaining long, watch the referenced “safe house,” and wait for fresh confirmation before adding. A new short is not supported by the latest public sequence yet.",
  invalidation:
    "A decisive failure back through the post-bounce structure would weaken the long thesis. Exact invalidation is not public in the visible thread.",
  waitFor:
    "A fresh Astro post, a clearly stated target, or a structure change that explains what “safe house” means on his chart.",
  decision: {
    position: "Reduced long / runner",
    status: "Profit locked · waiting for confirmation",
    lookingFor: "Weekly liquidity and a clear safe-house level",
    playbookMove: "Manage the runner; do not chase a fresh full-size entry.",
    risk: "Runner closes or aggressive shorts return.",
  },
  signal: {
    state: "wait",
    plainSummary: "There is no confirmed new trade to follow.",
    astroMayDo:
      "He may keep a small piece of his current trade open. He has already taken some profit.",
    readerStep:
      "Wait for a new Astro post. Do not use his old entry price as a new entry.",
    changesWhen:
      "Astro clearly says he closed this trade or started a different one.",
  },
  execution: {
    entry: {
      state: "WAIT",
      level: "Not public",
      condition: "No fresh full-size entry is supported by the latest posts.",
    },
    takeProfit: {
      state: "PARTIALS TAKEN",
      level: "64K confirmed · 67.7K flagged",
      condition: "Further locks are more likely if weekly liquidity is reached.",
    },
    exit: {
      state: "CONDITIONAL",
      level: "Not public",
      condition: "Runner closes or aggressive short IV returns.",
    },
  },
  thesis: {
    horizon: "Intraweek",
    regime: "Recovery inside a larger unresolved bearish thesis",
    astroConfirmed:
      "Astro flipped into Long V, took staged profit, and kept structural Short III public.",
    modelRead:
      "The playbook favors protecting any runner while waiting for weekly-open acceptance or a renewed downside trigger.",
    nextTrigger:
      "Price reaction at the weekly open and a fresh direct Astro position update.",
    failure:
      "A direct full close, aggressive short re-add, or a new thesis that supersedes the dual-book read.",
  },
  thesisLevels: [
    {
      label: "Weekly-open decision",
      value: "~65.5K",
      kind: "watch",
      reason: "Known objective and likely decision area, not a fresh entry.",
    },
  ],
  bias: {
    cyclical: "Range / repair",
    weekly: "Bottoming range",
    swing: "Bullish recovery",
  },
  framework: {
    phase: "Trend → range",
    typeA: "Retest sequence active",
    sentiment: "Cautious after rebound",
    score: "Not enough live inputs",
  },
  levels: [
    { label: "Public long area", value: "~64.0K", kind: "entry" },
    { label: "Reported trim", value: "67.7K", kind: "trim" },
    { label: "Exact risk", value: "Not public", kind: "risk" },
  ],
  evidence: [
    {
      type: "astro",
      label: "Astro said",
      detail:
        "“Fully closed shorts IV, and started flipping it into a long.”",
      source: "https://x.com/astronomer_zero/status/2082560085994434700",
      time: "17h",
    },
    {
      type: "astro",
      label: "Astro said",
      detail:
        "He later reported taking profit around 64K and 67.7K, describing five live wins in a row.",
      source: "https://x.com/astronomer_zero/status/2082796525126856769",
      time: "1h",
    },
    {
      type: "framework",
      label: "Framework-derived",
      detail:
        "Astro’s archive favors gradual execution: enter, compound selectively, then realize profit in stages instead of treating a thesis as binary.",
      time: "Codex Ch. 2–3",
    },
    {
      type: "inference",
      label: "Our inference",
      detail:
        "Because profit has already been realized, the next likely action is management of a runner—not an immediate fresh full-size position.",
      time: "Model synthesis",
    },
  ],
  scenarios: [
    {
      name: "Continuation",
      probability: 48,
      description:
        "The recovery extends; Astro continues trimming into strength and protects a runner.",
      trigger: "Hold above the post-bounce structure",
    },
    {
      name: "Retest",
      probability: 34,
      description:
        "Price revisits the developing range before another directional decision.",
      trigger: "Momentum stalls after the public trims",
    },
    {
      name: "Thesis failure",
      probability: 18,
      description:
        "The bounce fails and the public long is closed or materially reduced.",
      trigger: "Confirmed structure failure",
    },
  ],
  sources: [
    {
      label: "Astro · latest long thesis",
      url: "https://x.com/astronomer_zero/status/2082560085994434700",
    },
    {
      label: "Astro · reported profit trim",
      url: "https://x.com/astronomer_zero/status/2082796525126856769",
    },
  ],
  caveat:
    "This is a timestamped inference from public posts and the archived framework—not Astro’s private intent, financial advice, or a guaranteed trade.",
};

function deriveSignal(report: Forecast): SimpleSignal {
  const entryState = report.execution?.entry?.state?.toUpperCase() ?? "WAIT";
  const noFreshEntry =
    entryState.includes("WAIT") ||
    entryState.includes("DONE") ||
    entryState.includes("CLOSED") ||
    report.confidence < 65;

  if (noFreshEntry) {
    return {
      state: "wait",
      plainSummary: "There is no confirmed new trade to follow.",
      astroMayDo:
        "He may keep a small piece of his current trade open. He has already taken some profit.",
      readerStep:
        "Wait for a new Astro post. Do not use his old entry price as a new entry.",
      changesWhen:
        "Astro clearly says he closed this trade or started a different one.",
    };
  }

  return {
    state: report.stanceTone === "short" ? "short" : "long",
    plainSummary: "Astro may have posted a new trade setup.",
    astroMayDo:
      "He appears to be following a new idea that still needs confirmation.",
    readerStep:
      "Open his newest post and check the price and timing before considering anything.",
    changesWhen: "Astro cancels it, takes profit, or posts a different move.",
  };
}

function normalizeForecast(report: Forecast): Forecast {
  return {
    ...report,
    decision:
      report.decision ?? {
        position: report.stance || "Position not public",
        status: "Legacy snapshot · refresh for the compact read",
        lookingFor: report.waitFor || "A fresh direct Astro update",
        playbookMove: report.nextMove || "Wait for confirmation",
        risk: report.invalidation || "A new thesis supersedes this read",
      },
    signal: report.signal ?? deriveSignal(report),
    execution:
      report.execution ?? {
        entry: {
          state: "WAIT",
          level: "Not public",
          condition: "No verified fresh entry level in this snapshot.",
        },
        takeProfit: {
          state: "MANAGE",
          level:
            report.levels.find((level) => level.kind === "trim")?.value ??
            "Not public",
          condition: report.nextMove || "Wait for a direct management update.",
        },
        exit: {
          state: "CONDITIONAL",
          level:
            report.levels.find((level) => level.kind === "risk")?.value ??
            "Not public",
          condition:
            report.decision?.risk ??
            report.invalidation ??
            "A new direct thesis supersedes the current read.",
        },
      },
    thesis:
      report.thesis ?? {
        horizon: "Next public update",
        regime: report.framework?.phase ?? "Regime not yet classified",
        astroConfirmed:
          report.decision?.status ?? "No fresh direct Astro confirmation.",
        modelRead:
          report.nextMove ?? "Wait for the next evidence-backed change.",
        nextTrigger:
          report.decision?.lookingFor ?? report.waitFor ?? "Fresh direct evidence",
        failure:
          report.decision?.risk ??
          report.invalidation ??
          "A new direct thesis supersedes this read.",
      },
    thesisLevels: report.thesisLevels ?? [],
  };
}

function getSimpleNextMove(forecast: Forecast) {
  const labels: Record<SignalState, string> = {
    wait: "WAIT",
    long: "LONG",
    short: "SHORT",
    take_profit: "TAKE PROFIT",
    exit: "EXIT",
    conflict: "WAIT · CONFLICT",
  };
  return {
    action: labels[forecast.signal.state],
    summary: forecast.signal.plainSummary,
    astro: forecast.signal.astroMayDo,
    you: forecast.signal.readerStep,
    change: forecast.signal.changesWhen,
  };
}

function getOpportunityStatus(forecast: Forecast) {
  const copy: Record<
    SignalState,
    { label: string; tone: string; summary: string }
  > = {
    wait: {
      label: "WAIT",
      tone: "wait",
      summary: "No fresh opportunity is confirmed yet.",
    },
    long: {
      label: "LONG SETUP",
      tone: "long",
      summary: "A fresh long setup is supported by a direct Astro update.",
    },
    short: {
      label: "SHORT SETUP",
      tone: "short",
      summary: "A fresh short setup is supported by a direct Astro update.",
    },
    take_profit: {
      label: "LOCK PROFIT",
      tone: "take_profit",
      summary: "Astro posted a fresh trim or profit-lock update.",
    },
    exit: {
      label: "EXIT UPDATE",
      tone: "exit",
      summary: "Astro posted a full close or explicit invalidation.",
    },
    conflict: {
      label: "NO TRADE",
      tone: "conflict",
      summary: "Astro’s words and chart disagree. Wait for clarity.",
    },
  };
  return copy[forecast.signal.state];
}

const embeddedForecast =
  (liveForecast as Forecast).mode === "live"
    ? normalizeForecast(liveForecast as Forecast)
    : initialForecast;

type LiveSignalEnvelope = {
  forecast: Forecast;
  checkedAt: string | null;
  source: "vps" | "bundled";
  degraded?: boolean;
  status?: string;
  runId?: string | null;
  model?: string | null;
  codexEntries?: number;
};

async function fetchLiveSignal(): Promise<LiveSignalEnvelope> {
  const response = await fetch(`/api/live-signal?ts=${Date.now()}`, {
    cache: "no-store",
  });
  const data = (await response.json()) as LiveSignalEnvelope & {
    error?: string;
  };
  if (!response.ok || !data.forecast) {
    throw new Error(data.error || "The validated signal is unavailable.");
  }
  return data;
}

const rules = [
  {
    index: "01",
    title: "Direction before execution",
    body: "No bias, no trade. Establish the highest relevant timeframe first, then descend.",
    source: "Ch. 1 · message 619",
  },
  {
    index: "02",
    title: "Timeframe translation",
    body: "Bias timeframe ≈ execution timeframe × 12. Treat the ratio as guidance, not a rigid law.",
    source: "Ch. 1 · messages 178–184",
  },
  {
    index: "03",
    title: "Patterns, not fractals",
    body: "Use repeatable formats that adapt to context. Exact historical shapes are not predictions.",
    source: "Ch. 3 · messages 4254–4261",
  },
  {
    index: "04",
    title: "Data + logic",
    body: "Combine minimally correlated evidence; confidence must not come from several copies of one signal.",
    source: "Ch. 2 · messages 716–739",
  },
  {
    index: "05",
    title: "Plan before position",
    body: "A position changes only after the thesis changes. Document triggers, targets and invalidation first.",
    source: "Ch. 2 · messages 2893–2905",
  },
  {
    index: "06",
    title: "Sentiment confirms",
    body: "Sentiment follows recent price action. It confirms an existing plan; it does not create one alone.",
    source: "Ch. 4 · messages 4699–4799",
  },
];

function Tag({ type }: { type: Evidence["type"] }) {
  const copy = {
    astro: "ASTRO SAID",
    framework: "FRAMEWORK",
    inference: "INFERENCE",
  };
  return <span className={`source-tag ${type}`}>{copy[type]}</span>;
}

function PositionJourney({
  evidence,
  position,
}: {
  evidence: Evidence[];
  position: string;
}) {
  const publicSteps = evidence
    .filter((item) => item.type === "astro")
    .slice(0, 4);

  return (
    <div className="position-journey" aria-label="Verified Astro position timeline">
      {publicSteps.map((item, index) => (
        <a
          className="journey-step complete"
          href={item.source}
          key={`${item.label}-${index}`}
          target="_blank"
          rel="noreferrer"
        >
          <span className="journey-dot">{index + 1}</span>
          <small>{item.time}</small>
          <strong>{item.label}</strong>
        </a>
      ))}
      <div className="journey-step current">
        <span className="journey-dot">●</span>
        <small>NOW · INFERRED</small>
        <strong>{position}</strong>
      </div>
    </div>
  );
}

export default function Home() {
  const [forecast, setForecast] = useState<Forecast>(embeddedForecast);
  const [activeView, setActiveView] =
    useState<"desk" | "history" | "evidence" | "playbook">("desk");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState("Validated Grok snapshot");
  const [signalCheckedAt, setSignalCheckedAt] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState({
    degraded: true,
    model: null as string | null,
    codexEntries: 0,
    runId: null as string | null,
  });
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [hasUnseenUpdate, setHasUnseenUpdate] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const envelope = await fetchLiveSignal();
        if (!active) return;
        const normalized = normalizeForecast(envelope.forecast);
        setForecast((current) => {
          const seenForecast = window.localStorage.getItem(
            "astro-intel-seen-forecast",
          );
          const changed = current.generatedAt !== normalized.generatedAt;
          const generatedAt = new Date(normalized.generatedAt).getTime();
          const recentlyGenerated =
            Number.isFinite(generatedAt) &&
            Date.now() - generatedAt <= 60 * 60_000;
          if (
            (changed && seenForecast !== normalized.generatedAt) ||
            (!seenForecast && recentlyGenerated)
          ) {
            setHasUnseenUpdate(true);
          }
          return normalized;
        });
        setSignalCheckedAt(envelope.checkedAt);
        setSystemStatus({
          degraded: Boolean(envelope.degraded) || envelope.source !== "vps",
          model: envelope.model ?? null,
          codexEntries: Number(envelope.codexEntries || 0),
          runId: envelope.runId ?? null,
        });
        setLastUpdated(
          envelope.source === "vps"
            ? "VPS live signal"
            : "Validated Grok snapshot",
        );
        window.localStorage.setItem(
          "astro-intel-last-forecast",
          JSON.stringify(normalized),
        );
      } catch {
        if (!active) return;
        const saved = window.localStorage.getItem("astro-intel-last-forecast");
        if (!saved) return;
        try {
          setForecast(normalizeForecast(JSON.parse(saved) as Forecast));
          setLastUpdated("Restored validated snapshot");
        } catch {
          window.localStorage.removeItem("astro-intel-last-forecast");
        }
      }
    }

    void load();
    const refresh = window.setInterval(() => void load(), 15_000);

    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, []);

  useEffect(() => {
    const clock = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  const timeLabel = useMemo(() => {
    const date = new Date(forecast.generatedAt);
    if (Number.isNaN(date.getTime())) return "Latest";
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${hour}:${minute} UTC`;
  }, [forecast.generatedAt]);
  const simpleNextMove = useMemo(
    () => getSimpleNextMove(forecast),
    [forecast],
  );
  const opportunity = useMemo(
    () => getOpportunityStatus(forecast),
    [forecast],
  );
  const predictedNextMove = useMemo(
    () =>
      [...forecast.scenarios].sort(
        (left, right) => right.probability - left.probability,
      )[0] ?? null,
    [forecast.scenarios],
  );
  const latestAstroEvidence = useMemo(() => {
    const direct = forecast.evidence.filter(
      (item) => item.type === "astro" && item.source,
    );
    return (
      [...direct].sort((left, right) => {
        const leftTime = new Date(left.time || "").getTime();
        const rightTime = new Date(right.time || "").getTime();
        if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return 0;
        return rightTime - leftTime;
      })[0] ?? null
    );
  }, [forecast.evidence]);
  const signalFreshness = useMemo(() => {
    if (!signalCheckedAt) {
      return { label: "VPS CONNECTING", tone: "scheduled" };
    }
    const checked = new Date(signalCheckedAt).getTime();
    if (!Number.isFinite(checked)) {
      return { label: "CHECK TIME UNKNOWN", tone: "stale" };
    }
    const ageMinutes = Math.max(0, Math.floor((clockNow - checked) / 60_000));
    if (ageMinutes <= 3) {
      return { label: "LIVE · CHECKED NOW", tone: "live" };
    }
    if (ageMinutes <= 10) {
      return { label: `CHECKED ${ageMinutes}M AGO`, tone: "aging" };
    }
    return { label: `LATE · ${ageMinutes}M AGO`, tone: "stale" };
  }, [clockNow, signalCheckedAt]);

  async function refreshForecast() {
    setLoading(true);
    setNotice("");
    try {
      const envelope = await fetchLiveSignal();
      const normalized = normalizeForecast(envelope.forecast);
      setForecast((current) => {
        if (current.generatedAt !== normalized.generatedAt) {
          setHasUnseenUpdate(true);
        }
        return normalized;
      });
      setSignalCheckedAt(envelope.checkedAt);
      setSystemStatus({
        degraded: Boolean(envelope.degraded) || envelope.source !== "vps",
        model: envelope.model ?? null,
        codexEntries: Number(envelope.codexEntries || 0),
        runId: envelope.runId ?? null,
      });
      setLastUpdated(
        envelope.source === "vps"
          ? "VPS live signal"
          : "Validated Grok snapshot",
      );
      window.localStorage.setItem(
        "astro-intel-last-forecast",
        JSON.stringify(normalized),
      );
      setNotice("Loaded the newest forecast accepted by the evidence gate.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to refresh right now.");
    } finally {
      setLoading(false);
    }
  }

  function showView(view: "desk" | "history" | "evidence" | "playbook") {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function markCurrentUpdateSeen() {
    window.localStorage.setItem(
      "astro-intel-seen-forecast",
      forecast.generatedAt,
    );
    setHasUnseenUpdate(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Astro Intelligence home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>
            <strong>ASTRO</strong>
            <small>INTELLIGENCE</small>
          </span>
        </a>

        <nav aria-label="Primary navigation">
          <button className={activeView === "desk" ? "active" : ""} onClick={() => showView("desk")}>Now</button>
          <button className={activeView === "history" ? "active" : ""} onClick={() => showView("history")}>History</button>
          <button className={activeView === "evidence" ? "active" : ""} onClick={() => showView("evidence")}>Evidence</button>
          <button className={activeView === "playbook" ? "active" : ""} onClick={() => showView("playbook")}>Playbook</button>
        </nav>

        <div className="status-cluster">
          <span
            className={`connection-dot ${
              systemStatus.degraded ? "stale" : forecast.mode
            }`}
          />
          <span>{systemStatus.degraded ? "Protected snapshot" : "Systems live"}</span>
          <button className="sync-button" onClick={refreshForecast} disabled={loading}>
            {loading ? "Syncing…" : "Sync"}
          </button>
        </div>
      </header>

      {activeView === "desk" && (
        <div className="desk" id="top">
          <section className="quick-view">
            <div className="live-meta">
              <span>
                <i
                  className={`connection-dot ${
                    systemStatus.degraded ? "stale" : forecast.mode
                  }`}
                />
                Grok connected · evidence gated
                {systemStatus.model
                  ? ` · ${systemStatus.model.replace("grok-", "Grok ")}`
                  : ""}
              </span>
              <span>{lastUpdated} · {timeLabel}</span>
            </div>

            <div
              className="system-health-strip"
              aria-label="System connection status"
              title={systemStatus.runId ? `Latest scan ${systemStatus.runId}` : undefined}
            >
              <span className={signalFreshness.tone}>
                <i /> Signal {signalFreshness.label.toLowerCase()}
              </span>
              <span className={systemStatus.codexEntries > 0 ? "live" : "stale"}>
                <i /> Astro Codex{" "}
                {systemStatus.codexEntries > 0
                  ? `${systemStatus.codexEntries.toLocaleString()} memories`
                  : "connecting"}
              </span>
              <span className={systemStatus.degraded ? "stale" : "live"}>
                <i /> {systemStatus.degraded ? "Using safe snapshot" : "VPS connected"}
              </span>
            </div>

            <aside
              className={`latest-update-flash ${
                hasUnseenUpdate ? "new" : ""
              }`}
              aria-live="polite"
            >
              <div className="latest-update-copy">
                <small>
                  <i />
                  {hasUnseenUpdate ? "NEW ASTRO UPDATE" : "LATEST ASTRO UPDATE"}
                  <span>{timeLabel}</span>
                </small>
                <strong>
                  {latestAstroEvidence?.label || forecast.headline}
                </strong>
                <p>
                  {latestAstroEvidence?.detail ||
                    "No newer direct Astro evidence has been accepted."}
                </p>
              </div>
              <div className="latest-update-actions">
                <a
                  href={
                    latestAstroEvidence?.source ||
                    forecast.sources[0]?.url ||
                    "https://x.com/astronomer_zero"
                  }
                  onClick={markCurrentUpdateSeen}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open post ↗
                </a>
                {hasUnseenUpdate && (
                  <button onClick={markCurrentUpdateSeen} type="button">
                    Mark seen
                  </button>
                )}
              </div>
            </aside>

            <section
              className={`opportunity-command ${opportunity.tone}`}
              aria-label="Simple next move and opportunity status"
            >
              <header>
                <span><i />ASTRO NEXT-MOVE MODEL</span>
                <small className={signalFreshness.tone}>
                  {signalFreshness.label}
                </small>
              </header>

              {predictedNextMove && (
                <div className="prediction-lead">
                  <div>
                    <small>BEFORE HIS NEXT POST · MODEL FORECAST</small>
                    <strong>{predictedNextMove.name}</strong>
                    <p>{predictedNextMove.description}</p>
                  </div>
                  <div className="prediction-probability">
                    <strong>{predictedNextMove.probability}%</strong>
                    <small>MODEL WEIGHT</small>
                  </div>
                  <div className="prediction-trigger">
                    <small>THIS BECOMES MORE LIKELY IF</small>
                    <strong>{predictedNextMove.trigger}</strong>
                  </div>
                </div>
              )}

              <div className="opportunity-command-grid">
                <article className="opportunity-primary">
                  <small>CONFIRMED SIGNAL</small>
                  <strong>{opportunity.label}</strong>
                  <p>{opportunity.summary}</p>
                  <span>WHAT YOU DO</span>
                  <em>{simpleNextMove.you}</em>
                </article>
                <article className="opportunity-position">
                  <small>ASTRO POSITION</small>
                  <strong>{forecast.decision.position}</strong>
                  <p>{forecast.decision.status}</p>
                  <div>
                    <span>READ CONFIDENCE</span>
                    <b>{forecast.confidence}%</b>
                  </div>
                </article>
              </div>

              <div className="opportunity-levels">
                <article>
                  <small>AREA</small>
                  <strong>{forecast.execution.entry.level}</strong>
                  <p>{forecast.execution.entry.state}</p>
                </article>
                <article>
                  <small>ACTIVATES WHEN</small>
                  <strong>{forecast.decision.lookingFor}</strong>
                  <p>{forecast.execution.entry.condition}</p>
                </article>
                <article>
                  <small>READ IS WRONG IF</small>
                  <strong>{forecast.decision.risk}</strong>
                  <p>{simpleNextMove.change}</p>
                </article>
              </div>

              <footer>
                <small>WHAT ASTRO MAY DO NEXT</small>
                <p>{simpleNextMove.astro}</p>
              </footer>
            </section>

            <div className="position-actions">
              <a
                href={
                  latestAstroEvidence?.source ||
                  forecast.sources[0]?.url ||
                  "https://x.com/astronomer_zero"
                }
                onClick={markCurrentUpdateSeen}
                target="_blank"
                rel="noreferrer"
              >
                Open latest Astro post ↗
              </a>
              <button onClick={() => showView("evidence")}>Why this read</button>
              <button onClick={() => showView("history")}>Previous moves</button>
            </div>
            {notice && <p className="notice">{notice}</p>}
          </section>

          <LiveAstroChart
            events={forecast.evidence.filter(
              (item) => item.type === "astro" && item.source && item.time,
            )}
            freshnessLabel={signalFreshness.label}
            freshnessTone={signalFreshness.tone}
            levels={forecast.levels}
            thesisLevels={forecast.thesisLevels}
            thesisTrigger={forecast.thesis.nextTrigger}
            forecastTime={forecast.generatedAt}
            signalState={forecast.signal.state}
            riskText={forecast.decision.risk}
            predictedMove={predictedNextMove?.name || "Insufficient inputs"}
            predictedProbability={predictedNextMove?.probability ?? 0}
          />

          <details className="current-analysis-details">
            <summary>
              <span>Deeper current analysis</span>
              <small>Thesis · levels · scenarios · reasoning</small>
            </summary>
            <div>
          <section className="forward-thesis" aria-label="Forward Astro thesis">
            <div className="simple-section-head">
              <div>
                <span className="eyebrow">ONE STEP AHEAD</span>
                <h2>What Astro confirmed vs what the playbook suggests next.</h2>
              </div>
              <p>{forecast.thesis.horizon} · {forecast.thesis.regime}</p>
            </div>
            <div className="forward-thesis-grid">
              <article className="confirmed">
                <small>ASTRO CONFIRMED</small>
                <p>{forecast.thesis.astroConfirmed}</p>
              </article>
              <article className="model">
                <small>OUR MODEL READ</small>
                <p>{forecast.thesis.modelRead}</p>
              </article>
              <article className="trigger">
                <small>NEXT TRIGGER</small>
                <p>{forecast.thesis.nextTrigger}</p>
              </article>
              <article className="failure">
                <small>MODEL IS WRONG IF</small>
                <p>{forecast.thesis.failure}</p>
              </article>
            </div>
          </section>

          <section className="execution-map" id="map">
            <div className="simple-section-head">
              <div>
                <span className="eyebrow">OPEN & CLOSE MAP</span>
                <h2>What the public playbook supports.</h2>
              </div>
              <p>Astro’s map—not a personal trade instruction.</p>
            </div>

            <div className="execution-cards">
              <article className="execution-card entry-card">
                <div className="execution-card-top">
                  <span>01</span>
                  <small>OPEN / ADD</small>
                  <em>{forecast.execution.entry.state}</em>
                </div>
                <strong>{forecast.execution.entry.level}</strong>
                <p>{forecast.execution.entry.condition}</p>
              </article>

              <article className="execution-card profit-card">
                <div className="execution-card-top">
                  <span>02</span>
                  <small>REDUCE / TAKE PROFIT</small>
                  <em>{forecast.execution.takeProfit.state}</em>
                </div>
                <strong>{forecast.execution.takeProfit.level}</strong>
                <p>{forecast.execution.takeProfit.condition}</p>
              </article>

              <article className="execution-card exit-card">
                <div className="execution-card-top">
                  <span>03</span>
                  <small>CLOSE / INVALIDATE</small>
                  <em>{forecast.execution.exit.state}</em>
                </div>
                <strong>{forecast.execution.exit.level}</strong>
                <p>{forecast.execution.exit.condition}</p>
              </article>
            </div>
          </section>

          <section className="journey-panel">
            <div className="simple-section-head">
              <div>
                <span className="eyebrow">POSITION TIMELINE</span>
                <h2>What actually happened.</h2>
              </div>
              <p>Green steps link to Astro’s original posts.</p>
            </div>
            <PositionJourney
              evidence={forecast.evidence}
              position={forecast.decision.position}
            />
          </section>

          <section className="insight-panel">
            <div className="insight-grid">
              <article className="insight-card watch">
                <small>WATCHING NOW</small>
                <h2>{forecast.decision.lookingFor}</h2>
              </article>
              <article className="insight-card risk">
                <small>READ CHANGES IF</small>
                <h2>{forecast.decision.risk}</h2>
              </article>
            </div>

            <div className="scenario-simple">
              <div className="scenario-lead">
                <div>
                  <small>MOST LIKELY PATH</small>
                  <h2>{forecast.scenarios[0]?.name}</h2>
                </div>
                <strong>{forecast.scenarios[0]?.probability}%</strong>
              </div>
              <div className="probability-bar">
                <i style={{ width: `${forecast.scenarios[0]?.probability}%` }} />
              </div>
              <p>{forecast.scenarios[0]?.description}</p>
              <small>TRIGGER · {forecast.scenarios[0]?.trigger}</small>

              <details className="other-paths">
                <summary>See the other two paths <span>+</span></summary>
                <div>
                  {forecast.scenarios.slice(1).map((scenario) => (
                    <article key={scenario.name}>
                      <span>{scenario.probability}%</span>
                      <div>
                        <strong>{scenario.name}</strong>
                        <p>{scenario.description}</p>
                        <small>TRIGGER · {scenario.trigger}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            </div>
          </section>

          <section className="details-panel">
            <details className="read-details">
              <summary>Full reasoning <span>+</span></summary>
              <div>
                <span className="eyebrow">{forecast.headline}</span>
                <p>{forecast.summary}</p>
                <p><strong>Next-move reasoning:</strong> {forecast.nextMove}</p>
              </div>
            </details>
          </section>
            </div>
          </details>
        </div>
      )}

      {activeView === "history" && <AstroHistory />}

      {activeView === "evidence" && (
        <section className="evidence-view">
          <div className="view-intro">
            <span className="eyebrow">SOURCE LEDGER</span>
            <h1>Every conclusion should survive an audit.</h1>
            <p>
              Direct statements, framework rules, and probabilistic inference remain visibly separate.
            </p>
          </div>
          <div className="evidence-ledger">
            {forecast.evidence.map((item, index) => (
              <article key={`${item.label}-${index}`}>
                <div className="ledger-index">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <div className="ledger-meta">
                    <Tag type={item.type} />
                    <span>{item.time}</span>
                  </div>
                  <p>{item.detail}</p>
                  {item.source && (
                    <a href={item.source} target="_blank" rel="noreferrer">
                      Inspect source ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
          <div className="caveat-box">
            <span>BOUNDARY</span>
            <p>{forecast.caveat}</p>
          </div>
        </section>
      )}

      {activeView === "playbook" && (
        <section className="playbook-view">
          <div className="view-intro">
            <span className="eyebrow">VERSIONED RULEBOOK</span>
            <h1>The method underneath the prediction.</h1>
            <p>
              These are the durable decision rules extracted from the private archive. Corrections remain versioned.
            </p>
          </div>
          <div className="rule-grid">
            {rules.map((rule) => (
              <article key={rule.index}>
                <span>{rule.index}</span>
                <h2>{rule.title}</h2>
                <p>{rule.body}</p>
                <small>{rule.source}</small>
              </article>
            ))}
          </div>
          <div className="version-log">
            <div>
              <span>RULE UPDATE</span>
              <strong>Type A catastrophic invalidation</strong>
            </div>
            <p>
              Earlier archive reference: 35%. Later detailed rule: 25%. The engine uses the later rule and preserves the earlier statement for audit.
            </p>
          </div>
        </section>
      )}

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={activeView === "desk" ? "active" : ""} onClick={() => showView("desk")}>
          <span>●</span>Now
        </button>
        <button className={activeView === "evidence" ? "active" : ""} onClick={() => showView("evidence")}>
          <span>≡</span>Evidence
        </button>
        <button className={activeView === "history" ? "active" : ""} onClick={() => showView("history")}>
          <span>↺</span>History
        </button>
      </nav>

      <footer>
        <div className="brand footer-brand">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>ASTRO</strong><small>INTELLIGENCE</small></span>
        </div>
        <p>Private research terminal · Human judgment remains the final gate.</p>
        <a href="https://x.com/astronomer_zero" target="_blank" rel="noreferrer">@astronomer_zero ↗</a>
      </footer>
    </main>
  );
}
