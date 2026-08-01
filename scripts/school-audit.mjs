function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value, fallback = "", maximum = 600) {
  if (typeof value !== "string") return fallback;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, maximum) : fallback;
}

function percent(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)));
}

function lessonStatus(lesson, decisions) {
  const fingerprint = text(lesson?.fingerprint, "", 128);
  const decision = object(decisions[fingerprint]);
  const humanStatus = ["approved", "rejected"].includes(decision.status)
    ? decision.status
    : lesson?.quality?.humanReview?.status === "approved"
      ? "approved"
      : "legacy";
  return {
    source: lesson?.quality?.status === "supported" ? "supported" : "unknown",
    human: humanStatus,
    reviewedAt:
      decision.decidedAt ??
      lesson?.quality?.humanReview?.decidedAt ??
      lesson?.quality?.reviewedAt ??
      null,
    reason: text(
      decision.reason ?? lesson?.quality?.reason,
      "No review note was recorded.",
      500,
    ),
  };
}

function resolvedBehavior(history) {
  return array(history?.behaviorPredictions)
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

function behaviorImprovement(history, requiredExamples) {
  const resolved = resolvedBehavior(history);
  const hits = resolved.filter(
    (item) => item.behaviorOutcome.status === "hit",
  ).length;
  const hitRate = resolved.length ? percent(hits, resolved.length) : null;
  const windowSize = Math.min(5, Math.floor(resolved.length / 2));
  const previousWindow =
    windowSize >= 3 ? resolved.slice(-(windowSize * 2), -windowSize) : [];
  const recentWindow = windowSize >= 3 ? resolved.slice(-windowSize) : [];
  const windowRate = (items) =>
    items.length
      ? percent(
          items.filter((item) => item.behaviorOutcome.status === "hit").length,
          items.length,
        )
      : null;
  const previousRate = windowRate(previousWindow);
  const recentRate = windowRate(recentWindow);
  const delta =
    recentRate === null || previousRate === null
      ? null
      : recentRate - previousRate;
  const averageConfidence = resolved.length
    ? Math.round(
        resolved.reduce(
          (sum, item) => sum + Number(item.confidence || 0),
          0,
        ) / resolved.length,
      )
    : null;

  return {
    resolved: resolved.length,
    hits,
    wrong: resolved.length - hits,
    hitRate,
    requiredExamples,
    readyForResearch: resolved.length >= requiredExamples,
    recentWindow: recentWindow.length,
    recentRate,
    previousRate,
    delta,
    direction:
      delta === null
        ? "too_early"
        : delta >= 10
          ? "improving"
          : delta <= -10
            ? "declining"
            : "flat",
    averageConfidence,
    calibrationGap:
      hitRate === null || averageConfidence === null
        ? null
        : Math.abs(hitRate - averageConfidence),
  };
}

export function buildSchoolAudit({
  thesis = {},
  review = {},
  index = {},
  autoresearch = {},
  history = {},
  forecast = {},
} = {}) {
  const entries = new Map(
    array(index.entries).map((entry) => [entry?.ref, entry]),
  );
  const decisions = object(review.decisions);
  const activeLessonRefs = new Set(
    array(forecast?.hermes?.lessonRefs).map((value) => text(value, "", 128)),
  );
  const researchLessonRefs = new Set(
    array(thesis?.lunaPacket?.appliedLessonFingerprints).map((value) =>
      text(value, "", 128),
    ),
  );
  const lessons = array(thesis.lessons)
    .filter((lesson) => lesson?.quality?.status === "supported")
    .map((lesson) => {
      const fingerprint = text(lesson.fingerprint, "", 128);
      return {
        id: fingerprint,
        category: text(lesson.category, "setup", 40),
        rule: text(lesson.rule, "Unnamed lesson.", 500),
        when: text(lesson.when, "Conditions not recorded.", 400),
        sequence: text(lesson.sequence, "Sequence not recorded.", 500),
        failsWhen: text(lesson.failsWhen, "Failure case not recorded.", 400),
        sourceRefs: array(lesson.sourceRefs).map((ref) => text(ref, "", 400)),
        sources: array(lesson.sourceRefs)
          .map((ref) => {
            const source = entries.get(ref);
            return {
              ref: text(ref, "Unknown source", 400),
              source: text(
                source?.source ?? array(source?.sources)[0],
                "Astro archive",
                120,
              ),
              date: source?.date ?? null,
              author: text(source?.author, "AstronomerZero", 120),
              excerpt: text(
                source?.text,
                "The archived source is indexed but its excerpt is unavailable.",
                280,
              ),
            };
          })
          .slice(0, 8),
        review: lessonStatus(lesson, decisions),
        connection: activeLessonRefs.has(fingerprint)
          ? "used_in_accepted_forecast"
          : researchLessonRefs.has(fingerprint)
            ? "selected_for_current_research"
            : "available_to_hermes",
      };
    })
    .reverse();

  const decisionValues = Object.values(decisions);
  const requiredBehaviorExamples = Math.max(
    8,
    Number(autoresearch.requiredBehaviorExamples || 12),
  );
  const behavior = behaviorImprovement(history, requiredBehaviorExamples);
  const behaviorPredictions = array(history.behaviorPredictions);
  const activeBehavior =
    [...behaviorPredictions]
      .reverse()
      .find((item) => item?.behaviorOutcome?.status === "active") ?? null;
  const processed = Number(thesis?.school?.processed || 0);
  const total = Number(thesis?.school?.total || index.entryCount || 0);
  const experiments = array(autoresearch.experiments)
    .slice(-12)
    .reverse()
    .map((experiment) => ({
      id: text(experiment.id, "", 120),
      track: text(experiment.track, "unknown", 40),
      hypothesis: text(experiment.hypothesis, "Unnamed experiment.", 300),
      result: text(experiment.result, "unknown", 60),
      baselineScore: Number.isFinite(experiment?.baseline?.score)
        ? experiment.baseline.score
        : null,
      candidateScore: Number.isFinite(experiment?.candidate?.score)
        ? experiment.candidate.score
        : null,
    }));

  return {
    updatedAt: thesis.updatedAt ?? null,
    status: text(thesis.status, "unknown", 40),
    provider: text(thesis.provider, "unknown", 120),
    progress: {
      processed,
      total,
      percent: percent(processed, total),
      complete: thesis?.school?.complete === true,
      lessons: lessons.length,
      pendingReview: Number(thesis?.school?.pendingHumanReview || 0),
    },
    review: {
      approved: decisionValues.filter((item) => item?.status === "approved")
        .length,
      rejected: decisionValues.filter((item) => item?.status === "rejected")
        .length,
      legacy: decisionValues.filter((item) => item?.status === "legacy").length,
    },
    lessons,
    currentResearch: {
      thesis: text(
        thesis?.thesis?.telegramContext,
        "Waiting for the next source-backed research update.",
        700,
      ),
      question: text(
        thesis?.lunaPacket?.question,
        "What evidence would change the current Hermes read?",
        500,
      ),
      counterCase: text(
        thesis?.lunaPacket?.counterCase,
        "The historical pattern may not repeat.",
        500,
      ),
      selectedLessonRefs: [...researchLessonRefs],
    },
    ahead: {
      action: text(activeBehavior?.behavior?.action, "unscored", 60),
      confidence: Number(activeBehavior?.confidence || 0),
      horizonHours: Number(activeBehavior?.behavior?.horizonHours || 0),
      condition: text(
        activeBehavior?.behavior?.condition,
        "The next frozen Astro-behavior hypothesis is pending.",
        700,
      ),
      createdAt: activeBehavior?.createdAt ?? null,
      status: text(
        activeBehavior?.behaviorOutcome?.status,
        "unscored",
        40,
      ),
      adjustIf: text(
        forecast?.hermes?.failure,
        "Material contradictory Astro evidence arrives.",
        600,
      ),
      nextPhase: text(
        forecast?.hermes?.nextPhase,
        "A successor strategy is not yet accepted.",
        600,
      ),
      longerMove: text(
        forecast?.hermes?.longerMove,
        "The longer-horizon path is not yet accepted.",
        600,
      ),
    },
    improvement: {
      behavior,
      market: {
        examples: Number(
          autoresearch.marketExamples ?? autoresearch.eligibleExamples ?? 0,
        ),
        requiredExamples: Number(
          autoresearch.requiredMarketExamples ??
            autoresearch.requiredExamples ??
            20,
        ),
      },
      researchStatus: text(autoresearch.status, "collecting", 60),
      mode: text(autoresearch.mode, "shadow_only", 60),
      note: text(
        autoresearch.note,
        "Shadow research waits for enough frozen outcomes.",
        500,
      ),
      experiments,
    },
  };
}
