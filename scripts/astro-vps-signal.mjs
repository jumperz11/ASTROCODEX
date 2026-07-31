import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const forecastPath = join(projectRoot, "public", "forecast.json");
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(projectRoot, ".astro-runtime");
const statePath = join(stateDirectory, "state.json");
const historyPath = join(stateDirectory, "history.json");
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

async function currentHealth() {
  try {
    const state = await readJson(statePath);
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

  if (url.pathname !== "/signal" && url.pathname !== "/history") {
    response.writeHead(404).end();
    return;
  }
  if (!authorized(request)) {
    response.writeHead(401).end();
    return;
  }

  if (url.pathname === "/history") {
    try {
      const history = await readJson(historyPath);
      response
        .writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        })
        .end(JSON.stringify(history));
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

  try {
    const [forecast, health] = await Promise.all([
      readJson(forecastPath),
      currentHealth(),
    ]);
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
