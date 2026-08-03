import assert from "node:assert/strict";
import test from "node:test";

import {
  notifyTelegram,
  telegramSnapshot,
} from "../scripts/telegram-notifier.mjs";

const forecast = {
  generatedAt: "2026-07-31T16:42:41.680Z",
  signal: {
    state: "wait",
    readerStep: "Wait for Astro to publish a close.",
  },
  decision: {
    position: "Short III still open",
  },
  execution: {
    takeProfit: { level: "~62.2k class" },
    exit: { level: "Not public" },
  },
  evidence: [
    {
      type: "astro",
      label: "Hold major shorts",
      source:
        "https://x.com/astronomer_zero/status/2083130924980727816",
      time: "2026-07-31T10:01:00.000Z",
    },
  ],
};

const history = {
  hermesPredictions: [
    {
      id: "map-1",
      official: true,
      integrity: "valid",
      marketStatus: "active",
      direction: "down_then_up",
      checkpoints: [
        {
          label: "Downside objective",
          price: 62358,
          kind: "transition",
          hitAt: null,
        },
        {
          label: "Reclaim",
          price: 64600,
          kind: "target",
          hitAt: null,
        },
      ],
      invalidation: { price: 59000 },
      behaviorOutcome: { status: "active" },
    },
  ],
};

test("Telegram snapshot separates Astro and Hermes targets", () => {
  const snapshot = telegramSnapshot(forecast, history, { price: 62800 });
  assert.match(snapshot.text, /ASTRO NOW/);
  assert.match(snapshot.text, /Astro still has a short open/);
  assert.match(snapshot.text, /ASTRO IN: /);
  assert.match(snapshot.text, /ASTRO TP: /);
  assert.match(snapshot.text, /ASTRO SL \/ EXIT: /);
  assert.match(snapshot.text, /HERMES NEXT/);
  assert.match(snapshot.text, /Hermes agrees: price may fall first, then bounce/);
  assert.match(snapshot.text, /Next price area: \$62,358/);
  assert.match(snapshot.text, /Then watch: \$64,600/);
  assert.match(snapshot.text, /Price now: \$62,800/);
  assert.match(snapshot.text, /YOUR NEXT CHECK/);
  assert.match(snapshot.text, /ASTRO NOW\n.+\n\nASTRO IN:/);
  assert.doesNotMatch(snapshot.text, /CHECKPOINTS|AGREEMENT ·|TP STATE/);
  assert.match(snapshot.text, /No automatic trading/i);
});

test("Telegram snapshot marks a contrary Hermes path as conflict", () => {
  const contraryHistory = {
    hermesPredictions: [
      {
        ...history.hermesPredictions[0],
        id: "map-2",
        direction: "up",
      },
    ],
  };
  const snapshot = telegramSnapshot(forecast, contraryHistory, {
    price: 62800,
  });
  assert.match(snapshot.text, /Hermes disagrees: the next move may be higher/);
});

test("Telegram snapshot does not invent agreement without a Hermes direction", () => {
  const unresolvedHistory = {
    hermesPredictions: [
      {
        ...history.hermesPredictions[0],
        id: "map-3",
        direction: undefined,
      },
    ],
  };
  const snapshot = telegramSnapshot(forecast, unresolvedHistory, {
    price: 62800,
  });
  assert.match(snapshot.text, /Hermes does not have a clear direction yet/);
});

test("Telegram notifier deduplicates identical state", async () => {
  const snapshot = telegramSnapshot(forecast, history, { price: 62800 });
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "-1001";
  let calls = 0;
  const result = await notifyTelegram({
    forecast,
    history,
    market: { price: 62800 },
    previous: { signature: snapshot.signature, status: "sent" },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("should not send");
    },
  });
  assert.equal(result.status, "quiet");
  assert.equal(calls, 0);
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  if (originalChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = originalChat;
});

test("Telegram notifier sends once when lifecycle state changes", async () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "-1001";
  let request = null;
  const result = await notifyTelegram({
    forecast,
    history,
    market: { price: 62800 },
    previous: null,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { ok: true, result: { message_id: 99 } };
        },
      };
    },
  });
  assert.equal(result.status, "sent");
  assert.equal(result.messageId, 99);
  assert.match(request.url, /sendMessage$/);
  assert.match(request.options.body, /ASTRO UPDATE/);
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  if (originalChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = originalChat;
});

test("Telegram notifier explains a queued Astro review", () => {
  const snapshot = telegramSnapshot(
    forecast,
    history,
    { price: 62800 },
    {
      entityRef: "x:2083999999999999999",
      reason: "Luna Medium is at its daily limit.",
    },
  );
  assert.match(snapshot.text, /ASTRO UPDATE SEEN/);
  assert.match(snapshot.text, /review is waiting/i);
  assert.match(snapshot.text, /last validated plan/i);
  assert.match(snapshot.text, /ASTRO IN:/);
  assert.match(
    snapshot.text,
    /https:\/\/x\.com\/astronomer_zero\/status\/2083999999999999999/,
  );
});

test("Telegram keeps one alert while a review remains queued", () => {
  const first = telegramSnapshot(
    forecast,
    history,
    { price: 62800 },
    { entityRef: "x:1", reason: "provider full" },
  );
  const later = telegramSnapshot(
    forecast,
    history,
    { price: 62700 },
    { entityRef: "x:2", reason: "provider full" },
  );
  assert.equal(first.signature, later.signature);
});
