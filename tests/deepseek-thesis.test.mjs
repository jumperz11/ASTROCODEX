import assert from "node:assert/strict";
import test from "node:test";

import {
  nextUnprocessedSchoolBatch,
  normalizeDeepSeekThesis,
  stabilizeDeepSeekThesis,
  thesisSourceSignature,
} from "../scripts/deepseek-thesis.mjs";
import { parseDeepSeekJson } from "../scripts/deepseek-client.mjs";

test("shared DeepSeek parser accepts fenced objects and rejects partial JSON", () => {
  assert.deepEqual(parseDeepSeekJson("```json\n{\"ok\":true}\n```"), {
    ok: true,
  });
  assert.equal(parseDeepSeekJson("{\"ok\":"), null);
});

test("DeepSeek school advances only through unprocessed Astro entries", () => {
  const index = {
    entries: [
      { ref: "messages.html#message1", source: "School", text: "One" },
      { ref: "messages.html#message2", source: "School", text: "Two" },
      { ref: "messages.html#message3", source: "School", text: "Three" },
    ],
  };
  const batch = nextUnprocessedSchoolBatch(
    index,
    ["messages.html#message1"],
    2,
  );
  assert.deepEqual(
    batch.map((entry) => entry.ref),
    ["messages.html#message2", "messages.html#message3"],
  );
});

test("DeepSeek thesis strips unsupported public sources and archive lessons", () => {
  const normalized = normalizeDeepSeekThesis(
    {
      thesis: {
        astroConfirmed: "Confirmed claim",
        publicSourceRefs: [
          "telegram-user:-1001:3",
          "https://x.com/astronomer_zero/status/2083130924980727816",
        ],
        campaign: { state: "open", direction: "short" },
        nextBehaviors: [
          { action: "hold", probability: 2, horizonHours: 24 },
          { action: "close", probability: 1, horizonHours: 48 },
        ],
      },
      newLessons: [
        {
          rule: "Trim before flipping.",
          sourceRefs: ["messages.html#message2", "invented-ref"],
        },
      ],
      lunaPacket: { facts: ["One fact"] },
    },
    ["messages.html#message2"],
  );
  assert.deepEqual(normalized.thesis.publicSourceRefs, [
    "https://x.com/astronomer_zero/status/2083130924980727816",
  ]);
  assert.deepEqual(normalized.newLessons[0].sourceRefs, [
    "messages.html#message2",
  ]);
  assert.deepEqual(
    normalized.thesis.nextBehaviors.map((item) => item.probability),
    [67, 33],
  );
});

test("DeepSeek thesis source signature changes with accepted inputs", () => {
  const base = {
    index: { builtAt: "a", entryCount: 10 },
    telegram: { newestAcceptedAt: "b", messages: [] },
    x: { newestAcceptedAt: "c", status: "healthy" },
    forecast: { generatedAt: "d" },
  };
  assert.notEqual(
    thesisSourceSignature(base),
    thesisSourceSignature({
      ...base,
      telegram: { newestAcceptedAt: "new", messages: [] },
    }),
  );
});

test("weak school batches cannot erase a stronger thesis", () => {
  const weak = normalizeDeepSeekThesis({}, []);
  const stabilized = stabilizeDeepSeekThesis(weak, {
    previous: {
      thesis: {
        astroConfirmed: "Prior fact",
        publicSourceRefs: [
          "https://x.com/astronomer_zero/status/2083130924980727816",
        ],
        telegramContext: "Prior context",
        campaign: { state: "partial", direction: "short" },
        nextBehaviors: [],
        contradictions: [],
        unknowns: [],
      },
      lunaPacket: {
        facts: ["Fact one", "Fact two"],
        question: "Prior question",
      },
    },
    forecast: {
      hermes: {
        projection: {
          confidence: 58,
          behavior: {
            action: "close",
            horizonHours: 72,
            condition: "Astro posts a full close.",
          },
        },
      },
      sources: [
        {
          url: "https://x.com/astronomer_zero/status/2083130924980727816",
        },
      ],
    },
  });
  assert.equal(stabilized.acceptedNewThesis, false);
  assert.equal(stabilized.thesis.campaign.direction, "short");
  assert.equal(stabilized.thesis.nextBehaviors[0].action, "close");
  assert.equal(stabilized.thesis.nextBehaviors[0].probability, 100);
  assert.deepEqual(stabilized.lunaPacket.facts, ["Fact one", "Fact two"]);
});
