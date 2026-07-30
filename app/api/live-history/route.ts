export const dynamic = "force-dynamic";

export async function GET() {
  const signalUrl = process.env.ASTRO_SIGNAL_URL?.trim();
  const signalToken = process.env.ASTRO_SIGNAL_TOKEN?.trim();
  if (!signalUrl || !signalToken) {
    return Response.json(
      { updatedAt: null, daily: [], plays: [], degraded: true },
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
    return Response.json(payload, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return Response.json(
      { updatedAt: null, daily: [], plays: [], degraded: true },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
