import trackRecord from "../../track-record.json";

export const dynamic = "force-dynamic";

function payloadWithTrackRecord(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { updatedAt: null, daily: [], plays: [], trackRecord, degraded: true };
  }
  const remote = payload as Record<string, unknown>;
  const remoteTrackRecord = remote.trackRecord;
  const hasRemoteTrackRecord =
    remoteTrackRecord &&
    typeof remoteTrackRecord === "object" &&
    !Array.isArray(remoteTrackRecord) &&
    Array.isArray((remoteTrackRecord as Record<string, unknown>).plays);
  return {
    ...remote,
    trackRecord: hasRemoteTrackRecord ? remoteTrackRecord : trackRecord,
  };
}

export async function GET() {
  const signalUrl = process.env.ASTRO_SIGNAL_URL?.trim();
  const signalToken = process.env.ASTRO_SIGNAL_TOKEN?.trim();
  if (!signalUrl || !signalToken) {
    return Response.json(
      payloadWithTrackRecord(null),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }

  try {
    const historyUrl = new URL(signalUrl);
    historyUrl.pathname = "/history";
    historyUrl.search = "";
    const remote = await fetch(historyUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${signalToken}`,
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (!remote.ok) throw new Error("History source unavailable.");
    const payload = await remote.json();
    return Response.json(payloadWithTrackRecord(payload), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return Response.json(
      payloadWithTrackRecord(null),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
