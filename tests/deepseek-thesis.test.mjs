import assert from "node:assert/strict";
import test from "node:test";

import {
  buildThesisReviewSignal,
  lessonFingerprint,
  mergeApprovedLessons,
  nextUnprocessedSchoolBatch,
  normalizeDeepSeekThesis,
  normalizeLessonReviews,
  stabilizeDeepSeekThesis,
  thesisSourceSignature,
} from "../scripts/deepseek-thesis.mjs";
import { parseDeepSeekJson } from "../scripts/deepseek-client.mjs";

test("shared DeepSeek parser accepts fenced objects and rejects partial JSON", () => {
  assert.deepEqual(parseDeepSeekJson("```json\n{\"ok\":true}\n```"), {
    ok: true,
  });
  assert.equal(parseDeepSeekJson("{\"ok\":"), null);
});

test("DeepSeek school advances only through unprocessed Astro entries", () => {
  const index = {
    entries: [
      { ref: "messages.html#message1", source: "School", text: "One" },
      { ref: "messages.html#message2", source: "School", text: "Two" },
      { ref: "messages.html#message3", source: "School", text: "Three" },
    ],
  };
  const batch = nextUnprocessedSchoolBatch(
    index,
    ["messages.html#message1"],
    2,
  );
  assert.deepEqual(
    batch.map((entry) => entry.ref),
    ["messages.html#message2", "messages.html#message3"],
  );
});

test("DeepSeek thesis strips unsupported public sources and archive lessons", () => {
  const normalized = normalizeDeepSeekThesis(
    {
      thesis: {
        astroConfirmed: "Confirmed claim",
        publicSourceRefs: [
          "telegram-user:-1001:3",
          "https://x.com/astronomer_zero/status/2083130924980727816",
        ],
        campaign: { state: "open", direction: "short" },
        nextBehaviors: [
          { action: "hold", probability: 2, horizonHours: 24 },
          { action: "close", probability: 1, horizonHours: 48 },
        ],
      },
      newLessons: [
        {
          rule: "Trim before flipping.",
          sourceRefs: ["messages.html#message2", "invented-ref"],
        },
      ],
      lunaPacket: { facts: ["One fact"] },
    },
    ["messages.html#message2"],
  );
  assert.deepEqual(normalized.thesis.publicSourceRefs, [
    "https://x.com/astronomer_zero/status/2083130924980727816",
  ]);
  assert.deepEqual(normalized.newLessons[0].sourceRefs, [
    "messages.html#message2",
  ]);
  assert.deepEqual(
    normalized.thesis.nextBehaviors.map((item) => item.probability),
    [67, 33],
  );
});

test("DeepSeek thesis source signature changes with accepted inputs", () => {
  const base = {
    index: { builtAt: "a", entryCount: 10 },
    telegram: { newestAcceptedAt: "b", messages: [] },
    x: { newestAcceptedAt: "c", status: "healthy" },
    forecast: { generatedAt: "d" },
  };
  assert.notEqual(
    thesisSourceSignature(base),
    thesisSourceSignature({
      ...base,
      telegram: { newestAcceptedAt: "new", messages: [] },
    }),
  );
});

test("zero-weight behavior candidates become explicit equal uncertainty", () => {
  const normalized = normalizeDeepSeekThesis(
    {
      thesis: {
        nextBehaviors: [
          { action: "silence", probability: 0 },
          { action: "post_update", probability: 0 },
          { action: "trim", probability: 0 },
        ],
      },
    },
    [],
  );
  assert.deepEqual(
    normalized.thesis.nextBehaviors.map((item) => item.probability),
    [33, 33, 34],
  );
});

test("background behavior certainty leaves room for alternatives", () => {
  const normalized = normalizeDeepSeekThesis(
    {
      thesis: {
        nextBehaviors: [
          { action: "post_update", probability: 100 },
          { action: "hold", probability: 0 },
          { action: "trim", probability: 0 },
        ],
      },
    },
    [],
  );
  assert.deepEqual(
    normalized.thesis.nextBehaviors.map((item) => item.probability),
    [70, 15, 15],
  );
});

