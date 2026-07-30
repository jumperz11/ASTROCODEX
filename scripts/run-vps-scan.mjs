import { spawn } from "node:child_process";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const forecastPath = join(projectRoot, "public", "forecast.json");
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(projectRoot, ".astro-runtime");
const statePath = join(stateDirectory, "state.json");
const timeoutMs = Math.max(
  60_000,
  Number.parseInt(process.env.ASTRO_AGENT_TIMEOUT_MS || "105000", 10),
);
const researchPrompt =
  "Check @astronomer_zero's newest relevant public X posts and connected threads. Compare them with the latest accepted Astro Intelligence forecast. Apply the archived playbook and save a forecast only if new direct evidence or a material change alters his best-supported position, what he is watching, likely playbook action, invalidation, scenarios, confidence, execution map, Astro-derived chart levels, or plain-language signal state. Use exact direct status URLs and keep the compact decision fields terse. If nothing material changed, do not save.";

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeState(state) {
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
}

async function verifyMarketFeed() {
  const response = await fetch(
    "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300",
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
  return new Date(Number(candles[0][0]) * 1000).toISOString();
}

function runAgent() {
  return new Promise((resolve, reject) => {
    const { XAI_API_KEY: ignoredApiKey, ...oauthEnvironment } = process.env;
    void ignoredApiKey;
    const child = spawn(
      process.execPath,
      [join(scriptsDirectory, "run-astro-agent.mjs"), researchPrompt],
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

const previous = await readJson(statePath, {});
const startedAt = new Date().toISOString();
await writeState({
  ...previous,
  status: "checking",
  startedAt,
  error: null,
});

try {
  const marketCandleAt = await verifyMarketFeed();
  const before = await stat(forecastPath)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  const result = await runAgent();
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
  await writeState({
    status: "healthy",
    startedAt,
    finishedAt,
    checkedAt: finishedAt,
    lastSuccessfulAt: finishedAt,
    lastChangedAt: changed ? finishedAt : previous.lastChangedAt ?? null,
    forecastGeneratedAt: forecast?.generatedAt ?? null,
    marketCandleAt,
    changed,
    consecutiveFailures: 0,
    error: null,
  });
  process.stdout.write(
    `${JSON.stringify({ status: "healthy", checkedAt: finishedAt, changed })}\n`,
  );
} catch (error) {
  const finishedAt = new Date().toISOString();
  const message =
    error instanceof Error ? error.message : "Unknown Astro scan failure.";
  await writeState({
    ...previous,
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
