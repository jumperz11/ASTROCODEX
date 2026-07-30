import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureConnectorCredentials } from "./connector-auth.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const promptPath = join(projectRoot, "prompts", "astro-live-analysis.md");
const forecastPath = join(projectRoot, "public", "forecast.json");
const question =
  process.argv.slice(2).join(" ").trim() ||
  "What is Astro likely thinking and doing next?";
const credentials = await ensureConnectorCredentials();

async function connectorIsReady() {
  try {
    const response = await fetch("http://127.0.0.1:4318/health");
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForConnector() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await connectorIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The local Astro connector did not start.");
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });
  const [code] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`${command} exited with code ${code}.`);
  }
}

let connector = null;
if (!(await connectorIsReady())) {
  connector = spawn(process.execPath, ["scripts/astro-mcp-server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ASTRO_OWNER_CODE: credentials.ownerCode,
      ASTRO_STATIC_ACCESS_TOKEN: credentials.accessToken,
      ASTRO_PUBLIC_URL: "http://127.0.0.1:4318",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitForConnector();
}

try {
  await run("grok", [
    "mcp",
    "add",
    "--scope",
    "user",
    "--transport",
    "http",
    "astro-intelligence",
    "http://127.0.0.1:4318/mcp",
    "--header",
    `Authorization: Bearer ${credentials.accessToken}`,
  ]);

  const before = await stat(forecastPath)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  const template = await readFile(promptPath, "utf8");
  const prompt = `${template
    .replace("{{NOW}}", new Date().toISOString())
    .replace("{{QUESTION}}", question)}

Connector workflow:
- Call get_astro_playbook before forming the forecast.
- Use current public X evidence and exact direct status URLs.
- Call save_astro_forecast with the complete result.
- If exact current evidence cannot be verified, do not save a forecast.
- After the tool accepts the forecast, give a short human-readable summary.`;

  await run("grok", [
    "--single",
    prompt,
    "--max-turns",
    "14",
    "--output-format",
    "plain",
    "--no-subagents",
    "--always-approve",
  ]);

  const after = await stat(forecastPath)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  if (after <= before) {
    throw new Error(
      "Grok finished without saving a newly validated forecast. Review its evidence output and try again.",
    );
  }
  process.stdout.write(
    "\nValidated forecast saved. Refresh the Astro dashboard.\n",
  );
} finally {
  if (connector && connector.exitCode === null) {
    connector.kill("SIGTERM");
    await once(connector, "exit");
  }
}
