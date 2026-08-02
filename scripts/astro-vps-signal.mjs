import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchoolAudit } from "./school-audit.mjs";
import {
  defaultLedgerPath,
  readLedgerHealth,
  readRuntimeEvents,
} from "./astro-event-ledger.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const forecastPath =
  process.env.ASTRO_FORECAST_PATH?.trim() ||
  join(projectRoot, "public", "forecast.json");
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(projectRoot, ".astro-runtime");
const statePath = join(stateDirectory, "state.json");
const telegramSourcePath =
  process.env.ASTRO_TELEGRAM_SOURCE_PATH?.trim() ||
  join(stateDirectory, "telegram-source.json");
const xSourcePath =
  process.env.ASTRO_X_SOURCE_PATH?.trim() ||
  join(stateDirectory, "x-source.json");
const historyPath = join(stateDirectory, "history.json");
const deepSeekThesisPath = join(stateDirectory, "deepseek-thesis.json");
const learningReviewPath = join(stateDirectory, "learning-review.json");
const codexIndexPath = join(stateDirectory, "codex-index.json");
const autoresearchPath = join(stateDirectory, "autoresearch-shadow.json");
const eventLedgerPath = defaultLedgerPath(stateDirectory);
const signalToken = process.env.ASTRO_SIGNAL_TOKEN?.trim() ?? "";
const host = process.env.ASTRO_SIGNAL_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.ASTRO_SIGNAL_PORT || "8789", 10);
const staleAfterMs = Math.max(
  300_000,
  Number.parseInt(process.env.ASTRO_STALE_AFTER_MS || "600000", 10),
);

if (signalToken.length < 32) {
  throw new Error(
    "ASTRO_SIGNAL_TOKEN must be a random secret containing at least 32 characters.",
  );
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("ASTRO_SIGNAL_PORT must be a valid TCP port.");
}

function authorized(request) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBuffer = Buffer.from(signalToken);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function asText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function eventOutcomeFor(runtimeEvents, entityRef) {
  const matched = [...runtimeEvents]
    .reverse()
    .find(
      (event) =>
        event?.entityRef === entityRef &&
        [
          "forecast_changed",
          "plan_confirmed",
          "analysis_kept",
          "analysis_deferred",
        ].includes(event?.kind),
    );
  if (!matched) return null;
  if (matched.kind === "forecast_changed") return "changed";
  if (matched.kind === "analysis_deferred") return "deferred";
  return "confirmed";
}

