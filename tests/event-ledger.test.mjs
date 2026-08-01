import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readLedgerHealth,
  syncRuntimeLedger,
} from "../scripts/astro-event-ledger.mjs";

function fixture(overrides = {}) {
  const fingerprint = "a".repeat(64);
  const commitment = "b".repeat(64);
  const forecast = {
    generatedAt: "2026-08-01T00:00:00.000Z",
    hermes: { lessonRefs: [fingerprint] },
    sources: [
      {
        url: "https://x.com/astronomer_zero/status/2083000000000000000",
      },
    ],
  };
  const marketPrediction = {
    id: forecast.generatedAt,
    createdAt: forecast.generatedAt,
    marketStatus: "active",
    direction: "down_then_up",
    confidence: 62,
    horizonHours: 72,
    integrity: "valid",
    commitmentHash: commitment,
    checkpoints: [{ label: "T1", price: 62000, hitAt: null }],
    sources: forecast.sources,
  };
  const behaviorPrediction = {
    id: forecast.generatedAt,
    createdAt: forecast.generatedAt,
    confidence: 62,
    integrity: "valid",
    commitmentHash: "c".repeat(64),
    behavior: {
      action: "trim",
      horizonHours: 48,
      condition: "The first objective is reached.",
    },
    behaviorOutcome: {
      status: "active",
      resolvedAt: null,
      reason: null,
    },
    sources: forecast.sources,
  };
  const lesson = {
    fingerprint,
    category: "trim",
    rule: "Trim at the first objective.",
    when: "The first objective is reached.",
    sequence: "Enter, trim, hold a residual.",
    sourceRefs: ["telegram-live:-1001:700"],
    learnedAt: "2026-08-01T00:01:00.000Z",
    quality: {
      status: "supported",
      humanReview: { status: "approved" },
    },
  };
  return {
    observedAt: "2026-08-01T01:00:00.000Z",
    forecast,
    history: {
      hermesPredictions: [marketPrediction],
      behaviorPredictions: [behaviorPrediction],
      trackRecord: {
        reviewedAt: "2026-08-01T00:30:00.000Z",
        plays: [
          {
            id: "short-iii",
            direction: "SHORT",
            status: "open",
            openedAt: "2026-07-01T00:00:00.000Z",
            closedAt: null,
            sources: forecast.sources,
          },
        ],
      },
    },
    telegram: {
      messages: [
        {
          chatId: "-1001",
          id: "700",
          activityAt: "2026-08-01T00:02:00.000Z",
          text: "Direct private context.",
        },
      ],
    },
    x: {
      posts: [
        {
          id: "2083000000000000000",
          url: forecast.sources[0].url,
          createdAt: "2026-08-01T00:03:00.000Z",
          text: "Public update.",
        },
      ],
    },
    thesis: {
      updatedAt: "2026-08-01T00:45:00.000Z",
      lessons: [lesson],
      lessonCandidates: [
        {
          ...lesson,
          candidateAt: "2026-08-01T00:00:30.000Z",
          review: {
            verdict: "supported",
            supportedRefs: lesson.sourceRefs,
          },
        },
      ],
      lunaPacket: { appliedLessonFingerprints: [fingerprint] },
    },
    review: {
      decisions: {
        [fingerprint]: {
          status: "approved",
          decidedAt: "2026-08-01T00:40:00.000Z",
        },
      },
    },
    ...overrides,
  };
}

test("event ledger backfills idempotently with complete parity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astro-ledger-"));
  const path = join(directory, "ledger.sqlite");
  try {
    const first = syncRuntimeLedger({ path, ...fixture() });
    const second = syncRuntimeLedger({ path, ...fixture() });
    const health = readLedgerHealth(path, { verifyIntegrity: true });

    assert.equal(first.status, "healthy");
    assert.equal(first.parity.ok, true);
    assert.equal(second.parity.ok, true);
    assert.equal(second.counts.events, first.counts.events);
    assert.equal(second.counts.hypotheses, 2);
    assert.equal(second.counts.campaigns, 1);
    assert.equal(second.counts.campaignTransitions, 1);
    assert.equal(second.counts.lessons, 1);
    assert.equal(second.counts.lessonUses, 2);
    assert.equal(health.status, "healthy");
    assert.equal(health.integrity, "ok");
    assert.equal(health.schemaVersion, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("event ledger rejects a rewritten frozen commitment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astro-ledger-"));
  const path = join(directory, "ledger.sqlite");
  try {
    const initial = fixture();
    syncRuntimeLedger({ path, ...initial });
    const rewritten = fixture({
      history: {
        ...initial.history,
        hermesPredictions: [
          {
            ...initial.history.hermesPredictions[0],
            commitmentHash: "d".repeat(64),
          },
        ],
      },
    });
    assert.throws(
      () => syncRuntimeLedger({ path, ...rewritten }),
      /Commitment conflict/,
    );
    const health = readLedgerHealth(path, { verifyIntegrity: true });
    assert.equal(health.status, "degraded");
    assert.equal(health.integrity, "ok");
    assert.match(health.error, /Commitment conflict/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("event ledger refuses an untraceable lesson reference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astro-ledger-"));
  const path = join(directory, "ledger.sqlite");
  try {
    const current = fixture();
    const unknown = "f".repeat(64);
    assert.throws(
      () =>
        syncRuntimeLedger({
          path,
          ...current,
          forecast: {
            ...current.forecast,
            hermes: { lessonRefs: [unknown] },
          },
        }),
      /references unknown lesson/,
    );
    const health = readLedgerHealth(path, { verifyIntegrity: true });
    assert.equal(health.status, "degraded");
    assert.equal(health.integrity, "ok");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
