import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const fallback = {
  generatedAt: new Date().toISOString(),
  mode: "demo",
  market: "BTC / USD",
  stance: "Long active · profits being realized",
  stanceTone: "long",
  confidence: 72,
  headline: "Protect the long. Do not chase the fifth win.",
  summary:
    "Astro publicly flipped his closed shorts into a long, then reported trims as price advanced. The observable behavior is execution-first: lock profit into strength while leaving room for the remaining thesis.",
  nextMove:
    "Most likely: protect the remaining long, watch the referenced “safe house,” and wait for fresh confirmation before adding. A new short is not supported by the latest public sequence yet.",
  invalidation:
    "A decisive failure back through the post-bounce structure would weaken the long thesis. Exact invalidation is not public in the visible thread.",
  waitFor:
    "A fresh Astro post, a clearly stated target, or a structure change that explains what “safe house” means on his chart.",
  bias: {
    cyclical: "Range / repair",
    weekly: "Bottoming range",
    swing: "Bullish recovery",
  },
  framework: {
    phase: "Trend → range",
    typeA: "Retest sequence active",
    sentiment: "Cautious after rebound",
    score: "Not enough live inputs",
  },
  levels: [
    { label: "Public long area", value: "~64.0K", kind: "entry" },
    { label: "Reported trim", value: "67.7K", kind: "trim" },
    { label: "Exact risk", value: "Not public", kind: "risk" },
  ],
  evidence: [
    {
      type: "astro",
      label: "Astro said",
      detail:
        "“Fully closed shorts IV, and started flipping it into a long.”",
      source: "https://x.com/astronomer_zero/status/2082560085994434700",
      time: "Latest public sequence",
    },
    {
      type: "framework",
      label: "Framework-derived",
      detail:
        "Astro’s archive favors gradual execution and staged profit realization.",
      time: "Codex Ch. 2–3",
    },
    {
      type: "inference",
      label: "Our inference",
      detail:
        "The next likely action is management of a runner rather than an immediate fresh full-size position.",
      time: "Model synthesis",
    },
  ],
  scenarios: [
    {
      name: "Continuation",
      probability: 48,
      description:
        "The recovery extends; Astro continues trimming into strength and protects a runner.",
      trigger: "Hold above the post-bounce structure",
    },
    {
      name: "Retest",
      probability: 34,
      description:
        "Price revisits the developing range before another directional decision.",
      trigger: "Momentum stalls after the public trims",
    },
    {
      name: "Thesis failure",
      probability: 18,
      description:
        "The bounce fails and the public long is closed or materially reduced.",
      trigger: "Confirmed structure failure",
    },
  ],
  sources: [
    {
      label: "Astro · latest long thesis",
      url: "https://x.com/astronomer_zero/status/2082560085994434700",
    },
    {
      label: "Astro · reported profit trim",
      url: "https://x.com/astronomer_zero/status/2082796525126856769",
    },
  ],
  caveat:
    "This is a timestamped inference from public posts and the archived framework—not Astro’s private intent, financial advice, or a guaranteed trade.",
};

function extractText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = Array.isArray((item as { content?: unknown[] }).content)
        ? (item as { content: unknown[] }).content
        : [];
      return content.map((part) => {
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        return typeof record.text === "string"
          ? record.text
          : typeof record.output_text === "string"
            ? record.output_text
            : "";
      });
    })
    .filter(Boolean)
    .join("\n");
}

function parseJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Grok did not return structured analysis.");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.XAI_API_KEY;
  const body = (await request.json().catch(() => ({}))) as { question?: string };

  if (!apiKey) {
    return NextResponse.json({
      ...fallback,
      generatedAt: new Date().toISOString(),
      mode: "demo",
    });
  }

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 14);
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  const framework = `
ASTRO FRAMEWORK — apply carefully and never invent missing inputs:
1. Establish direction before execution. Bias timeframe is approximately execution timeframe × 12.
2. Classify bullish, bearish, or range; market alternates trend → range → trend.
3. Distinguish patterns (adaptable formats) from exact fractals.
4. A Type A retest follows capitulation → strong bounce → retest. Long-wick threshold was later specified as 4.8%; target centers near 0.57 of the developing range.
5. Sentiment confirms a pre-existing plan; it does not create the plan alone.
6. Prefer staged entry/exit, time-and-price compounding, and explicit soft versus catastrophic invalidation.
7. Top/bottom confidence needs minimally correlated price, time, volume, volatility, divergence and positioning evidence. If unavailable, say so.
8. Separate direct statement, framework-derived conclusion, and inference.
`;

  const prompt = `
You are the live intelligence layer for a private research dashboard following X user @astronomer_zero.
Today is ${iso(now)}.

User question: ${body.question || "What is Astro likely thinking and doing next?"}

${framework}

Search ONLY @astronomer_zero on X from ${iso(from)} through ${iso(now)}. Inspect relevant chart images.
Prioritize the most recent connected thread, quoted posts, position changes, entries, trims, targets, invalidations, metaphors that encode levels, and explicit uncertainty.
Do not infer a private intention with certainty. Do not turn a historical post into a current position.

Return ONLY one valid JSON object matching this shape:
{
  "market": "string",
  "stance": "short status line",
  "stanceTone": "long|short|neutral",
  "confidence": 0-100,
  "headline": "concise decision-oriented headline",
  "summary": "what is directly observable",
  "nextMove": "probabilistic forecast of his next action",
  "invalidation": "what would invalidate this reading",
  "waitFor": "most important missing confirmation",
  "bias": {"cyclical":"string","weekly":"string","swing":"string"},
  "framework": {"phase":"string","typeA":"string","sentiment":"string","score":"string"},
  "levels": [{"label":"string","value":"string","kind":"entry|trim|risk"}],
  "evidence": [{"type":"astro|framework|inference","label":"string","detail":"string","source":"X URL when direct","time":"string"}],
  "scenarios": [{"name":"string","probability":0-100,"description":"string","trigger":"string"}],
  "sources": [{"label":"string","url":"direct X status URL"}],
  "caveat": "clear uncertainty boundary"
}

Requirements:
- Scenario probabilities must total 100.
- Use direct X status URLs.
- Exact quotes must be brief and faithful.
- Unknown values must say "Not public" or "Insufficient inputs".
- Never output a command to buy or sell.
`;

  try {
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4.5",
        input: prompt,
        tools: [
          {
            type: "x_search",
            allowed_x_handles: ["astronomer_zero"],
            from_date: iso(from),
            to_date: iso(now),
            enable_image_understanding: true,
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`xAI request failed (${response.status}): ${detail.slice(0, 180)}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const report = parseJson(extractText(payload));

    return NextResponse.json({
      ...fallback,
      ...report,
      generatedAt: new Date().toISOString(),
      mode: "live",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The Grok analysis could not be completed.",
      },
      { status: 502 },
    );
  }
}