test("school lessons require a valid source-support review before promotion", () => {
  const candidates = [
    {
      rule: "Trim gradually into strength.",
      when: "A target is reached.",
      sequence: "Entry, target, trim.",
      failsWhen: "The position was never confirmed.",
      sourceRefs: ["archive:1"],
    },
    {
      rule: "Invented rule.",
      when: "Always.",
      sequence: "Unknown.",
      failsWhen: "Never.",
      sourceRefs: ["archive:2"],
    },
  ];
  const reviews = normalizeLessonReviews(
    {
      reviews: [
        {
          candidateIndex: 0,
          verdict: "supported",
          supportedRefs: ["archive:1", "archive:not-allowed"],
          reason: "The cited message states the sequence.",
          contradiction: "None",
        },
        {
          candidateIndex: 1,
          verdict: "supported",
          supportedRefs: [],
          reason: "No source support.",
          contradiction: "None",
        },
      ],
    },
    candidates,
  );
  assert.equal(reviews[0].verdict, "supported");
  assert.deepEqual(reviews[0].supportedRefs, ["archive:1"]);
  assert.equal(reviews[1].verdict, "rejected");

  const approved = mergeApprovedLessons(
    [],
    candidates,
    reviews,
    "2026-08-01T00:00:00.000Z",
  );
  assert.equal(approved.length, 1);
  assert.equal(approved[0].quality.status, "supported");
  assert.equal(approved[0].fingerprint, lessonFingerprint(candidates[0]));
});

test("approved school lessons deduplicate while preserving source support", () => {
  const candidate = {
    rule: "Protect a runner.",
    when: "After taking partial profit.",
    sequence: "Trim, protect, wait.",
    failsWhen: "The trade is fully closed.",
    sourceRefs: ["archive:2"],
  };
  const existing = [
    {
      ...candidate,
      fingerprint: lessonFingerprint(candidate),
      sourceRefs: ["archive:1"],
      learnedAt: "2026-07-31T00:00:00.000Z",
      quality: { status: "supported" },
    },
  ];
  const merged = mergeApprovedLessons(
    existing,
    [candidate],
    [
      {
        candidateIndex: 0,
        verdict: "supported",
        supportedRefs: ["archive:2"],
        reason: "Supported.",
        contradiction: "None",
      },
    ],
    "2026-08-01T00:00:00.000Z",
  );
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sourceRefs, ["archive:1", "archive:2"]);
});

test("school review wakes only at bounded milestones or completion", () => {
  const base = {
    school: { processed: 1_900, total: 14_187, complete: false, lessonCount: 9 },
    thesis: {
      campaign: { state: "open", direction: "short" },
      nextBehaviors: [{ action: "hold", probability: 60, horizonHours: 24 }],
    },
  };
  assert.equal(
    buildThesisReviewSignal(
      base,
      {
        ...base,
        school: { ...base.school, processed: 1_999 },
      },
      "2026-08-01T00:00:00.000Z",
    ),
    null,
  );
  const milestone = buildThesisReviewSignal(
    base,
    {
      ...base,
      school: { ...base.school, processed: 2_000 },
    },
    "2026-08-01T00:00:00.000Z",
  );
  assert.match(milestone.token, /^milestone:2000:/);

  const completed = buildThesisReviewSignal(
    {
      ...base,
      school: { ...base.school, processed: 14_100 },
      reviewSignal: milestone,
    },
    {
      ...base,
      school: {
        ...base.school,
        processed: 14_187,
        complete: true,
      },
    },
    "2026-08-02T00:00:00.000Z",
  );
  assert.match(completed.token, /^complete:14187:/);
});

test("weak school batches cannot erase a stronger thesis", () => {
  const weak = normalizeDeepSeekThesis({}, []);
  const stabilized = stabilizeDeepSeekThesis(weak, {
    previous: {
      thesis: {
        astroConfirmed: "Prior fact",
        publicSourceRefs: [
          "https://x.com/astronomer_zero/status/2083130924980727816",
        ],
        telegramContext: "Prior context",
        campaign: { state: "partial", direction: "short" },
        nextBehaviors: [],
        contradictions: [],
        unknowns: [],
      },
      lunaPacket: {
        facts: ["Fact one", "Fact two"],
        question: "Prior question",
      },
    },
    forecast: {
      hermes: {
        projection: {
          confidence: 58,
          behavior: {
            action: "close",
            horizonHours: 72,
            condition: "Astro posts a full close.",
          },
        },
      },
      sources: [
        {
          url: "https://x.com/astronomer_zero/status/2083130924980727816",
        },
      ],
    },
  });
  assert.equal(stabilized.acceptedNewThesis, false);
  assert.equal(stabilized.thesis.campaign.direction, "short");
  assert.equal(stabilized.thesis.nextBehaviors[0].action, "close");
  assert.equal(stabilized.thesis.nextBehaviors[0].probability, 58);
  assert.equal(stabilized.thesis.nextBehaviors[1].action, "hold");
  assert.equal(stabilized.thesis.nextBehaviors[1].probability, 42);
  assert.deepEqual(stabilized.lunaPacket.facts, ["Fact one", "Fact two"]);
});
