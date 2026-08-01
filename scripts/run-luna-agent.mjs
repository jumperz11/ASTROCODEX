import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureConnectorCredentials } from "./connector-auth.mjs";
import { consumeBudget } from "./provider-budget.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const promptPath = join(projectRoot, "prompts", "astro-live-analysis.md");
const gateSchemaPath = join(projectRoot, "prompts", "luna-gate.schema.json");
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(projectRoot, ".astro-runtime");
const forecastPath =
  process.env.ASTRO_FORECAST_PATH?.trim() ||
  join(projectRoot, "public", "forecast.json");
const telegramSourcePath =
  process.env.ASTRO_TELEGRAM_SOURCE_PATH?.trim() ||
  join(stateDirectory, "telegram-source.json");
const xSourcePath =
  process.env.ASTRO_X_SOURCE_PATH?.trim() ||
  join(stateDirectory, "x-source.json");
const lightBudgetPath = join(stateDirectory, "luna-light-budget.json");
const mediumBudgetPath = join(stateDirectory, "luna-medium-budget.json");
const deepSeekBudgetPath = join(
  stateDirectory,
  "deepseek-flash-budget.json",
);
const lightDailyCap = Math.max(
  1,
  Number.parseInt(process.env.ASTRO_LUNA_LIGHT_DAILY_CAP || "8", 10),
);
const mediumDailyCap = Math.max(
  1,
  Number.parseInt(process.env.ASTRO_LUNA_MEDIUM_DAILY_CAP || "5", 10),
);
const deepSeekDailyCap = Math.max(
  1,
  Number.parseInt(process.env.ASTRO_DEEPSEEK_DAILY_CAP || "24", 10),
);
const timeoutMs = Math.max(
  60_000,
  Number.parseInt(process.env.ASTRO_LUNA_TIMEOUT_MS || "240000", 10),
);
const configuredModel = process.env.ASTRO_CODEX_MODEL?.trim() || "";
const question =
  process.argv.slice(2).join(" ").trim() ||
  "Check whether the accepted Astro/Hermes read materially changed.";

function modelEnvironment(extra = {}) {
  const {
    DEEPSEEK_API_KEY: ignoredDeepSeekKey,
    TELEGRAM_API_HASH: ignoredTelegramApiHash,
    TELEGRAM_BOT_TOKEN: ignoredTelegramBotToken,
    ASTRO_SIGNAL_TOKEN: ignoredSignalToken,
    XAI_API_KEY: ignoredXaiKey,
    ...safe
  } = process.env;
  void ignoredDeepSeekKey;
  void ignoredTelegramApiHash;
  void ignoredTelegramBotToken;
  void ignoredSignalToken;
  void ignoredXaiKey;
  return { ...safe, ...extra };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-131_072);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-131_072);
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

function compactTelegram(source) {
  const messages = Array.isArray(source?.messages) ? source.messages : [];
  return messages.slice(-14).map((message) => ({
    id: message.id ?? message.messageId ?? null,
    chatId: message.chatId ?? null,
    chatTitle: message.chatTitle ?? message.sourceTitle ?? null,
    date: message.date ?? message.createdAt ?? null,
    text:
      typeof message.text === "string"
        ? message.text.trim().slice(0, 3_000)
        : "",
    mediaPath:
      typeof message.mediaPath === "string" ? message.mediaPath : null,
  }));
}

function compactX(source) {
  return (Array.isArray(source?.posts) ? source.posts : [])
    .slice(0, 8)
    .map((post) => ({
      url: post.url,
      postedAt: post.postedAt ?? null,
      text:
        typeof post.text === "string" ? post.text.trim().slice(0, 3_000) : "",
      threadUrls: Array.isArray(post.threadUrls)
        ? post.threadUrls.slice(0, 8)
        : [],
    }));
}

async function codexExists() {
  try {
    await access(
      process.env.ASTRO_CODEX_BIN?.trim() || "/usr/local/bin/codex",
    );
    return true;
  } catch {
    return false;
  }
}

