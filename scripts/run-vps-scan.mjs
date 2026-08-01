import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitmentHash,
  evaluateHermesPredictions,
  HERMES_SCORING_VERSION,
  hermesLedgerSummary,
  supersedeActivePredictions,
} from "./hermes-ledger.mjs";
import { notifyTelegram } from "./telegram-notifier.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const forecastPath =
  process.env.ASTRO_FORECAST_PATH?.trim() ||
  join(projectRoot, "public", "forecast.json");
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(projectRoot, ".astro-runtime");
const statePath = join(stateDirectory, "state.json");
const historyPath = join(stateDirectory, "history.json");
const telegramSourcePath =
  process.env.ASTRO_TELEGRAM_SOURCE_PATH?.trim() ||
  join(stateDirectory, "telegram-source.json");
const xSourcePath =
  process.env.ASTRO_X_SOURCE_PATH?.trim() ||
  join(stateDirectory, "x-source.json");
const trackRecordSeedPath = join(projectRoot, "app", "track-record.json");
const codexIndexPath =
  process.env.ASTRO_CODEX_INDEX?.trim() ||
  join(stateDirectory, "codex-index.json");
const deepSeekThesisPath = join(stateDirectory, "deepseek-thesis.json");
const reasoningModel =
  process.env.ASTRO_CODEX_MODEL?.trim() || "codex-luna";
const timeoutMs = Math.max(
  60_000,
  Number.parseInt(process.env.ASTRO_AGENT_TIMEOUT_MS || "210000", 10),
);
const researchPrompt =
  "Check @astronomer_zero's newest relevant public X posts and connected threads. Compare them with the latest accepted Astro Intelligence forecast. Call Astro Codex with at least three focused searches: the closest historical market phase, the closest position/execution sequence, and the closest behavior around the active trigger or silence. Apply the archived playbook and treat the three scenarios as a next-move prediction engine: each scenario must predict Astro's next observable behavior, be ordered highest probability first, and explicitly combine his best-supported current public position, retrieved Astro Codex behavior, distance to verified levels, and the supplied live market snapshot. Also rebuild the Hermes longer-horizon thesis on every material save: connect the supported current campaign to the expected transition and then the next days-to-weeks or macro campaign; include a specific retrieved learning note; never skip the confirmation required between phases or convert a future plan into a current signal. Hermes projection must be a stable, scoreable map rather than a decorative curve: set scoringVersion 2; choose a 24-to-2160-hour horizon, two to four ordered numeric checkpoints, a direction, confidence, a numeric invalidation when evidence supports one, and one frozen next-observable Astro behavior with its own 1-to-720-hour horizon. Do not move an existing checkpoint merely because live price approaches it; replace the map only when evidence changes, it is completed, invalidated, expires, or is explicitly superseded. Save a forecast when new direct evidence materially changes the read, when the Hermes longer-horizon path materially changes, when the current Hermes audit resolves and needs a successor map, OR when verified market movement changes the leading predicted behavior, crosses a relevant Astro/model level, or shifts a scenario weight by at least 10 points. A failed, partial, expired, or superseded Hermes map must be studied and replaced, never erased from the supplied audit ledger. Without a fresh direct update, cap the leading scenario and Hermes projection confidence at 70%. A model-only update may change scenarios, thesis, and Hermes while Astro is silent, but it must keep the confirmed signal at wait unless fresh direct evidence supports long, short, take_profit, exit, or conflict. Never turn archive similarity or market movement alone into a confirmed trade. Preserve exact direct status URLs, exact evidence timestamps when available, and the separation between Astro evidence and inference. If nothing material changed, do not save.";

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

async function writeState(state) {
  await writeJsonAtomic(statePath, state);
}

function nextActivity(existing, event) {
  const activity = Array.isArray(existing) ? existing : [];
  return [
    ...activity,
    {
      at: new Date().toISOString(),
      ...event,
    },
  ].slice(-60);
}

function forecastSemanticHash(forecast) {
  if (!forecast || typeof forecast !== "object") return "missing";
  const { generatedAt: ignoredGeneratedAt, mode: ignoredMode, ...semantic } =
    forecast;
  void ignoredGeneratedAt;
  void ignoredMode;
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(semantic)))
    .digest("hex");
}

