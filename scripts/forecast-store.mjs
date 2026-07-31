import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const configuredForecastPath = process.env.ASTRO_FORECAST_PATH?.trim();
const forecastPath =
  configuredForecastPath || join(projectRoot, "public", "forecast.json");
const embeddedForecastPath = join(projectRoot, "app", "forecast.json");

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

  const decisionFields = [
    "position",
    "status",
    "lookingFor",
    "playbookMove",
    "risk",
  ];
  if (
    !report.decision ||
    typeof report.decision !== "object" ||
    Array.isArray(report.decision)
  ) {
    throw new Error("Forecast is missing decision.");
  }
  for (const field of decisionFields) {
    if (
      typeof report.decision[field] !== "string" ||
      !report.decision[field].trim()
    ) {
      throw new Error(`Forecast decision is missing ${field}.`);
    }
  }

  const signalFields = [
    "plainSummary",
    "astroMayDo",
    "readerStep",
    "changesWhen",
  ];
  const signalStates = [
    "wait",
    "long",
    "short",
    "take_profit",
    "exit",
    "conflict",
  ];
  if (
    !report.signal ||
    typeof report.signal !== "object" ||
    Array.isArray(report.signal)
  ) {
    throw new Error("Forecast is missing signal.");
  }
  if (!signalStates.includes(report.signal.state)) {
    throw new Error("Forecast signal state is invalid.");
  }
  for (const field of signalFields) {
    if (
      typeof report.signal[field] !== "string" ||
      !report.signal[field].trim()
    ) {
      throw new Error(`Forecast signal is missing ${field}.`);
    }
  }

  const thesisFields = [
    "horizon",
    "regime",
    "astroConfirmed",
    "modelRead",
    "nextTrigger",
    "failure",
  ];
  if (
    !report.thesis ||
    typeof report.thesis !== "object" ||
    Array.isArray(report.thesis)
  ) {
    throw new Error("Forecast is missing thesis.");
  }
  for (const field of thesisFields) {
    if (
      typeof report.thesis[field] !== "string" ||
      !report.thesis[field].trim()
    ) {
      throw new Error(`Forecast thesis is missing ${field}.`);
    }
  }
  const hermesFields = [
    "horizon",
    "coreThesis",
    "currentPhase",
    "nextPhase",
    "longerMove",
    "confirmation",
    "failure",
    "learningNote",
  ];
  if (
    !report.hermes ||
    typeof report.hermes !== "object" ||
    Array.isArray(report.hermes)
  ) {
    throw new Error("Forecast is missing Hermes longer-horizon thesis.");
  }
  for (const field of hermesFields) {
    if (
      typeof report.hermes[field] !== "string" ||
      !report.hermes[field].trim()
    ) {
      throw new Error(`Forecast Hermes thesis is missing ${field}.`);
    }
  }
  const projection = report.hermes.projection;
  const projectionDirections = [
    "down_then_up",
    "up_then_down",
    "up",
    "down",
    "range",
  ];
  if (
    !projection ||
    typeof projection !== "object" ||
    Array.isArray(projection) ||
    projection.scoringVersion !== 2 ||
    !projectionDirections.includes(projection.direction) ||
    !Number.isInteger(projection.horizonHours) ||
    projection.horizonHours < 24 ||
    projection.horizonHours > 2_160 ||
    !Number.isInteger(projection.confidence) ||
    projection.confidence < 0 ||
    projection.confidence > 100 ||
    !Array.isArray(projection.checkpoints) ||
    projection.checkpoints.length < 2 ||
    projection.checkpoints.length > 4
  ) {
    throw new Error("Forecast Hermes projection is invalid.");
  }
  for (const checkpoint of projection.checkpoints) {
    if (
      !checkpoint ||
      typeof checkpoint !== "object" ||
      !["transition", "confirmation", "target"].includes(checkpoint.kind) ||
      typeof checkpoint.label !== "string" ||
      !checkpoint.label.trim() ||
      typeof checkpoint.condition !== "string" ||
      !checkpoint.condition.trim() ||
      !Number.isFinite(checkpoint.price) ||
      checkpoint.price < 10_000 ||
      checkpoint.price > 250_000 ||
      !Number.isInteger(checkpoint.horizonHours) ||
      checkpoint.horizonHours < 1 ||
      checkpoint.horizonHours > projection.horizonHours
    ) {
      throw new Error("Every Hermes checkpoint must be numeric and time-bound.");
    }
  }
  if (
    !projection.invalidation ||
    typeof projection.invalidation !== "object" ||
    typeof projection.invalidation.condition !== "string" ||
    !projection.invalidation.condition.trim() ||
    (projection.invalidation.price !== null &&
      (!Number.isFinite(projection.invalidation.price) ||
        projection.invalidation.price < 10_000 ||
        projection.invalidation.price > 250_000))
  ) {
    throw new Error("Forecast Hermes invalidation is invalid.");
  }
  if (
    !projection.behavior ||
    typeof projection.behavior !== "object" ||
    ![
      "hold",
      "trim",
      "close",
      "flip_long",
      "flip_short",
      "readd",
      "silence",
      "post_update",
    ].includes(projection.behavior.action) ||
    !Number.isInteger(projection.behavior.horizonHours) ||
    projection.behavior.horizonHours < 1 ||
    projection.behavior.horizonHours > 720 ||
    typeof projection.behavior.condition !== "string" ||
    !projection.behavior.condition.trim()
  ) {
    throw new Error("Forecast Hermes behavior prediction is invalid.");
  }
  if (
    !Array.isArray(report.thesisLevels) ||
    report.thesisLevels.length < 1 ||
    report.thesisLevels.length > 5
  ) {
    throw new Error("Forecast must contain one to five thesis levels.");
  }
  for (const level of report.thesisLevels) {
    if (
      !["watch", "upside", "downside"].includes(level?.kind) ||
      ["label", "value", "reason"].some(
        (field) => typeof level?.[field] !== "string" || !level[field].trim(),
      )
    ) {
      throw new Error("Every thesis level must be a labeled model watch area.");
    }
  }

  const executionFields = ["entry", "takeProfit", "exit"];
  const levelFields = ["state", "level", "condition"];
  if (
    !report.execution ||
    typeof report.execution !== "object" ||
    Array.isArray(report.execution)
  ) {
    throw new Error("Forecast is missing execution.");
  }
  for (const field of executionFields) {
    const level = report.execution[field];
    if (!level || typeof level !== "object" || Array.isArray(level)) {
      throw new Error(`Forecast execution is missing ${field}.`);
    }
    for (const levelField of levelFields) {
      if (
        typeof level[levelField] !== "string" ||
        !level[levelField].trim()
      ) {
        throw new Error(
          `Forecast execution ${field} is missing ${levelField}.`,
        );
      }
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

  if (report.trackRecord !== undefined) {
    const trackRecord = report.trackRecord;
    if (
      !trackRecord ||
      typeof trackRecord !== "object" ||
      Array.isArray(trackRecord) ||
      typeof trackRecord.reviewedAt !== "string" ||
      !Number.isFinite(new Date(trackRecord.reviewedAt).getTime()) ||
      typeof trackRecord.method !== "string" ||
      !trackRecord.method.trim() ||
      !trackRecord.astroClaim ||
      typeof trackRecord.astroClaim.label !== "string" ||
      typeof trackRecord.astroClaim.detail !== "string" ||
      !Array.isArray(trackRecord.plays)
    ) {
      throw new Error("Forecast track record is invalid.");
    }
    const playIds = new Set();
    for (const play of trackRecord.plays) {
      const resolved = play?.status === "win" || play?.status === "loss";
      if (
        !play ||
        typeof play !== "object" ||
        typeof play.id !== "string" ||
        !play.id.trim() ||
        playIds.has(play.id) ||
        typeof play.name !== "string" ||
        !["LONG", "SHORT"].includes(play.direction) ||
        !["win", "loss", "open", "unscored"].includes(play.status) ||
        typeof play.openedAt !== "string" ||
        !Number.isFinite(new Date(play.openedAt).getTime()) ||
        (resolved &&
          (typeof play.closedAt !== "string" ||
            !Number.isFinite(new Date(play.closedAt).getTime()))) ||
        (play.status === "open" && play.closedAt !== null) ||
        ["entry", "targets", "result", "why"].some(
          (field) => typeof play[field] !== "string" || !play[field].trim(),
        ) ||
        !Array.isArray(play.sources) ||
        play.sources.length < (resolved ? 2 : 1) ||
        play.sources.some(
          (source) =>
            typeof source?.label !== "string" ||
            typeof source?.url !== "string" ||
            !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/astronomer_zero\/status\/\d+/.test(
              source.url,
            ),
        )
      ) {
        throw new Error("Forecast contains an invalid audited play.");
      }
      playIds.add(play.id);
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
  await writeForecastSnapshots(validated);
  return validated;
}

export async function writeForecastSnapshots(report) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const destinations = configuredForecastPath
    ? [forecastPath]
    : [forecastPath, embeddedForecastPath];
  await Promise.all(
    destinations.map(async (destination) => {
      const temporaryPath = `${destination}.tmp`;
      await writeFile(temporaryPath, serialized, "utf8");
      await rename(temporaryPath, destination);
    }),
  );
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
