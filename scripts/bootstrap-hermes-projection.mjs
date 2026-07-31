import { readForecast, saveForecast } from "./forecast-store.mjs";

function numericPrices(value) {
  const normalized = String(value || "").replaceAll(",", "");
  return [
    ...normalized.matchAll(/\b(\d{2,3}(?:\.\d+)?)k\b|\b(\d{5,6}(?:\.\d+)?)\b/gi),
  ]
    .map((match) =>
      match[1] ? Number(match[1]) * 1_000 : Number(match[2]),
    )
    .filter(
      (price, index, prices) =>
        Number.isFinite(price) &&
        price >= 10_000 &&
        price <= 250_000 &&
        prices.indexOf(price) === index,
    );
}

const forecast = await readForecast();
if (!forecast?.hermes) {
  throw new Error("A validated Hermes thesis is required before bootstrapping.");
}
if (forecast.hermes.projection) {
  process.stdout.write("Hermes projection already exists; no change saved.\n");
  process.exit(0);
}

const modelLevels = (forecast.thesisLevels ?? [])
  .flatMap((level) =>
    numericPrices(level.value).map((price) => ({ ...level, price })),
  )
  .filter((level) => Number.isFinite(level.price));
const spot =
  modelLevels.find((level) => /spot|snapshot/i.test(level.label))?.price ??
  null;
if (!spot) {
  throw new Error("A verified model spot anchor is required.");
}

const below = modelLevels
  .filter((level) => level.price < spot && level.kind === "downside")
  .sort((left, right) => right.price - left.price);
const above = modelLevels
  .filter((level) => level.price > spot)
  .sort((left, right) => left.price - right.price);
const ordered = [below[0], above[0], above.at(-1)]
  .filter(Boolean)
  .filter(
    (level, index, levels) =>
      levels.findIndex((candidate) => candidate.price === level.price) === index,
  );
if (ordered.length < 2) {
  throw new Error("At least two verified model checkpoints are required.");
}

const currentShort = /\bshort\b|downside/i.test(forecast.hermes.currentPhase);
const longerLong = /\blong\b|upside|new ath/i.test(forecast.hermes.longerMove);
const direction =
  currentShort && longerLong
    ? "down_then_up"
    : currentShort
      ? "down"
      : longerLong
        ? "up"
        : "range";
const leadingProbability = Math.max(
  0,
  ...((forecast.scenarios ?? []).map((scenario) =>
    Number(scenario.probability || 0),
  )),
);

const projection = {
  direction,
  horizonHours: 336,
  confidence: Math.min(70, leadingProbability),
  checkpoints: ordered.map((level, index) => ({
    label: level.label,
    price: level.price,
    kind:
      index === 0 && direction === "down_then_up"
        ? "transition"
        : index === ordered.length - 1
          ? "target"
          : "confirmation",
    horizonHours:
      index === 0
        ? 72
        : index === ordered.length - 1
          ? 336
          : 168,
    condition: level.reason,
  })),
  invalidation: {
    price: null,
    condition: forecast.hermes.failure,
  },
};

const { generatedAt: ignoredGeneratedAt, mode: ignoredMode, ...report } =
  forecast;
void ignoredGeneratedAt;
void ignoredMode;
const saved = await saveForecast({
  ...report,
  hermes: {
    ...forecast.hermes,
    projection,
  },
});
process.stdout.write(
  `${JSON.stringify({
    saved: true,
    generatedAt: saved.generatedAt,
    projection: saved.hermes.projection,
  })}\n`,
);
