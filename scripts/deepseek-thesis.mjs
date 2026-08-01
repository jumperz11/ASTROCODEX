import { createHash } from "node:crypto";

const PUBLIC_ASTRO_URL =
  /^https:\/\/(?:www\.)?x\.com\/astronomer_zero\/status\/\d+$/;

function text(value, fallback = "Unknown", limit = 600) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, limit);
}

function stringList(value, limit = 12, itemLimit = 500) {
  return (Array.isArray(value) ? value : [])
    .map((item) => text(item, "", itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

export function lessonFingerprint(lesson) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        rule: text(lesson?.rule, "", 400).toLowerCase(),
        when: text(lesson?.when, "", 300).toLowerCase(),
        sequence: text(lesson?.sequence, "", 400).toLowerCase(),
      }),
    )
    .digest("hex");
}

export function lessonSourceReviewHash(review) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        verdict: review?.verdict ?? null,
        supportedRefs: Array.isArray(review?.supportedRefs)
          ? review.supportedRefs
          : [],
        reason: review?.reason ?? null,
        contradiction: review?.contradiction ?? null,
      }),
    )
    .digest("hex");
}

export function normalizeLessonReviews(value, candidates = []) {
  const reviews = Array.isArray(value?.reviews) ? value.reviews : [];
  const seen = new Set();
  return reviews
    .map((review) => {
      const candidateIndex = Math.round(Number(review?.candidateIndex));
      const candidate = candidates[candidateIndex];
      if (
        !Number.isInteger(candidateIndex) ||
        candidateIndex < 0 ||
        !candidate ||
        seen.has(candidateIndex)
      ) {
        return null;
      }
      seen.add(candidateIndex);
      const candidateRefs = new Set(candidate.sourceRefs || []);
      const supportedRefs = stringList(
        review?.supportedRefs,
        8,
        300,
      ).filter((ref) => candidateRefs.has(ref));
      const verdict =
        review?.verdict === "supported" && supportedRefs.length
          ? "supported"
          : "rejected";
      return {
        candidateIndex,
        verdict,
        supportedRefs,
        reason: text(
          review?.reason,
          verdict === "supported"
            ? "Source support verified."
            : "Source support was insufficient.",
          500,
        ),
        contradiction: text(review?.contradiction, "None", 400),
      };
    })
    .filter(Boolean);
}

export function mergeApprovedLessons(
  existingLessons,
  candidates,
  reviews,
  learnedAt,
) {
  const approved = reviews
    .filter((review) => review.verdict === "supported")
    .map((review) => {
      const candidate = candidates[review.candidateIndex];
      return {
        ...candidate,
        fingerprint: lessonFingerprint(candidate),
        sourceRefs: review.supportedRefs,
        learnedAt,
        quality: {
          status: "supported",
          reviewedAt: learnedAt,
          reason: review.reason,
          contradiction: review.contradiction,
        },
      };
    });
  const merged = new Map();
  for (const lesson of [
    ...(Array.isArray(existingLessons)
      ? existingLessons.filter(
          (lesson) => lesson?.quality?.status === "supported",
        )
      : []),
    ...approved,
  ]) {
    const fingerprint = lesson.fingerprint || lessonFingerprint(lesson);
    const previous = merged.get(fingerprint);
    merged.set(
      fingerprint,
      previous
        ? {
            ...previous,
            sourceRefs: [
              ...new Set([
                ...(previous.sourceRefs || []),
                ...(lesson.sourceRefs || []),
              ]),
            ].slice(0, 12),
            quality: lesson.quality ?? previous.quality,
          }
        : { ...lesson, fingerprint },
    );
  }
  return [...merged.values()].slice(-500);
}

