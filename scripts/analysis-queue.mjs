export const DEFERRED_RETRY_AFTER_MS = 30 * 60 * 1_000;

function validTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function pendingAnalysisFromState(state = {}) {
  if (state?.pendingAnalysis && typeof state.pendingAnalysis === "object") {
    return state.pendingAnalysis;
  }
  if (state?.lastAnalysis?.status !== "deferred") return null;
  return {
    entityRef: state.lastAnalysis.entityRef ?? null,
    queuedAt: state.lastAnalysis.at ?? null,
    sourceNewest: state.lastAnalysis.sourceNewest ?? {},
    reason: state.reasoner?.error ?? "The deeper review was deferred.",
  };
}

export function pendingAnalysisStillCurrent(
  pending,
  { telegramNewestAt = null, xNewestAt = null } = {},
) {
  if (!pending || typeof pending !== "object") return false;
  const sourceNewest = pending.sourceNewest || {};
  return Boolean(
    (sourceNewest.x && sourceNewest.x === xNewestAt) ||
      (sourceNewest.telegram && sourceNewest.telegram === telegramNewestAt),
  );
}

export function deferredRetryDue(
  pending,
  { now = Date.now(), retryAfterMs = DEFERRED_RETRY_AFTER_MS } = {},
) {
  if (!pending || typeof pending !== "object") return false;
  const queuedAt = validTimestamp(pending.queuedAt);
  return queuedAt !== null && now - queuedAt >= retryAfterMs;
}

