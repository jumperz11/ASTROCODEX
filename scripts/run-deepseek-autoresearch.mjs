import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  chronologicalSplit,
  eligiblePredictions,
  normalizePolicy,
  scorePolicy,
} from "./autoresearch-shadow.mjs";
import { consumeBudget } from "./provider-budget.mjs";

const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || "/var/lib/astro-signal";
const historyPath = join(stateDirectory, "history.json");
const researchPath = join(stateDirectory, "autoresearch-shadow.json");
const budgetPath = join(stateDirectory, "autoresearch-deepseek-budget.json");
const minimumExamples = Math.max(
  12,
  Number.parseInt(process.env.ASTRO_AUTORESEARCH_MIN_EXAMPLES || "20", 10),
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

async function proposeExperiment(records, previous) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return { available: false, reason: "not_configured" };
  const budget = await consumeBudget(budgetPath, 2);
  if (!budget.accepted) return { available: false, reason: "daily_cap" };
  const openRouter =
    apiKey.startsWith("sk-or-") ||
    process.env.DEEPSEEK_BASE_URL?.includes("openrouter.ai");
  const url =
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    (openRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.deepseek.com/chat/completions");
  const model =
    process.env.ASTRO_DEEPSEEK_MODEL?.trim() ||
    (openRouter
      ? "deepseek/deepseek-v4-flash-0731"
      : "deepseek-v4-flash");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Propose one bounded shadow experiment. Return JSON only. Never recommend a trade or modify live state.",
        },
        {
          role: "user",
          content: `We score frozen Hermes forecasts mechanically. Propose one alert-filter experiment.

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
${JSON.stringify((previous?.experiments || []).slice(-12))}`,
        },
      ],
      response_format: { type: "json_object" },
      ...(openRouter
        ? { reasoning: { effort: "low" } }
        : { thinking: { type: "enabled" } }),
      max_tokens: 800,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    return { available: false, reason: `http_${response.status}` };
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return { available: false, reason: "empty_response" };
  }
  const candidate = JSON.parse(content);
  return {
    available: true,
    model,
    hypothesis:
      typeof candidate.hypothesis === "string"
        ? candidate.hypothesis.slice(0, 240)
        : "Bounded confidence and horizon experiment.",
    policy: normalizePolicy(candidate),
  };
}

const history = await readJson(historyPath, {});
const previous = await readJson(researchPath, {
  champion: {
    confidenceFloor: 0,
    maxHorizonHours: 2160,
    requireBehaviorPrediction: false,
  },
  experiments: [],
});
const eligible = eligiblePredictions(history);
if (eligible.length < minimumExamples) {
  const result = {
    ...previous,
    updatedAt: new Date().toISOString(),
    status: "collecting",
    eligibleExamples: eligible.length,
    requiredExamples: minimumExamples,
    note: "No experiment runs until enough frozen outcomes exist.",
  };
  await writeJsonAtomic(researchPath, result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

const records = eligible.map((item) => ({
  id: item.id,
  createdAt: item.createdAt,
  confidence: item.confidence,
  horizonHours: item.horizonHours,
  marketStatus: item.marketStatus,
  behaviorStatus: item.behaviorOutcome?.status ?? "unscored",
  hasBehavior: Boolean(item.behavior),
}));
const proposal = await proposeExperiment(records, previous);
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
const baseline = scorePolicy(holdout, previous.champion);
const candidate = scorePolicy(holdout, proposal.policy);
const improved =
  candidate.score !== null &&
  baseline.score !== null &&
  candidate.score >= baseline.score + 0.02;
const experiment = {
  id: new Date().toISOString(),
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
  eligibleExamples: eligible.length,
  champion: improved ? proposal.policy : previous.champion,
  experiments: [...(previous.experiments || []), experiment].slice(-200),
  note:
    "Shadow results never change live forecasts without explicit human review.",
};
await writeJsonAtomic(researchPath, next);
process.stdout.write(`${JSON.stringify(experiment)}\n`);
