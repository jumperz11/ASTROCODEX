import { consumeBudget } from "./provider-budget.mjs";

function configuration() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const configuredUrl = process.env.DEEPSEEK_BASE_URL?.trim();
  const openRouter =
    Boolean(apiKey?.startsWith("sk-or-")) ||
    Boolean(configuredUrl?.includes("openrouter.ai"));
  return {
    apiKey,
    openRouter,
    url:
      configuredUrl ||
      (openRouter
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.deepseek.com/chat/completions"),
    model:
      process.env.ASTRO_DEEPSEEK_MODEL?.trim() ||
      (openRouter
        ? "deepseek/deepseek-v4-flash-0731"
        : "deepseek-v4-flash"),
  };
}

export async function callDeepSeekJson({
  budgetPath,
  dailyCap,
  system,
  prompt,
  maxTokens = 1_200,
  reasoningEffort = "none",
  timeoutMs = 60_000,
}) {
  const config = configuration();
  if (!config.apiKey) {
    return { available: false, reason: "not_configured" };
  }
  const budget = await consumeBudget(budgetPath, dailyCap);
  if (!budget.accepted) {
    return { available: false, reason: "daily_cap", budget };
  }
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        ...(config.openRouter
          ? { reasoning: { effort: reasoningEffort } }
          : {
              thinking: {
                type: reasoningEffort === "none" ? "disabled" : "enabled",
              },
            }),
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        available: false,
        reason:
          response.status === 429
            ? "provider_rate_limit"
            : `http_${response.status}`,
        budget,
      };
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { available: false, reason: "empty_response", budget };
    }
    let value;
    try {
      value = JSON.parse(content);
    } catch {
      return { available: false, reason: "invalid_json", budget };
    }
    return {
      available: true,
      value,
      budget,
      model: config.model,
    };
  } catch {
    return { available: false, reason: "request_failed", budget };
  }
}
