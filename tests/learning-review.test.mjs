import assert from "node:assert/strict";
import test from "node:test";
import {
  lessonFingerprint,
  mergeHumanApprovedLessons,
} from "../scripts/deepseek-thesis.mjs";
import {
  callbackData,
  parseLearningCallback,
  renderLessonReview,
  reviewableLessonCandidates,
} from "../scripts/telegram-learning-review.mjs";

function candidate(overrides = {}) {
  const value = {
    category: "trim",
    rule: "Trim at the first objective before holding a residual position.",
    when: "The first planned objective is reached.",
    sequence: "Enter, trim, then manage the residual.",
    failsWhen: "Astro explicitly closes the full position.",
    sourceRefs: ["telegram-live:-1001:700"],
    candidateAt: "2026-08-01T00:00:00.000Z",
    review: {
      verdict: "supported",
      supportedRefs: ["telegram-live:-1001:700"],
      reason: "The source explicitly shows the sequence.",
      contradiction: "None",
    },
    ...overrides,
  };
  return { ...value, fingerprint: lessonFingerprint(value) };
}

test("only source-supported undecided lessons enter the human queue", () => {
  const pending = candidate();
  const rejectedBySource = candidate({
    rule: "Unsupported candidate",
    review: {
      verdict: "rejected",
      supportedRefs: [],
      reason: "Insufficient support.",
      contradiction: "None",
    },
  });
  const alreadyDecided = candidate({ rule: "Already decided" });
  const queue = reviewableLessonCandidates(
    {
      lessonCandidates: [pending, rejectedBySource, alreadyDecided],
    },
    {
      decisions: {
        [alreadyDecided.fingerprint]: {
          status: "rejected",
          decidedAt: "2026-08-01T01:00:00.000Z",
        },
      },
    },
  );

  assert.equal(queue.length, 1);
  assert.equal(queue[0].fingerprint, pending.fingerprint);
});

test("Hermes memory accepts owner-approved lessons and excludes rejections", () => {
  const approved = candidate();
  const rejected = candidate({ rule: "Do not learn this rule" });
  const lessons = mergeHumanApprovedLessons(
    [],
    [approved, rejected],
    {
      decisions: {
        [approved.fingerprint]: {
          status: "approved",
          reviewerId: 511828670,
          decidedAt: "2026-08-01T02:00:00.000Z",
        },
        [rejected.fingerprint]: {
          status: "rejected",
          reviewerId: 511828670,
          decidedAt: "2026-08-01T02:01:00.000Z",
        },
      },
    },
    "2026-08-01T02:05:00.000Z",
  );

  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].fingerprint, approved.fingerprint);
  assert.equal(lessons[0].quality.status, "supported");
  assert.equal(lessons[0].quality.humanReview.status, "approved");
  assert.equal(lessons[0].quality.humanReview.reviewerId, 511828670);
});

test("learning review messages stay plain and callbacks stay bounded", () => {
  const lesson = candidate();
  const message = renderLessonReview(lesson);
  const approve = callbackData("approve", lesson.fingerprint);

  assert.match(message, /HERMES LESSON TEST/);
  assert.match(message, /CATEGORY · TRIM/);
  assert.match(message, /PROPOSED RULE/);
  assert.match(message, /DO NOT USE IT WHEN/);
  assert.match(message, /not certifying this as true/i);
  assert.ok(message.length < 4000);
  assert.ok(approve.length <= 64);
  assert.deepEqual(parseLearningCallback(approve), {
    action: "approve",
    fingerprintPrefix: lesson.fingerprint.slice(0, 24),
  });
  assert.equal(parseLearningCallback("learn:delete:bad"), null);
});