function buildAstroItems({ state, telegram, x, runtimeEvents }) {
  const xAcceptedAt = x?.newestAcceptedAt ?? null;
  const lastAgentAt = state?.lastAgentAt ?? null;
  const xWasAnalyzed =
    Boolean(xAcceptedAt && lastAgentAt) &&
    new Date(lastAgentAt).getTime() >= new Date(xAcceptedAt).getTime();
  const xChangedAfterLatest =
    xWasAnalyzed &&
    Boolean(state?.lastChangedAt) &&
    new Date(state.lastChangedAt).getTime() >= new Date(xAcceptedAt).getTime();
  const telegramAnalyzedNewestAt =
    state?.telegramSource?.analyzedNewestAt ?? null;
  const telegramAnalyzedAt =
    state?.telegramSource?.lastAnalyzedAt ?? null;
  const reasonerDeferred =
    state?.reasoner?.material === true &&
    ["rate_limited", "degraded"].includes(state?.reasoner?.status);

  const xItems = (Array.isArray(x?.posts) ? x.posts : [])
    .map((post) => {
      const statusId =
        asText(post?.statusId) ||
        asText(post?.url).match(/\/status\/(\d+)$/)?.[1] ||
        "";
      if (!statusId || !asText(post?.text)) return null;
      const id = `x:${statusId}`;
      const recordedOutcome = eventOutcomeFor(runtimeEvents, id);
      const outcome =
        recordedOutcome ??
        (reasonerDeferred
          ? "deferred"
          : xWasAnalyzed
            ? xChangedAfterLatest
              ? "changed"
              : "confirmed"
            : "queued");
      return {
        id,
        source: "x",
        channels: ["Public X"],
        postedAt: post?.postedAt ?? null,
        activityAt: post?.postedAt ?? null,
        seenAt: x?.lastSuccessAt ?? x?.checkedAt ?? null,
        analyzedAt: xWasAnalyzed ? lastAgentAt : null,
        outcome,
        text: asText(post?.text).slice(0, 4_000),
        url: asText(post?.url) || null,
        hasMedia: false,
      };
    })
    .filter(Boolean);
  const xByUrl = new Map(
    xItems.filter((item) => item.url).map((item) => [item.url, item]),
  );

  const telegramItems = (Array.isArray(telegram?.messages)
    ? telegram.messages
    : []
  )
    .map((message) => {
      const body = asText(message?.text);
      if (!body) return null;
      const directXUrl = body.match(
        /https:\/\/(?:www\.)?x\.com\/astronomer_zero\/status\/\d+/i,
      )?.[0];
      const mirrored = directXUrl ? xByUrl.get(directXUrl) : null;
      const channel = asText(message?.chatTitle, "Astro Telegram");
      if (mirrored && body === directXUrl) {
        if (!mirrored.channels.includes(channel)) {
          mirrored.channels.push(channel);
        }
        return null;
      }
      const id =
        asText(message?.id) ||
        `telegram:${asText(message?.chatId)}:${message?.messageId ?? "unknown"}`;
      const activityAt =
        message?.activityAt ?? message?.editedAt ?? message?.postedAt ?? null;
      const analyzed =
        Boolean(activityAt && telegramAnalyzedNewestAt) &&
        new Date(activityAt).getTime() <=
          new Date(telegramAnalyzedNewestAt).getTime();
      const recordedOutcome = eventOutcomeFor(runtimeEvents, id);
      const username = asText(message?.chatUsername).replace(/^@/, "");
      const telegramUrl =
        username && message?.messageId
          ? `https://t.me/${username}/${message.messageId}`
          : null;
      return {
        id,
        source: "telegram",
        channels: [channel],
        postedAt: message?.postedAt ?? null,
        activityAt,
        seenAt: telegram?.lastSuccessAt ?? null,
        analyzedAt: analyzed ? telegramAnalyzedAt : null,
        outcome:
          recordedOutcome ??
          (reasonerDeferred && !analyzed
            ? "deferred"
            : analyzed
              ? "confirmed"
              : "queued"),
        text: body.slice(0, 4_000),
        url: directXUrl ?? telegramUrl,
        hasMedia: Boolean(message?.mediaPath),
      };
    })
    .filter(Boolean);

  return [...xItems, ...telegramItems]
    .sort(
      (left, right) =>
        new Date(right.activityAt ?? right.postedAt ?? 0).getTime() -
        new Date(left.activityAt ?? left.postedAt ?? 0).getTime(),
    )
    .slice(0, 120);
}

