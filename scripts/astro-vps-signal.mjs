import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const forecastPath = join(projectRoot, "public", "forecast.json");
const signalToken = process.env.ASTRO_SIGNAL_TOKEN?.trim() ?? "";
const host = process.env.ASTRO_SIGNAL_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.ASTRO_SIGNAL_PORT || "8789", 10);
const requestedInterval = Number.parseInt(
  process.env.ASTRO_CHECK_INTERVAL_MS || "120000",
  10,
);
const intervalMs = Math.max(120_000, requestedInterval);
const researchPrompt =
  "Check @astronomer_zero's newest relevant public X posts and connected threads. Compare them with the latest accepted Astro Intelligence forecast. Apply the archived playbook and save a forecast only if new direct evidence or a material change alters his best-supported position, what he is watching, likely playbook action, invalidation, scenarios, confidence, execution map, Astro-derived chart levels, or plain-language signal state. Use exact direct status URLs and keep the compact decision fields terse. If nothing material changed, do not save.";

if (signalToken.length < 32) {
  throw new Error(
    "ASTRO_SIGNAL_TOKEN must be a random secret containing at least 32 characters.",
  );
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("ASTRO_SIGNAL_PORT must be a valid TCP port.");
}

let checkedAt = null;
let checkStatus = "starting";
let lastError = null;
let timer = null;

function authorized(request) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBuffer = Buffer.from(signalToken);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

async function readForecast() {
  return JSON.parse(await readFile(forecastPath, "utf8"));
}

function runAstroCheck() {
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
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const noChange =
        output.includes("no new forecast saved") ||
        output.includes("without saving a newly validated forecast");
      if (code === 0 || noChange) {
        resolve();
        return;
      }
      if (/oauth|login|unauthorized|authentication/i.test(output)) {
        reject(new Error("Grok OAuth needs login again."));
        return;
      }
      reject(new Error("Astro check failed; the last valid signal is still served."));
    });
  });
}

async function checkLoop() {
  checkStatus = "checking";
  try {
    await runAstroCheck();
    checkedAt = new Date().toISOString();
    checkStatus = "healthy";
    lastError = null;
  } catch (error) {
    checkStatus = "error";
    lastError = error instanceof Error ? error.message : "Astro check failed.";
  } finally {
    timer = setTimeout(() => void checkLoop(), intervalMs);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || host}`);

  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end();
    return;
  }

  if (url.pathname === "/health") {
    response
      .writeHead(checkStatus === "error" ? 503 : 200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify({ status: checkStatus, checkedAt }));
    return;
  }

  if (url.pathname !== "/signal") {
    response.writeHead(404).end();
    return;
  }
  if (!authorized(request)) {
    response.writeHead(401).end();
    return;
  }

  try {
    const forecast = await readForecast();
    response
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(
        JSON.stringify({
          forecast,
          checkedAt,
          status: checkStatus,
          error: lastError,
        }),
      );
  } catch {
    response.writeHead(503).end();
  }
});

server.listen(port, host, () => {
  console.log(`Astro signal service listening on http://${host}:${port}`);
  void checkLoop();
});

function shutdown() {
  if (timer) clearTimeout(timer);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
