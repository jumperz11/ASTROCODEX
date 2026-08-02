import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  chronologicalSplit,
  eligibleBehaviorPredictions,
  eligiblePredictions,
  normalizePolicy,
  scoreBehaviorPolicy,
  scorePolicy,
} from "./autoresearch-shadow.mjs";
import { callDeepSeekJson } from "./deepseek-client.mjs";
import {
  defaultLedgerPath,
  recordRuntimeEvent,
} from "./astro-event-ledger.mjs";

const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || "/var/lib/astro-signal";
const historyPath = join(stateDirectory, "history.json");
const researchPath = join(stateDirectory, "autoresearch-shadow.json");
const budgetPath = join(stateDirectory, "autoresearch-deepseek-budget.json");
const eventLedgerPath = defaultLedgerPath(stateDirectory);
const minimumMarketExamples = Math.max(
  12,
  Number.parseInt(process.env.ASTRO_AUTORESEARCH_MIN_EXAMPLES || "20", 10),
);
const minimumBehaviorExamples = Math.max(
  8,
  Number.parseInt(
    process.env.ASTRO_AUTORESEARCH_MIN_BEHAVIOR_EXAMPLES || "12",
    10,
  ),
);

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function emitLiveEvent(event) {
  try {
    return recordRuntimeEvent(eventLedgerPath, event);
  } catch {
    return null;
  }
}

async function proposeExperiment(records, previous, track) {
  const result = await callDeepSeekJson({
    budgetPath,
    dailyCap: 2,
    system:
      "Propose one bounded shadow experiment. Return JSON only. Never recommend a trade or modify live state.",
    prompt: `We score frozen Hermes ${track} predictions mechanically. Propose one alert-filter experiment.

Allowed JSON:
{
  "confidenceFloor": integer 0..90,
  "maxHorizonHours": integer 24..2160,
  "requireBehaviorPrediction": boolean,
  "hypothesis": "one terse sentence"
}

Recent resolved record summaries:
${JSON.stringify(records.slice(-120))}

Previous shadow results:
${JSON.stringify(
  (previous?.experiments || [])
    .filter((experiment) => experiment.track === track)
    .slice(-12),
)}`,
    maxTokens: 800,
    reasoningEffort: "low",
    timeoutMs: 60_000,
  });
  if (!result.available) return result;
  const candidate = result.value;
  return {
    available: true,
    model: result.model,
    hypothesis:
      typeof candidate.hypothesis === "string"
        ? candidate.hypothesis.slice(0, 240)
        : "Bounded confidence and horizon experiment.",
    policy: normalizePolicy(candidate),
  };
}

const history = await readJson(historyPath, {});
const defaultPolicy = {
  confidenceFloor: 0,
  maxHorizonHours: 2160,
  requireBehaviorPrediction: false,
};
const previous = await readJson(researchPath, {
  champion: defaultPolicy,
  champions: { market: defaultPolicy, behavior: defaultPolicy },
  experiments: [],
});
const marketEligible = eligiblePredictions(history);
const behaviorEligible = eligibleBehaviorPredictions(history);
const track =
  marketEligible.length >= minimumMarketExamples
    ? "market"
    : behaviorEligible.length >= minimumBehaviorExamples
      ? "behavior"
      : null;
if (!track) {
  const result = {
    ...previous,
    updatedAt: new Date().toISOString(),
    status: "collecting",
    mode: "shadow_only",
    eligibleExamples: marketEligible.length,
    marketExamples: marketEligible.length,
    behaviorExamples: behaviorEligible.length,
    requiredExamples: minimumMarketExamples,
    requiredMarketExamples: minimumMarketExamples,
    requiredBehaviorExamples: minimumBehaviorExamples,
    note:
      "Market and behavior outcomes are collected separately. No experiment runs until one track has enough frozen outcomes.",
  };
  await writeJsonAtomic(researchPath, result);
  emitLiveEvent({
    at: result.updatedAt,
    service: "school",
    kind: "research_waiting",
    status: "quiet",
    title: "DeepSeek checked whether Hermes is improving",
    detail: `There are ${behaviorEligible.length}/${minimumBehaviorExamples} scored behavior predictions and ${marketEligible.length}/${minimumMarketExamples} scored market maps. No strategy experiment ran yet.`,
    dedupeKey: result.updatedAt,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

const eligible = track === "market" ? marketEligible : behaviorEligible;
const records = eligible.map((item) => ({
  id: item.id,
  createdAt: item.createdAt,
  confidence: item.confidence,
  horizonHours: item.horizonHours,
  marketStatus: item.marketStatus,
  behaviorStatus: item.behaviorOutcome?.status ?? "unscored",
  hasBehavior: Boolean(item.behavior),
}));
const proposal = await proposeExperiment(records, previous, track);
if (!proposal.available) {
  await writeJsonAtomic(researchPath, {
    ...previous,
    updatedAt: new Date().toISOString(),
    status: "degraded",
    error: proposal.reason,
  });
  process.stdout.write(
    `${JSON.stringify({ status: "degraded", error: proposal.reason })}\n`,
  );
  process.exit(0);
}

const { holdout } = chronologicalSplit(eligible);
const champions = {
  market:
    previous.champions?.market ?? previous.champion ?? defaultPolicy,
  behavior: previous.champions?.behavior ?? defaultPolicy,
};
const score = track === "market" ? scorePolicy : scoreBehaviorPolicy;
const baseline = score(holdout, champions[track]);
const candidate = score(holdout, proposal.policy);
const improved =
  candidate.score !== null &&
  baseline.score !== null &&
  candidate.score >= baseline.score + 0.02;
const experiment = {
  id: new Date().toISOString(),
  track,
  model: proposal.model,
  hypothesis: proposal.hypothesis,
  baseline,
  candidate,
  result: improved ? "shadow_improvement" : "rejected",
};
const next = {
  updatedAt: experiment.id,
  status: "healthy",
  mode: "shadow_only",
  eligibleExamples: marketEligible.length,
  marketExamples: marketEligible.length,
  behaviorExamples: behaviorEligible.length,
  requiredMarketExamples: minimumMarketExamples,
  requiredBehaviorExamples: minimumBehaviorExamples,
  champions: {
    ...champions,
    [track]: improved ? proposal.policy : champions[track],
  },
  champion:
    track === "market" && improved
      ? proposal.policy
      : champions.market,
  experiments: [...(previous.experiments || []), experiment].slice(-200),
  note:
    "Shadow results never change live forecasts without explicit human review.",
};
await writeJsonAtomic(researchPath, next);
emitLiveEvent({
  at: experiment.id,
  service: "school",
  kind: "research_experiment",
  status: improved ? "done" : "quiet",
  title: improved
    ? "DeepSeek found a better shadow rule"
    : "DeepSeek tested a rule · no improvement",
  detail: improved
    ? "The rule improved the held-out score in shadow testing. It still cannot change the live strategy automatically."
    : "The candidate rule did not beat the current shadow baseline, so it was rejected.",
  dedupeKey: experiment.id,
});
process.stdout.write(`${JSON.stringify(experiment)}\n`);
