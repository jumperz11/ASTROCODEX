export function crossedPrice(anchorPrice, targetPrice, currentPrice) {
  return targetPrice >= anchorPrice
    ? currentPrice >= targetPrice
    : currentPrice <= targetPrice;
}

export function evaluateHermesPredictions(
  predictions,
  market,
  checkedAt,
) {
  const currentPrice = Number(market.price);
  const checkedMs = new Date(checkedAt).getTime();
  return (Array.isArray(predictions) ? predictions : []).map((prediction) => {
    if (
      !prediction ||
      prediction.status === "hit" ||
      prediction.status === "wrong"
    ) {
      return prediction;
    }
    const anchorPrice = Number(prediction.anchorPrice);
    const checkpoints = Array.isArray(prediction.checkpoints)
      ? prediction.checkpoints.map((checkpoint) => ({ ...checkpoint }))
      : [];
    const nextCheckpoint = checkpoints.find((checkpoint) => !checkpoint.hitAt);
    if (
      nextCheckpoint &&
      Number.isFinite(anchorPrice) &&
      Number.isFinite(currentPrice) &&
      crossedPrice(anchorPrice, Number(nextCheckpoint.price), currentPrice)
    ) {
      nextCheckpoint.hitAt = checkedAt;
      nextCheckpoint.hitPrice = currentPrice;
    }

    const invalidationPrice = prediction.invalidation?.price;
    const invalidated =
      Number.isFinite(invalidationPrice) &&
      crossedPrice(anchorPrice, Number(invalidationPrice), currentPrice);
    const finalCheckpoint = checkpoints.at(-1);
    const completed = Boolean(finalCheckpoint?.hitAt);
    const horizonEndsMs = new Date(prediction.horizonEndsAt || 0).getTime();
    const expired =
      Number.isFinite(horizonEndsMs) &&
      Number.isFinite(checkedMs) &&
      checkedMs > horizonEndsMs;
    const status = invalidated
      ? "wrong"
      : completed
        ? "hit"
        : expired
          ? "wrong"
          : "active";
    const outcomeReason = invalidated
      ? `Invalidation crossed at ${invalidationPrice}.`
      : completed
        ? `Final checkpoint reached at ${finalCheckpoint.price}.`
        : expired
          ? "Prediction horizon expired before the final checkpoint."
          : null;

    return {
      ...prediction,
      status,
      resolvedAt: status === "active" ? null : checkedAt,
      outcomeReason,
      latestPrice: currentPrice,
      maxObservedPrice: Math.max(
        Number(prediction.maxObservedPrice || anchorPrice),
        currentPrice,
      ),
      minObservedPrice: Math.min(
        Number(prediction.minObservedPrice || anchorPrice),
        currentPrice,
      ),
      checkpoints,
    };
  });
}

export function hermesLedgerSummary(predictions) {
  const ledger = Array.isArray(predictions) ? predictions : [];
  const resolved = ledger.filter((item) =>
    ["hit", "wrong"].includes(item?.status),
  );
  const hits = resolved.filter((item) => item.status === "hit").length;
  return {
    total: ledger.length,
    active: ledger.filter((item) => item?.status === "active").length,
    hits,
    wrong: resolved.length - hits,
    resolved: resolved.length,
    hitRate: resolved.length ? Math.round((hits / resolved.length) * 100) : null,
    recent: ledger.slice(-12),
  };
}
