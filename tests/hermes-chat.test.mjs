import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHermesChatPrompt,
  markPendingChatAnswer,
  normalizeChatAnswer,
} from "../scripts/hermes-chat.mjs";

test("Hermes chat keeps only exact public Astro X citations", () => {
  const answer = normalizeChatAnswer({
    answer: "The saved read is waiting for review.",
    sources: [
      "https://x.com/astronomer_zero/status/123",
      "https://t.me/private/55",
      "https://x.com/other/status/456",
    ],
    levels: [{ label: "tp", value: "Not public" }],
    confidence: 140,
  });
  assert.deepEqual(answer.sources, [
    "https://x.com/astronomer_zero/status/123",
  ]);
  assert.equal(answer.confidence, 100);
  assert.deepEqual(answer.levels, [{ label: "TP", value: "Not public" }]);
});

test("Hermes chat prompt says when the accepted plan is stale", () => {
  const prompt = buildHermesChatPrompt({
    question: "What is Astro doing now?",
    forecast: { generatedAt: "2026-08-01T00:00:00.000Z" },
    state: {
      forecastGeneratedAt: "2026-08-01T00:00:00.000Z",
      pendingAnalysis: { reason: "waiting" },
    },
    thesis: {},
    telegram: {},
    x: {},
    history: {},
  });
  assert.match(prompt, /saved plan is old\/pending/i);
  assert.match(prompt, /never place, recommend, or execute/i);
});

test("Hermes chat labels an unreviewed source as a preview", () => {
  const answer = markPendingChatAnswer(
    normalizeChatAnswer({
      answer: "A new source may change the route.",
      astro: "Astro may be short.",
      hermes: "Price may fall.",
      confidence: 90,
    }),
    true,
  );
  assert.match(answer.answer, /^REVIEW PENDING/);
  assert.match(answer.astro, /Unapproved/);
  assert.match(answer.hermes, /Preview only/);
  assert.equal(answer.confidence, 50);
});