function ledgerTriggerSignature(predictions) {
  return JSON.stringify(
    (Array.isArray(predictions) ? predictions : []).map((prediction) => ({
      id: prediction?.id,
      marketStatus: prediction?.marketStatus ?? prediction?.status,
      hits: Array.isArray(prediction?.checkpoints)
        ? prediction.checkpoints.filter((checkpoint) => checkpoint.hitAt).length
        : 0,
      behaviorStatus: prediction?.behaviorOutcome?.status ?? "unscored",
    })),
  );
}

async function telegramSourceSummary() {
  const source = await readJson(telegramSourcePath, {});
  const messages = Array.isArray(source?.messages) ? source.messages : [];
  const discoveredChats = Array.isArray(source?.discoveredChats)
    ? source.discoveredChats
    : [];
  const allowedChats = discoveredChats
    .filter((chat) => chat?.allowed)
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      type: chat.type,
      lastMessageAt: chat.lastMessageAt ?? null,
      messageCount: Number(chat.messageCount || 0),
      mediaCount: Number(chat.mediaCount || 0),
    }));
  const lastSuccessAt = source?.lastSuccessAt ?? source?.updatedAt ?? null;
  const lastSuccessMs = new Date(lastSuccessAt || 0).getTime();
  const stale =
    !Number.isFinite(lastSuccessMs) ||
    Date.now() - lastSuccessMs > 2 * 60_000;
  if (
    source?.mode !== "telegram-user-read-only" ||
    source?.status === "error" ||
    stale ||
    allowedChats.length !== 2
  ) {
    throw new Error(
      `Approved Telegram ingestion is unhealthy: ${
        source?.error ||
        (stale ? "source polling is stale" : "exactly two sources are required")
      }.`,
    );
  }
  return {
    path: telegramSourcePath,
    status: "healthy",
    lastSuccessAt,
    stale: false,
    newestAcceptedAt: source?.newestAcceptedAt ?? null,
    messageCount: messages.length,
    mediaCount: messages.filter((message) => message?.mediaPath).length,
    allowedChats,
  };
}

async function xSourceSummary() {
  const source = await readJson(xSourcePath, {});
  const posts = Array.isArray(source?.posts) ? source.posts : [];
  return {
    path: xSourcePath,
    status: source?.status ?? "missing",
    provider: source?.provider ?? "grok-oauth",
    checkedAt: source?.checkedAt ?? null,
    lastSuccessAt: source?.lastSuccessAt ?? null,
    newestAcceptedAt: source?.newestAcceptedAt ?? null,
    newestStatusId: source?.newestStatusId ?? null,
    postCount: posts.length,
    budget: source?.budget ?? null,
    error: source?.error ?? null,
  };
}

async function fetchCandles(granularity) {
  const response = await fetch(
    `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${granularity}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Astro-Intelligence/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Coinbase market feed returned HTTP ${response.status}.`);
  }
  const candles = await response.json();
  if (
    !Array.isArray(candles) ||
    candles.length === 0 ||
    !candles.every(
      (candle) =>
        Array.isArray(candle) &&
        candle.length >= 6 &&
        candle.slice(0, 6).every(Number.isFinite),
    )
  ) {
    throw new Error("Coinbase market feed returned invalid candles.");
  }
  return candles
    .map((candle) => candle.slice(0, 6).map(Number))
    .sort((left, right) => left[0] - right[0]);
}

function startOfUtcWeek(now = new Date()) {
  const day = now.getUTCDay() || 7;
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - day + 1,
  );
}

async function verifyMarketFeed() {
  const [fiveMinute, hourly] = await Promise.all([
    fetchCandles(300),
    fetchCandles(3600),
  ]);
  const latest = fiveMinute.at(-1);
  const first24h = fiveMinute[Math.max(0, fiveMinute.length - 288)];
  const window24h = fiveMinute.slice(-288);
  const weekStartSeconds = Math.floor(startOfUtcWeek() / 1000);
  const weeklyOpenCandle =
    hourly.find((candle) => candle[0] >= weekStartSeconds) ?? hourly[0];
  const latestPrice = latest[4];
  const open24h = first24h[3];
  const high24h = Math.max(...window24h.map((candle) => candle[2]));
  const low24h = Math.min(...window24h.map((candle) => candle[1]));
  const weeklyOpen = weeklyOpenCandle[3];

  return {
    snapshot: {
      candleAt: new Date(latest[0] * 1000).toISOString(),
      price: latestPrice,
      open24h,
      high24h,
      low24h,
      change24hPct: ((latestPrice - open24h) / open24h) * 100,
      weeklyOpen,
      distanceFromWeeklyOpenPct:
        ((latestPrice - weeklyOpen) / weeklyOpen) * 100,
    },
    candles: fiveMinute,
  };
}

