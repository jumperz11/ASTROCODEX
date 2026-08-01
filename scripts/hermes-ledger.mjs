import { createHash } from "node:crypto";

export const HERMES_SCORING_VERSION = 2;
export const BEHAVIOR_SCORING_VERSION = 1;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function predictionCommitment(prediction) {
  return {
    scoringVersion: prediction.scoringVersion,
    official: prediction.official,
    createdAt: prediction.createdAt,
    anchorPrice: prediction.anchorPrice,
    direction: prediction.direction,
    confidence: prediction.confidence,
    horizonHours: prediction.horizonHours,
    horizonEndsAt: prediction.horizonEndsAt,
    checkpoints: prediction.checkpoints.map((checkpoint) => {
      const committed = { ...checkpoint };
      delete committed.hitAt;
      delete committed.hitPrice;
      delete committed.baselineHitAt;
      delete committed.baselinePrice;
      return committed;
    }),
    invalidation: prediction.invalidation,
    behavior: prediction.behavior ?? null,
    thesis: prediction.thesis,
    learningNote: prediction.learningNote,
    sources: prediction.sources,
  };
}

export function commitmentHash(prediction) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(predictionCommitment(prediction))))
    .digest("hex");
}

export function behaviorPredictionCommitment(prediction) {
  return {
    scoringVersion: prediction.scoringVersion,
    official: prediction.official,
    createdAt: prediction.createdAt,
    confidence: prediction.confidence,
    horizonHours: prediction.horizonHours,
    behavior: prediction.behavior,
    sources: prediction.sources,
  };
}

export function behaviorCommitmentHash(prediction) {
  return createHash("sha256")
    .update(
      JSON.stringify(stableValue(behaviorPredictionCommitment(prediction))),
    )
    .digest("hex");
}

function relativeDifference(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / Math.max(1, Math.abs(a));
}

export function marketProjectionMateriallyChanged(
  activePrediction,
  projection,
) {
  if (!activePrediction || !projection) return true;
  if (activePrediction.direction !== projection.direction) return true;
  if (
    relativeDifference(
      activePrediction.horizonHours,
      projection.horizonHours,
    ) >= 0.25
  ) {
    return true;
  }

  const activeCheckpoints = Array.isArray(activePrediction.checkpoints)
    ? activePrediction.checkpoints
    : [];
  const nextCheckpoints = Array.isArray(projection.checkpoints)
    ? projection.checkpoints
    : [];
  if (activeCheckpoints.length !== nextCheckpoints.length) return true;
  if (!activeCheckpoints.length) return true;

  const activeFirst = activeCheckpoints[0]?.price;
  const nextFirst = nextCheckpoints[0]?.price;
  const activeFinal = activeCheckpoints.at(-1)?.price;
  const nextFinal = nextCheckpoints.at(-1)?.price;
  if (relativeDifference(activeFirst, nextFirst) >= 0.015) return true;
  if (relativeDifference(activeFinal, nextFinal) >= 0.015) return true;

  const activeInvalidation = activePrediction.invalidation?.price;
  const nextInvalidation = projection.invalidation?.price;
  if (
    (activeInvalidation === null) !== (nextInvalidation === null) ||
    (activeInvalidation !== null &&
      relativeDifference(activeInvalidation, nextInvalidation) >= 0.015)
  ) {
    return true;
  }
  return false;
}

function candleTime(candle) {
  return Number(candle?.[0]);
}

function crossedInCandle(origin, target, candle) {
  const low = Number(candle?.[1]);
  const high = Number(candle?.[2]);
  if (![origin, target, low, high].every(Number.isFinite)) return false;
  return target >= origin ? high >= target : low <= target;
}

