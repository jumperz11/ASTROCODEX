import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateHermesPredictions,
  hermesLedgerSummary,
} from "./hermes-ledger.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const forecastPath = join(projectRoot, "public", "forecast.json");
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(projectRoot, ".astro-runtime");
const statePath = join(stateDirectory, "state.json");
const historyPath = join(stateDirectory, "history.json");
const trackRecordSeedPath = join(projectRoot, "app", "track-record.json");
const codexIndexPath =
  process.env.ASTRO_CODEX_INDEX?.trim() ||
  join(stateDirectory, "codex-index.json");
const grokModel = process.env.ASTRO_GROK_MODEL?.trim() || "grok-4.5";
const timeoutMs = Math.max(
  60_000,
  Number.parseInt(process.env.ASTRO_AGENT_TIMEOUT_MS || "210000", 10),
);
const researchPrompt =
  "Check @astronomer_zero's newest relevant public X posts and connected threads. Compare them with the latest accepted Astro Intelligence forecast. Call Astro Codex with at least three focused searches: the closest historical market phase, the closest position/execution sequence, and the closest behavior around the active trigger or silence. Apply the archived playbook and treat the three scenarios as a next-move prediction engine: each scenario must predict Astro's next observable behavior, be ordered highest probability first, and explicitly combine his best-supported current public position, retrieved Astro Codex behavior, distance to verified levels, and the supplied live market snapshot. Also rebuild the Hermes longer-horizon thesis on every material save: connect the supported current campaign to the expected transition and then the next days-to-weeks or macro campaign; include a specific retrieved learning note; never skip the confirmation required between phases or convert a future plan into a current signal. Hermes projection must be a stable, scoreable map rather than a decorative curve: choose a 24-to-2160-hour horizon, two to four ordered numeric checkpoints, a direction, confidence, and a numeric invalidation when evidence supports one. Do not move an existing checkpoint merely because live price approaches it; replace the map only when evidence changes, it is completed, invalidated, or expires. Save a forecast when new direct evidence materially changes the read, when the Hermes longer-horizon path materially changes, when the current Hermes audit becomes hit or wrong and needs a successor map, OR when verified market movement changes the leading predicted behavior, crosses a relevant Astro/model level, or shifts a scenario weight by at least 10 points. If the latest accepted forecast has no Hermes projection object, save one compatibility update even when the rest of the read is unchanged. A wrong Hermes map must be studied and replaced, never erased from the supplied audit ledger. Without a fresh direct update, cap the leading scenario and Hermes projection confidence at 70%. A model-only update may change scenarios, thesis, and Hermes while Astro is silent, but it must keep the confirmed signal at wait unless fresh direct evidence supports long, short, take_profit, exit, or conflict. Never turn archive similarity or market movement alone into a confirmed trade. Preserve exact direct status URLs and the separation between Astro evidence and inference. If nothing material changed, do not save.";

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
    candleAt: new Date(latest[0] * 1000).toISOString(),
    price: latestPrice,
    open24h,
    high24h,
    low24h,
    change24hPct: ((latestPrice - open24h) / open24h) * 100,
    weeklyOpen,
    distanceFromWeeklyOpenPct:
      ((latestPrice - weeklyOpen) / weeklyOpen) * 100,
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

