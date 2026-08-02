import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callDeepSeekJson } from "./deepseek-client.mjs";
import {
  buildThesisReviewSignal,
  lessonFingerprint,
  mergeHumanApprovedLessons,
  nextUnprocessedSchoolBatch,
  normalizeDeepSeekThesis,
  normalizeLessonReviews,
  stabilizeDeepSeekThesis,
  thesisSourceSignature,
} from "./deepseek-thesis.mjs";
import {
  defaultLedgerPath,
  recordRuntimeEvent,
} from "./astro-event-ledger.mjs";

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
const learningReviewPath = join(stateDirectory, "learning-review.json");
const eventLedgerPath = defaultLedgerPath(stateDirectory);
const evidenceBriefPath = join(
  stateDirectory,
  "deepseek-evidence-brief.json",
);
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

function emitLiveEvent(event) {
  try {
    return recordRuntimeEvent(eventLedgerPath, event);
  } catch {
    return null;
  }
}

const [index, telegram, x, forecast, previous, evidenceBrief, learningReview] =
  await Promise.all([
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
  readJson(evidenceBriefPath, {}),
  readJson(learningReviewPath, {
    version: 1,
    decisions: {},
    posts: {},
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
const humanApprovedLessons = mergeHumanApprovedLessons(
  previous.lessons,
  previous.lessonCandidates,
  learningReview,
  new Date().toISOString(),
);
const previousLessonSignature = JSON.stringify(
  (Array.isArray(previous.lessons) ? previous.lessons : []).map(
    (lesson) => lesson.fingerprint || lessonFingerprint(lesson),
  ),
);
const approvedLessonSignature = JSON.stringify(
  humanApprovedLessons.map(
    (lesson) => lesson.fingerprint || lessonFingerprint(lesson),
  ),
);
const humanReviewChanged =
  previousLessonSignature !== approvedLessonSignature;

if (!schoolBatch.length && !sourceChanged && !refreshDue) {
  const quiet = {
    ...previous,
    lessons: humanApprovedLessons,
    school: previous.school
      ? {
          ...previous.school,
          lessonCount: humanApprovedLessons.length,
        }
      : previous.school,
    checkedAt: new Date().toISOString(),
    status: "healthy",
    work: humanReviewChanged ? "human_review_sync" : "quiet",
    error: null,
  };
  await writeJsonAtomic(outputPath, quiet);
  process.stdout.write(
    `${JSON.stringify({
      status: "healthy",
      work: quiet.work,
      schoolProcessed: previous.processedRefs?.length || 0,
      schoolTotal: index.entryCount,
      lessons: humanApprovedLessons.length,
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
    ref: message.id,
    id: message.id,
    chatTitle: message.chatTitle,
    date: message.activityAt || message.editedAt || message.postedAt,
    text: String(message.text || "").slice(0, 1_500),
  }));
const recentX = (Array.isArray(x?.posts) ? x.posts : []).slice(0, 8);
const recentLessons = humanApprovedLessons
  .filter((lesson) => lesson?.quality?.status === "supported")
  .slice(-60);
const liveLearningEvidence = recentTelegram
  .filter((message) => message.ref && message.text)
  .map((message) => ({
    ref: message.ref,
    source: message.chatTitle || "Approved Astro Telegram",
    date: message.date || "Unknown date",
    text: message.text,
  }));
const learningEvidence = [
  ...schoolBatch,
  ...liveLearningEvidence.filter(
    (live) => !schoolBatch.some((entry) => entry.ref === live.ref),
  ),
];

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

Eligible learning evidence (next archive batch plus recent live Astro messages):
${JSON.stringify(learningEvidence)}

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
      "category": "setup/entry/add/trim/close/flip/invalidation/avoidance/timing/communication/risk",
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
    "appliedLessonFingerprints": ["exact fingerprint of each approved lesson that materially affects the current research"],
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
- Return one to three next behaviors. Probabilities express model uncertainty
  and should total 100 across the returned candidates.
- Every new lesson must cite only refs present in the supplied learning evidence.
- A lesson is only a proposal. A human owner must approve it before Hermes may
  use it in future predictions.
- Learn Astro's decision process, not whether a trade made money: what he
  notices, waits for, avoids, enters, adds to, trims, closes, invalidates, and
  changes after the market disagrees.
- Preserve negative edge. A well-supported rule about when Astro refuses or
  skips a setup is as valuable as an entry rule.
- appliedLessonFingerprints may contain only exact fingerprints from Previously
  distilled lessons. Include a fingerprint only when that lesson materially
  changes or supports the current research; otherwise return an empty array.`;

const result = await callDeepSeekJson({
  budgetPath,
  dailyCap,
  system:
    "Return only valid JSON for an internal evidence and curriculum packet. No trading instructions.",
  prompt,
  maxTokens: 3_000,
  reasoningEffort: "none",
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
  learningEvidence.map((entry) => entry.ref),
  humanApprovedLessons.map(
    (lesson) => lesson.fingerprint || lessonFingerprint(lesson),
  ),
);
let lessonReviews = [];
let reviewResult = null;
if (normalized.newLessons.length) {
  reviewResult = await callDeepSeekJson({
    budgetPath,
    dailyCap,
    system:
      "Act as a strict source-entailment grader. Approve only lessons fully supported by the supplied source text. Return JSON only.",
    prompt: `Review these candidate Astro School lessons against the exact archive
items supplied below.

Candidates, addressed by zero-based candidateIndex:
${JSON.stringify(normalized.newLessons)}

Exact source evidence:
${JSON.stringify(learningEvidence)}

Return only:
{
  "reviews": [
    {
      "candidateIndex": 0,
      "verdict": "supported or rejected",
      "supportedRefs": ["only candidate refs whose text directly supports it"],
      "reason": "terse support decision",
      "contradiction": "direct contradiction or None"
    }
  ]
}

Reject a candidate when its rule, conditions, sequence, or limitation goes
beyond the cited text. Similarity is not support. Review every candidate.`,
    maxTokens: 1_800,
    reasoningEffort: "none",
    timeoutMs: 60_000,
  });
  if (!reviewResult.available) {
    const degraded = {
      ...previous,
      version: 1,
      checkedAt: new Date().toISOString(),
      status: "degraded",
      work: "lesson_review_failed",
      pendingLessonCandidates: normalized.newLessons,
      error: reviewResult.reason,
    };
    await writeJsonAtomic(outputPath, degraded);
    process.stdout.write(
      `${JSON.stringify({
        status: "degraded",
        work: "lesson_review_failed",
        error: reviewResult.reason,
      })}\n`,
    );
    process.exit(0);
  }
  const normalizedReviews = normalizeLessonReviews(
    reviewResult.value,
    normalized.newLessons,
  );
  const byCandidate = new Map(
    normalizedReviews.map((review) => [review.candidateIndex, review]),
  );
  lessonReviews = normalized.newLessons.map(
    (_, candidateIndex) =>
      byCandidate.get(candidateIndex) ?? {
        candidateIndex,
        verdict: "rejected",
        supportedRefs: [],
        reason: "The grader did not return a valid review.",
        contradiction: "None",
      },
  );
}
const stabilized = stabilizeDeepSeekThesis(normalized, {
  previous: {
    ...previous,
    lessons: humanApprovedLessons,
  },
  forecast,
  evidenceBrief,
});
const processedRefs = [
  ...new Set([
    ...(Array.isArray(previous.processedRefs) ? previous.processedRefs : []),
    ...schoolBatch.map((entry) => entry.ref),
  ]),
];
const updatedAt = new Date().toISOString();
const legacyLessonCandidates = (Array.isArray(previous.lessons)
  ? previous.lessons
  : []
)
  .filter((lesson) => lesson?.quality?.status !== "supported")
  .map((lesson) => ({
    ...lesson,
    candidateAt: lesson.learnedAt ?? updatedAt,
    review: {
      candidateIndex: null,
      verdict: "legacy_unreviewed",
      supportedRefs: [],
      reason:
        "Created before the independent lesson-quality gate; retained for audit but not approved memory.",
      contradiction: "Unknown",
    },
  }));
const rawLessonCandidates = [
  ...(Array.isArray(previous.lessonCandidates)
    ? previous.lessonCandidates
    : []),
  ...legacyLessonCandidates,
  ...normalized.newLessons.map((lesson, candidateIndex) => ({
    ...lesson,
    fingerprint: lessonFingerprint(lesson),
    candidateAt: updatedAt,
    review: lessonReviews.find(
      (item) => item.candidateIndex === candidateIndex,
    ) ?? {
      candidateIndex,
      verdict: "rejected",
      supportedRefs: [],
      reason: "No valid source-support review was returned.",
      contradiction: "None",
    },
  })),
];
const lessonCandidateMap = new Map();
for (const candidate of rawLessonCandidates) {
  const fingerprint = candidate.fingerprint || lessonFingerprint(candidate);
  const prior = lessonCandidateMap.get(fingerprint);
  lessonCandidateMap.set(fingerprint, {
    ...(prior || {}),
    ...candidate,
    fingerprint,
    candidateAt: prior?.candidateAt || candidate.candidateAt || updatedAt,
    sourceRefs: [
      ...new Set([
        ...(prior?.sourceRefs || []),
        ...(candidate.sourceRefs || []),
      ]),
    ].slice(0, 12),
  });
}
const lessonCandidates = [...lessonCandidateMap.values()].slice(-500);
const lessons = mergeHumanApprovedLessons(
  humanApprovedLessons,
  lessonCandidates,
  learningReview,
  updatedAt,
);
const budget = reviewResult?.budget ?? result.budget;
const next = {
  version: 1,
  updatedAt,
  checkedAt: updatedAt,
  status: "healthy",
  work: schoolBatch.length
    ? stabilized.acceptedNewThesis
      ? "school_and_thesis"
      : "school_with_thesis_continuity"
    : stabilized.acceptedNewThesis
      ? "thesis_refresh"
      : "thesis_continuity",
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
    candidateCount: lessonCandidates.length,
    pendingHumanReview: lessonCandidates.filter((candidate) => {
      const decision = learningReview?.decisions?.[candidate.fingerprint];
      return candidate.review?.verdict === "supported" && !decision;
    }).length,
  },
  processedRefs,
  lessons,
  lessonCandidates,
  thesis: stabilized.thesis,
  lunaPacket: stabilized.lunaPacket,
  budget: {
    cap: budget.cap,
    used: budget.used,
    remaining: budget.remaining,
  },
  error: null,
};
next.reviewSignal = buildThesisReviewSignal(previous, next, updatedAt);
await writeJsonAtomic(outputPath, next);
emitLiveEvent({
  at: updatedAt,
  service: "school",
  kind: "school_progress",
  status: "done",
  title: "DeepSeek studied more Astro history",
  detail: `DeepSeek reviewed ${schoolBatch.length} archive items and updated its source-checked lesson candidates. Live Astro updates still have priority.`,
  dedupeKey: updatedAt,
});
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
