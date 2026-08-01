import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultLedgerPath,
  readLedgerHealth,
  syncRuntimeLedger,
} from "./astro-event-ledger.mjs";

const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || "/var/lib/astro-signal";
const forecastPath =
  process.env.ASTRO_FORECAST_PATH?.trim() ||
  join(process.cwd(), "public", "forecast.json");
const ledgerPath = defaultLedgerPath(stateDirectory);

async function readJson(path, fallback = {}) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

const [forecast, history, telegram, x, thesis, review] = await Promise.all([
  readJson(forecastPath),
  readJson(join(stateDirectory, "history.json")),
  readJson(join(stateDirectory, "telegram-source.json")),
  readJson(join(stateDirectory, "x-source.json")),
  readJson(join(stateDirectory, "deepseek-thesis.json")),
  readJson(join(stateDirectory, "learning-review.json")),
]);

const sync = syncRuntimeLedger({
  path: ledgerPath,
  observedAt: new Date().toISOString(),
  forecast,
  history,
  telegram,
  x,
  thesis,
  review,
});
const health = readLedgerHealth(ledgerPath, {
  verifyIntegrity: process.argv.includes("--verify"),
});
process.stdout.write(`${JSON.stringify({ sync, health })}\n`);
