import { createHash } from "node:crypto";

function formatPrice(value) {
  return Number.isFinite(Number(value))
    ? `$${Math.round(Number(value)).toLocaleString("en-US")}`
    : "Not public";
}

function latestDirectEvidence(forecast) {
  return (Array.isArray(forecast?.evidence) ? forecast.evidence : [])
    .filter((item) => item?.type === "astro" && item?.source)
    .sort(
      (left, right) =>
        new Date(right.time || 0).getTime() -
        new Date(left.time || 0).getTime(),
    )[0];
}

function latestOfficialPrediction(history) {
  return (Array.isArray(history?.hermesPredictions)
    ? history.hermesPredictions
    : []
  )
    .filter((item) => item?.official && item?.integrity === "valid")
    .at(-1);
}

export function telegramSnapshot(forecast, history, market) {
  const evidence = latestDirectEvidence(forecast);
  const prediction = latestOfficialPrediction(history);
  const checkpoints = Array.isArray(prediction?.checkpoints)
    ? prediction.checkpoints
    : [];
  const hitCount = checkpoints.filter((checkpoint) => checkpoint.hitAt).length;
  const signatureData = {
    forecastId: forecast?.generatedAt ?? null,
    signal: forecast?.signal?.state ?? null,
    evidence: evidence?.source ?? null,
    predictionId: prediction?.id ?? null,
    marketStatus: prediction?.marketStatus ?? null,
    hitCount,
    behaviorStatus: prediction?.behaviorOutcome?.status ?? null,
  };
  const signature = createHash("sha256")
    .update(JSON.stringify(signatureData))
    .digest("hex");
  const targetLines = checkpoints.map((checkpoint, index) => {
    const targetIndex = checkpoints
      .slice(0, index + 1)
      .filter((item) => item.kind === "target").length;
    const label =
      checkpoint.kind === "target"
        ? `TP${Math.max(1, targetIndex)}`
        : `T${index + 1}`;
    return `${checkpoint.hitAt ? "✅" : "▫️"} ${label} ${formatPrice(
      checkpoint.price,
    )} · ${checkpoint.label}`;
  });
  const text = [
    "📡 ASTRO INTELLIGENCE",
    `BTC · ${formatPrice(market?.price)}`,
    "",
    `ASTRO · ${(forecast?.signal?.state || "wait").toUpperCase()}`,
    forecast?.decision?.position || "Position not public",
    `TP · ${forecast?.execution?.takeProfit?.level || "Not public"}`,
    `CLOSE · ${forecast?.execution?.exit?.level || "Not public"}`,
    "",
    `HERMES · ${(prediction?.marketStatus || "pending").toUpperCase()} · ${hitCount}/${checkpoints.length}`,
    ...targetLines,
    `WRONG IF · ${formatPrice(prediction?.invalidation?.price)}`,
    "",
    `OPPORTUNITY WATCH · ${
      forecast?.signal?.readerStep || "Wait for direct evidence."
    }`,
    evidence?.source ? `SOURCE · ${evidence.source}` : null,
    "",
    "Research alert only · no automatic trade.",
  ]
    .filter(Boolean)
    .join("\n");
  return { signature, text: text.slice(0, 4000), signatureData };
}

export async function notifyTelegram({
  forecast,
  history,
  market,
  previous = null,
  fetchImpl = fetch,
}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const messageThreadId = Number.parseInt(
    process.env.TELEGRAM_MESSAGE_THREAD_ID || "",
    10,
  );
  const snapshot = telegramSnapshot(forecast, history, market);
  if (!botToken || !chatId) {
    return {
      enabled: false,
      status: "disabled",
      signature: previous?.signature ?? null,
      error: null,
    };
  }
  if (previous?.signature === snapshot.signature) {
    return {
      ...previous,
      enabled: true,
      status: "quiet",
      error: null,
    };
  }

  try {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          ...(Number.isInteger(messageThreadId) && messageThreadId > 0
            ? { message_thread_id: messageThreadId }
            : {}),
          text: snapshot.text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Telegram returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (!payload?.ok) {
      throw new Error("Telegram rejected the notification.");
    }
    return {
      enabled: true,
      status: "sent",
      signature: snapshot.signature,
      sentAt: new Date().toISOString(),
      messageId: payload.result?.message_id ?? null,
      error: null,
    };
  } catch (error) {
    return {
      enabled: true,
      status: "error",
      signature: previous?.signature ?? null,
      error:
        error instanceof Error
          ? error.message
          : "Unknown Telegram notification failure.",
    };
  }
}