async function verifyCodexIndex() {
  const index = await readJson(codexIndexPath);
  if (
    !index ||
    index.version !== 1 ||
    !Number.isInteger(index.entryCount) ||
    index.entryCount < 10 ||
    !Array.isArray(index.entries) ||
    index.entries.length !== index.entryCount
  ) {
    throw new Error("Astro Codex memory index is missing or invalid.");
  }
  return {
    builtAt: index.builtAt ?? null,
    entries: index.entryCount,
    media: Number(index.mediaCount || 0),
  };
}

async function deepSeekBackgroundSummary() {
  const thesis = await readJson(deepSeekThesisPath, {});
  const updatedMs = new Date(thesis?.updatedAt || 0).getTime();
  const stale =
    !Number.isFinite(updatedMs) || Date.now() - updatedMs > 8 * 3_600_000;
  return {
    status:
      thesis?.status === "healthy" && !stale
        ? "healthy"
        : thesis?.status || "warming_up",
    updatedAt: thesis?.updatedAt ?? null,
    checkedAt: thesis?.checkedAt ?? null,
    work: thesis?.work ?? null,
    provider: thesis?.provider ?? null,
    stale,
    school: thesis?.school ?? null,
    thesis: thesis?.thesis
      ? {
          campaign: thesis.thesis.campaign ?? null,
          nextBehaviors: thesis.thesis.nextBehaviors ?? [],
          contradictions: thesis.thesis.contradictions ?? [],
          unknowns: thesis.thesis.unknowns ?? [],
        }
      : null,
    error: thesis?.error ?? null,
  };
}

function runAgent(
  market,
  trackRecord,
  hermesAudit,
  telegramSources,
  xSources,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(scriptsDirectory, "run-luna-agent.mjs"),
        `${researchPrompt}

Verified Coinbase BTC-USD market snapshot (machine-supplied, not Astro evidence):
${JSON.stringify(market)}

Current audited track record (carry forward; change only with new direct evidence):
${JSON.stringify(trackRecord)}

Hermes prediction audit ledger (machine-scored; preserve failures and learn from them):
${JSON.stringify(hermesAudit)}

Private Telegram source ledger (private direct context; never present as a public X quote):
${JSON.stringify(telegramSources)}

Grok X scout ledger (direct public evidence transport only):
${JSON.stringify(xSources)}

When messageCount is positive, read the JSON ledger at the supplied path and inspect recent allowlisted messages and referenced local chart media. Use them to improve Hermes scenarios, target mapping, and behavioral context. Do not reproduce paid message text in the saved public-facing summary. A Telegram-only claim may affect Hermes inference, but it cannot become public Astro evidence or create a confirmed public signal unless an exact public X status corroborates it.

Use this snapshot only for the separate model thesis and thesisLevels. Keep Astro-confirmed levels in levels. Never present the market snapshot or model levels as Astro's words.`,
      ],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    const collect = (chunk) => {
      output = `${output}${String(chunk)}`.slice(-65_536);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    timeout.unref();

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, output, signal });
    });
  });
}

