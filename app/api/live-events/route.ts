export const dynamic = "force-dynamic";

type RemoteEventsEnvelope = {
  status?: unknown;
  checkedAt?: unknown;
  runId?: unknown;
  telegramSourceStatus?: unknown;
  telegramSourceLastSuccessAt?: unknown;
  telegramSourceNewestAt?: unknown;
  telegramSourceMessages?: unknown;
  telegramSourceMedia?: unknown;
  telegramSources?: unknown;
  xSourceStatus?: unknown;
  xSourceLastSuccessAt?: unknown;
  xSourceNewestAt?: unknown;
  xSourceBudget?: unknown;
  reasoner?: unknown;
  activity?: unknown;
  astroItems?: unknown;
  liveEventCursor?: unknown;
};

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function privateJson(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

export async function GET() {
  const signalUrl = process.env.ASTRO_SIGNAL_URL?.trim();
  const signalToken = process.env.ASTRO_SIGNAL_TOKEN?.trim();
  if (!signalUrl || !signalToken) {
    return privateJson(
      {
        status: "degraded",
        activity: [],
        astroItems: [],
        liveEventCursor: null,
      },
      503,
    );
  }

  try {
    const remoteUrl = new URL(signalUrl);
    remoteUrl.pathname = remoteUrl.pathname.replace(/\/signal\/?$/, "/events");
    if (!remoteUrl.pathname.endsWith("/events")) {
      remoteUrl.pathname = "/events";
    }
    remoteUrl.search = "";
    const remote = await fetch(remoteUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${signalToken}`,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!remote.ok) throw new Error("Live event source unavailable.");
    const payload = (await remote.json()) as RemoteEventsEnvelope;

    return privateJson({
      status:
        typeof payload.status === "string" ? payload.status : "unknown",
      checkedAt: stringOrNull(payload.checkedAt),
      runId: stringOrNull(payload.runId),
      telegramSourceStatus:
        typeof payload.telegramSourceStatus === "string"
          ? payload.telegramSourceStatus
          : "unknown",
      telegramSourceLastSuccessAt: stringOrNull(
        payload.telegramSourceLastSuccessAt,
      ),
      telegramSourceNewestAt: stringOrNull(
        payload.telegramSourceNewestAt,
      ),
      telegramSourceMessages: Number.isInteger(
        payload.telegramSourceMessages,
      )
        ? Number(payload.telegramSourceMessages)
        : 0,
      telegramSourceMedia: Number.isInteger(payload.telegramSourceMedia)
        ? Number(payload.telegramSourceMedia)
        : 0,
      telegramSources: Array.isArray(payload.telegramSources)
        ? payload.telegramSources
        : [],
      xSourceStatus:
        typeof payload.xSourceStatus === "string"
          ? payload.xSourceStatus
          : "unknown",
      xSourceLastSuccessAt: stringOrNull(payload.xSourceLastSuccessAt),
      xSourceNewestAt: stringOrNull(payload.xSourceNewestAt),
      xSourceBudget:
        payload.xSourceBudget &&
        typeof payload.xSourceBudget === "object" &&
        !Array.isArray(payload.xSourceBudget)
          ? payload.xSourceBudget
          : null,
      reasoner:
        payload.reasoner &&
        typeof payload.reasoner === "object" &&
        !Array.isArray(payload.reasoner)
          ? payload.reasoner
          : null,
      activity: Array.isArray(payload.activity) ? payload.activity : [],
      astroItems: Array.isArray(payload.astroItems) ? payload.astroItems : [],
      liveEventCursor: stringOrNull(payload.liveEventCursor),
    });
  } catch {
    return privateJson(
      {
        status: "degraded",
        activity: [],
        astroItems: [],
        liveEventCursor: null,
      },
      503,
    );
  }
}
