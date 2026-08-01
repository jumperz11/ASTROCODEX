import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { consumeBudget } from "./provider-budget.mjs";
import { parseScoutOutput } from "./x-scout-parser.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(projectRoot, ".astro-runtime");
const sourcePath =
  process.env.ASTRO_X_SOURCE_PATH?.trim() ||
  join(stateDirectory, "x-source.json");
const forecastPath =
  process.env.ASTRO_FORECAST_PATH?.trim() ||
  join(projectRoot, "public", "forecast.json");
const budgetPath = join(stateDirectory, "grok-x-budget.json");
const dailyCap = Math.max(
  1,
  Number.parseInt(process.env.ASTRO_GROK_X_DAILY_CAP || "60", 10),
);
const grokModel = process.env.ASTRO_GROK_MODEL?.trim() || "grok-4.5";
const timeoutMs = Math.max(
  30_000,
  Number.parseInt(process.env.ASTRO_GROK_X_TIMEOUT_MS || "90000", 10),
);

async function readJson(path, fallback) {
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

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-131_072);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-65_536);
    });
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
      resolve({ code, signal, stdout, stderr });
    });
  });
}

const previous = await readJson(sourcePath, {
  posts: [],
  newestStatusId: null,
  lastSuccessAt: null,
});
const budget = await consumeBudget(budgetPath, dailyCap);
if (!budget.accepted) {
  await writeJsonAtomic(sourcePath, {
    ...previous,
    checkedAt: new Date().toISOString(),
    status: "rate_limited",
    provider: "grok-oauth",
    budget: {
      cap: budget.cap,
      used: budget.used,
      remaining: budget.remaining,
    },
    error: "Daily Grok X scout budget reached; cached evidence remains active.",
  });
  process.stdout.write(
    `${JSON.stringify({ status: "rate_limited", provider: "grok-oauth" })}\n`,
  );
  process.exit(0);
}

const forecast = await readJson(forecastPath, {});
const knownUrls = [
  ...(Array.isArray(previous.posts)
    ? previous.posts.map((post) => post?.url)
    : []),
  ...(Array.isArray(forecast?.evidence)
    ? forecast.evidence.map((item) => item?.source)
    : []),
]
  .filter((url) =>
    /^https:\/\/(?:www\.)?x\.com\/astronomer_zero\/status\/\d+$/.test(
      String(url || ""),
    ),
  )
  .slice(0, 30);

const prompt = `You are a narrow X evidence scout. Check only @astronomer_zero's newest public X posts and directly connected self-authored thread posts.

Known status URLs:
${JSON.stringify(knownUrls)}

Return JSON only:
{
  "newestStatusId": "numeric status id or null",
  "posts": [
    {
      "url": "exact https://x.com/astronomer_zero/status/<digits>",
      "postedAt": "ISO timestamp if directly available, otherwise null",
      "text": "faithful compact text; no interpretation",
      "threadUrls": ["exact self-authored connected status URLs"]
    }
  ],
  "note": "brief retrieval note"
}

Rules:
- Maximum eight posts, newest first.
- Use exact direct status URLs only.
- Do not analyze trading strategy, predict price, search archives, or build a forecast.
- Do not repeat older known posts unless needed to identify a new connected thread.
- If no newer direct evidence is found, return an empty posts array and preserve the newest known status id when identifiable.`;

const { XAI_API_KEY: ignoredApiKey, ...oauthEnvironment } = process.env;
void ignoredApiKey;
try {
  const result = await run(
    "grok",
    [
      "--single",
      prompt,
      "--model",
      grokModel,
      "--max-turns",
      "2",
      "--output-format",
      "plain",
      "--no-subagents",
      "--always-approve",
    ],
    oauthEnvironment,
  );
  if (result.signal) {
    throw new Error(`Grok X scout timed out (${result.signal}).`);
  }
  if (result.code !== 0) {
    throw new Error(
      /limit|quota|rate/i.test(result.stderr)
        ? "Grok OAuth usage limit reached."
        : "Grok X scout failed.",
    );
  }
  const parsed = parseScoutOutput(result.stdout);
  const discoveredPosts = parsed.posts.filter(
    (post) => !knownUrls.includes(post.url),
  );
  const checkedAt = new Date().toISOString();
  const nextPosts = [...discoveredPosts, ...(previous.posts || [])]
    .filter(
      (post, index, items) =>
        post?.url &&
        items.findIndex((candidate) => candidate?.url === post.url) === index,
    )
    .slice(0, 30);
  const newestStatusId =
    discoveredPosts[0]?.statusId ||
    parsed.newestStatusId ||
    previous.newestStatusId ||
    null;
  await writeJsonAtomic(sourcePath, {
    checkedAt,
    lastSuccessAt: checkedAt,
    status: "healthy",
    provider: "grok-oauth",
    model: grokModel,
    changed: discoveredPosts.length > 0,
    newestAcceptedAt:
      discoveredPosts.length > 0
        ? checkedAt
        : previous.newestAcceptedAt ?? null,
    newestStatusId,
    posts: nextPosts,
    note: parsed.note,
    budget: {
      cap: budget.cap,
      used: budget.used,
      remaining: budget.remaining,
    },
    error: null,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "healthy",
      provider: "grok-oauth",
      newPosts: discoveredPosts.length,
      newestStatusId,
      remaining: budget.remaining,
    })}\n`,
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Unknown Grok X scout failure.";
  await writeJsonAtomic(sourcePath, {
    ...previous,
    checkedAt: new Date().toISOString(),
    status: /limit|quota|rate/i.test(message) ? "rate_limited" : "degraded",
    provider: "grok-oauth",
    budget: {
      cap: budget.cap,
      used: budget.used,
      remaining: budget.remaining,
    },
    error: message,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: /limit|quota|rate/i.test(message) ? "rate_limited" : "degraded",
      provider: "grok-oauth",
      error: message,
    })}\n`,
  );
}