async function updateHistory({
  checkedAt,
  changed,
  forecast,
  market,
  candles,
}) {
  const history = await readJson(historyPath, {
    updatedAt: null,
    daily: [],
    plays: [],
  });
  const date = checkedAt.slice(0, 10);
  const snapshot = {
    date,
    checkedAt,
    changed,
    market,
    forecast: {
      generatedAt: forecast?.generatedAt ?? null,
      confidence: forecast?.confidence ?? null,
      decision: forecast?.decision ?? null,
      signal: forecast?.signal ?? null,
      execution: forecast?.execution ?? null,
      thesis: forecast?.thesis ?? null,
      hermes: forecast?.hermes ?? null,
      levels: forecast?.levels ?? [],
      thesisLevels: forecast?.thesisLevels ?? [],
      scenarios: forecast?.scenarios ?? [],
      sources: forecast?.sources ?? [],
    },
  };
  const daily = Array.isArray(history.daily)
    ? history.daily.filter((item) => item?.date !== date)
    : [];
  daily.push(snapshot);
  daily.sort((left, right) => left.date.localeCompare(right.date));

  const plays = Array.isArray(history.plays) ? history.plays : [];
  const forecastId = forecast?.generatedAt ?? null;
  if (
    forecastId &&
    (changed || !plays.some((item) => item?.id === forecastId))
  ) {
    plays.push({
      id: forecastId,
      recordedAt: checkedAt,
      market,
      forecast: snapshot.forecast,
    });
  }
  let hermesPredictions = evaluateHermesPredictions(
    history.hermesPredictions,
    market,
    checkedAt,
    candles,
    forecast?.evidence,
  );
  const projection = forecast?.hermes?.projection;
  if (
    forecastId &&
    projection &&
    !hermesPredictions.some((item) => item?.id === forecastId)
  ) {
    const createdMs = new Date(forecastId).getTime();
    const createdAt = Number.isFinite(createdMs) ? forecastId : checkedAt;
    hermesPredictions = supersedeActivePredictions(
      hermesPredictions,
      forecastId,
      checkedAt,
    );
    const scoringVersion = Number(projection.scoringVersion || 1);
    const official =
      scoringVersion === HERMES_SCORING_VERSION &&
      Boolean(projection.behavior);
    const prediction = {
      id: forecastId,
      scoringVersion,
      official,
      evaluationQuality: "complete",
      createdAt,
      resolvedAt: null,
      marketStatus: "active",
      status: "active",
      outcomeReason: null,
      anchorPrice: market.price,
      latestPrice: market.price,
      maxObservedPrice: market.price,
      minObservedPrice: market.price,
      direction: projection.direction,
      confidence: projection.confidence,
      horizonHours: projection.horizonHours,
      horizonEndsAt: new Date(
        new Date(createdAt).getTime() + projection.horizonHours * 3_600_000,
      ).toISOString(),
      checkpoints: projection.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        hitAt: null,
        hitPrice: null,
      })),
      invalidation: projection.invalidation,
      behavior: projection.behavior ?? null,
      behaviorOutcome: {
        status: projection.behavior ? "active" : "unscored",
        resolvedAt: null,
        reason: projection.behavior
          ? null
          : "Experimental map predates official behavior scoring.",
        matchedSource: null,
      },
      thesis: forecast.hermes.coreThesis,
      learningNote: forecast.hermes.learningNote,
      sources: forecast.sources ?? [],
      lastEvaluatedCandleAt: Math.floor(new Date(createdAt).getTime() / 1000) - 1,
    };
    prediction.commitmentHash = commitmentHash(prediction);
    prediction.integrity = official ? "valid" : "legacy";
    hermesPredictions.push(prediction);
  }
  const hermesStats = hermesLedgerSummary(hermesPredictions);

  const seededTrackRecord = await readJson(trackRecordSeedPath);
  const nextHistory = {
    updatedAt: checkedAt,
    daily: daily.slice(-365),
    plays: plays.slice(-500),
    hermesPredictions: hermesPredictions.slice(-500),
    hermesStats: {
      total: hermesStats.total,
      experimental: hermesStats.experimental,
      active: hermesStats.active,
      market: hermesStats.market,
      behavior: hermesStats.behavior,
    },
    trackRecord:
      forecast?.trackRecord ?? history.trackRecord ?? seededTrackRecord ?? null,
  };
  await writeJsonAtomic(historyPath, nextHistory);
  return nextHistory;
}

const previous = await readJson(statePath, {});
const runId = randomUUID();
const startedAt = new Date().toISOString();
let activity = nextActivity(previous.activity, {
  runId,
  stage: "scan",
  status: "working",
  title: "Started a new evidence check",
  detail: "Checking approved Astro sources, market data, and saved forecasts.",
});
await writeState({
  ...previous,
  runId,
  model: reasoningModel,
  status: "checking",
  startedAt,
  activity,
  error: null,
});

