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

export function normalizeDeepSeekThesis(value, allowedLessonRefs = []) {
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
  const lessons = (Array.isArray(value?.newLessons) ? value.newLessons : [])
    .map((lesson) => ({
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
