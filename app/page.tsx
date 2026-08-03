"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import liveForecast from "./forecast.json";
import AstroHistory from "./astro-history";
import LiveAstroChart from "./live-astro-chart";
import NightSchool from "./night-school";
import LearningPulse from "./learning-pulse";
import PositionsView from "./positions-view";
import ActivityCenter, { type AstroItem } from "./activity-center";

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
  createdAt: string;
  resolvedAt: string | null;
  direction: string | null;
  summary: string | null;
  anchorPrice: number;
  latestPrice: number;
  hitCheckpoints: number;
  totalCheckpoints: number;
  outcomeReason: string | null;
  behaviorAction: string | null;
  behaviorStatus: "active" | "hit" | "wrong" | "unscored";
};

type HermesActivity = {
  id?: string;
  at: string;
  runId?: string;
  service?:
    | "telegram"
    | "x"
    | "scanner"
    | "hermes"
    | "notifications"
    | "school"
    | "system";
  kind?: string;
  stage: string;
  status: "working" | "done" | "quiet" | "warning" | "error";
  importance?: "normal" | "important" | "alert";
  title: string;
  detail: string;
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
  hermes: {
    horizon: string;
    coreThesis: string;
    currentPhase: string;
    nextPhase: string;
    longerMove: string;
    confirmation: string;
    failure: string;
    learningNote: string;
    lessonRefs?: string[];
    projection?: HermesProjection;
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
  hermes: {
    horizon: "Days to weeks · updates with every accepted forecast",
    coreThesis:
      "Astro’s staged execution suggests the current position should be completed before a new campaign is treated as active.",
    currentPhase: "Manage the existing position; do not treat its old entry as new.",
    nextPhase: "Wait for a direct close, trim, or flip before changing campaigns.",
    longerMove:
      "After the current campaign resolves, use the higher-timeframe bias and fresh Astro levels to map the next move.",
    confirmation: "A direct Astro management post with readable position levels.",
    failure: "A new direct thesis that supersedes the current position sequence.",
    learningNote:
      "Archive baseline: staged entry, gradual profit-taking, protected runner, then a confirmed transition.",
    projection: {
      scoringVersion: 2,
      direction: "up",
      horizonHours: 168,
      confidence: 55,
      checkpoints: [
        {
          label: "Weekly-open decision",
          price: 65_500,
          kind: "confirmation",
          horizonHours: 72,
          condition: "Price reaches the known decision area.",
        },
        {
          label: "Higher-timeframe continuation",
          price: 67_700,
          kind: "target",
          horizonHours: 168,
          condition: "Continuation holds after the decision area.",
        },
      ],
      invalidation: {
        price: null,
        condition: "No public numeric invalidation is available.",
      },
      behavior: {
        action: "post_update",
        horizonHours: 72,
        condition: "Astro publishes a fresh management or structure update.",
      },
    },
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
  const positionText =
    `${report.decision?.position ?? report.stance} ${report.execution?.entry?.state ?? ""}`.toLowerCase();
  const plannedLong = report.levels?.find((level) =>
    /planned htf long|60k.?66k long/i.test(`${level.label} ${level.value}`),
  );
  const residualShort =
    positionText.includes("short") &&
    /\bhold\b|residual|still open|no add|no-add/.test(positionText);
  const fallbackHermes: Forecast["hermes"] = residualShort
    ? {
        horizon: report.thesis?.horizon ?? "Days to weeks",
        coreThesis:
          "The downside campaign is near its public objective, but Astro’s last direct position still supports holding the remaining short without adding. The larger transition needs a public close first.",
        currentPhase:
          report.decision?.position ?? "Residual short held · no new add",
        nextPhase:
          "Finish or trim the remaining short, then wait for Astro to confirm the campaign is closed.",
        longerMove: plannedLong
          ? `After the short closes, the public plan points to higher-timeframe longs around ${plannedLong.value}. This is conditional, not active.`
          : "After the short closes, rebuild the higher-timeframe long thesis from fresh direct levels.",
        confirmation:
          report.thesis?.nextTrigger ??
          "A direct short-close or higher-timeframe long post",
        failure:
          report.thesis?.failure ??
          report.invalidation ??
          "Astro re-adds shorts or cancels the planned long transition.",
        learningNote:
          "Astro Codex favors completing the active campaign, realizing profit gradually, and requiring direct confirmation before treating a planned flip as active.",
      }
    : {
        horizon: report.thesis?.horizon ?? "Days to weeks",
        coreThesis:
          report.thesis?.modelRead ??
          report.nextMove ??
          "Wait for the next evidence-backed phase change.",
        currentPhase:
          report.decision?.position ?? report.stance ?? "Position not public",
        nextPhase:
          report.decision?.playbookMove ??
          report.nextMove ??
          "Wait for a direct management update.",
        longerMove:
          report.nextMove ??
          "The longer move remains uncertain until the current campaign resolves.",
        confirmation:
          report.thesis?.nextTrigger ??
          report.waitFor ??
          "Fresh direct Astro evidence",
        failure:
          report.thesis?.failure ??
          report.invalidation ??
          "A new direct thesis supersedes the model.",
        learningNote:
          "Derived from the current Astro Codex retrieval and archived staged-execution framework.",
      };

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
    hermes: report.hermes ?? fallbackHermes,
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
  const entryText =
    `${forecast.execution.entry.state} ${forecast.execution.entry.condition}`.toLowerCase();
  const existingPositionOnly =
    /\bdone\b|no add|no-add|hold only|residual/.test(entryText);
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
      label: existingPositionOnly ? "HOLD LONG" : "LONG SETUP",
      tone: "long",
      summary: existingPositionOnly
        ? "Existing position only. Astro has not confirmed a new long entry."
        : "A fresh long setup is supported by a direct Astro update.",
    },
    short: {
      label: existingPositionOnly ? "HOLD SHORT" : "SHORT SETUP",
      tone: "short",
      summary: existingPositionOnly
        ? "Existing position only. Astro’s last direct update said not to add."
        : "A fresh short setup is supported by a direct Astro update.",
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

function relativeTime(value: string | null | undefined, now: number) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time)) return "unknown";
  const seconds = Math.max(0, Math.floor((now - time) / 1_000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function activitySourceLabel(service?: HermesActivity["service"]) {
  return (
    {
      telegram: "ASTRO SOURCE",
      x: "PUBLIC X",
      scanner: "LIVE CHECK",
      hermes: "HERMES",
      notifications: "ALERT",
      school: "NIGHT SCHOOL",
      system: "SYSTEM",
    }[service || "system"] || "SYSTEM"
  );
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
  dataReady?: boolean;
  dataStatus?: string;
  reviewPending?: boolean;
  reasonerBlocked?: boolean;
  unreviewedSources?: { telegram?: boolean; x?: boolean } | null;
  runId?: string | null;
  model?: string | null;
  codexEntries?: number;
  codexMedia?: number;
  telegramEnabled?: boolean;
  telegramStatus?: string;
  telegramSourceStatus?: string;
  telegramSourceLastSuccessAt?: string | null;
  telegramSourceNewestAt?: string | null;
  telegramSourceLastAnalyzedAt?: string | null;
  telegramSourceAnalyzedNewestAt?: string | null;
  telegramSourceMessages?: number;
  telegramSourceMedia?: number;
  telegramSources?: Array<{
    id?: string;
    title?: string;
    lastMessageAt?: string | null;
    messageCount?: number;
    mediaCount?: number;
  }>;
  xSourceStatus?: string;
  xSourceLastSuccessAt?: string | null;
  xSourceNewestAt?: string | null;
  xSourceBudget?: {
    cap?: number;
    used?: number;
    remaining?: number;
  } | null;
  reasoner?: {
    status?: string;
    provider?: string;
    stage?: string;
    material?: boolean;
    category?: string;
    remaining?: number;
    lightRemaining?: number;
    mediumRemaining?: number;
    error?: string;
  } | null;
  pendingAnalysis?: {
    entityRef?: string | null;
    queuedAt?: string | null;
    sourceNewest?: { telegram?: string | null; x?: string | null };
    reason?: string | null;
  } | null;
  activity?: HermesActivity[];
  astroItems?: AstroItem[];
  liveEventCursor?: string | null;
  hermesAudit?: HermesAudit | null;
};

type LiveEventsEnvelope = Omit<
  LiveSignalEnvelope,
  "forecast" | "source" | "hermesAudit"
>;

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

async function fetchLiveEvents(): Promise<LiveEventsEnvelope> {
  const response = await fetch(`/api/live-events?ts=${Date.now()}`, {
    cache: "no-store",
  });
  const data = (await response.json()) as LiveEventsEnvelope & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "The live activity feed is unavailable.");
  }
  return data;
}

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
    useState<
      | "desk"
      | "chart"
      | "live"
      | "journal"
      | "positions"
      | "hermes"
      | "history"
      | "evidence"
      | "playbook"
    >("desk");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState("Saved snapshot");
  const [signalCheckedAt, setSignalCheckedAt] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState({
    degraded: true,
    pipelineStatus: "starting",
    dataReady: false,
    dataStatus: "starting",
    reviewPending: false,
    reasonerBlocked: false,
    unreviewedSources: { telegram: false, x: false },
    model: null as string | null,
    codexEntries: 0,
    codexMedia: 0,
    runId: null as string | null,
    telegramEnabled: false,
    telegramStatus: "disabled",
    telegramSourceStatus: "unknown",
    telegramSourceLastSuccessAt: null as string | null,
    telegramSourceNewestAt: null as string | null,
    telegramSourceLastAnalyzedAt: null as string | null,
    telegramSourceAnalyzedNewestAt: null as string | null,
    telegramSourceMessages: 0,
    telegramSourceMedia: 0,
    telegramSources: [] as NonNullable<LiveSignalEnvelope["telegramSources"]>,
    xSourceStatus: "unknown",
    xSourceLastSuccessAt: null as string | null,
    xSourceNewestAt: null as string | null,
    xSourceBudget: null as LiveSignalEnvelope["xSourceBudget"],
    reasoner: null as LiveSignalEnvelope["reasoner"],
    pendingAnalysis: null as LiveSignalEnvelope["pendingAnalysis"],
    activity: [] as HermesActivity[],
    astroItems: [] as AstroItem[],
    liveEventCursor: null as string | null,
    hermesAudit: null as HermesAudit | null,
  });
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [hasUnseenUpdate, setHasUnseenUpdate] = useState(false);
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const soundAlertsEnabledRef = useRef(false);
  const lastObservedForecastRef = useRef<string | null>(null);
  const lastObservedAstroItemRef = useRef<string | null>(null);
  const lastObservedLiveEventRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playAlertTone = useCallback(async () => {
    const context = audioContextRef.current;
    if (!context) return;
    if (context.state === "suspended") {
      await context.resume();
    }
    const start = context.currentTime;
    [740, 988].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(
        0.13,
        start + index * 0.12 + 0.015,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        start + index * 0.12 + 0.11,
      );
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + index * 0.12);
      oscillator.stop(start + index * 0.12 + 0.12);
    });
  }, []);

  const announceForecastChange = useCallback(
    async (nextForecast: Forecast) => {
      if (!soundAlertsEnabledRef.current) return;
      try {
        await playAlertTone();
      } catch {
        // The visual update remains available if the browser suspends audio.
      }
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification("Astro Intelligence updated", {
          body: `${nextForecast.decision.position} · ${nextForecast.signal.plainSummary}`,
          tag: "astro-intelligence-forecast",
        });
      }
    },
    [playAlertTone],
  );

  const announceLiveEvent = useCallback(
    async (event: HermesActivity) => {
      if (
        !soundAlertsEnabledRef.current ||
        !["important", "alert"].includes(event.importance || "normal")
      ) {
        return;
      }
      try {
        await playAlertTone();
      } catch {
        // The visual event remains visible when a browser suspends audio.
      }
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification(event.title, {
          body: event.detail,
          tag: event.id || `${event.at}-${event.stage}`,
        });
      }
    },
    [playAlertTone],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const envelope = await fetchLiveSignal();
        if (!active) return;
        const normalized = normalizeForecast(envelope.forecast);
        const previouslyObserved = lastObservedForecastRef.current;
        lastObservedForecastRef.current = normalized.generatedAt;
        if (
          previouslyObserved &&
          previouslyObserved !== normalized.generatedAt
        ) {
          setNotice("New accepted Astro update received.");
          void announceForecastChange(normalized);
        }
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
        const astroItems = Array.isArray(envelope.astroItems)
          ? envelope.astroItems
          : [];
        const newestAstroItem = astroItems[0] ?? null;
        const previouslyObservedAstroItem =
          lastObservedAstroItemRef.current;
        lastObservedAstroItemRef.current = newestAstroItem?.id ?? null;
        if (
          newestAstroItem &&
          previouslyObservedAstroItem &&
          previouslyObservedAstroItem !== newestAstroItem.id
        ) {
          setHasUnseenUpdate(true);
        }
        if (newestAstroItem && !previouslyObservedAstroItem) {
          const seenItem = window.localStorage.getItem(
            "astro-intel-seen-source-item",
          );
          const itemTime = new Date(
            newestAstroItem.activityAt || newestAstroItem.postedAt || 0,
          ).getTime();
          if (
            seenItem !== newestAstroItem.id &&
            Number.isFinite(itemTime) &&
            Date.now() - itemTime <= 60 * 60_000
          ) {
            setHasUnseenUpdate(true);
          }
        }
        setSignalCheckedAt(envelope.checkedAt);
        setSystemStatus({
          degraded:
            Boolean(envelope.degraded) ||
            envelope.dataReady === false ||
            envelope.source !== "vps",
          pipelineStatus: envelope.status ?? "unknown",
          dataReady: envelope.dataReady !== false,
          dataStatus: envelope.dataStatus ?? "unknown",
          reviewPending: envelope.reviewPending === true,
          reasonerBlocked: envelope.reasonerBlocked === true,
          unreviewedSources: envelope.unreviewedSources ?? {
            telegram: false,
            x: false,
          },
          model: envelope.model ?? null,
          codexEntries: Number(envelope.codexEntries || 0),
          codexMedia: Number(envelope.codexMedia || 0),
          runId: envelope.runId ?? null,
          telegramEnabled: Boolean(envelope.telegramEnabled),
          telegramStatus: envelope.telegramStatus ?? "disabled",
          telegramSourceStatus: envelope.telegramSourceStatus ?? "unknown",
          telegramSourceLastSuccessAt:
            envelope.telegramSourceLastSuccessAt ?? null,
          telegramSourceNewestAt: envelope.telegramSourceNewestAt ?? null,
          telegramSourceLastAnalyzedAt:
            envelope.telegramSourceLastAnalyzedAt ?? null,
          telegramSourceAnalyzedNewestAt:
            envelope.telegramSourceAnalyzedNewestAt ?? null,
          telegramSourceMessages: Number(envelope.telegramSourceMessages || 0),
          telegramSourceMedia: Number(envelope.telegramSourceMedia || 0),
          telegramSources: Array.isArray(envelope.telegramSources)
            ? envelope.telegramSources
            : [],
          xSourceStatus: envelope.xSourceStatus ?? "unknown",
          xSourceLastSuccessAt: envelope.xSourceLastSuccessAt ?? null,
          xSourceNewestAt: envelope.xSourceNewestAt ?? null,
          xSourceBudget: envelope.xSourceBudget ?? null,
          reasoner: envelope.reasoner ?? null,
          pendingAnalysis: envelope.pendingAnalysis ?? null,
          activity: Array.isArray(envelope.activity) ? envelope.activity : [],
          astroItems,
          liveEventCursor: envelope.liveEventCursor ?? null,
          hermesAudit: envelope.hermesAudit ?? null,
        });
        if (!lastObservedLiveEventRef.current && envelope.liveEventCursor) {
          lastObservedLiveEventRef.current = envelope.liveEventCursor;
        }
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
  }, [announceForecastChange]);

  useEffect(() => {
    let active = true;

    async function loadEvents() {
      try {
        const envelope = await fetchLiveEvents();
        if (!active) return;
        const events = Array.isArray(envelope.activity)
          ? envelope.activity
          : [];
        const newest = events.at(-1) ?? null;
        const cursor =
          envelope.liveEventCursor ??
          newest?.id ??
          (newest ? `${newest.at}-${newest.stage}` : null);
        const previousCursor = lastObservedLiveEventRef.current;
        lastObservedLiveEventRef.current = cursor;
        if (previousCursor && cursor && previousCursor !== cursor && newest) {
          void announceLiveEvent(newest);
        }
        setSystemStatus((current) => ({
          ...current,
          degraded:
            envelope.dataReady === false
              ? true
              : envelope.dataReady === true
                ? false
                : current.degraded,
          pipelineStatus: envelope.status ?? current.pipelineStatus,
          dataReady: envelope.dataReady ?? current.dataReady,
          dataStatus: envelope.dataStatus ?? current.dataStatus,
          reviewPending: envelope.reviewPending ?? current.reviewPending,
          reasonerBlocked:
            envelope.reasonerBlocked ?? current.reasonerBlocked,
          unreviewedSources:
            envelope.unreviewedSources ?? current.unreviewedSources,
          runId: envelope.runId ?? current.runId,
          telegramSourceStatus:
            envelope.telegramSourceStatus ??
            current.telegramSourceStatus,
          telegramSourceLastSuccessAt:
            envelope.telegramSourceLastSuccessAt ??
            current.telegramSourceLastSuccessAt,
          telegramSourceNewestAt:
            envelope.telegramSourceNewestAt ??
            current.telegramSourceNewestAt,
          telegramSourceMessages: Number(
            envelope.telegramSourceMessages ??
              current.telegramSourceMessages,
          ),
          telegramSourceMedia: Number(
            envelope.telegramSourceMedia ?? current.telegramSourceMedia,
          ),
          telegramSources: Array.isArray(envelope.telegramSources)
            ? envelope.telegramSources
            : current.telegramSources,
          xSourceStatus:
            envelope.xSourceStatus ?? current.xSourceStatus,
          xSourceLastSuccessAt:
            envelope.xSourceLastSuccessAt ??
            current.xSourceLastSuccessAt,
          xSourceNewestAt:
            envelope.xSourceNewestAt ?? current.xSourceNewestAt,
          xSourceBudget:
            envelope.xSourceBudget ?? current.xSourceBudget,
          reasoner: envelope.reasoner ?? current.reasoner,
          pendingAnalysis:
            envelope.pendingAnalysis ?? current.pendingAnalysis,
          activity: events.length ? events : current.activity,
          astroItems: Array.isArray(envelope.astroItems)
            ? envelope.astroItems
            : current.astroItems,
          liveEventCursor: cursor ?? current.liveEventCursor,
        }));
      } catch {
        // Keep the last recorded feed visible; the full signal poll reports health.
      }
    }

    void loadEvents();
    const refresh = window.setInterval(() => void loadEvents(), 4_000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [announceLiveEvent]);

  useEffect(() => {
    const clock = window.setInterval(() => setClockNow(Date.now()), 5_000);
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
  const hermesAgreement = useMemo(() => {
    const astroPosition = forecast.decision.position.toLowerCase();
    const hasLong = /\blong\b/.test(astroPosition);
    const hasShort = /\bshort\b/.test(astroPosition);
    const direction = (systemStatus.hermesAudit?.direction || "").toLowerCase();
    const hermesDirection = direction.startsWith("down")
      ? "short"
      : direction.startsWith("up")
        ? "long"
        : null;

    if (!hermesDirection) {
      return {
        label: "UNRESOLVED",
        detail: "Hermes has not frozen a directional first move.",
      };
    }
    if (hasLong && hasShort) {
      return {
        label: "PARTIAL",
        detail: `Astro has both books; Hermes models ${hermesDirection} first.`,
      };
    }
    if ((hasLong && hermesDirection === "long") || (hasShort && hermesDirection === "short")) {
      return {
        label: "AGREES",
        detail: `Same ${hermesDirection} first move.`,
      };
    }
    if (hasLong || hasShort) {
      return {
        label: "CONFLICT",
        detail: `Hermes expects ${hermesDirection} first.`,
      };
    }
    return {
      label: "UNRESOLVED",
      detail: "Astro has no confirmed direction to compare.",
    };
  }, [forecast.decision.position, systemStatus.hermesAudit?.direction]);
  const targetPlan = useMemo(() => {
    const byLabel = (needles: string[]) =>
      forecast.levels.find((level) =>
        needles.some((needle) => level.label.toLowerCase().includes(needle)),
      );
    const positionText =
      `${forecast.decision.position} ${forecast.execution.entry.state}`.toLowerCase();
    const holdingShort =
      positionText.includes("short") &&
      /\b(open|held|hold|holding|residual|still)\b/.test(positionText) &&
      !/\b(full(?:y)? closed|fully exited)\b/.test(positionText);
    if (holdingShort) {
      const shortEntry = byLabel(["short iii", "holding major short"]);
      const downsideTarget = byLabel(["7% drawdown", "active objective"]);
      const plannedLong = byLabel(["planned htf long", "60k→66k"]);
      const targetClass =
        downsideTarget?.value.match(/≈\s*~?(\d{5,6})\s*class/i)?.[1];
      const formattedTarget = targetClass
        ? `~${(Number(targetClass) / 1_000).toFixed(1)}k area`
        : downsideTarget?.value || "Not public";

      return [
        {
          label: "POSITION",
          value: shortEntry ? "~66.3k short" : "Existing short",
          state: "Held · do not add",
          tone: "past",
        },
        {
          label: "DOWN TARGET",
          value: formattedTarget,
          state: "Market tagged · not closed",
          tone: "hit",
        },
        {
          label: "NEXT ACTION",
          value: "Trim or close",
          state: "Needs a direct Astro post",
          tone: "watch",
        },
        {
          label: "PLANNED FLIP",
          value: plannedLong ? "60–66k longs" : "Not public",
          state: "Only after short close",
          tone: "watch",
        },
      ];
    }

    const t1 = byLabel(["initial long trim", "first trim"]);
    const t2 = byLabel(["hv liquidity", "fifth-win lock", "close 30%"]);
    const nextTarget = byLabel(["safe house", "weekly open", "objective claimed"]);
    const entry = byLabel(["long v chart entry", "public long area"]);
    const longComplete =
      forecast.execution.takeProfit.state.toLowerCase().includes("complete") ||
      forecast.decision.position.toLowerCase().includes("residual sold");

    return [
      {
        label: "ENTRY",
        value: entry?.value || forecast.execution.entry.level,
        state: "Historical",
        tone: "past",
      },
      {
        label: "T1",
        value: t1?.value || "Not public",
        state: "Hit · profit taken",
        tone: "hit",
      },
      {
        label: "T2",
        value: t2?.value || forecast.execution.takeProfit.level,
        state: "Hit · 30% closed",
        tone: "hit",
      },
      {
        label: "TP / GOAL",
        value: nextTarget?.value || "Not public",
        state: longComplete ? "Reached · long complete" : "Watching",
        tone: longComplete ? "hit" : "watch",
      },
    ];
  }, [forecast]);
  const plainDashboard = useMemo(() => {
    const position = forecast.decision.position.toLowerCase();
    const entryText =
      `${forecast.execution.entry.state} ${forecast.execution.entry.condition}`.toLowerCase();
    const existingPositionOnly =
      /\bdone\b|no add|no-add|hold only|residual/.test(entryText);
    const holdingShort =
      (position.includes("short") || entryText.includes("short")) &&
      /\b(open|held|hold|holding|residual|still)\b/.test(
        `${position} ${entryText}`,
      ) &&
      !/\b(full(?:y)? closed|fully exited)\b/.test(
        `${position} ${entryText}`,
      );
    const holdingLong =
      (position.includes("long") || entryText.includes("long")) &&
      /\b(open|held|hold|holding|residual|still)\b/.test(
        `${position} ${entryText}`,
      ) &&
      !/\b(full(?:y)? closed|fully exited)\b/.test(
        `${position} ${entryText}`,
      );
    const longDone =
      position.includes("residual sold") ||
      forecast.execution.takeProfit.state.toLowerCase().includes("complete");
    const shortOpen = position.includes("short iii") && position.includes("open");
    const partialsTaken =
      forecast.execution.takeProfit.state.toLowerCase().includes("partial") ||
      forecast.execution.takeProfit.state.toLowerCase().includes("profit");
    const oneThirdShortTrim =
      /\b(?:1\/3|one third)\b/.test(
        `${forecast.execution.takeProfit.state} ${forecast.execution.takeProfit.condition}`,
      );

    return {
      happened: holdingShort
        ? oneThirdShortTrim
          ? "Astro took profit on one third of the remaining short. Short III is still partly open."
          : "Astro has taken some short profit. Short III is still partly open."
        : holdingLong
          ? "Astro’s last confirmed position is still long. Any new entry needs a new direct post."
          : longDone
            ? "The long reached its goal. Astro sold the final piece. That long trade is finished."
        : partialsTaken
          ? "The long hit T1 and T2. Astro took profit. A smaller piece may still be open."
          : forecast.signal.plainSummary,
      where: holdingShort
        ? "Remaining short still held · no new add"
        : holdingLong
          ? "Existing long still held · no fresh entry"
          : longDone && shortOpen
        ? "Long V is closed. Short III is still open, but its exit price is not public."
        : forecast.decision.position,
      next: predictedNextMove
        ? `${predictedNextMove.name} · ${predictedNextMove.probability}% model`
        : longDone && shortOpen
        ? "Most likely: stay quiet and keep Short III. A new move needs a fresh post with levels."
        : simpleNextMove.astro,
      you: existingPositionOnly && holdingShort
        ? "No fresh entry. Watch for Astro to trim, fully close, or announce the planned long."
        : existingPositionOnly && holdingLong
          ? "No fresh entry. Watch for Astro to trim, close, or publish a new setup."
          : forecast.signal.state === "wait"
        ? "No new move yet. Wait for a fresh post with an entry and targets."
        : simpleNextMove.you,
      freshEntry: existingPositionOnly ? "NO · EXISTING POSITION" : "YES · CHECK LATEST POST",
    };
  }, [forecast, predictedNextMove, simpleNextMove]);
  const focusTargets = useMemo(() => {
    const active = targetPlan.filter((target) => target.tone === "watch");
    return (active.length ? active : targetPlan.slice(-2)).slice(0, 2);
  }, [targetPlan]);
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
  const latestAstroItem = systemStatus.astroItems[0] ?? null;
  const signalFreshness = useMemo(() => {
    if (!signalCheckedAt) {
      return { label: "VPS CONNECTING", tone: "scheduled" };
    }
    const checked = new Date(signalCheckedAt).getTime();
    if (!Number.isFinite(checked)) {
      return { label: "CHECK TIME UNKNOWN", tone: "stale" };
    }
    if (systemStatus.reasonerBlocked) {
      return { label: "REVIEW BLOCKED", tone: "stale" };
    }
    if (systemStatus.reviewPending) {
      return { label: "REVIEW QUEUED", tone: "aging" };
    }
    const ageMinutes = Math.max(0, Math.floor((clockNow - checked) / 60_000));
    if (ageMinutes <= 3) {
      return { label: "LIVE · CHECKED NOW", tone: "live" };
    }
    if (ageMinutes <= 10) {
      return { label: `CHECKED ${ageMinutes}M AGO`, tone: "aging" };
    }
    return { label: `LATE · ${ageMinutes}M AGO`, tone: "stale" };
  }, [
    clockNow,
    signalCheckedAt,
    systemStatus.reasonerBlocked,
    systemStatus.reviewPending,
  ]);
  const latestActivity = systemStatus.activity.at(-1) ?? null;
  const liveState = useMemo(() => {
    if (systemStatus.reasonerBlocked) {
      return {
        label: "REVIEW BLOCKED",
        detail:
          latestActivity?.detail ||
          "New Astro information is saved, but no model slot is available to review it yet.",
        tone: "error",
      };
    }
    if (systemStatus.reviewPending) {
      return {
        label: "REVIEW QUEUED",
        detail:
          latestActivity?.detail ||
          "New Astro information is saved. Hermes has not approved a new plan yet.",
        tone: "error",
      };
    }
    if (systemStatus.degraded || systemStatus.pipelineStatus === "error") {
      return {
        label: "NEEDS ATTENTION",
        detail:
          latestActivity?.detail ||
          "The last safe plan is still visible while the live connection retries.",
        tone: "error",
      };
    }
    if (
      latestActivity?.kind === "source_update" ||
      latestActivity?.stage === "source_update"
    ) {
      return {
        label: "NEW ASTRO UPDATE FOUND",
        detail: "Hermes will check whether it changes the saved plan.",
        tone: "working",
      };
    }
    if (
      latestActivity?.kind === "analysis_started" ||
      latestActivity?.stage === "analysis_started" ||
      systemStatus.pipelineStatus === "analyzing"
    ) {
      return {
        label: "HERMES IS CHECKING IT",
        detail: "The new information is being compared with Astro history.",
        tone: "working",
      };
    }
    if (
      latestActivity?.kind === "forecast_changed" ||
      latestActivity?.stage === "forecast_changed"
    ) {
      return {
        label: "THE PLAN CHANGED",
        detail: "The chart and the simple answer now show the new saved read.",
        tone: "working",
      };
    }
    if (
      latestActivity?.kind === "no_change" ||
      latestActivity?.kind === "analysis_kept" ||
      latestActivity?.kind === "plan_confirmed" ||
      latestActivity?.stage === "no_change" ||
      latestActivity?.stage === "analysis_kept" ||
      latestActivity?.stage === "plan_confirmed"
    ) {
      return {
        label:
          latestActivity?.kind === "plan_confirmed"
            ? "NEW POST · PLAN CONFIRMED"
            : "PLAN KEPT",
        detail:
          latestActivity?.kind === "plan_confirmed"
            ? "Hermes read the new Astro update. It supports the existing plan."
            : "Hermes checked the newest information and kept the saved plan.",
        tone: "quiet",
      };
    }
    if (
      latestActivity?.kind === "scan_started" ||
      latestActivity?.stage === "scan_started" ||
      systemStatus.pipelineStatus === "checking"
    ) {
      return {
        label: "CHECKING NOW",
        detail: "Looking for a new Astro update or an important market change.",
        tone: "working",
      };
    }
    if (latestActivity?.service === "school") {
      return {
        label: "LEARNING IN THE BACKGROUND",
        detail: "Night School is studying old Astro examples. Live updates still come first.",
        tone: "quiet",
      };
    }
    return {
      label: "WAITING FOR ASTRO",
      detail: "Both Telegram channels are being watched. The saved plan stays active.",
      tone: "quiet",
    };
  }, [
    latestActivity,
    systemStatus.degraded,
    systemStatus.reasonerBlocked,
    systemStatus.reviewPending,
    systemStatus.pipelineStatus,
  ]);

  async function refreshForecast() {
    setLoading(true);
    setNotice("");
    try {
      const envelope = await fetchLiveSignal();
      const normalized = normalizeForecast(envelope.forecast);
      const previouslyObserved = lastObservedForecastRef.current;
      lastObservedForecastRef.current = normalized.generatedAt;
      if (
        previouslyObserved &&
        previouslyObserved !== normalized.generatedAt
      ) {
        void announceForecastChange(normalized);
      }
      setForecast((current) => {
        if (current.generatedAt !== normalized.generatedAt) {
          setHasUnseenUpdate(true);
        }
        return normalized;
      });
      const astroItems = Array.isArray(envelope.astroItems)
        ? envelope.astroItems
        : [];
      lastObservedAstroItemRef.current = astroItems[0]?.id ?? null;
      setSignalCheckedAt(envelope.checkedAt);
      setSystemStatus({
        degraded: Boolean(envelope.degraded) || envelope.source !== "vps",
        pipelineStatus: envelope.status ?? "unknown",
        model: envelope.model ?? null,
        codexEntries: Number(envelope.codexEntries || 0),
        codexMedia: Number(envelope.codexMedia || 0),
        runId: envelope.runId ?? null,
        telegramEnabled: Boolean(envelope.telegramEnabled),
        telegramStatus: envelope.telegramStatus ?? "disabled",
        telegramSourceStatus: envelope.telegramSourceStatus ?? "unknown",
        telegramSourceLastSuccessAt:
          envelope.telegramSourceLastSuccessAt ?? null,
        telegramSourceNewestAt: envelope.telegramSourceNewestAt ?? null,
        telegramSourceLastAnalyzedAt:
          envelope.telegramSourceLastAnalyzedAt ?? null,
        telegramSourceAnalyzedNewestAt:
          envelope.telegramSourceAnalyzedNewestAt ?? null,
        telegramSourceMessages: Number(envelope.telegramSourceMessages || 0),
        telegramSourceMedia: Number(envelope.telegramSourceMedia || 0),
        telegramSources: Array.isArray(envelope.telegramSources)
          ? envelope.telegramSources
          : [],
        xSourceStatus: envelope.xSourceStatus ?? "unknown",
        xSourceLastSuccessAt: envelope.xSourceLastSuccessAt ?? null,
        xSourceNewestAt: envelope.xSourceNewestAt ?? null,
        xSourceBudget: envelope.xSourceBudget ?? null,
        reasoner: envelope.reasoner ?? null,
        activity: Array.isArray(envelope.activity) ? envelope.activity : [],
        astroItems,
        liveEventCursor: envelope.liveEventCursor ?? null,
        hermesAudit: envelope.hermesAudit ?? null,
      });
      if (!lastObservedLiveEventRef.current && envelope.liveEventCursor) {
        lastObservedLiveEventRef.current = envelope.liveEventCursor;
      }
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

  function showView(
    view:
      | "desk"
      | "chart"
      | "live"
      | "journal"
      | "positions"
      | "hermes"
      | "history"
      | "evidence"
      | "playbook",
  ) {
    setActiveView(view);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function markCurrentUpdateSeen() {
    window.localStorage.setItem(
      "astro-intel-seen-forecast",
      forecast.generatedAt,
    );
    if (latestAstroItem) {
      window.localStorage.setItem(
        "astro-intel-seen-source-item",
        latestAstroItem.id,
      );
    }
    setHasUnseenUpdate(false);
  }

  async function toggleSoundAlerts() {
    if (soundAlertsEnabledRef.current) {
      soundAlertsEnabledRef.current = false;
      setSoundAlertsEnabled(false);
      setNotice("Website sound alerts are off.");
      return;
    }
    try {
      audioContextRef.current ??= new AudioContext();
      await audioContextRef.current.resume();
      soundAlertsEnabledRef.current = true;
      setSoundAlertsEnabled(true);
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        await Notification.requestPermission();
      }
      await playAlertTone();
      setNotice("Sound alerts enabled for this browser session.");
    } catch {
      soundAlertsEnabledRef.current = false;
      setSoundAlertsEnabled(false);
      setNotice("This browser did not allow sound alerts.");
    }
  }

  if (["desk", "chart", "live", "history"].includes(activeView)) {
    const shortStatus =
      opportunity.label === "WAIT" ? "WAIT" : opportunity.label;

    return (
      <main className="neo-shell" id="top">
        <header className="neo-topbar">
          <button className="neo-brand" onClick={() => showView("desk")}>
            <span>AI</span>
            <strong>Astro</strong>
          </button>

          <nav className="neo-tabs" aria-label="Main pages">
            {[
              ["desk", "Now"],
              ["chart", "Chart"],
              ["live", "Updates"],
              ["history", "History"],
            ].map(([view, label]) => (
              <button
                className={activeView === view ? "active" : ""}
                key={view}
                onClick={() =>
                  showView(view as "desk" | "chart" | "live" | "history")
                }
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="neo-tools">
            <span className={systemStatus.degraded ? "stale" : "live"}>
              <i />
              {systemStatus.reasonerBlocked
                ? "Review blocked"
                : systemStatus.reviewPending
                  ? "Review queued"
                  : systemStatus.degraded
                    ? "Saved"
                    : "Live"}
            </span>
            <button
              aria-label="Refresh"
              disabled={loading}
              onClick={refreshForecast}
            >
              {loading ? "…" : "↻"}
            </button>
          </div>
        </header>

        {activeView !== "desk" && (
          <section className="neo-context" aria-label="Current research summary">
            <article className={`neo-context-signal ${forecast.signal.state}`}>
              <small>STATE</small>
              <strong>{shortStatus}</strong>
            </article>
            <article>
              <small>ASTRO NOW</small>
              <strong>{plainDashboard.where}</strong>
            </article>
            <article>
              <small>HERMES NEXT</small>
              <strong>{plainDashboard.next}</strong>
            </article>
          </section>
        )}

        {activeView === "desk" && (
          <section className="home-simple">
            <article className={`home-answer ${forecast.signal.state}`}>
              <header>
                <span>
                  <i />
                  {signalFreshness.label}
                </span>
                <b>{shortStatus}</b>
              </header>
              <small>WHAT SHOULD I KNOW RIGHT NOW?</small>
              <h1>{plainDashboard.you}</h1>
              <footer>
                <strong>{liveState.label}</strong>
                <p>{liveState.detail}</p>
              </footer>
            </article>

            <div className="home-two-answers">
              <article className="astro">
                <header>
                  <span>ASTRO · CONFIRMED</span>
                  <b>{plainDashboard.freshEntry}</b>
                </header>
                <small>WHAT ASTRO LAST DID</small>
                <h2>{plainDashboard.happened}</h2>
                <p>{plainDashboard.where}</p>
              </article>
              <article className="hermes">
                <header>
                  <span>HERMES · PREDICTION</span>
                  <b>{hermesAgreement.label}</b>
                </header>
                <small>WHAT HERMES EXPECTS NEXT</small>
                <h2>{plainDashboard.next}</h2>
                <p>{hermesAgreement.detail}</p>
              </article>
            </div>

            <section className="home-path" aria-label="Current important levels">
              <header>
                <div>
                  <small>THE CURRENT PATH</small>
                  <strong>Only the important numbers</strong>
                </div>
                <button onClick={() => showView("chart")}>
                  See the full drawing →
                </button>
              </header>
              <div>
                {targetPlan.slice(0, 4).map((target, index) => (
                  <article className={target.tone} key={target.label}>
                    <i>{index + 1}</i>
                    <small>{target.label}</small>
                    <strong>{target.value}</strong>
                    <span>{target.state}</span>
                  </article>
                ))}
              </div>
            </section>

            <nav className="home-open-buttons" aria-label="Open more detail">
              <button onClick={() => showView("chart")}>
                <small>SEE THE ROUTE</small>
                <strong>Chart</strong>
                <span>Astro levels + Hermes drawing →</span>
              </button>
              <button onClick={() => showView("live")}>
                <small>WATCH THE VPS</small>
                <strong>Live</strong>
                <span>Real events only →</span>
              </button>
              <button onClick={() => showView("history")}>
                <small>CHECK RESULTS</small>
                <strong>History</strong>
                <span>Right, wrong, or still open →</span>
              </button>
            </nav>

            <LearningPulse onOpen={() => showView("live")} />

            <article className={`home-latest ${hasUnseenUpdate ? "new" : ""}`}>
              <div>
                <small>
                  {hasUnseenUpdate ? "NEW ASTRO POST" : "LATEST ASTRO POST"} ·{" "}
                  {relativeTime(
                    latestAstroItem?.activityAt ||
                      latestAstroItem?.postedAt ||
                      latestAstroEvidence?.time,
                    clockNow,
                  )}
                </small>
                <strong>
                  {latestAstroItem?.text ||
                    latestAstroEvidence?.label ||
                    forecast.headline}
                </strong>
              </div>
              <a
                href={
                  latestAstroItem?.url ||
                  latestAstroEvidence?.source ||
                  forecast.sources[0]?.url ||
                  "https://x.com/astronomer_zero"
                }
                onClick={markCurrentUpdateSeen}
                rel="noreferrer"
                target="_blank"
              >
                Read source ↗
              </a>
            </article>

            <p className="home-boundary">
              Research monitor only. It never places a trade and never labels a
              model guess as an Astro call.
            </p>
            {notice && <p className="neo-notice">{notice}</p>}
          </section>
        )}

        {activeView === "chart" && (
          <section className="neo-page neo-chart">
            <header className="neo-page-title">
              <div>
                <span>PRICE + IMPORTANT LEVELS</span>
                <h1>Chart</h1>
              </div>
              <button
                className="neo-alerts"
                onClick={() => void toggleSoundAlerts()}
              >
                {soundAlertsEnabled ? "Sound on" : "Sound off"}
              </button>
            </header>

            <LiveAstroChart
              events={forecast.evidence.filter(
                (item) => item.type === "astro" && item.source && item.time,
              )}
              freshnessLabel={signalFreshness.label}
              freshnessTone={signalFreshness.tone}
              levels={forecast.levels}
              thesisLevels={forecast.thesisLevels}
              forecastTime={forecast.generatedAt}
              signalState={forecast.signal.state}
              signalHeadline={opportunity.label}
              riskText={forecast.decision.risk}
              predictedProbability={predictedNextMove?.probability ?? 0}
              hermesHorizon={forecast.hermes.horizon}
              hermesCurrentPhase={forecast.hermes.currentPhase}
              hermesNextPhase={forecast.hermes.nextPhase}
              hermesLongerMove={forecast.hermes.longerMove}
              hermesConfirmation={forecast.hermes.confirmation}
              hermesFailure={forecast.hermes.failure}
              astroPosition={forecast.decision.position}
              astroConfirmed={forecast.thesis.astroConfirmed}
              astroTakeProfit={`${forecast.execution.takeProfit.state} · ${forecast.execution.takeProfit.level}`}
              schoolMatch={forecast.hermes.learningNote}
              marketContext={forecast.thesis.regime}
              hermesProjection={forecast.hermes.projection}
              hermesAudit={systemStatus.hermesAudit}
              hermesAnchorPrice={systemStatus.hermesAudit?.anchorPrice ?? null}
              hermesAnchorTime={systemStatus.hermesAudit?.createdAt ?? forecast.generatedAt}
              onOpenHermes={() => showView("desk")}
            />

            <div className="neo-chart-summary">
              <article>
                <small>FIRST</small>
                <strong>{forecast.hermes.currentPhase}</strong>
              </article>
              <article>
                <small>THEN</small>
                <strong>{forecast.hermes.nextPhase}</strong>
              </article>
              <article>
                <small>WRONG IF</small>
                <strong>{forecast.decision.risk}</strong>
              </article>
            </div>
          </section>
        )}

        {activeView === "live" && (
          <section className="neo-page neo-activity">
            <ActivityCenter
              items={systemStatus.astroItems}
              activity={systemStatus.activity}
              reasoner={systemStatus.reasoner}
              now={clockNow}
              sourceSummary={{
                telegram:
                  systemStatus.telegramSourceStatus === "healthy"
                    ? `checked ${relativeTime(
                        systemStatus.telegramSourceLastSuccessAt,
                        clockNow,
                      )}`
                    : "reconnecting",
                x:
                  systemStatus.xSourceStatus === "healthy"
                    ? `checked ${relativeTime(
                        systemStatus.xSourceLastSuccessAt,
                        clockNow,
                      )}`
                    : systemStatus.xSourceStatus.replaceAll("_", " "),
              }}
            />
          </section>
        )}

        {activeView === "history" && (
          <section className="neo-page neo-history">
            <header className="neo-page-title">
              <div>
                <span>VERIFIED OUTCOMES ONLY</span>
                <h1>Right, wrong, open.</h1>
              </div>
            </header>
            <AstroHistory />
          </section>
        )}

        <nav className="neo-mobile-tabs" aria-label="Mobile pages">
          {[
            ["desk", "Now"],
            ["chart", "Chart"],
            ["live", "Updates"],
            ["history", "History"],
          ].map(([view, label]) => (
            <button
              className={activeView === view ? "active" : ""}
              key={view}
              onClick={() =>
                showView(view as "desk" | "chart" | "live" | "history")
              }
            >
              {label}
            </button>
          ))}
        </nav>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <button
        aria-expanded={menuOpen}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        className="menu-trigger"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span><i /><i /><i /></span>
        <b>{menuOpen ? "Close" : "Menu"}</b>
      </button>

      {menuOpen && (
        <button
          aria-label="Close navigation"
          className="menu-backdrop"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside className={`app-menu ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
        <div className="app-menu-head">
          <a className="brand" href="#top" onClick={() => showView("desk")}>
            <span className="brand-mark"><i /><i /><i /></span>
            <span><strong>ASTRO</strong><small>INTELLIGENCE</small></span>
          </a>
          <button aria-label="Close menu" onClick={() => setMenuOpen(false)}>×</button>
        </div>

        <nav aria-label="Main menu">
          <button className={activeView === "desk" ? "active" : ""} onClick={() => showView("desk")}>
            <span>01</span><strong>Now</strong><small>Astro + Hermes</small>
          </button>
          <button className={activeView === "chart" ? "active" : ""} onClick={() => showView("chart")}>
            <span>02</span><strong>Chart</strong><small>Price + levels</small>
          </button>
          <button className={activeView === "live" ? "active" : ""} onClick={() => showView("live")}>
            <span>03</span><strong>Live</strong><small>What Hermes is doing</small>
          </button>
          <button
            className={["journal", "positions", "hermes", "history", "evidence", "playbook"].includes(activeView) ? "active" : ""}
            onClick={() => showView("journal")}
          >
            <span>04</span><strong>History</strong><small>Past moves + school</small>
          </button>
        </nav>

        <div className="app-menu-status">
          <p>
            <i className={`connection-dot ${systemStatus.degraded ? "stale" : forecast.mode}`} />
            {systemStatus.reasonerBlocked
              ? "Review blocked"
              : systemStatus.reviewPending
                ? "Review queued"
                : systemStatus.degraded
                  ? "Protected snapshot"
                  : "Systems live"}
          </p>
          <button
            aria-pressed={soundAlertsEnabled}
            className={`sound-alert-button ${soundAlertsEnabled ? "active" : ""}`}
            onClick={() => void toggleSoundAlerts()}
            title={
              soundAlertsEnabled
                ? "Turn website sound alerts off"
                : "Enable sound for accepted Astro updates"
            }
          >
            <i />
            <b>{soundAlertsEnabled ? "Alerts on" : "Alerts off"}</b>
          </button>
          <button className="sync-button" onClick={refreshForecast} disabled={loading}>
            {loading ? "Syncing…" : "Sync"}
          </button>
        </div>
      </aside>

      {activeView === "desk" && (
        <div className="desk" id="top">
          <section className="quick-view">
            <div className="simple-heading">
              <div>
                <span>RIGHT NOW</span>
                <h1>Astro at a glance.</h1>
              </div>
              <div className="simple-live-state">
                <i className={`connection-dot ${systemStatus.degraded ? "stale" : forecast.mode}`} />
                <span>{signalFreshness.label}</span>
              </div>
            </div>

            <section className="simple-focus-grid" aria-label="Astro and Hermes now">
              <article className="simple-focus-card astro-card">
                <header>
                  <small>ASTRO · CONFIRMED</small>
                  <span>{opportunity.label}</span>
                </header>
                <h2>{plainDashboard.where}</h2>
                <p>{plainDashboard.happened}</p>
                <dl>
                  <div><dt>New entry?</dt><dd>{plainDashboard.freshEntry}</dd></div>
                  <div><dt>Next change</dt><dd>{forecast.thesis.nextTrigger}</dd></div>
                </dl>
              </article>

              <article className="simple-focus-card hermes-card">
                <header>
                  <small>HERMES · PREDICTION</small>
                  <span>{hermesAgreement.label}</span>
                </header>
                <h2>{plainDashboard.next}</h2>
                <p>{hermesAgreement.detail}</p>
                <button onClick={() => showView("live")}>See Hermes thinking</button>
              </article>

              <article className="simple-focus-card targets-card">
                <header>
                  <small>IMPORTANT LEVELS</small>
                  <span>ASTRO ONLY</span>
                </header>
                <div>
                  {focusTargets.map((target) => (
                    <section key={target.label}>
                    <small>{target.label}</small>
                    <strong>{target.value}</strong>
                    <span>{target.state}</span>
                    </section>
                  ))}
                </div>
                <button onClick={() => showView("chart")}>Open chart</button>
              </article>
            </section>

            <article className={`simple-latest ${hasUnseenUpdate ? "new" : ""}`}>
              <div>
                <small>{hasUnseenUpdate ? "NEW ASTRO UPDATE" : "LATEST ASTRO UPDATE"} · {lastUpdated} · {timeLabel}</small>
                <strong>{latestAstroEvidence?.label || forecast.headline}</strong>
              </div>
              <a
                href={latestAstroEvidence?.source || forecast.sources[0]?.url || "https://x.com/astronomer_zero"}
                onClick={markCurrentUpdateSeen}
                target="_blank"
                rel="noreferrer"
              >
                Open post ↗
              </a>
            </article>

            <nav className="simple-actions" aria-label="Main actions">
              <button onClick={() => showView("chart")}><strong>Chart</strong><span>Levels and projection</span></button>
              <button onClick={() => showView("journal")}><strong>History</strong><span>Past moves and school</span></button>
            </nav>

            {notice && <p className="notice">{notice}</p>}
          </section>
        </div>
      )}

      {activeView === "chart" && (
        <div className="chart-view" id="top">
          <header className="chart-page-intro">
            <div>
              <span className="eyebrow">MARKET MAP</span>
              <h1>Chart</h1>
              <p>Only price, confirmed Astro levels, and the separated Hermes projection.</p>
            </div>
            <button onClick={() => showView("desk")}>← Back to Now</button>
          </header>

          <LiveAstroChart
            events={forecast.evidence.filter(
              (item) => item.type === "astro" && item.source && item.time,
            )}
            freshnessLabel={signalFreshness.label}
            freshnessTone={signalFreshness.tone}
            levels={forecast.levels}
            thesisLevels={forecast.thesisLevels}
            forecastTime={forecast.generatedAt}
            signalState={forecast.signal.state}
            signalHeadline={opportunity.label}
            riskText={forecast.decision.risk}
            predictedProbability={predictedNextMove?.probability ?? 0}
            hermesHorizon={forecast.hermes.horizon}
            hermesCurrentPhase={forecast.hermes.currentPhase}
            hermesNextPhase={forecast.hermes.nextPhase}
            hermesLongerMove={forecast.hermes.longerMove}
            hermesConfirmation={forecast.hermes.confirmation}
            hermesFailure={forecast.hermes.failure}
            astroPosition={forecast.decision.position}
            astroConfirmed={forecast.thesis.astroConfirmed}
            astroTakeProfit={`${forecast.execution.takeProfit.state} · ${forecast.execution.takeProfit.level}`}
            schoolMatch={forecast.hermes.learningNote}
            marketContext={forecast.thesis.regime}
            hermesProjection={forecast.hermes.projection}
            hermesAudit={systemStatus.hermesAudit}
            hermesAnchorPrice={systemStatus.hermesAudit?.anchorPrice ?? null}
            hermesAnchorTime={systemStatus.hermesAudit?.createdAt ?? forecast.generatedAt}
            onOpenHermes={() => showView("hermes")}
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

      {activeView === "live" && (
        <section className="live-room">
          <header className="live-room-hero">
            <div>
              <span className="eyebrow">REAL ACTIVITY · REFRESHES EVERY 4 SECONDS</span>
              <h1>What is happening now?</h1>
              <p>
                One simple answer first. The timeline below shows only events
                that actually happened on the VPS.
              </p>
            </div>
            <div className={`live-now-card ${liveState.tone}`}>
              <span><i /> RIGHT NOW</span>
              <strong>{liveState.label}</strong>
              <p>{liveState.detail}</p>
              <small>
                Last real event · {relativeTime(latestActivity?.at, clockNow)}
              </small>
            </div>
          </header>

          <section className="live-simple-answer">
            <div className="live-answer-heading">
              <span>THE SIMPLE ANSWER</span>
              <strong>{plainDashboard.you}</strong>
            </div>
            <div className="live-answer-grid">
              <article>
                <small>WHAT ASTRO LAST DID</small>
                <strong>{plainDashboard.happened}</strong>
              </article>
              <article>
                <small>WHAT HERMES EXPECTS NEXT</small>
                <strong>{plainDashboard.next}</strong>
              </article>
              <article>
                <small>WHEN THIS ANSWER CHANGES</small>
                <strong>{forecast.signal.changesWhen}</strong>
              </article>
            </div>
          </section>

          <section className="live-steps" aria-label="How the live system works">
            <article>
              <i>1</i>
              <div>
                <small>LISTEN</small>
                <strong>Astro sources</strong>
                <p>
                  {systemStatus.telegramSourceStatus === "healthy"
                    ? `Both Telegram channels checked ${relativeTime(
                        systemStatus.telegramSourceLastSuccessAt,
                        clockNow,
                      )}.`
                    : "Telegram is reconnecting. Saved messages remain available."}
                </p>
              </div>
            </article>
            <article>
              <i>2</i>
              <div>
                <small>UNDERSTAND</small>
                <strong>Hermes checks the meaning</strong>
                <p>
                  {systemStatus.pipelineStatus === "analyzing"
                    ? "Working on new information now."
                    : "Ready. It runs only when something important changes."}
                </p>
              </div>
            </article>
            <article>
              <i>3</i>
              <div>
                <small>UPDATE</small>
                <strong>Plan, chart, and alert</strong>
                <p>
                  Last accepted plan saved {relativeTime(
                    forecast.generatedAt,
                    clockNow,
                  )}.
                </p>
              </div>
            </article>
          </section>

          <div className="live-room-grid">
            <section className="live-event-feed" aria-label="Recent real activity">
              <header>
                <div>
                  <span>REAL VPS EVENTS</span>
                  <strong>What just happened</strong>
                </div>
                <small>UPDATES EVERY 4S</small>
              </header>
              <div className="live-event-list" aria-live="polite">
                {systemStatus.activity.length ? (
                  [...systemStatus.activity]
                    .reverse()
                    .slice(0, 12)
                    .map((event, index) => (
                    <article
                      className={event.status}
                      key={event.id || `${event.at}-${event.stage}-${index}`}
                    >
                      <i />
                      <div>
                        <span>
                          {activitySourceLabel(event.service)} ·{" "}
                          {relativeTime(event.at, clockNow)}
                        </span>
                        <strong>{event.title}</strong>
                        <p>{event.detail}</p>
                      </div>
                    </article>
                    ))
                ) : (
                  <article className="quiet">
                    <i />
                    <div>
                      <span>LIVE CHECK</span>
                      <strong>Waiting for the first recorded event</strong>
                      <p>The last saved plan remains visible above.</p>
                    </div>
                  </article>
                )}
              </div>
            </section>

            <aside className="live-side-cards">
              <section>
                <small>WHAT WOULD MAKE HERMES RECHECK?</small>
                <strong>{forecast.thesis.nextTrigger}</strong>
                <p>A recheck does not automatically mean the plan will change.</p>
              </section>
              <section className="risk">
                <small>WHAT WOULD PROVE THIS READ WRONG?</small>
                <strong>{forecast.decision.risk}</strong>
              </section>
              <section className="live-freshness">
                <small>SOURCE FRESHNESS</small>
                <div>
                  <span>Astro Telegram</span>
                  <strong>
                    {systemStatus.telegramSourceStatus === "healthy"
                      ? "Listening now"
                      : "Reconnecting"}
                  </strong>
                </div>
                <div>
                  <span>Public X</span>
                  <strong>
                    Checked{" "}
                    {relativeTime(systemStatus.xSourceLastSuccessAt, clockNow)}
                  </strong>
                </div>
                <div>
                  <span>Whole signal</span>
                  <strong>{signalFreshness.label.toLowerCase()}</strong>
                </div>
              </section>
              <button
                className={`live-sound-button ${
                  soundAlertsEnabled ? "active" : ""
                }`}
                onClick={() => void toggleSoundAlerts()}
              >
                <span>{soundAlertsEnabled ? "Sound is on" : "Turn on sound"}</span>
                <small>
                  Alert me when a real Astro update or saved plan change arrives.
                </small>
              </button>
            </aside>
          </div>

          <p className="live-boundary">
            This page shows recorded inputs and conclusions, not hidden
            chain-of-thought. It cannot know Astro&apos;s private actions and it
            never places a trade.
          </p>
        </section>
      )}

      {["positions", "hermes", "history", "evidence", "playbook"].includes(
        activeView,
      ) && (
        <nav className="journal-subnav" aria-label="Journal sections">
          <button onClick={() => showView("journal")}>← History home</button>
        </nav>
      )}

      {activeView === "journal" && (
        <section className="journal-view">
          <header>
            <span className="eyebrow">REVIEW & LEARN</span>
            <h1>Journal</h1>
            <p>Everything saved for later—kept away from the live decision screen.</p>
          </header>
          <div className="journal-grid">
            <button onClick={() => showView("positions")}>
              <span>01</span>
              <strong>Positions & targets</strong>
              <p>Current maps, entries, targets and closes.</p>
              <small>Open →</small>
            </button>
            <button onClick={() => showView("history")}>
              <span>02</span>
              <strong>Track record</strong>
              <p>Past Astro plays and scored Hermes predictions.</p>
              <small>Open →</small>
            </button>
            <button onClick={() => showView("playbook")}>
              <span>03</span>
              <strong>Night School</strong>
              <p>Sources, lessons and whether Hermes is improving.</p>
              <small>Open →</small>
            </button>
          </div>
        </section>
      )}

      {activeView === "positions" && (
        <PositionsView
          forecast={forecast}
          hermesAudit={systemStatus.hermesAudit}
        />
      )}

      {activeView === "hermes" && (
        <section className="hermes-view">
          <div className="hermes-head">
            <div>
              <span className="eyebrow">HERMES BRAIN · LONGER-HORIZON MODEL</span>
              <h1>What comes after the current move?</h1>
              <p>
                Hermes connects Astro’s newest public evidence, the full Astro
                Codex archive, live market structure, and past forecast outcomes.
                This is a changing thesis—not a confirmed Astro trade.
              </p>
            </div>
            <div className="hermes-live-chip">
              <span className={signalFreshness.tone}><i /> AUTO-UPDATING</span>
              <strong>{forecast.confidence}%</strong>
              <small>EVIDENCE ALIGNMENT</small>
              <p>
                {systemStatus.hermesAudit
                  ? `${systemStatus.hermesAudit.official ? systemStatus.hermesAudit.marketStatus.toUpperCase() : "EXPERIMENTAL"} MAP · ${systemStatus.hermesAudit.hitCheckpoints}/${systemStatus.hermesAudit.totalCheckpoints} CHECKPOINTS`
                  : "FIRST MAP PENDING"}{" "}
                · {signalFreshness.label} · {timeLabel}
              </p>
            </div>
          </div>

          <section className="hermes-core">
            <header>
              <div>
                <small>HERMES CORE THESIS</small>
                <h2>{forecast.hermes.coreThesis}</h2>
              </div>
              <span>{forecast.hermes.horizon}</span>
            </header>

            <div className="hermes-path" aria-label="Hermes predicted phase path">
              <article className="current">
                <span>01</span>
                <small>CURRENT PHASE</small>
                <strong>{forecast.hermes.currentPhase}</strong>
                <p>Best-supported public state now.</p>
              </article>
              <i>→</i>
              <article className="next">
                <span>02</span>
                <small>EXPECTED TRANSITION</small>
                <strong>{forecast.hermes.nextPhase}</strong>
                <p>What Hermes expects before the larger move.</p>
              </article>
              <i>→</i>
              <article className="longer">
                <span>03</span>
                <small>LONGER MOVE</small>
                <strong>{forecast.hermes.longerMove}</strong>
                <p>Days-to-weeks model path; inference only.</p>
              </article>
            </div>
          </section>

          <div className="hermes-scenarios">
            <div className="hermes-section-title">
              <div>
                <small>NEXT OBSERVABLE ASTRO BEHAVIOR</small>
                <h2>Three paths. One must earn confirmation.</h2>
              </div>
              <p>Probabilities refresh when evidence or meaningful market structure changes.</p>
            </div>
            <div className="hermes-scenario-grid">
              {forecast.scenarios.map((scenario, index) => (
                <article className={index === 0 ? "lead" : ""} key={scenario.name}>
                  <header>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{scenario.probability}%</strong>
                  </header>
                  <h3>{scenario.name}</h3>
                  <div className="hermes-probability">
                    <i style={{ width: `${scenario.probability}%` }} />
                  </div>
                  <p>{scenario.description}</p>
                  <small>CONFIRMS IF · {scenario.trigger}</small>
                </article>
              ))}
            </div>
          </div>

          <section className="hermes-proof">
            <article className="direct">
              <small>01 · ASTRO DIRECT</small>
              <strong>{forecast.thesis.astroConfirmed}</strong>
              <span>Public evidence only</span>
            </article>
            <article className="memory">
              <small>02 · WHAT HERMES LEARNED</small>
              <strong>{forecast.hermes.learningNote}</strong>
              <span>
                {(systemStatus.codexEntries || 13984).toLocaleString("en-US")} lessons ·{" "}
                {(systemStatus.codexMedia || 877).toLocaleString("en-US")} charts
              </span>
            </article>
            <article className="market">
              <small>03 · MARKET / REGIME</small>
              <strong>{forecast.thesis.regime}</strong>
              <span>Model context—not an Astro quote</span>
            </article>
          </section>

          <section className="hermes-gates">
            <article>
              <small>THESIS GETS STRONGER IF</small>
              <strong>{forecast.hermes.confirmation}</strong>
            </article>
            <article className="failure">
              <small>HERMES IS WRONG / MUST REBUILD IF</small>
              <strong>{forecast.hermes.failure}</strong>
            </article>
          </section>

          <div className="hermes-boundary">
            <span>HOW IT UPDATES</span>
            <p>
              Every accepted VPS scan re-reads direct Astro posts, retrieves
              matching Astro Codex behavior, checks live Coinbase structure, and
              rebuilds this thesis. Silence or archive similarity can change a
              probability, but cannot create a confirmed trade.
            </p>
          </div>
        </section>
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

      {activeView === "playbook" && <NightSchool />}

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