function runAgent(market, trackRecord, hermesAudit) {
  return new Promise((resolve, reject) => {
    const { XAI_API_KEY: ignoredApiKey, ...oauthEnvironment } = process.env;
    void ignoredApiKey;
    const child = spawn(
      process.execPath,
      [
        join(scriptsDirectory, "run-astro-agent.mjs"),
        `${researchPrompt}

Verified Coinbase BTC-USD market snapshot (machine-supplied, not Astro evidence):
${JSON.stringify(market)}

Current audited track record (carry forward; change only with new direct evidence):
${JSON.stringify(trackRecord)}

Hermes prediction audit ledger (machine-scored; preserve failures and learn from them):
${JSON.stringify(hermesAudit)}

Use this snapshot only for the separate model thesis and thesisLevels. Keep Astro-confirmed levels in levels. Never present the market snapshot or model levels as Astro's words.`,
      ],
      {
        cwd: projectRoot,
        env: oauthEnvironment,
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

async function updateHistory({ checkedAt, changed, forecast, market }) {
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
  const hermesPredictions = evaluateHermesPredictions(
    history.hermesPredictions,
    market,
    checkedAt,
  );
  const projection = forecast?.hermes?.projection;
  if (
    forecastId &&
    projection &&
    !hermesPredictions.some((item) => item?.id === forecastId)
  ) {
    const createdMs = new Date(forecastId).getTime();
    const createdAt = Number.isFinite(createdMs) ? forecastId : checkedAt;
    hermesPredictions.push({
      id: forecastId,
      createdAt,
      resolvedAt: null,
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
      thesis: forecast.hermes.coreThesis,
      learningNote: forecast.hermes.learningNote,
      sources: forecast.sources ?? [],
    });
  }
  const hermesStats = hermesLedgerSummary(hermesPredictions);

  const seededTrackRecord = await readJson(trackRecordSeedPath);
  await writeJsonAtomic(historyPath, {
    updatedAt: checkedAt,
    daily: daily.slice(-365),
    plays: plays.slice(-500),
    hermesPredictions: hermesPredictions.slice(-500),
    hermesStats: {
      total: hermesStats.total,
      active: hermesStats.active,
      hits: hermesStats.hits,
      wrong: hermesStats.wrong,
      resolved: hermesStats.resolved,
      hitRate: hermesStats.hitRate,
    },
    trackRecord:
      forecast?.trackRecord ?? history.trackRecord ?? seededTrackRecord ?? null,
  });
}

const previous = await readJson(statePath, {});
const runId = randomUUID();
const startedAt = new Date().toISOString();
await writeState({
  ...previous,
  runId,
  model: grokModel,
  status: "checking",
  startedAt,
  error: null,
});

try {
  const [market, codex] = await Promise.all([
    verifyMarketFeed(),
    verifyCodexIndex(),
  ]);
  const currentHistory = await readJson(historyPath, {});
  const currentTrackRecord =
    currentHistory?.trackRecord ?? (await readJson(trackRecordSeedPath, null));
  const evaluatedHermesPredictions = evaluateHermesPredictions(
    currentHistory?.hermesPredictions,
    market,
    startedAt,
  );
  const currentHermesAudit = hermesLedgerSummary(evaluatedHermesPredictions);
  const before = await stat(forecastPath)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  const result = await runAgent(market, currentTrackRecord, currentHermesAudit);
  const after = await stat(forecastPath)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  const noChange =
    result.output.includes("no new forecast saved") ||
    result.output.includes("without saving a newly validated forecast");

  if (result.signal) {
    throw new Error(`Astro agent exceeded its time limit (${result.signal}).`);
  }
  if (result.code !== 0 && !noChange) {
    if (/oauth|login|unauthorized|authentication/i.test(result.output)) {
      throw new Error("Grok OAuth needs login again on the VPS.");
    }
    throw new Error("Astro agent failed; the last validated signal remains live.");
  }

  const finishedAt = new Date().toISOString();
  const forecast = await readJson(forecastPath);
  const changed = after > before;
  await updateHistory({ checkedAt: finishedAt, changed, forecast, market });
  await writeState({
    runId,
    model: grokModel,
    codex,
    status: "healthy",
    startedAt,
    finishedAt,
    checkedAt: finishedAt,
    lastSuccessfulAt: finishedAt,
    lastChangedAt: changed ? finishedAt : previous.lastChangedAt ?? null,
    forecastGeneratedAt: forecast?.generatedAt ?? null,
    marketCandleAt: market.candleAt,
    changed,
    consecutiveFailures: 0,
    error: null,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "healthy",
      runId,
      model: grokModel,
      codexEntries: codex.entries,
      checkedAt: finishedAt,
      changed,
    })}\n`,
  );
} catch (error) {
  const finishedAt = new Date().toISOString();
  const message =
    error instanceof Error ? error.message : "Unknown Astro scan failure.";
  await writeState({
    ...previous,
    runId,
    model: grokModel,
    status: "error",
    startedAt,
    finishedAt,
    checkedAt: previous.checkedAt ?? null,
    lastSuccessfulAt: previous.lastSuccessfulAt ?? null,
    consecutiveFailures: Number(previous.consecutiveFailures || 0) + 1,
    error: message,
  });
  process.stderr.write(
    `${JSON.stringify({ status: "error", finishedAt, error: message })}\n`,
  );
  process.exitCode = 1;
}
