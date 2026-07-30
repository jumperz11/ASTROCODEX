import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const forecastPath = join(projectRoot, "public", "forecast.json");

export function validateForecast(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Forecast must be an object.");
  }

  const requiredText = [
    "market",
    "stance",
    "headline",
    "summary",
    "nextMove",
    "invalidation",
    "waitFor",
    "caveat",
  ];
  for (const field of requiredText) {
    if (typeof report[field] !== "string" || !report[field].trim()) {
      throw new Error(`Forecast is missing ${field}.`);
    }
  }

  if (!["long", "short", "neutral"].includes(report.stanceTone)) {
    throw new Error("Forecast stance tone is invalid.");
  }
  if (
    !Number.isInteger(report.confidence) ||
    report.confidence < 0 ||
    report.confidence > 100
  ) {
    throw new Error("Forecast confidence must be an integer from 0 to 100.");
  }

  if (!Array.isArray(report.scenarios) || report.scenarios.length !== 3) {
    throw new Error("Forecast must contain exactly three scenarios.");
  }
  const probabilityTotal = report.scenarios.reduce(
    (sum, scenario) => sum + Number(scenario.probability),
    0,
  );
  if (probabilityTotal !== 100) {
    throw new Error("Scenario probabilities must total 100.");
  }

  const evidenceTypes = new Set(
    Array.isArray(report.evidence)
      ? report.evidence.map((item) => item.type)
      : [],
  );
  for (const type of ["astro", "framework", "inference"]) {
    if (!evidenceTypes.has(type)) {
      throw new Error(`Forecast is missing ${type} evidence.`);
    }
  }

  if (!Array.isArray(report.sources) || report.sources.length === 0) {
    throw new Error("Forecast must cite at least one source.");
  }
  for (const source of report.sources) {
    if (
      typeof source.url !== "string" ||
      !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/astronomer_zero\/status\/\d+/.test(
        source.url,
      )
    ) {
      throw new Error(
        "Every forecast source must be a direct @astronomer_zero status URL.",
      );
    }
  }

  for (const item of report.evidence) {
    if (
      item.type === "astro" &&
      (typeof item.source !== "string" ||
        !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/astronomer_zero\/status\/\d+/.test(
          item.source,
        ))
    ) {
      throw new Error(
        "Every direct Astro evidence item must cite its exact status URL.",
      );
    }
  }

  return {
    ...report,
    generatedAt: new Date().toISOString(),
    mode: "live",
  };
}

export async function saveForecast(report) {
  const validated = validateForecast(report);
  const temporaryPath = `${forecastPath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(validated, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, forecastPath);
  return validated;
}

export async function readForecast() {
  try {
    return JSON.parse(await readFile(forecastPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
