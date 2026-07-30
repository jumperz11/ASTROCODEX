import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const forecastPath = join(projectRoot, "public", "forecast.json");
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(projectRoot, ".astro-runtime");
const statePath = join(stateDirectory, "state.json");
const historyPath = join(stateDirectory, "history.json");
const codexIndexPath =
  process.env.ASTRO_CODEX_INDEX?.trim() ||
  join(stateDirectory, "codex-index.json");
const grokModel = process.env.ASTRO_GROK_MODEL?.trim() || "grok-4.5";
const timeoutMs = Math.max(
  60_000,
  Number.parseInt(process.env.ASTRO_AGENT_TIMEOUT_MS || "105000", 10),
);
const researchPrompt =
  "Check @astronomer_zero's newest relevant public X posts and connected threads. Compare them with the latest accepted Astro Intelligence forecast. Apply the archived playbook and save a forecast only if new direct evidence or a material change alters his best-supported position, what he is watching, likely playbook action, invalidation, scenarios, confidence, execution map, Astro-derived chart levels, plain-language signal state, or the separate forward model thesis. If the latest accepted forecast does not yet contain thesis and thesisLevels, save one compatibility upgrade using the existing direct evidence plus the verified market snapshot; do not invent new Astro evidence. Use exact direct status URLs and keep the compact decision fields terse. If nothing material changed and the latest forecast is already complete, do not save.";

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

function runAgent(market) {
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

  await writeJsonAtomic(historyPath, {
    updatedAt: checkedAt,
    daily: daily.slice(-365),
    plays: plays.slice(-500),
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
  const before = await stat(forecastPath)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  const result = await runAgent(market);
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