export function mergeHumanApprovedLessons(
  existingLessons,
  candidates,
  reviewState,
  learnedAt,
) {
  const decisions =
    reviewState?.decisions && typeof reviewState.decisions === "object"
      ? reviewState.decisions
      : {};
  const approved = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => {
      const fingerprint =
        candidate?.fingerprint || lessonFingerprint(candidate);
      const sourceReview = candidate?.review;
      const humanReview = decisions[fingerprint];
      if (
        sourceReview?.verdict !== "supported" ||
        !Array.isArray(sourceReview.supportedRefs) ||
        sourceReview.supportedRefs.length === 0 ||
        humanReview?.status !== "approved" ||
        (humanReview.sourceReviewHash &&
          humanReview.sourceReviewHash !==
            lessonSourceReviewHash(sourceReview))
      ) {
        return null;
      }
      return {
        ...candidate,
        fingerprint,
        sourceRefs: sourceReview.supportedRefs,
        learnedAt: humanReview.decidedAt || learnedAt,
        quality: {
          status: "supported",
          reviewedAt: sourceReview.reviewedAt || candidate.candidateAt || learnedAt,
          reason: sourceReview.reason,
          contradiction: sourceReview.contradiction,
          humanReview: {
            status: "approved",
            reviewerId: humanReview.reviewerId ?? null,
            decidedAt: humanReview.decidedAt || learnedAt,
          },
        },
      };
    })
    .filter(Boolean);

  const merged = new Map();
  for (const lesson of [
    ...(Array.isArray(existingLessons)
      ? existingLessons.filter(
          (lesson) => lesson?.quality?.status === "supported",
        )
      : []),
    ...approved,
  ]) {
    const fingerprint = lesson.fingerprint || lessonFingerprint(lesson);
    const previous = merged.get(fingerprint);
    merged.set(
      fingerprint,
      previous
        ? {
            ...previous,
            ...lesson,
            sourceRefs: [
              ...new Set([
                ...(previous.sourceRefs || []),
                ...(lesson.sourceRefs || []),
              ]),
            ].slice(0, 12),
          }
        : { ...lesson, fingerprint },
    );
  }
  return [...merged.values()].slice(-500);
}

export function thesisSourceSignature({ index, telegram, x, forecast }) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        indexBuiltAt: index?.builtAt ?? null,
        indexEntries: index?.entryCount ?? null,
        telegramNewest: telegram?.newestAcceptedAt ?? null,
        telegramCount: Array.isArray(telegram?.messages)
          ? telegram.messages.length
          : 0,
        xNewest: x?.newestAcceptedAt ?? null,
        xStatus: x?.status ?? null,
        forecastGeneratedAt: forecast?.generatedAt ?? null,
      }),
    )
    .digest("hex");
}

export function buildThesisReviewSignal(
  previous,
  next,
  reviewedAt,
  milestoneSize = 2_000,
) {
  const size = Math.max(500, Math.round(Number(milestoneSize) || 2_000));
  const previousProcessed = Number(previous?.school?.processed || 0);
  const nextProcessed = Number(next?.school?.processed || 0);
  const previousMilestone = Math.floor(previousProcessed / size);
  const nextMilestone = Math.floor(nextProcessed / size);
  const completedNow =
    next?.school?.complete === true && previous?.school?.complete !== true;
  const reachedMilestone = nextMilestone > previousMilestone;
  if (!completedNow && !reachedMilestone) {
    return previous?.reviewSignal ?? null;
  }
  const thesisSignature = createHash("sha256")
    .update(
      JSON.stringify({
        campaign: next?.thesis?.campaign ?? null,
        nextBehaviors: (next?.thesis?.nextBehaviors || []).map((item) => ({
          action: item.action,
          probability: item.probability,
          horizonHours: item.horizonHours,
        })),
        approvedLessons: next?.school?.lessonCount ?? 0,
      }),
    )
    .digest("hex");
  const reason = completedNow
    ? "Initial Astro School pass completed."
    : `Astro School crossed ${nextMilestone * size} reviewed archive items.`;
  return {
    token: `${completedNow ? "complete" : "milestone"}:${nextProcessed}:${thesisSignature.slice(0, 16)}`,
    requestedAt: reviewedAt,
    reason,
    schoolProcessed: nextProcessed,
    schoolTotal: Number(next?.school?.total || 0),
    thesisSignature,
  };
}

export function nextUnprocessedSchoolBatch(
  index,
  processedRefs,
  batchSize = 100,
) {
  const seen = new Set(Array.isArray(processedRefs) ? processedRefs : []);
  const entries = Array.isArray(index?.entries) ? index.entries : [];
  return entries
    .filter((entry) => entry?.ref && !seen.has(entry.ref))
    .slice(0, Math.max(1, Math.min(Number(batchSize) || 100, 200)))
    .map((entry) => ({
      ref: entry.ref,
      source: text(entry.source, "Astro archive", 120),
      date: text(entry.date, "Unknown date", 80),
      text: text(entry.text, "[Media-only item]", 700),
    }));
}

function normalizeBehavior(value) {
  const allowed = new Set([
    "hold",
    "trim",
    "close",
    "flip_long",
    "flip_short",
    "readd",
    "silence",
    "post_update",
  ]);
  const action = allowed.has(value?.action) ? value.action : "post_update";
  return {
    action,
    probability: Math.min(
      100,
      Math.max(0, Math.round(Number(value?.probability) || 0)),
    ),
    horizonHours: Math.min(
      720,
      Math.max(1, Math.round(Number(value?.horizonHours) || 24)),
    ),
    why: text(value?.why, "Insufficient evidence.", 500),
    sourceRefs: stringList(value?.sourceRefs, 8, 300),
  };
}

