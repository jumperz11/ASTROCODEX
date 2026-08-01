import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

export function recentAttempts(attempts, now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1_000;
  return (Array.isArray(attempts) ? attempts : []).filter((value) => {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now;
  });
}

export async function inspectBudget(path, cap, now = Date.now()) {
  const state = await readJson(path, { attempts: [] });
  const attempts = recentAttempts(state.attempts, now);
  return {
    cap,
    used: attempts.length,
    remaining: Math.max(0, cap - attempts.length),
    attempts,
  };
}

export async function consumeBudget(path, cap, now = Date.now()) {
  const budget = await inspectBudget(path, cap, now);
  if (budget.remaining <= 0) {
    return { ...budget, accepted: false };
  }
  const attemptedAt = new Date(now).toISOString();
  const attempts = [...budget.attempts, attemptedAt];
  await writeJsonAtomic(path, {
    updatedAt: attemptedAt,
    cap,
    attempts,
  });
  return {
    cap,
    used: attempts.length,
    remaining: Math.max(0, cap - attempts.length),
    attempts,
    accepted: true,
    attemptedAt,
  };
}
