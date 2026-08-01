import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callDeepSeekJson } from "./deepseek-client.mjs";
import {
  nextUnprocessedSchoolBatch,
  normalizeDeepSeekThesis,
  thesisSourceSignature,
} from "./deepseek-thesis.mjs";

const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || "/var/lib/astro-signal";
const indexPath =
  process.env.ASTRO_CODEX_INDEX?.trim() ||
  join(stateDirectory, "codex-index.json");
const telegramPath =
  process.env.ASTRO_TELEGRAM_SOURCE_PATH?.trim() ||
  join(stateDirectory, "telegram-source.json");
const xPath =
  process.env.ASTRO_X_SOURCE_PATH?.trim() ||
  join(stateDirectory, "x-source.json");
const forecastPath =
  process.env.ASTRO_FORECAST_PATH?.trim() ||
  join(stateDirectory, "forecast.json");
const outputPath = join(stateDirectory, "deepseek-thesis.json");
const budgetPath = join(stateDirectory, "deepseek-background-budget.json");
const dailyCap = Math.max(
  1,
  Number.parseInt(process.env.ASTRO_DEEPSEEK_BACKGROUND_DAILY_CAP || "120", 10),
);
const batchSize = Math.max(
  20,
  Math.min(
    200,
    Number.parseInt(process.env.ASTRO_DEEPSEEK_SCHOOL_BATCH_SIZE || "100", 10),
  ),
);
const refreshMs =
  Math.max(
    1,
    Number.parseInt(process.env.ASTRO_DEEPSEEK_THESIS_REFRESH_HOURS || "6", 10),
  ) *
  3_600_000;

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

const [index, telegram, x, forecast, previous] = await Promise.all([
  readJson(indexPath, {}),
  readJson(telegramPath, {}),
  readJson(xPath, {}),
  readJson(forecastPath, {}),
  readJson(outputPath, {
    version: 1,
    processedRefs: [],
    lessons: [],
    thesis: null,
    lunaPacket: null,
  }),
]);