function capBehaviorCertainty(behaviors, maxProbability = 70) {
  if (behaviors.length < 2) return;
  const leaderIndex = behaviors.reduce(
    (best, behavior, index) =>
      behavior.probability > behaviors[best].probability ? index : best,
    0,
  );
  const excess = behaviors[leaderIndex].probability - maxProbability;
  if (excess <= 0) return;

  behaviors[leaderIndex].probability = maxProbability;
  const alternatives = behaviors.filter((_, index) => index !== leaderIndex);
  const alternativeWeight = alternatives.reduce(
    (total, behavior) => total + behavior.probability,
    0,
  );
  let assigned = 0;
  alternatives.forEach((behavior, index) => {
    const addition =
      index === alternatives.length - 1
        ? excess - assigned
        : alternativeWeight > 0
          ? Math.round((behavior.probability / alternativeWeight) * excess)
          : Math.floor(excess / alternatives.length);
    behavior.probability += addition;
    assigned += addition;
  });
}

export function normalizeDeepSeekThesis(
  value,
  allowedLessonRefs = [],
  allowedLessonFingerprints = [],
) {
  const allowedRefs = new Set(allowedLessonRefs);
  const thesis = value?.thesis && typeof value.thesis === "object"
    ? value.thesis
    : {};
  const campaign = thesis?.campaign && typeof thesis.campaign === "object"
    ? thesis.campaign
    : {};
  const state = ["unknown", "planned", "open", "partial", "closed", "conflict"]
    .includes(campaign.state)
    ? campaign.state
    : "unknown";
  const direction = ["unknown", "long", "short", "both", "flat"].includes(
    campaign.direction,
  )
    ? campaign.direction
    : "unknown";
  const publicRefs = stringList(thesis.publicSourceRefs, 12, 300).filter((ref) =>
    PUBLIC_ASTRO_URL.test(ref),
  );
  const lessonCategories = new Set([
    "setup",
    "entry",
    "add",
    "trim",
    "close",
    "flip",
    "invalidation",
    "avoidance",
    "timing",
    "communication",
    "risk",
  ]);
  const lessons = (Array.isArray(value?.newLessons) ? value.newLessons : [])
    .map((lesson) => ({
      category: lessonCategories.has(lesson?.category)
        ? lesson.category
        : "setup",
      rule: text(lesson?.rule, "", 400),
      when: text(lesson?.when, "Unknown", 300),
      sequence: text(lesson?.sequence, "Unknown", 400),
      failsWhen: text(lesson?.failsWhen, "Unknown", 300),
      sourceRefs: stringList(lesson?.sourceRefs, 8, 300).filter((ref) =>
        allowedRefs.has(ref),
      ),
    }))
    .filter((lesson) => lesson.rule && lesson.sourceRefs.length)
    .slice(0, 8);
  const nextBehaviors = (
    Array.isArray(thesis.nextBehaviors) ? thesis.nextBehaviors : []
  )
    .map(normalizeBehavior)
    .slice(0, 3);
  const behaviorTotal = nextBehaviors.reduce(
    (total, behavior) => total + behavior.probability,
    0,
  );
  if (behaviorTotal > 0) {
    let assigned = 0;
    nextBehaviors.forEach((behavior, index) => {
      behavior.probability =
        index === nextBehaviors.length - 1
          ? 100 - assigned
          : Math.round((behavior.probability / behaviorTotal) * 100);
      assigned += behavior.probability;
    });
  } else if (nextBehaviors.length) {
    const equal = Math.floor(100 / nextBehaviors.length);
    nextBehaviors.forEach((behavior, index) => {
      behavior.probability =
        index === nextBehaviors.length - 1
          ? 100 - equal * (nextBehaviors.length - 1)
          : equal;
    });
  }
  capBehaviorCertainty(nextBehaviors);

  return {
    thesis: {
      astroConfirmed: publicRefs.length
        ? text(thesis.astroConfirmed, "No new public confirmation.", 700)
        : "No new public confirmation.",
      publicSourceRefs: publicRefs,
      telegramContext: text(
        thesis.telegramContext,
        "No new Telegram context.",
        700,
      ),
      campaign: {
        state,
        direction,
        entry: text(campaign.entry, "Unknown", 300),
        targets: stringList(campaign.targets, 8, 300),
        invalidation: text(campaign.invalidation, "Unknown", 400),
      },
      nextBehaviors,
      contradictions: stringList(thesis.contradictions, 8, 400),
      unknowns: stringList(thesis.unknowns, 8, 400),
    },
    newLessons: lessons,
    lunaPacket: {
      facts: stringList(value?.lunaPacket?.facts, 10, 500),
      historicalAnalogues: stringList(
        value?.lunaPacket?.historicalAnalogues,
        8,
        500,
      ),
      appliedLessonFingerprints: stringList(
        value?.lunaPacket?.appliedLessonFingerprints,
        8,
        128,
      ).filter((fingerprint) =>
        allowedLessonFingerprints.includes(fingerprint),
      ),
      question: text(
        value?.lunaPacket?.question,
        "What material evidence would change the accepted forecast?",
        600,
      ),
      counterCase: text(
        value?.lunaPacket?.counterCase,
        "The apparent pattern may not repeat.",
        600,
      ),
      doNotAssume: stringList(value?.lunaPacket?.doNotAssume, 8, 400),
    },
  };
}