function codexArgs({ effort, prompt, outputPath, schemaPath, search, images }) {
  const args = [
    "--ask-for-approval",
    "never",
  ];
  if (search) args.push("--search");
  args.push(
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--cd",
    projectRoot,
    "-c",
    `model_reasoning_effort="${effort}"`,
    "--output-last-message",
    outputPath,
  );
  if (configuredModel) args.push("--model", configuredModel);
  if (schemaPath) args.push("--output-schema", schemaPath);
  for (const imagePath of images || []) args.push("--image", imagePath);
  args.push(prompt);
  return args;
}

function validGate(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.material === "boolean" &&
    ["none", "low", "medium", "high"].includes(value.severity) &&
    [
      "no_change",
      "position",
      "take_profit",
      "close",
      "thesis",
      "conflict",
      "market_checkpoint",
      "forecast_resolution",
    ].includes(value.category) &&
    typeof value.reason === "string" &&
    Array.isArray(value.evidenceRefs) &&
    typeof value.needsXSearch === "boolean" &&
    typeof value.mediumReason === "string"
  );
}

async function deepSeekGate(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return { available: false, reason: "not_configured" };
  const configuredBaseUrl = process.env.DEEPSEEK_BASE_URL?.trim();
  const usesOpenRouter =
    apiKey.startsWith("sk-or-") ||
    Boolean(configuredBaseUrl?.includes("openrouter.ai"));
  const baseUrl =
    configuredBaseUrl ||
    (usesOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.deepseek.com/chat/completions");
  const model =
    process.env.ASTRO_DEEPSEEK_MODEL?.trim() ||
    (usesOpenRouter
      ? "deepseek/deepseek-v4-flash-0731"
      : "deepseek-v4-flash");
  const budget = await consumeBudget(
    deepSeekBudgetPath,
    deepSeekDailyCap,
  );
  if (!budget.accepted) {
    return { available: false, reason: "daily_cap", budget };
  }
  try {
    const response = await fetch(
      baseUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "Return only valid JSON matching the requested evidence-gate shape. Do not provide trading instructions.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          ...(usesOpenRouter
            ? { reasoning: { effort: "none" } }
            : { thinking: { type: "disabled" } }),
          max_tokens: 1_200,
          stream: false,
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );
    if (!response.ok) {
      return {
        available: false,
        reason:
          response.status === 429 ? "provider_rate_limit" : `http_${response.status}`,
        budget,
      };
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { available: false, reason: "empty_response", budget };
    }
    const gate = JSON.parse(content);
    if (!validGate(gate)) {
      return { available: false, reason: "invalid_response", budget };
    }
    return { available: true, gate, budget, model };
  } catch {
    return { available: false, reason: "request_failed", budget };
  }
}

const [telegramSource, xSource, forecast] = await Promise.all([
  readJson(telegramSourcePath, {}),
  readJson(xSourcePath, {}),
  readJson(forecastPath, {}),
]);
const telegramMessages = compactTelegram(telegramSource);
const xPosts = compactX(xSource);
const imagePaths = telegramMessages
  .map((message) => message.mediaPath)
  .filter(Boolean)
  .slice(-3);
const lightPrompt = `You are the low-cost evidence gate for Astro Intelligence.

Trigger context:
${question}

Latest approved Telegram messages:
${JSON.stringify(telegramMessages)}

Latest Grok X scout state:
${JSON.stringify({
  status: xSource.status ?? "missing",
  checkedAt: xSource.checkedAt ?? null,
  newestStatusId: xSource.newestStatusId ?? null,
  posts: xPosts,
  error: xSource.error ?? null,
})}

Accepted forecast summary:
${JSON.stringify({
  generatedAt: forecast.generatedAt ?? null,
  signal: forecast.signal ?? null,
  decision: forecast.decision ?? null,
  hermesProjection: forecast.hermes?.projection ?? null,
})}

Classify only whether a Luna Medium rebuild is justified.
- Telegram is approved private context, but Telegram-only claims cannot become public X evidence.
- A new message is not automatically material.
- Market noise is not material unless a saved checkpoint, invalidation, or forecast resolution changed.
- Exact public Astro status URLs are required before changing Astro-confirmed public facts.
- Do not build a forecast.

Return only this JSON object:
{
  "material": true or false,
  "severity": "none" or "low" or "medium" or "high",
  "category": "no_change" or "position" or "take_profit" or "close" or "thesis" or "conflict" or "market_checkpoint" or "forecast_resolution",
  "reason": "one terse factual sentence",
  "evidenceRefs": ["message IDs or exact X status URLs"],
  "needsXSearch": true or false,
  "mediumReason": "why Luna Medium is or is not justified"
}`;