try {
  const [marketFeed, codex, telegramSources, xSources, deepSeek] =
    await Promise.all([
    verifyMarketFeed(),
    verifyCodexIndex(),
    telegramSourceSummary(),
    xSourceSummary(),
    deepSeekBackgroundSummary(),
  ]);
  const market = marketFeed.snapshot;
  const candles = marketFeed.candles;
  activity = nextActivity(activity, {
    runId,
    stage: "inputs",
    status: "done",
    title: "Inputs verified",
    detail: `${telegramSources.allowedChats.length}/2 Astro channels healthy · ${telegramSources.messageCount} recent messages · DeepSeek school ${deepSeek.school?.processed ?? 0}/${deepSeek.school?.total ?? codex.entries} · BTC $${Math.round(market.price).toLocaleString("en-US")}.`,
  });
  const currentHistory = await readJson(historyPath, {});
  const currentTrackRecord =
    currentHistory?.trackRecord ?? (await readJson(trackRecordSeedPath, null));
  const evaluatedHermesPredictions = evaluateHermesPredictions(
    currentHistory?.hermesPredictions,
    market,
    startedAt,
    candles,
    (await readJson(forecastPath))?.evidence,
  );
  const currentHermesAudit = hermesLedgerSummary(evaluatedHermesPredictions);
  const ledgerChanged =
    ledgerTriggerSignature(currentHistory?.hermesPredictions) !==
    ledgerTriggerSignature(evaluatedHermesPredictions);
  const previousMarketPrice = Number(previous.marketPrice);
  const materialPriceMove =
    Number.isFinite(previousMarketPrice) &&
    Math.abs(market.price - previousMarketPrice) / previousMarketPrice >= 0.0075;
  const telegramChanged =
    Boolean(telegramSources.newestAcceptedAt) &&
    telegramSources.newestAcceptedAt !== previous.telegramSourceUpdatedAt;
  const xChanged =
    Boolean(xSources.newestAcceptedAt) &&
    xSources.newestAcceptedAt !== previous.xSourceUpdatedAt;
  const existingForecast = await readJson(forecastPath);
  const shouldRunAgent =
    ledgerChanged ||
    materialPriceMove ||
    telegramChanged ||
    xChanged ||
    process.env.ASTRO_FORCE_REASONER === "1" ||
    !existingForecast;

  if (!shouldRunAgent) {
    const finishedAt = new Date().toISOString();
    const nextHistory = await updateHistory({
      checkedAt: finishedAt,
      changed: false,
      forecast: existingForecast,
      market,
      candles,
    });
    const telegram = await notifyTelegram({
      forecast: existingForecast,
      history: nextHistory,
      market,
      previous: previous.telegram,
    });
    activity = nextActivity(activity, {
      runId,
      stage: "decision",
      status: "quiet",
      title: "No material trigger",
      detail: "No new Astro evidence or market change required a full Hermes rebuild.",
    });
    await writeState({
      ...previous,
      runId,
      model: reasoningModel,
      codex,
      deepSeek,
      status: "healthy",
      startedAt,
      finishedAt,
      checkedAt: finishedAt,
      lastSuccessfulAt: finishedAt,
      forecastGeneratedAt: existingForecast?.generatedAt ?? null,
      marketCandleAt: market.candleAt,
      marketPrice: market.price,
      telegramSourceUpdatedAt: telegramSources.newestAcceptedAt,
      telegramSource: {
        status: telegramSources.status,
        lastSuccessAt: telegramSources.lastSuccessAt,
        newestAcceptedAt: telegramSources.newestAcceptedAt,
        messageCount: telegramSources.messageCount,
        mediaCount: telegramSources.mediaCount,
        sources: telegramSources.allowedChats,
        lastAnalyzedAt: previous.telegramSource?.lastAnalyzedAt ?? null,
        analyzedNewestAt: previous.telegramSource?.analyzedNewestAt ?? null,
      },
      xSourceUpdatedAt: xSources.newestAcceptedAt,
      xSource: xSources,
      changed: false,
      agentRun: false,
      activity,
      telegram,
      consecutiveFailures: 0,
      error: null,
    });
    process.stdout.write(
      `${JSON.stringify({
        status: "healthy",
        runId,
        model: reasoningModel,
        checkedAt: finishedAt,
        changed: false,
        agentRun: false,
      })}\n`,
    );
    process.exit(0);
  }
  activity = nextActivity(activity, {
    runId,
    stage: "hermes",
    status: "working",
    title: "Hermes is analyzing",
    detail:
      "Comparing the newest accepted evidence with Astro history, the active playbook, and live market structure.",
  });
  await writeState({
    ...previous,
    runId,
    model: reasoningModel,
    codex,
    deepSeek,
    status: "analyzing",
    startedAt,
    telegramSource: {
      status: telegramSources.status,
      lastSuccessAt: telegramSources.lastSuccessAt,
      newestAcceptedAt: telegramSources.newestAcceptedAt,
      messageCount: telegramSources.messageCount,
      mediaCount: telegramSources.mediaCount,
      sources: telegramSources.allowedChats,
      lastAnalyzedAt: previous.telegramSource?.lastAnalyzedAt ?? null,
      analyzedNewestAt: previous.telegramSource?.analyzedNewestAt ?? null,
    },
    xSource: xSources,
    activity,
    error: null,
  });
  const beforeForecast = await readJson(forecastPath);
  const beforeHash = forecastSemanticHash(beforeForecast);
  const result = await runAgent(
    market,
    currentTrackRecord,
    currentHermesAudit,
    telegramSources,
    xSources,
  );
  const forecast = await readJson(forecastPath);
  const afterHash = forecastSemanticHash(forecast);
  const changed = afterHash !== beforeHash;

  if (result.signal) {
    throw new Error(`Astro agent exceeded its time limit (${result.signal}).`);
  }
  if (result.code !== 0) {
    if (!changed) {
      throw new Error(
        "Luna failed without a newly validated forecast; the last signal remains live.",
      );
    }
  }
  const providerResult = result.output
    .split(/\r?\n/)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find(Boolean);

  const finishedAt = new Date().toISOString();
  const nextHistory = await updateHistory({
    checkedAt: finishedAt,
    changed,
    forecast,
    market,
    candles,
  });
  const telegram = await notifyTelegram({
    forecast,
    history: nextHistory,
    market,
    previous: previous.telegram,
  });
  activity = nextActivity(activity, {
    runId,
    stage: "decision",
    status: changed ? "done" : "quiet",
    title: changed ? "Forecast updated" : "Analysis complete · no change",
    detail: changed
      ? "New evidence materially changed the accepted dashboard read."
      : "Hermes found no material reason to replace the accepted forecast.",
  });
  await writeState({
    runId,
    model: reasoningModel,
    codex,
    deepSeek,
    status: "healthy",
    startedAt,
    finishedAt,
    checkedAt: finishedAt,
    lastSuccessfulAt: finishedAt,
    lastChangedAt: changed ? finishedAt : previous.lastChangedAt ?? null,
    forecastGeneratedAt: forecast?.generatedAt ?? null,
    marketCandleAt: market.candleAt,
    marketPrice: market.price,
    telegramSourceUpdatedAt: telegramSources.newestAcceptedAt,
    telegramSource: {
      status: telegramSources.status,
      lastSuccessAt: telegramSources.lastSuccessAt,
      newestAcceptedAt: telegramSources.newestAcceptedAt,
      messageCount: telegramSources.messageCount,
      mediaCount: telegramSources.mediaCount,
      sources: telegramSources.allowedChats,
      lastAnalyzedAt: finishedAt,
      analyzedNewestAt: telegramSources.newestAcceptedAt,
    },
    xSourceUpdatedAt: xSources.newestAcceptedAt,
    xSource: xSources,
    reasoner: providerResult ?? {
      status: "unknown",
      provider: "codex-luna",
    },
    changed,
    agentRun: true,
    lastAgentAt: finishedAt,
    activity,
    telegram,
    consecutiveFailures: 0,
    error: null,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "healthy",
      runId,
      model: reasoningModel,
      codexEntries: codex.entries,
      checkedAt: finishedAt,
      changed,
    })}\n`,
  );
} catch (error) {
  const finishedAt = new Date().toISOString();
  const message =
    error instanceof Error ? error.message : "Unknown Astro scan failure.";
  activity = nextActivity(activity, {
    runId,
    stage: "error",
    status: "error",
    title: "Evidence check failed",
    detail: message,
  });
  await writeState({
    ...previous,
    runId,
    model: reasoningModel,
    status: "error",
    startedAt,
    finishedAt,
    checkedAt: previous.checkedAt ?? null,
    lastSuccessfulAt: previous.lastSuccessfulAt ?? null,
    activity,
    consecutiveFailures: Number(previous.consecutiveFailures || 0) + 1,
    error: message,
  });
  process.stderr.write(
    `${JSON.stringify({ status: "error", finishedAt, error: message })}\n`,
  );
  process.exitCode = 1;
}
