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
    return response(bundledForecast, {
      checkedAt: null,
      source: "bundled",
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
      hermesAudit:
        payload.hermesAudit &&
        typeof payload.hermesAudit === "object" &&
        !Array.isArray(payload.hermesAudit)
          ? payload.hermesAudit
          : null,
    });
  } catch {
    return response(bundledForecast, {
      checkedAt: null,
      source: "bundled",
      degraded: true,
    });
  }
}