let gate = null;
let gateProvider = "deepseek-v4-flash";
let lightRemaining = null;
const deepSeekResult = await deepSeekGate(lightPrompt);
if (deepSeekResult.available) {
  gate = deepSeekResult.gate;
  gateProvider = deepSeekResult.model;
  lightRemaining = deepSeekResult.budget.remaining;
} else {
  const codexBin =
    process.env.ASTRO_CODEX_BIN?.trim() || "/usr/local/bin/codex";
  if (!(await codexExists())) {
    process.stdout.write(
      `${JSON.stringify({
        status: "degraded",
        provider: "evidence-gate",
        stage: "unavailable",
        deepSeekStatus: deepSeekResult.reason,
        error: "Neither DeepSeek nor Codex Luna Light is available.",
      })}\n`,
    );
    process.exit(0);
  }
  gateProvider = "codex-luna-light";
  const lightBudget = await consumeBudget(lightBudgetPath, lightDailyCap);
  if (!lightBudget.accepted) {
    process.stdout.write(
      `${JSON.stringify({
        status: "rate_limited",
        provider: "evidence-gate",
        stage: "light",
        deepSeekStatus: deepSeekResult.reason,
        remaining: 0,
      })}\n`,
    );
    process.exit(0);
  }
  lightRemaining = lightBudget.remaining;
  const gateOutputPath = join(
    stateDirectory,
    `luna-gate-${process.pid}-${Date.now()}.json`,
  );
  const lightResult = await run(
    codexBin,
    codexArgs({
      effort: "low",
      prompt: lightPrompt,
      outputPath: gateOutputPath,
      schemaPath: gateSchemaPath,
      search: false,
      images: imagePaths,
    }),
    { env: modelEnvironment() },
  );
  if (lightResult.signal || lightResult.code !== 0) {
    const authenticationError = /login|auth|unauthorized/i.test(
      `${lightResult.stdout}\n${lightResult.stderr}`,
    );
    process.stdout.write(
      `${JSON.stringify({
        status: "degraded",
        provider: "codex-luna",
        stage: "light",
        deepSeekStatus: deepSeekResult.reason,
        error: authenticationError
          ? "Codex login is required on the VPS."
          : "Luna Light failed; the last accepted forecast remains active.",
      })}\n`,
    );
    process.exit(0);
  }
  gate = await readJson(gateOutputPath, null);
  if (!validGate(gate)) {
    process.stdout.write(
      `${JSON.stringify({
        status: "degraded",
        provider: "codex-luna",
        stage: "light",
        error: "Luna Light returned an invalid evidence classification.",
      })}\n`,
    );
    process.exit(0);
  }
}
if (!gate.material) {
  process.stdout.write(
    `${JSON.stringify({
      status: "healthy",
      provider: gateProvider,
      stage: "light",
      material: false,
      category: gate.category,
      reason: gate.reason,
      remaining: lightRemaining,
    })}\n`,
  );
  process.exit(0);
}

const codexBin =
  process.env.ASTRO_CODEX_BIN?.trim() || "/usr/local/bin/codex";
if (!(await codexExists())) {
  process.stdout.write(
    `${JSON.stringify({
      status: "degraded",
      provider: "codex-luna",
      stage: "medium",
      material: true,
      category: gate.category,
      error: "Luna Medium is unavailable; the last accepted forecast remains active.",
    })}\n`,
  );
  process.exit(0);
}

const mediumBudget = await consumeBudget(mediumBudgetPath, mediumDailyCap);
if (!mediumBudget.accepted) {
  process.stdout.write(
    `${JSON.stringify({
      status: "rate_limited",
      provider: "codex-luna",
      stage: "medium",
      material: true,
      category: gate.category,
      remaining: 0,
    })}\n`,
  );
  process.exit(0);
}

