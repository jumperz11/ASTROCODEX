export const RESOLVED_MARKET_STATES = new Set([
  "hit",
  "partial",
  "invalidated",
  "expired",
]);

export function eligiblePredictions(history) {
  return (Array.isArray(history?.hermesPredictions)
    ? history.hermesPredictions
    : []
  )
    .filter(
      (item) =>
        item?.official === true &&
        item?.integrity === "valid" &&
        RESOLVED_MARKET_STATES.has(item?.marketStatus),
    )
    .sort(
      (left, right) =>
        new Date(left.createdAt || 0).getTime() -
        new Date(right.createdAt || 0).getTime(),
    );
}

export function eligibleBehaviorPredictions(history) {
  return (Array.isArray(history?.hermesPredictions)
    ? history.hermesPredictions
    : []
  )
    .filter(
      (item) =>
        item?.official === true &&
        item?.integrity === "valid" &&
        ["hit", "wrong"].includes(item?.behaviorOutcome?.status),
    )
    .sort(
      (left, right) =>
        new Date(left.createdAt || 0).getTime() -
        new Date(right.createdAt || 0).getTime(),
    );
}

function outcomeValue(prediction) {
  const market =
    prediction.marketStatus === "hit"
      ? 1
      : prediction.marketStatus === "partial"
        ? 0.5
        : 0;
  const behaviorStatus = prediction.behaviorOutcome?.status;
  if (behaviorStatus === "hit") return market * 0.75 + 0.25;
  if (behaviorStatus === "wrong") return market * 0.75;
  return market;
}

export function normalizePolicy(value = {}) {
  return {
    confidenceFloor: Math.min(
      90,
      Math.max(0, Math.round(Number(value.confidenceFloor) || 0)),
    ),
    maxHorizonHours: Math.min(
      2160,
      Math.max(24, Math.round(Number(value.maxHorizonHours) || 2160)),
    ),
    requireBehaviorPrediction: Boolean(value.requireBehaviorPrediction),
  };
}

export function scorePolicy(predictions, policyInput) {
  const policy = normalizePolicy(policyInput);
  const population = Array.isArray(predictions) ? predictions : [];
  const selected = population.filter((item) => {
    if (Number(item.confidence || 0) < policy.confidenceFloor) return false;
    if (Number(item.horizonHours || 0) > policy.maxHorizonHours) return false;
    if (policy.requireBehaviorPrediction && !item.behavior) return false;
    return true;
  });
  const minimum = Math.max(4, Math.ceil(population.length * 0.25));
  if (selected.length < minimum) {
    return {
      policy,
      score: null,
      selected: selected.length,
      total: population.length,
      reason: `Needs at least ${minimum} holdout examples.`,
    };
  }
  const brierQuality =
    selected.reduce((total, item) => {
      const probability = Math.min(
        1,
        Math.max(0, Number(item.confidence || 0) / 100),
      );
      const outcome = outcomeValue(item);
      return total + (1 - (probability - outcome) ** 2);
    }, 0) / selected.length;
  const coverage = selected.length / Math.max(1, population.length);
  return {
    policy,
    score: Number((brierQuality * (0.75 + coverage * 0.25)).toFixed(6)),
    selected: selected.length,
    total: population.length,
    coverage: Number(coverage.toFixed(4)),
    reason: null,
  };
}

export function scoreBehaviorPolicy(predictions, policyInput) {
  const policy = normalizePolicy(policyInput);
  const population = Array.isArray(predictions) ? predictions : [];
  const selected = population.filter((item) => {
    if (Number(item.confidence || 0) < policy.confidenceFloor) return false;
    if (Number(item.horizonHours || 0) > policy.maxHorizonHours) return false;
    if (policy.requireBehaviorPrediction && !item.behavior) return false;
    return true;
  });
  const minimum = Math.max(4, Math.ceil(population.length * 0.25));
  if (selected.length < minimum) {
    return {
      policy,
      score: null,
      selected: selected.length,
      total: population.length,
      reason: `Needs at least ${minimum} holdout examples.`,
    };
  }
  const brierQuality =
    selected.reduce((total, item) => {
      const probability = Math.min(
        1,
        Math.max(0, Number(item.confidence || 0) / 100),
      );
      const outcome = item.behaviorOutcome?.status === "hit" ? 1 : 0;
      return total + (1 - (probability - outcome) ** 2);
    }, 0) / selected.length;
  const coverage = selected.length / Math.max(1, population.length);
  return {
    policy,
    score: Number((brierQuality * (0.75 + coverage * 0.25)).toFixed(6)),
    selected: selected.length,
    total: population.length,
    coverage: Number(coverage.toFixed(4)),
    reason: null,
  };
}

export function chronologicalSplit(predictions) {
  const pivot = Math.max(1, Math.floor(predictions.length * 0.7));
  return {
    training: predictions.slice(0, pivot),
    holdout: predictions.slice(pivot),
  };
}
