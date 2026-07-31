import assert from "node:assert/strict";
import test from "node:test";

import {
  commitmentHash,
  evaluateHermesPredictions,
  hermesLedgerSummary,
  supersedeActivePredictions,
} from "../scripts/hermes-ledger.mjs";

function timestamp(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function candle(time, low, high, close = (low + high) / 2) {
  return [timestamp(time), low, high, close, close, 1];
}

function prediction(overrides = {}) {
  const map = {
    id: "map-1",
    scoringVersion: 2,
    official: true,
    createdAt: "2026-07-31T00:00:00.000Z",
    resolvedAt: null,
    marketStatus: "active",
    status: "active",
    outcomeReason: null,
    anchorPrice: 63000,
    latestPrice: 63000,
    maxObservedPrice: 63000,
    minObservedPrice: 63000,
    direction: "down_then_up",
    confidence: 55,
    horizonHours: 168,
    horizonEndsAt: "2026-08-07T00:00:00.000Z",
    checkpoints: [
      {
        label: "Base",
        price: 61000,
        kind: "transition",
        horizonHours: 48,
        condition: "Reach the base.",
        hitAt: null,
        hitPrice: null,
      },
      {
        label: "Reclaim",
        price: 62000,
        kind: "target",
        horizonHours: 120,
        condition: "Recover after the base.",
        hitAt: null,
        hitPrice: null,
      },
    ],
    invalidation: { price: 59000, condition: "Base fails." },
    behavior: {
      action: "trim",
      horizonHours: 72,
      condition: "Astro posts a direct trim.",
    },
    behaviorOutcome: {
      status: "active",
      resolvedAt: null,
      reason: null,
      matchedSource: null,
    },
    thesis: "Down first, then recover.",
    learningNote: "Frozen test lesson.",
    sources: [
      {
        label: "Source",
        url: "https://x.com/astronomer_zero/status/2083130924980727816",
      },
    ],
    lastEvaluatedCandleAt: timestamp("2026-07-31T00:55:00.000Z"),
    ...overrides,
  };
  map.commitmentHash = commitmentHash(map);
  return map;
}

test("Hermes scores reversal checkpoints from the previous hit, not the original anchor", () => {
  const first = evaluateHermesPredictions(
    [prediction()],
    { price: 61050 },
    "2026-07-31T01:05:00.000Z",
    [candle("2026-07-31T01:00:00.000Z", 60950, 61500)],
  )[0];
  assert.equal(first.marketStatus, "active");
  assert.equal(first.checkpoints[0].hitPrice, 61000);
  assert.equal(first.checkpoints[1].hitAt, null);

  const flatAfterBase = evaluateHermesPredictions(
    [first],
    { price: 61100 },
    "2026-07-31T01:10:00.000Z",
    [candle("2026-07-31T01:05:00.000Z", 60800, 61200)],
  )[0];
  assert.equal(flatAfterBase.marketStatus, "active");
  assert.equal(flatAfterBase.checkpoints[1].hitAt, null);

  const recovered = evaluateHermesPredictions(
    [flatAfterBase],
    { price: 62100 },
    "2026-07-31T01:15:00.000Z",
    [candle("2026-07-31T01:10:00.000Z", 61050, 62150)],
  )[0];
  assert.equal(recovered.marketStatus, "hit");
  assert.ok(recovered.checkpoints[1].hitAt);
  assert.equal(hermesLedgerSummary([recovered]).market.hitRate, 100);
});

test("Hermes catches an invalidation wick between scans", () => {
  const result = evaluateHermesPredictions(
    [prediction()],
    { price: 60100 },
    "2026-07-31T01:05:00.000Z",
    [candle("2026-07-31T01:00:00.000Z", 58500, 62000, 60100)],
  )[0];
  assert.equal(result.marketStatus, "invalidated");
  assert.match(result.outcomeReason, /Invalidation crossed/);
});

test("Hermes ignores candles from before the map was frozen", () => {
  const result = evaluateHermesPredictions(
    [prediction()],
    { price: 62500 },
    "2026-07-31T01:05:00.000Z",
    [
      candle("2026-07-30T23:55:00.000Z", 60000, 63500),
      candle("2026-07-31T01:00:00.000Z", 62400, 62900),
    ],
  )[0];
  assert.equal(result.checkpoints[0].hitAt, null);
  assert.equal(result.marketStatus, "active");
});

test("Hermes distinguishes partial expiry from immediate expiry", () => {
  const first = evaluateHermesPredictions(
    [prediction()],
    { price: 61000 },
    "2026-07-31T01:05:00.000Z",
    [candle("2026-07-31T01:00:00.000Z", 60900, 61500)],
  )[0];
  const partial = evaluateHermesPredictions(
    [first],
    { price: 61200 },
    "2026-08-08T00:00:00.000Z",
    [],
  )[0];
  assert.equal(partial.marketStatus, "partial");

  const expired = evaluateHermesPredictions(
    [prediction()],
    { price: 62500 },
    "2026-08-08T00:00:00.000Z",
    [],
  )[0];
  assert.equal(expired.marketStatus, "expired");
});

test("Hermes records a distance-matched opposite baseline", () => {
  const result = evaluateHermesPredictions(
    [prediction()],
    { price: 65100 },
    "2026-07-31T01:05:00.000Z",
    [candle("2026-07-31T01:00:00.000Z", 62500, 65100)],
  )[0];
  assert.equal(result.checkpoints[0].hitAt, null);
  assert.ok(result.checkpoints[0].baselineHitAt);
});

test("Astro behavior scoring remains separate from market-path scoring", () => {
  const result = evaluateHermesPredictions(
    [prediction()],
    { price: 62500 },
    "2026-07-31T02:00:00.000Z",
    [],
    [
      {
        type: "astro",
        label: "Trim update",
        detail: "Taking profit and reducing the residual position.",
        source:
          "https://x.com/astronomer_zero/status/2083131725987864687",
        time: "2026-07-31T01:30:00.000Z",
      },
    ],
  )[0];
  assert.equal(result.marketStatus, "active");
  assert.equal(result.behaviorOutcome.status, "hit");
  assert.match(result.behaviorOutcome.matchedSource, /status/);
});

test("superseded maps stay resolved and a mutated commitment fails integrity", () => {
  const map = prediction();
  const superseded = supersedeActivePredictions(
    [map],
    "map-2",
    "2026-07-31T02:00:00.000Z",
  )[0];
  assert.equal(superseded.marketStatus, "superseded");

  const tampered = evaluateHermesPredictions(
    [{ ...map, confidence: 99 }],
    { price: 63000 },
    "2026-07-31T01:00:00.000Z",
  )[0];
  assert.equal(tampered.integrity, "failed");
  assert.equal(hermesLedgerSummary([tampered]).market.resolved, 0);
});
