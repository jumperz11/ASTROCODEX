import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateHermesPredictions,
  hermesLedgerSummary,
} from "../scripts/hermes-ledger.mjs";

function prediction() {
  return {
    id: "map-1",
    createdAt: "2026-07-31T00:00:00.000Z",
    resolvedAt: null,
    status: "active",
    outcomeReason: null,
    anchorPrice: 63000,
    latestPrice: 63000,
    maxObservedPrice: 63000,
    minObservedPrice: 63000,
    horizonEndsAt: "2026-08-07T00:00:00.000Z",
    checkpoints: [
      { label: "Base", price: 61000, hitAt: null, hitPrice: null },
      { label: "Reclaim", price: 65000, hitAt: null, hitPrice: null },
    ],
    invalidation: { price: 59000, condition: "Base fails." },
  };
}

test("Hermes scores ordered down-then-up checkpoints without hindsight", () => {
  const first = evaluateHermesPredictions(
    [prediction()],
    { price: 60800 },
    "2026-08-01T00:00:00.000Z",
  )[0];
  assert.equal(first.status, "active");
  assert.ok(first.checkpoints[0].hitAt);
  assert.equal(first.checkpoints[1].hitAt, null);

  const second = evaluateHermesPredictions(
    [first],
    { price: 65200 },
    "2026-08-02T00:00:00.000Z",
  )[0];
  assert.equal(second.status, "hit");
  assert.ok(second.checkpoints[1].hitAt);
  assert.equal(hermesLedgerSummary([second]).hitRate, 100);
});

test("Hermes permanently marks invalidation as wrong", () => {
  const result = evaluateHermesPredictions(
    [prediction()],
    { price: 58500 },
    "2026-08-01T00:00:00.000Z",
  )[0];
  assert.equal(result.status, "wrong");
  assert.match(result.outcomeReason, /Invalidation crossed/);
  assert.equal(hermesLedgerSummary([result]).wrong, 1);
});

test("Hermes marks an unfinished expired map wrong", () => {
  const result = evaluateHermesPredictions(
    [prediction()],
    { price: 62500 },
    "2026-08-08T00:00:00.000Z",
  )[0];
  assert.equal(result.status, "wrong");
  assert.match(result.outcomeReason, /horizon expired/i);
});
