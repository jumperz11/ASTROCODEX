import bundledForecast from "../../forecast.json";

export const dynamic = "force-dynamic";

type RemoteSignalEnvelope = {
  forecast?: unknown;
  checkedAt?: unknown;
  status?: unknown;
  runId?: unknown;
  model?: unknown;
  codexEntries?: unknown;
  codexMedia?: unknown;
  telegramEnabled?: unknown;
  telegramStatus?: unknown;
  telegramSourceStatus?: unknown;
  telegramSourceLastSuccessAt?: unknown;
  telegramSourceNewestAt?: unknown;
  telegramSourceLastAnalyzedAt?: unknown;
  telegramSourceAnalyzedNewestAt?: unknown;
  telegramSourceMessages?: unknown;
  telegramSourceMedia?: unknown;
  telegramSources?: unknown;
  activity?: unknown;
  hermesAudit?: unknown;
};

function isForecast(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (
    typeof report.generatedAt === "string" &&
    typeof report.market === "string" &&
    typeof report.decision === "object" &&
    Array.isArray(report.evidence) &&
    Array.isArray(report.levels)
  );
}

function safeBundledForecast() {
  return {
    ...bundledForecast,
    mode: "snapshot",
    confidence: Math.min(Number(bundledForecast.confidence || 0), 50),
    decision: {
      ...bundledForecast.decision,
      status: "Live VPS confirmation is unavailable.",
      playbookMove: "Wait for the live evidence connection to recover.",
    },
    signal: {
      ...bundledForecast.signal,
      state: "wait",
      plainSummary:
        "The live evidence connection is unavailable. This snapshot is context only.",
      astroMayDo: "Unknown until the live source reconnects.",
      readerStep: "Wait. Do not use the bundled snapshot as a fresh signal.",
      changesWhen: "The live VPS evidence source reconnects.",
    },
  };
}

function response(
  forecast: unknown,
  options: {
    checkedAt: string | null;
    source: "vps" | "bundled";
    degraded?: boolean;
    status?: string;
    runId?: string | null;
    model?: string | null;
    codexEntries?: number;
    codexMedia?: number;
    telegramEnabled?: boolean;
    telegramStatus?: string;
    telegramSourceStatus?: string;
    telegramSourceLastSuccessAt?: string | null;
    telegramSourceNewestAt?: string | null;
    telegramSourceLastAnalyzedAt?: string | null;
    telegramSourceAnalyzedNewestAt?: string | null;
    telegramSourceMessages?: number;
    telegramSourceMedia?: number;
    telegramSources?: unknown[];
    activity?: unknown[];
    hermesAudit?: unknown;
  },
) {
  return Response.json(
    { forecast, ...options },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}

export async function GET() {
  const signalUrl = process.env.ASTRO_SIGNAL_URL?.trim();
  const signalToken = process.env.ASTRO_SIGNAL_TOKEN?.trim();

  if (!signalUrl || !signalToken) {
    return response(safeBundledForecast(), {
      checkedAt: null,
      source: "bundled",
      degraded: true,
      status: "degraded",
    });
  }

  try {
    const remote = await fetch(signalUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${signalToken}`,
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (!remote.ok) throw new Error("Signal source unavailable.");

    const payload = (await remote.json()) as RemoteSignalEnvelope;
    const forecast = payload.forecast ?? payload;
    if (!isForecast(forecast)) throw new Error("Invalid signal payload.");

    const checkedAt =
      typeof payload.checkedAt === "string" &&
      Number.isFinite(new Date(payload.checkedAt).getTime())
        ? payload.checkedAt
        : null;

    return response(forecast, {
      checkedAt,
      source: "vps",
      status: typeof payload.status === "string" ? payload.status : "healthy",
      runId: typeof payload.runId === "string" ? payload.runId : null,
      model: typeof payload.model === "string" ? payload.model : null,
      codexEntries: Number.isInteger(payload.codexEntries)
        ? Number(payload.codexEntries)
        : 0,
      codexMedia: Number.isInteger(payload.codexMedia)
        ? Number(payload.codexMedia)
        : 0,
      telegramEnabled: payload.telegramEnabled === true,
      telegramStatus:
        typeof payload.telegramStatus === "string"
          ? payload.telegramStatus
          : "disabled",
      telegramSourceStatus:
        typeof payload.telegramSourceStatus === "string"
          ? payload.telegramSourceStatus
          : "unknown",
      telegramSourceLastSuccessAt:
        typeof payload.telegramSourceLastSuccessAt === "string"
          ? payload.telegramSourceLastSuccessAt
          : null,
      telegramSourceNewestAt:
        typeof payload.telegramSourceNewestAt === "string"
          ? payload.telegramSourceNewestAt
          : null,
      telegramSourceLastAnalyzedAt:
        typeof payload.telegramSourceLastAnalyzedAt === "string"
          ? payload.telegramSourceLastAnalyzedAt
          : null,
      telegramSourceAnalyzedNewestAt:
        typeof payload.telegramSourceAnalyzedNewestAt === "string"
          ? payload.telegramSourceAnalyzedNewestAt
          : null,
      telegramSourceMessages: Number.isInteger(payload.telegramSourceMessages)
        ? Number(payload.telegramSourceMessages)
        : 0,
      telegramSourceMedia: Number.isInteger(payload.telegramSourceMedia)
        ? Number(payload.telegramSourceMedia)
        : 0,
      telegramSources: Array.isArray(payload.telegramSources)
        ? payload.telegramSources
        : [],
      activity: Array.isArray(payload.activity) ? payload.activity : [],
      hermesAudit:
        payload.hermesAudit &&
        typeof payload.hermesAudit === "object" &&
        !Array.isArray(payload.hermesAudit)
          ? payload.hermesAudit
          : null,
    });
  } catch {
    return response(safeBundledForecast(), {
      checkedAt: null,
      source: "bundled",
      degraded: true,
      status: "degraded",
    });
  }
}