function hasThesisSubstance(thesis) {
  return Boolean(
    thesis &&
      (thesis.publicSourceRefs?.length ||
        thesis.nextBehaviors?.length ||
        thesis.campaign?.direction !== "unknown" ||
        thesis.campaign?.state !== "unknown" ||
        (thesis.telegramContext &&
          thesis.telegramContext !== "No new Telegram context.")),
  );
}

export function stabilizeDeepSeekThesis(
  normalized,
  { previous = {}, forecast = {}, evidenceBrief = {} } = {},
) {
  const previousThesis = previous?.thesis;
  const acceptedNewThesis = hasThesisSubstance(normalized?.thesis);
  const thesis = acceptedNewThesis
    ? structuredClone(normalized.thesis)
    : hasThesisSubstance(previousThesis)
      ? structuredClone(previousThesis)
      : structuredClone(normalized.thesis);
  const briefCampaign = evidenceBrief?.campaign;
  if (
    thesis?.campaign?.direction === "unknown" &&
    ["long", "short", "both", "flat"].includes(briefCampaign?.direction)
  ) {
    thesis.campaign = {
      state: ["planned", "open", "partial", "closed", "conflict"].includes(
        briefCampaign.state,
      )
        ? briefCampaign.state
        : "unknown",
      direction: briefCampaign.direction,
      entry: text(briefCampaign.entry, "Unknown", 300),
      targets: stringList(briefCampaign.targets, 8, 300),
      invalidation: text(briefCampaign.invalidation, "Unknown", 400),
    };
  }
  if (
    thesis?.telegramContext === "No new Telegram context." &&
    evidenceBrief?.brief?.astroNow
  ) {
    thesis.telegramContext = text(
      evidenceBrief.brief.astroNow,
      "No new Telegram context.",
      700,
    );
  }
  if (!thesis?.nextBehaviors?.length) {
    const previousBehaviors = previousThesis?.nextBehaviors;
    const projection = forecast?.hermes?.projection;
    if (Array.isArray(previousBehaviors) && previousBehaviors.length) {
      thesis.nextBehaviors = structuredClone(previousBehaviors);
    } else if (projection?.behavior?.action) {
      const primaryProbability = Math.min(
        70,
        Math.max(30, Math.round(Number(projection.confidence) || 50)),
      );
      const alternativeAction =
        projection.behavior.action === "hold" ? "close" : "hold";
      const sourceRefs = (forecast.sources || []).map((source) => source?.url);
      thesis.nextBehaviors = [
        normalizeBehavior({
          action: projection.behavior.action,
          probability: primaryProbability,
          horizonHours: projection.behavior.horizonHours,
          why: `Carry-forward from the accepted frozen Hermes behavior map: ${projection.behavior.condition || "condition unchanged"}`,
          sourceRefs,
        }),
        normalizeBehavior({
          action: alternativeAction,
          probability: 100 - primaryProbability,
          horizonHours: projection.behavior.horizonHours,
          why:
            "Simple opposing case retained until fresh direct evidence resolves the behavior.",
          sourceRefs,
        }),
      ];
    }
  }

  const normalizedPacket = normalized?.lunaPacket || {};
  const previousPacket = previous?.lunaPacket || {};
  const briefPacket = evidenceBrief?.lunaBrief || {};
  const lunaPacket =
    normalizedPacket.facts?.length >= 2
      ? normalizedPacket
      : previousPacket.facts?.length >= 2
        ? structuredClone(previousPacket)
        : {
            facts: stringList(briefPacket.facts, 10, 500),
            historicalAnalogues: [],
            appliedLessonFingerprints: [],
            question: text(
              briefPacket.question,
              normalizedPacket.question ||
                "What material evidence changes the accepted forecast?",
              600,
            ),
            counterCase: text(
              briefPacket.counterCase,
              normalizedPacket.counterCase ||
                "The apparent pattern may not repeat.",
              600,
            ),
            doNotAssume: stringList(normalizedPacket.doNotAssume, 8, 400),
          };
  return {
    thesis,
    lunaPacket,
    acceptedNewThesis,
  };
}