const credentials = await ensureConnectorCredentials();
let connector = null;
async function connectorIsReady() {
  try {
    const response = await fetch("http://127.0.0.1:4318/health");
    return response.ok;
  } catch {
    return false;
  }
}
if (!(await connectorIsReady())) {
  connector = spawn(process.execPath, ["scripts/astro-mcp-server.mjs"], {
    cwd: projectRoot,
    env: modelEnvironment({
      ASTRO_OWNER_CODE: credentials.ownerCode,
      ASTRO_STATIC_ACCESS_TOKEN: credentials.accessToken,
      ASTRO_PUBLIC_URL: "http://127.0.0.1:4318",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await connectorIsReady()) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

try {
  await run(codexBin, ["mcp", "remove", "astro-intelligence"], {
    env: modelEnvironment({
      ASTRO_MCP_TOKEN: credentials.accessToken,
    }),
  });
  const mcpResult = await run(
    codexBin,
    [
      "mcp",
      "add",
      "astro-intelligence",
      "--url",
      "http://127.0.0.1:4318/mcp",
      "--bearer-token-env-var",
      "ASTRO_MCP_TOKEN",
    ],
    {
      env: modelEnvironment({
        ASTRO_MCP_TOKEN: credentials.accessToken,
      }),
    },
  );
  if (mcpResult.code !== 0) {
    throw new Error("Could not configure the protected Astro connector.");
  }
  const before = await stat(forecastPath)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  const template = await readFile(promptPath, "utf8");
  const mediumOutputPath = join(
    stateDirectory,
    `luna-medium-${process.pid}-${Date.now()}.txt`,
  );
  const mediumPrompt = `${template
    .replace("{{NOW}}", new Date().toISOString())
    .replace("{{QUESTION}}", question)}

Luna Light material classification:
${JSON.stringify(gate)}

Grok X scout evidence:
${JSON.stringify({
  status: xSource.status ?? "missing",
  checkedAt: xSource.checkedAt ?? null,
  posts: xPosts,
  error: xSource.error ?? null,
})}

Approved Telegram context:
${JSON.stringify(telegramMessages)}

Provider boundary:
- Grok is only the X evidence scout.
- You are Luna Medium, responsible for the separated Hermes thesis.
- Call get_astro_playbook and search_astro_codex for the closest phase, execution sequence, and active trigger.
- Use exact X status URLs for every public Astro evidence item.
- Telegram-only material may inform Hermes but cannot become a public Astro quote or confirmed public signal.
- If the X scout is degraded, web search is a fallback only. Do not claim newest-X completeness.
- Preserve the previous confirmed Astro state when no new exact public evidence exists.
- Save with save_astro_forecast only if the evidence or scoreable Hermes map materially changed.
- Never issue or execute an autonomous trade.`;
  const mediumResult = await run(
    codexBin,
    codexArgs({
      effort: "medium",
      prompt: mediumPrompt,
      outputPath: mediumOutputPath,
      schemaPath: null,
      search: Boolean(gate.needsXSearch || xSource.status !== "healthy"),
      images: imagePaths,
    }),
    {
      env: modelEnvironment({
        ASTRO_MCP_TOKEN: credentials.accessToken,
      }),
    },
  );
  const after = await stat(forecastPath)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  const changed = after > before;
  if (mediumResult.signal || mediumResult.code !== 0) {
    throw new Error(
      /login|auth|unauthorized/i.test(
        `${mediumResult.stdout}\n${mediumResult.stderr}`,
      )
        ? "Codex login is required on the VPS."
        : "Luna Medium failed; the last accepted forecast remains active.",
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "healthy",
      provider: "codex-luna",
      stage: "medium",
      material: true,
      category: gate.category,
      changed,
      gateProvider,
      lightRemaining,
      mediumRemaining: mediumBudget.remaining,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      status: "degraded",
      provider: "codex-luna",
      stage: "medium",
      material: true,
      category: gate.category,
      error:
        error instanceof Error
          ? error.message
          : "Unknown Luna Medium failure.",
    })}\n`,
  );
} finally {
  if (connector && connector.exitCode === null) {
    connector.kill("SIGTERM");
    await once(connector, "exit");
  }
}