async function currentHealth() {
  try {
    const [state, liveTelegram, liveX] = await Promise.all([
      readJson(statePath),
      readJson(telegramSourcePath).catch(() => ({})),
      readJson(xSourcePath).catch(() => ({})),
    ]);
    const runtimeEvents = readRuntimeEvents(eventLedgerPath, { limit: 200 });
    const astroItems = buildAstroItems({
      state,
      telegram: liveTelegram,
      x: liveX,
      runtimeEvents,
    });
    const telegramMessages = Array.isArray(liveTelegram.messages)
      ? liveTelegram.messages
      : [];
    const telegramSources = Array.isArray(liveTelegram.discoveredChats)
      ? liveTelegram.discoveredChats
          .filter((source) => source?.allowed)
          .map((source) => ({
            id: source.id,
            title: source.title,
            lastMessageAt: source.lastMessageAt ?? null,
            messageCount: Number(source.messageCount || 0),
            mediaCount: Number(source.mediaCount || 0),
          }))
      : [];
    const lastSuccessfulMs = new Date(state.lastSuccessfulAt || 0).getTime();
    const stale =
      !Number.isFinite(lastSuccessfulMs) ||
      Date.now() - lastSuccessfulMs > staleAfterMs;
    return {
      ok: !stale && state.status !== "error",
      status: stale ? "stale" : state.status,
      checkedAt: state.checkedAt ?? null,
      lastSuccessfulAt: state.lastSuccessfulAt ?? null,
      forecastGeneratedAt: state.forecastGeneratedAt ?? null,
      marketCandleAt: state.marketCandleAt ?? null,
      changed: Boolean(state.changed),
      runId: state.runId ?? null,
      model: state.model ?? null,
      codexEntries: Number(state.codex?.entries || 0),
      codexMedia: Number(state.codex?.media || 0),
      codexBuiltAt: state.codex?.builtAt ?? null,
      telegramEnabled: Boolean(state.telegram?.enabled),
      telegramStatus: state.telegram?.status ?? "disabled",
      telegramSourceStatus:
        liveTelegram.status ?? state.telegramSource?.status ?? "unknown",
      telegramSourceLastSuccessAt:
        liveTelegram.lastSuccessAt ?? state.telegramSource?.lastSuccessAt ?? null,
      telegramSourceNewestAt:
        liveTelegram.newestAcceptedAt ??
        state.telegramSource?.newestAcceptedAt ??
        null,
      telegramSourceLastAnalyzedAt:
        state.telegramSource?.lastAnalyzedAt ?? null,
      telegramSourceAnalyzedNewestAt:
        state.telegramSource?.analyzedNewestAt ?? null,
      telegramSourceMessages: telegramMessages.length,
      telegramSourceMedia: telegramMessages.filter(
        (message) => message?.mediaPath,
      ).length,
      telegramSources:
        telegramSources.length > 0
          ? telegramSources
          : Array.isArray(state.telegramSource?.sources)
            ? state.telegramSource.sources
            : [],
      xSourceStatus: liveX.status ?? state.xSource?.status ?? "unknown",
      xSourceLastSuccessAt:
        liveX.lastSuccessAt ?? state.xSource?.lastSuccessAt ?? null,
      xSourceNewestAt:
        liveX.newestAcceptedAt ?? state.xSource?.newestAcceptedAt ?? null,
      xSourceBudget: liveX.budget ?? state.xSource?.budget ?? null,
      reasoner:
        state.reasoner && typeof state.reasoner === "object"
          ? state.reasoner
          : null,
      ledger: readLedgerHealth(eventLedgerPath),
      activity:
        runtimeEvents.length > 0
          ? runtimeEvents
          : Array.isArray(state.activity)
            ? state.activity.slice(-60)
            : [],
      astroItems,
      liveEventCursor: runtimeEvents.at(-1)?.id ?? null,
      consecutiveFailures: Number(state.consecutiveFailures || 0),
      error: state.error ?? null,
    };
  } catch {
    return {
      ok: false,
      status: "starting",
      checkedAt: null,
      lastSuccessfulAt: null,
      forecastGeneratedAt: null,
      marketCandleAt: null,
      changed: false,
      runId: null,
      model: null,
      codexEntries: 0,
      codexMedia: 0,
      codexBuiltAt: null,
      telegramEnabled: false,
      telegramStatus: "disabled",
      telegramSourceStatus: "starting",
      telegramSourceLastSuccessAt: null,
      telegramSourceNewestAt: null,
      telegramSourceLastAnalyzedAt: null,
      telegramSourceAnalyzedNewestAt: null,
      telegramSourceMessages: 0,
      telegramSourceMedia: 0,
      telegramSources: [],
      xSourceStatus: "starting",
      xSourceLastSuccessAt: null,
      xSourceNewestAt: null,
      xSourceBudget: null,
      reasoner: null,
      ledger: readLedgerHealth(eventLedgerPath),
      activity: [],
      astroItems: [],
      liveEventCursor: null,
      consecutiveFailures: 0,
      error: "No completed VPS scan is available yet.",
    };
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || host}`);

  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end();
    return;
  }

  if (url.pathname === "/health") {
    const health = await currentHealth();
    response
      .writeHead(health.ok ? 200 : 503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify(health));
    return;
  }

  if (
    url.pathname !== "/signal" &&
    url.pathname !== "/history" &&
    url.pathname !== "/events"
  ) {
    response.writeHead(404).end();
    return;
  }
  if (!authorized(request)) {
    response.writeHead(401).end();
    return;
  }

  if (url.pathname === "/history") {
    try {
      const [history, thesis, review, index, autoresearch, forecast] =
        await Promise.all([
          readJson(historyPath),
          readJson(deepSeekThesisPath).catch(() => ({})),
          readJson(learningReviewPath).catch(() => ({})),
          readJson(codexIndexPath).catch(() => ({})),
          readJson(autoresearchPath).catch(() => ({})),
          readJson(forecastPath).catch(() => ({})),
        ]);
      const schoolAudit = buildSchoolAudit({
        thesis,
        review,
        index,
        autoresearch,
        history,
        forecast,
      });
      schoolAudit.systemSpine = readLedgerHealth(eventLedgerPath);
      response
        .writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        })
        .end(JSON.stringify({ ...history, schoolAudit }));
    } catch {
      response
        .writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        })
        .end(JSON.stringify({ updatedAt: null, daily: [], plays: [] }));
    }
    return;
  }

  if (url.pathname === "/events") {
    const health = await currentHealth();
    response
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store, max-age=0",
      })
      .end(
        JSON.stringify({
          status: health.status,
          checkedAt: health.checkedAt,
          runId: health.runId,
          telegramSourceStatus: health.telegramSourceStatus,
          telegramSourceLastSuccessAt: health.telegramSourceLastSuccessAt,
          telegramSourceNewestAt: health.telegramSourceNewestAt,
          telegramSourceMessages: health.telegramSourceMessages,
          telegramSourceMedia: health.telegramSourceMedia,
          telegramSources: health.telegramSources,
          xSourceStatus: health.xSourceStatus,
          xSourceLastSuccessAt: health.xSourceLastSuccessAt,
          xSourceNewestAt: health.xSourceNewestAt,
          xSourceBudget: health.xSourceBudget,
          reasoner: health.reasoner,
          activity: health.activity,
          astroItems: health.astroItems,
          liveEventCursor: health.liveEventCursor,
        }),
      );
    return;
  }

  try {
    const [forecast, health, history] = await Promise.all([
      readJson(forecastPath),
      currentHealth(),
      readJson(historyPath).catch(() => ({ hermesPredictions: [] })),
    ]);
    const hermesPredictions = Array.isArray(history.hermesPredictions)
      ? history.hermesPredictions
      : [];
    const behaviorPredictions = Array.isArray(history.behaviorPredictions)
      ? history.behaviorPredictions
      : [];
    const latestHermesPrediction = hermesPredictions.at(-1) ?? null;
    const latestBehaviorPrediction = behaviorPredictions.at(-1) ?? null;
    response
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(
        JSON.stringify({
          forecast,
          checkedAt: health.checkedAt,
          status: health.status,
          runId: health.runId,
          model: health.model,
          codexEntries: health.codexEntries,
          codexMedia: health.codexMedia,
          codexBuiltAt: health.codexBuiltAt,
          telegramEnabled: health.telegramEnabled,
          telegramStatus: health.telegramStatus,
          telegramSourceStatus: health.telegramSourceStatus,
          telegramSourceLastSuccessAt: health.telegramSourceLastSuccessAt,
          telegramSourceNewestAt: health.telegramSourceNewestAt,
          telegramSourceLastAnalyzedAt:
            health.telegramSourceLastAnalyzedAt,
          telegramSourceAnalyzedNewestAt:
            health.telegramSourceAnalyzedNewestAt,
          telegramSourceMessages: health.telegramSourceMessages,
          telegramSourceMedia: health.telegramSourceMedia,
          telegramSources: health.telegramSources,
          xSourceStatus: health.xSourceStatus,
          xSourceLastSuccessAt: health.xSourceLastSuccessAt,
          xSourceNewestAt: health.xSourceNewestAt,
          xSourceBudget: health.xSourceBudget,
          reasoner: health.reasoner,
          ledger: health.ledger,
          activity: health.activity,
          astroItems: health.astroItems,
          liveEventCursor: health.liveEventCursor,
          hermesAudit: latestHermesPrediction
            ? {
                id: latestHermesPrediction.id,
                marketStatus:
                  latestHermesPrediction.marketStatus ??
                  latestHermesPrediction.status,
                official: Boolean(latestHermesPrediction.official),
                integrity: latestHermesPrediction.integrity ?? "legacy",
                evaluationQuality:
                  latestHermesPrediction.evaluationQuality ?? "complete",
                createdAt: latestHermesPrediction.createdAt,
                resolvedAt: latestHermesPrediction.resolvedAt ?? null,
                direction: latestHermesPrediction.direction ?? null,
                summary:
                  latestHermesPrediction.summary ??
                  latestHermesPrediction.thesis ??
                  null,
                anchorPrice: latestHermesPrediction.anchorPrice,
                latestPrice: latestHermesPrediction.latestPrice,
                hitCheckpoints: Array.isArray(latestHermesPrediction.checkpoints)
                  ? latestHermesPrediction.checkpoints.filter(
                      (checkpoint) => checkpoint.hitAt,
                    ).length
                  : 0,
                totalCheckpoints: Array.isArray(
                  latestHermesPrediction.checkpoints,
                )
                  ? latestHermesPrediction.checkpoints.length
                  : 0,
                outcomeReason: latestHermesPrediction.outcomeReason ?? null,
                behaviorAction:
                  latestBehaviorPrediction?.behavior?.action ??
                  latestHermesPrediction.behavior?.action ??
                  null,
                behaviorStatus:
                  latestBehaviorPrediction?.behaviorOutcome?.status ??
                  latestHermesPrediction.behaviorOutcome?.status ??
                  "unscored",
              }
            : null,
          error: health.error,
        }),
      );
  } catch {
    response.writeHead(503).end();
  }
});

server.listen(port, host, () => {
  console.log(`Astro signal API listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