if (
  !Array.isArray(index?.entries) ||
  !Number.isInteger(index?.entryCount) ||
  index.entryCount !== index.entries.length
) {
  const result = {
    ...previous,
    version: 1,
    updatedAt: new Date().toISOString(),
    status: "degraded",
    error: "Astro Codex index is unavailable.",
  };
  await writeJsonAtomic(outputPath, result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

const sourceSignature = thesisSourceSignature({ index, telegram, x, forecast });
const schoolBatch = nextUnprocessedSchoolBatch(
  index,
  previous.processedRefs,
  batchSize,
);
const previousUpdatedMs = new Date(previous.updatedAt || 0).getTime();
const refreshDue =
  !Number.isFinite(previousUpdatedMs) ||
  Date.now() - previousUpdatedMs >= refreshMs;
const sourceChanged = previous.sourceSignature !== sourceSignature;

if (!schoolBatch.length && !sourceChanged && !refreshDue) {
  const quiet = {
    ...previous,
    checkedAt: new Date().toISOString(),
    status: "healthy",
    work: "quiet",
    error: null,
  };
  await writeJsonAtomic(outputPath, quiet);
  process.stdout.write(
    `${JSON.stringify({
      status: "healthy",
      work: "quiet",
      schoolProcessed: previous.processedRefs?.length || 0,
      schoolTotal: index.entryCount,
    })}\n`,
  );
  process.exit(0);
}

const recentTelegram = (Array.isArray(telegram?.messages)
  ? telegram.messages
  : []
)
  .slice(-30)
  .map((message) => ({
    id: message.id,
    chatTitle: message.chatTitle,
    date: message.activityAt || message.editedAt || message.postedAt,
    text: String(message.text || "").slice(0, 1_500),
  }));
const recentX = (Array.isArray(x?.posts) ? x.posts : []).slice(0, 8);
const recentLessons = (Array.isArray(previous?.lessons)
  ? previous.lessons
  : []
).slice(-60);

const prompt = `You are DeepSeek, the background evidence clerk and Astro School
distiller for Astro Intelligence. You prepare a clean internal research packet
for Luna Medium. You never create a confirmed trade and never modify a forecast.

Current accepted forecast:
${JSON.stringify({
  generatedAt: forecast.generatedAt ?? null,
  signal: forecast.signal ?? null,
  decision: forecast.decision ?? null,
  execution: forecast.execution ?? null,
  hermes: forecast.hermes ?? null,
})}

Recent approved Telegram context:
${JSON.stringify(recentTelegram)}

Recent Grok X evidence:
${JSON.stringify({
  status: x.status ?? "missing",
  checkedAt: x.checkedAt ?? null,
  posts: recentX,
})}

Previously distilled lessons:
${JSON.stringify(recentLessons)}

Next Astro School archive batch:
${JSON.stringify(schoolBatch)}

Return only this JSON:
{
  "thesis": {
    "astroConfirmed": "public X facts only, or No new public confirmation",
    "publicSourceRefs": ["exact direct Astro X status URLs only"],
    "telegramContext": "terse paraphrase; never reproduce paid text",
    "campaign": {
      "state": "unknown/planned/open/partial/closed/conflict",
      "direction": "unknown/long/short/both/flat",
      "entry": "supported value or Unknown",
      "targets": ["supported targets in order"],
      "invalidation": "supported invalidation or Unknown"
    },
    "nextBehaviors": [
      {
        "action": "hold/trim/close/flip_long/flip_short/readd/silence/post_update",
        "probability": 0,
        "horizonHours": 24,
        "why": "evidence-based reason",
        "sourceRefs": ["message IDs, archive refs, or exact X URLs"]
      }
    ],
    "contradictions": ["direct conflicts only"],
    "unknowns": ["important missing facts"]
  },
  "newLessons": [
    {
      "rule": "reusable Astro principle",
      "when": "conditions",
      "sequence": "observable execution or phase sequence",
      "failsWhen": "limit of the analogy",
      "sourceRefs": ["refs from the supplied archive batch only"]
    }
  ],
  "lunaPacket": {
    "facts": ["maximum ten terse facts"],
    "historicalAnalogues": ["closest useful lessons, with refs"],
    "question": "the one decision Luna must resolve",
    "counterCase": "strongest opposing explanation",
    "doNotAssume": ["unsupported claims Luna must not make"]
  }
}

Rules:
- X facts require exact https://x.com/astronomer_zero/status/<digits> URLs.
- Telegram is approved private context but must be paraphrased.
- Archive lessons are historical context, not proof of a current position.
- Never invent a price or imply private access to Astro's intentions.
- Keep up to three next behaviors. Probabilities express model uncertainty.
- Every new lesson must cite only refs present in the supplied archive batch.`;

const result = await callDeepSeekJson({
  budgetPath,
  dailyCap,
  system:
    "Return only valid JSON for an internal evidence and curriculum packet. No trading instructions.",
  prompt,
  maxTokens: 2_200,
  reasoningEffort: "low",
  timeoutMs: 75_000,
});

if (!result.available) {
  const degraded = {
    ...previous,
    version: 1,
    checkedAt: new Date().toISOString(),
    status: "degraded",
    work: "failed",
    error: result.reason,
  };
  await writeJsonAtomic(outputPath, degraded);
  process.stdout.write(
    `${JSON.stringify({ status: "degraded", error: result.reason })}\n`,
  );
  process.exit(0);
}

const normalized = normalizeDeepSeekThesis(
  result.value,
  schoolBatch.map((entry) => entry.ref),
);
const processedRefs = [
  ...new Set([
    ...(Array.isArray(previous.processedRefs) ? previous.processedRefs : []),
    ...schoolBatch.map((entry) => entry.ref),
  ]),
];
const lessons = [
  ...(Array.isArray(previous.lessons) ? previous.lessons : []),
  ...normalized.newLessons.map((lesson) => ({
    ...lesson,
    learnedAt: new Date().toISOString(),
  })),
].slice(-500);
const updatedAt = new Date().toISOString();
const next = {
  version: 1,
  updatedAt,
  checkedAt: updatedAt,
  status: "healthy",
  work: schoolBatch.length ? "school_and_thesis" : "thesis_refresh",
  provider: result.model,
  sourceSignature,
  sourceFreshness: {
    indexBuiltAt: index.builtAt ?? null,
    telegramNewestAt: telegram.newestAcceptedAt ?? null,
    xCheckedAt: x.checkedAt ?? null,
    forecastGeneratedAt: forecast.generatedAt ?? null,
  },
  school: {
    processed: processedRefs.length,
    total: index.entryCount,
    complete: processedRefs.length >= index.entryCount,
    batchSize: schoolBatch.length,
    lessonCount: lessons.length,
  },
  processedRefs,
  lessons,
  thesis: normalized.thesis,
  lunaPacket: normalized.lunaPacket,
  budget: {
    cap: result.budget.cap,
    used: result.budget.used,
    remaining: result.budget.remaining,
  },
  error: null,
};
await writeJsonAtomic(outputPath, next);
process.stdout.write(
  `${JSON.stringify({
    status: "healthy",
    work: next.work,
    schoolProcessed: next.school.processed,
    schoolTotal: next.school.total,
    lessons: next.school.lessonCount,
    remaining: next.budget.remaining,
  })}\n`,
);
