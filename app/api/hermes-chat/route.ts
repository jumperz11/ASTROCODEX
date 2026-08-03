export const dynamic = "force-dynamic";

type ChatResponse = {
  status?: string;
  error?: string;
  answer?: unknown;
  provider?: string;
  context?: unknown;
  budgetRemaining?: number | null;
};

function privateJson(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function chatUrlFromSignal(signalUrl: string) {
  const url = new URL(signalUrl);
  url.pathname = url.pathname.replace(/\/signal\/?$/, "/chat");
  if (!url.pathname.endsWith("/chat")) url.pathname = "/chat";
  url.search = "";
  return url;
}

export async function POST(request: Request) {
  const signalUrl = process.env.ASTRO_SIGNAL_URL?.trim();
  const signalToken = process.env.ASTRO_SIGNAL_TOKEN?.trim();
  if (!signalUrl || !signalToken) {
    return privateJson(
      {
        status: "unavailable",
        error: "Hermes chat is not connected to the VPS.",
      },
      503,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ status: "invalid", error: "Send a JSON question." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return privateJson({ status: "invalid", error: "Send a question." }, 400);
  }

  const input = body as { question?: unknown; conversation?: unknown };
  if (typeof input.question !== "string" || !input.question.trim()) {
    return privateJson({ status: "invalid", error: "Ask a question first." }, 400);
  }

  try {
    const remote = await fetch(chatUrlFromSignal(signalUrl), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${signalToken}`,
      },
      body: JSON.stringify({
        question: input.question.slice(0, 1_000),
        conversation: Array.isArray(input.conversation)
          ? input.conversation.slice(-6)
          : [],
      }),
      signal: AbortSignal.timeout(55_000),
    });
    const payload = (await remote.json()) as ChatResponse;
    return privateJson(payload, remote.ok ? 200 : remote.status);
  } catch {
    return privateJson(
      {
        status: "unavailable",
        error: "Hermes chat could not reach the VPS. The saved plan is unchanged.",
      },
      503,
    );
  }
}
