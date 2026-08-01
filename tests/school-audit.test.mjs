import test from "node:test";
import assert from "node:assert/strict";
import { buildSchoolAudit } from "../scripts/school-audit.mjs";

const fingerprint = "a".repeat(64);

function behavior(status, confidence, createdAt) {
  return {
    official: true,
    integrity: "valid",
    createdAt,
    confidence,
    behavior: {
      action: "hold",
      horizonHours: 48,
      condition: "Hold until direct evidence changes.",
    },
    behaviorOutcome: { status },
  };
}

test("Night School traces a source-backed lesson into accepted Hermes memory", () => {
  const audit = buildSchoolAudit({
    thesis: {
      status: "healthy",
      school: { processed: 100, total: 200, pendingHumanReview: 0 },
      lessons: [
        {
          fingerprint,
          category: "trim",
          rule: "Trim the first objective before managing the residual.",
          when: "The first objective is reached.",
          sequence: "Trim, then manage the residual.",
          failsWhen: "The setup is invalidated first.",
          sourceRefs: ["archive#message1"],
          quality: {
            status: "supported",
            reviewedAt: "2026-08-01T00:00:00.000Z",
            reason: "The source directly describes the trim.",
          },
        },
      ],
      lunaPacket: { appliedLessonFingerprints: [fingerprint] },
    },
    review: {
      decisions: {
        [fingerprint]: {
          status: "approved",
          decidedAt: "2026-08-01T01:00:00.000Z",
        },
      },
    },
    index: {
      entries: [
        {
          ref: "archive#message1",
          source: "Astro Core Edge Codex",
          author: "AstronomerZero",
          date: "2026-07-01T00:00:00.000Z",
          text: "Take the first objective, then leave a residual.",
        },
      ],
    },
    forecast: { hermes: { lessonRefs: [fingerprint] } },
  });

  assert.equal(audit.progress.percent, 50);
  assert.equal(audit.lessons[0].review.human, "approved");
  assert.equal(
    audit.lessons[0].connection,
    "used_in_accepted_forecast",
  );
  assert.equal(audit.lessons[0].sources[0].source, "Astro Core Edge Codex");
  assert.match(audit.lessons[0].sources[0].excerpt, /first objective/);
});

test("Hermes improvement stays honest while answer keys are scarce", () => {
  const history = {
    behaviorPredictions: [
      behavior("hit", 55, "2026-07-01T00:00:00.000Z"),
      behavior("wrong", 65, "2026-07-02T00:00:00.000Z"),
      behavior("hit", 68, "2026-07-03T00:00:00.000Z"),
      behavior("wrong", 70, "2026-07-04T00:00:00.000Z"),
      behavior("hit", 70, "2026-07-05T00:00:00.000Z"),
      behavior("hit", 72, "2026-07-06T00:00:00.000Z"),
      behavior("active", 72, "2026-07-07T00:00:00.000Z"),
    ],
  };
  const audit = buildSchoolAudit({
    history,
    autoresearch: {
      behaviorExamples: 6,
      requiredBehaviorExamples: 12,
      requiredMarketExamples: 20,
      status: "collecting",
    },
  });

  assert.equal(audit.improvement.behavior.resolved, 6);
  assert.equal(audit.improvement.behavior.hitRate, 67);
  assert.equal(audit.improvement.behavior.direction, "flat");
  assert.equal(audit.improvement.behavior.readyForResearch, false);
  assert.equal(audit.ahead.action, "hold");
  assert.equal(audit.ahead.status, "active");
});

test("legacy lessons are labeled instead of presented as owner-approved", () => {
  const audit = buildSchoolAudit({
    thesis: {
      lessons: [
        {
          fingerprint,
          rule: "Wait for confirmation.",
          sourceRefs: [],
          quality: { status: "supported" },
        },
      ],
    },
    review: {
      decisions: {
        [fingerprint]: {
          status: "legacy",
          reason: "Predates owner-gated review.",
        },
      },
    },
  });

  assert.equal(audit.lessons[0].review.human, "legacy");
  assert.equal(audit.lessons[0].connection, "available_to_hermes");
});
