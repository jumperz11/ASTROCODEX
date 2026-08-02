import assert from "node:assert/strict";
import test from "node:test";

import {
  deferredRetryDue,
  pendingAnalysisFromState,
  pendingAnalysisStillCurrent,
} from "../scripts/analysis-queue.mjs";

test("a deferred analysis remains pending until its source is retried", () => {
  const pending = pendingAnalysisFromState({
    lastAnalysis: {
      status: "deferred",
      at: "2026-08-02T05:32:59.572Z",
      entityRef: "x:2083787023102718119",
      sourceNewest: {
        telegram: "2026-08-02T05:13:18.000Z",
        x: "2026-08-02T05:32:16.302Z",
      },
    },
    reasoner: { error: "Luna Medium is full." },
  });

  assert.equal(pending.entityRef, "x:2083787023102718119");
  assert.equal(
    pendingAnalysisStillCurrent(pending, {
      telegramNewestAt: "2026-08-02T05:13:18.000Z",
      xNewestAt: "2026-08-02T05:32:16.302Z",
    }),
    true,
  );
  assert.equal(
    deferredRetryDue(pending, {
      now: new Date("2026-08-02T06:03:00.000Z").getTime(),
    }),
    true,
  );
});

test("a new source supersedes the old deferred queue", () => {
  const pending = {
    entityRef: "x:old",
    queuedAt: "2026-08-02T05:00:00.000Z",
    sourceNewest: { x: "2026-08-02T05:00:00.000Z" },
  };
  assert.equal(
    pendingAnalysisStillCurrent(pending, {
      xNewestAt: "2026-08-02T06:00:00.000Z",
    }),
    false,
  );
});