function evidenceTime(item) {
  const parsed = new Date(item?.time || "").getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function behaviorPattern(action) {
  return {
    hold: /\bhold\b|still (?:holding|open)|no add|no-add/i,
    trim: /\btrim\b|take profit|taking profit|reduc(?:e|ed|ing)|closed? \d+%/i,
    close: /fully clos(?:e|ed)|close all|fully exit(?:ed)?|position closed/i,
    flip_long: /flip(?:ped|ping)?[^.]{0,50}\blong\b|started?[^.]{0,40}\blong\b/i,
    flip_short: /flip(?:ped|ping)?[^.]{0,50}\bshort\b|started?[^.]{0,40}\bshort\b/i,
    readd: /re-?add|added (?:more|size)|increase(?:d)? (?:the )?(?:position|size)/i,
    post_update: /./,
    silence: null,
  }[action];
}

function evaluateBehavior(prediction, evidence, checkedAt) {
  const behavior = prediction.behavior;
  const current = prediction.behaviorOutcome ?? {
    status: behavior ? "active" : "unscored",
    resolvedAt: null,
    reason: behavior
      ? null
      : "Legacy map has no frozen Astro-behavior prediction.",
    matchedSource: null,
  };
  if (!behavior || current.status !== "active") return current;

  const createdMs = new Date(prediction.createdAt).getTime();
  const deadlineMs = createdMs + behavior.horizonHours * 3_600_000;
  const direct = (Array.isArray(evidence) ? evidence : [])
    .filter((item) => item?.type === "astro" && item?.source)
    .filter((item) => {
      const time = evidenceTime(item);
      return time !== null && time > createdMs;
    });
  const pattern = behaviorPattern(behavior.action);
  const matched =
    pattern &&
    direct.find((item) =>
      pattern.test(`${item.label || ""} ${item.detail || ""}`),
    );
  if (matched) {
    return {
      status: "hit",
      resolvedAt: checkedAt,
      reason: `Direct Astro evidence matched ${behavior.action}.`,
      matchedSource: matched.source,
    };
  }

  const nowMs = new Date(checkedAt).getTime();
  if (Number.isFinite(nowMs) && nowMs > deadlineMs) {
    if (behavior.action === "silence" && direct.length === 0) {
      return {
        status: "hit",
        resolvedAt: checkedAt,
        reason: "No fresh direct Astro post appeared inside the frozen horizon.",
        matchedSource: null,
      };
    }
    return {
      status: "wrong",
      resolvedAt: checkedAt,
      reason:
        behavior.action === "silence"
          ? "Fresh direct Astro evidence appeared before the silence horizon ended."
          : `No direct evidence matched ${behavior.action} before its horizon expired.`,
      matchedSource: direct.at(-1)?.source ?? null,
    };
  }

  if (behavior.action === "silence" && direct.length > 0) {
    return {
      status: "wrong",
      resolvedAt: checkedAt,
      reason: "Fresh direct Astro evidence appeared during the silence horizon.",
      matchedSource: direct.at(-1)?.source ?? null,
    };
  }
  return current;
}

export function evaluateBehaviorPredictions(
  predictions,
  astroEvidence,
  checkedAt,
) {
  return (Array.isArray(predictions) ? predictions : []).map((prediction) => {
    if (!prediction) return prediction;
    const scoringVersion = Number(
      prediction.scoringVersion || BEHAVIOR_SCORING_VERSION,
    );
    const official =
      prediction.official === true &&
      scoringVersion === BEHAVIOR_SCORING_VERSION;
    const integrity = prediction.commitmentHash
      ? behaviorCommitmentHash({
          ...prediction,
          scoringVersion,
          official,
        }) === prediction.commitmentHash
        ? "valid"
        : "failed"
      : "legacy";
    return {
      ...prediction,
      scoringVersion,
      official,
      integrity,
      behaviorOutcome: evaluateBehavior(
        prediction,
        astroEvidence,
        checkedAt,
      ),
    };
  });
}

export function extractBehaviorPredictions(marketPredictions) {
  return (Array.isArray(marketPredictions) ? marketPredictions : [])
    .filter((prediction) => prediction?.behavior)
    .map((prediction) => {
      const behaviorPrediction = {
        id: prediction.id,
        scoringVersion: BEHAVIOR_SCORING_VERSION,
        official:
          prediction.official === true && prediction.integrity === "valid",
        createdAt: prediction.createdAt,
        confidence: prediction.confidence,
        horizonHours: prediction.behavior.horizonHours,
        behavior: prediction.behavior,
        behaviorOutcome: prediction.behaviorOutcome ?? {
          status: "active",
          resolvedAt: null,
          reason: null,
          matchedSource: null,
        },
        sources: prediction.sources ?? [],
      };
      behaviorPrediction.commitmentHash =
        behaviorCommitmentHash(behaviorPrediction);
      behaviorPrediction.integrity = behaviorPrediction.official
        ? "valid"
        : "legacy";
      return behaviorPrediction;
    });
}

export function evaluateHermesPredictions(
  predictions,
  market,
  checkedAt,
  candles = [],
  astroEvidence = [],
) {
  const currentPrice = Number(market.price);
  const checkedSeconds = Math.floor(new Date(checkedAt).getTime() / 1000);
  return (Array.isArray(predictions) ? predictions : []).map((prediction) => {
    if (!prediction) return prediction;

    const scoringVersion = Number(prediction.scoringVersion || 1);
    const official =
      prediction.official === true &&
      scoringVersion === HERMES_SCORING_VERSION;
    const integrity = prediction.commitmentHash
      ? commitmentHash({ ...prediction, scoringVersion, official }) ===
        prediction.commitmentHash
        ? "valid"
        : "failed"
      : "legacy";
    const behaviorOutcome = evaluateBehavior(
      prediction,
      astroEvidence,
      checkedAt,
    );
    if (
      ["hit", "partial", "invalidated", "expired", "superseded"].includes(
        prediction.marketStatus,
      )
    ) {
      return {
        ...prediction,
        scoringVersion,
        official,
        integrity,
        behaviorOutcome,
      };
    }

    const anchorPrice = Number(prediction.anchorPrice);
    const checkpoints = Array.isArray(prediction.checkpoints)
      ? prediction.checkpoints.map((checkpoint) => ({ ...checkpoint }))
      : [];
    const createdSeconds = Math.floor(
      new Date(prediction.createdAt).getTime() / 1000,
    );
    const lastEvaluated = Number(
      prediction.lastEvaluatedCandleAt || createdSeconds - 1,
    );
    const newCandles = (Array.isArray(candles) ? candles : [])
      .filter(
        (candle) =>
          candleTime(candle) > lastEvaluated &&
          candleTime(candle) >= createdSeconds &&
          candleTime(candle) <= checkedSeconds,
      )
      .sort((left, right) => candleTime(left) - candleTime(right));
    const firstAvailableCandle = (Array.isArray(candles) ? candles : [])
      .map(candleTime)
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    const evaluationQuality =
      Number.isFinite(firstAvailableCandle) &&
      lastEvaluated < firstAvailableCandle - 300
        ? "gap"
        : prediction.evaluationQuality ?? "complete";

    let marketStatus = prediction.marketStatus || "active";
    let resolvedAt = prediction.resolvedAt ?? null;
    let outcomeReason = prediction.outcomeReason ?? null;
    let lastEvaluatedCandleAt = lastEvaluated;

    for (const candle of newCandles) {
      lastEvaluatedCandleAt = candleTime(candle);
      const nextIndex = checkpoints.findIndex((checkpoint) => !checkpoint.hitAt);
      if (nextIndex < 0) break;
      const checkpoint = checkpoints[nextIndex];
      const previous = checkpoints[nextIndex - 1];
      const segmentOrigin = previous?.hitPrice ?? anchorPrice;
      const baselinePrice =
        checkpoint.baselinePrice ??
        segmentOrigin - (Number(checkpoint.price) - segmentOrigin);
      checkpoint.baselinePrice = baselinePrice;
      const expectedCrossed = crossedInCandle(
        segmentOrigin,
        Number(checkpoint.price),
        candle,
      );
      const baselineCrossed = crossedInCandle(
        segmentOrigin,
        baselinePrice,
        candle,
      );
      if (baselineCrossed && !checkpoint.baselineHitAt) {
        checkpoint.baselineHitAt = new Date(
          candleTime(candle) * 1000,
        ).toISOString();
      }

      const invalidationPrice = prediction.invalidation?.price;
      const invalidated =
        Number.isFinite(invalidationPrice) &&
        crossedInCandle(
          segmentOrigin,
          Number(invalidationPrice),
          candle,
        );
      if (invalidated) {
        marketStatus = "invalidated";
        resolvedAt = new Date(candleTime(candle) * 1000).toISOString();
        outcomeReason = `Invalidation crossed at ${invalidationPrice}.`;
        break;
      }

      const checkpointDeadline =
        createdSeconds + Number(checkpoint.horizonHours || 0) * 3_600;
      if (candleTime(candle) > checkpointDeadline && !expectedCrossed) {
        marketStatus = nextIndex > 0 ? "partial" : "expired";
        resolvedAt = new Date(candleTime(candle) * 1000).toISOString();
        outcomeReason = `Checkpoint ${nextIndex + 1} expired before being reached.`;
        break;
      }

      if (expectedCrossed) {
        checkpoint.hitAt = new Date(candleTime(candle) * 1000).toISOString();
        checkpoint.hitPrice = Number(checkpoint.price);
        if (nextIndex === checkpoints.length - 1) {
          marketStatus = "hit";
          resolvedAt = checkpoint.hitAt;
          outcomeReason = `Final checkpoint reached at ${checkpoint.price}.`;
          break;
        }
      }
    }

    const horizonEndsMs = new Date(prediction.horizonEndsAt || 0).getTime();
    const checkedMs = new Date(checkedAt).getTime();
    if (
      marketStatus === "active" &&
      Number.isFinite(horizonEndsMs) &&
      Number.isFinite(checkedMs) &&
      checkedMs > horizonEndsMs
    ) {
      const hitCount = checkpoints.filter((checkpoint) => checkpoint.hitAt).length;
      marketStatus = hitCount > 0 ? "partial" : "expired";
      resolvedAt = checkedAt;
      outcomeReason = "Prediction horizon expired before the final checkpoint.";
    }

    return {
      ...prediction,
      scoringVersion,
      official,
      integrity,
      evaluationQuality,
      marketStatus,
      status: marketStatus,
      resolvedAt,
      outcomeReason,
      behaviorOutcome,
      latestPrice: currentPrice,
      maxObservedPrice: Math.max(
        Number(prediction.maxObservedPrice || anchorPrice),
        ...newCandles.map((candle) => Number(candle[2])),
        currentPrice,
      ),
      minObservedPrice: Math.min(
        Number(prediction.minObservedPrice || anchorPrice),
        ...newCandles.map((candle) => Number(candle[1])),
        currentPrice,
      ),
      lastEvaluatedCandleAt,
      checkpoints,
    };
  });
}

export function supersedeActivePredictions(
  predictions,
  successorId,
  resolvedAt,
) {
  return predictions.map((prediction) => {
    if (prediction?.marketStatus !== "active") return prediction;
    return {
      ...prediction,
      marketStatus: "superseded",
      status: "superseded",
      resolvedAt,
      outcomeReason: `Replaced by materially changed map ${successorId}.`,
    };
  });
}

export function hermesLedgerSummary(predictions, behaviorPredictions = null) {
  const ledger = Array.isArray(predictions) ? predictions : [];
  const official = ledger.filter(
    (item) =>
      item?.official &&
      item?.integrity === "valid" &&
      item?.evaluationQuality !== "gap",
  );
  const marketResolved = official.filter((item) =>
    ["hit", "partial", "invalidated", "expired", "superseded"].includes(
      item?.marketStatus,
    ),
  );
  const marketHits = marketResolved.filter(
    (item) => item.marketStatus === "hit",
  ).length;
  const baselineHits = marketResolved.filter(
    (item) => item.checkpoints?.at(-1)?.baselineHitAt,
  ).length;
  const behaviorLedger = Array.isArray(behaviorPredictions)
    ? behaviorPredictions.filter(
        (item) => item?.official && item?.integrity === "valid",
      )
    : official;
  const behaviorResolved = behaviorLedger.filter((item) =>
    ["hit", "wrong"].includes(item?.behaviorOutcome?.status),
  );
  const behaviorHits = behaviorResolved.filter(
    (item) => item.behaviorOutcome.status === "hit",
  ).length;

  return {
    total: ledger.length,
    experimental: ledger.length - official.length,
    active: official.filter((item) => item?.marketStatus === "active").length,
    market: {
      hits: marketHits,
      partial: marketResolved.filter((item) => item.marketStatus === "partial")
        .length,
      invalidated: marketResolved.filter(
        (item) => item.marketStatus === "invalidated",
      ).length,
      expired: marketResolved.filter((item) => item.marketStatus === "expired")
        .length,
      superseded: marketResolved.filter(
        (item) => item.marketStatus === "superseded",
      ).length,
      resolved: marketResolved.length,
      hitRate: marketResolved.length
        ? Math.round((marketHits / marketResolved.length) * 100)
        : null,
      baselineHits,
      baselineHitRate: marketResolved.length
        ? Math.round((baselineHits / marketResolved.length) * 100)
        : null,
    },
    behavior: {
      hits: behaviorHits,
      wrong: behaviorResolved.length - behaviorHits,
      resolved: behaviorResolved.length,
      hitRate: behaviorResolved.length
        ? Math.round((behaviorHits / behaviorResolved.length) * 100)
        : null,
    },
    recent: ledger.slice(-12),
  };
}
