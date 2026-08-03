import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { callDeepSeekJson } from "./deepseek-client.mjs";

export const HERMES_CHAT_MAX_QUESTION = 1_000;
export const HERMES_CHAT_MAX_HISTORY = 6;
const HERMES_CHAT_MAX_TOKENS = 1_000;

function clip(value, limit = 800) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function compactForecast(forecast = {}) {
  return {
    generatedAt: forecast.generatedAt ?? null,
    signal: forecast.signal ?? null,
    decision: forecast.decision ?? null,
    execution: forecast.execution ?? null,
    thesis: forecast.thesis ?? null,
    hermes: forecast.hermes ?? null,
    scenarios: Array.isArray(forecast.scenarios)
      ? forecast.scenarios.slice(0, 3)
      : [],
    directEvidence: Array.isArray(forecast.evidence)
      ? forecast.evidence
          .filter((item) => item?.type === "astro" && item?.source)
          .slice(0, 8)
          .map((item) => ({
            label: clip(item.label, 120),
            detail: clip(item.detail, 900),
            source: item.source,
            time: item.time ?? null,
          }))
      : [],
  };
}

function compactTelegram(telegram = {}) {
  return (Array.isArray(telegram.messages) ? telegram.messages : [])
    .slice(-12)
    .map((message) => ({
      ref: clip(message.id, 160),
      chat: clip(message.chatTitle, 120),
      at: message.activityAt ?? message.editedAt ?? message.postedAt ?? null,
      text: clip(message.text, 1_200),
    }));
}

function compactX(x = {}) {
  return (Array.isArray(x.posts) ? x.posts : [])
    .slice(0, 8)
    .map((post) => ({
      id: post.statusId ?? null,
      at: post.postedAt ?? post.createdAt ?? null,
      text: clip(post.text, 1_200),
      url: post.url ?? null,
    }));
}

function compactHistory(history = {}) {
  const predictions = Array.isArray(history.hermesPredictions)
    ? history.hermesPredictions
    : [];
  const behavior = Array.isArray(history.behaviorPredictions)
    ? history.behaviorPredictions
    : [];
  return {
    latestMarketMap: predictions.at(-1) ?? null,
    latestBehaviorMap: behavior.at(-1) ?? null,
  };
}

function cleanSources(value) {
  return Array.isArray(value)
    ? value
        .filter((source) =>
          typeof source === "string" &&
          /^https:\/\/x\.com\/astronomer_zero\/status\/\d+$/.test(source),
        )
        .slice(0, 4)
    : [];
}

export function normalizeChatAnswer(value) {
  const answer = clip(value?.answer, 2_400);
  if (!answer) return null;
  const levels = Array.isArray(value?.levels)
    ? value.levels
        .map((level) => ({
          label: clip(level?.label, 40).toUpperCase(),
          value: clip(level?.value, 120),
        }))
        .filter((level) => level.label && level.value)
        .slice(0, 6)
    : [];
  return {
    answer,
    astro: clip(value?.astro, 800),
    hermes: clip(value?.hermes, 800),
    watch: clip(value?.watch, 800),
    levels,
    sources: cleanSources(value?.sources),
    confidence: Number.isFinite(Number(value?.confidence))
      ? Math.max(0, Math.min(100, Math.round(Number(value.confidence))))
      : null,
  };
}

export function markPendingChatAnswer(answer, pendingReview) {
  if (!pendingReview || !answer) return answer;
  return {
    ...answer,
    answer: `REVIEW PENDING — ${answer.answer}`.slice(0, 2_400),
    astro: `Unapproved new-source read: ${answer.astro || "Not confirmed"}`.slice(
      0,
      800,
    ),
    hermes: `Preview only, not the saved plan: ${answer.hermes || "No saved prediction"}`.slice(
      0,
      800,
    ),
    confidence:
      answer.confidence === null ? null : Math.min(answer.confidence, 50),
  };
}

export function buildHermesChatPrompt({
  question,
  conversation = [],
  forecast,
  state,
  thesis,
  telegram,
  x,
  history,
}) {
  const safeConversation = (Array.isArray(conversation) ? conversation : [])
    .slice(-HERMES_CHAT_MAX_HISTORY)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: clip(message?.content, 800),
    }))
    .filter((message) => message.content);
  return `You are Hermes, the private research assistant for Astro Intelligence.
DeepSeek is the language model answering this chat. The user wants short,
plain-English research answers about what Astro confirmed, what Hermes predicts,
and what would change the read.

Rules:
- Do not claim to know Astro's private intent.
- Keep direct Astro facts separate from Hermes inference.
- Use only exact public X URLs as public Astro citations.
- Telegram is private context for the owner's research; paraphrase it and never
  present it as a public quote.
- Never place, recommend, or execute an autonomous trade.
- Do not reveal chain-of-thought. Give a compact reason summary instead.
- If the latest source is newer than the accepted forecast or review is blocked,
  say clearly that the saved plan is old/pending rather than pretending it is
  current.
- If entry, take-profit, or stop/exit levels are not public, write "Not public".
- Answer in the requested JSON shape only.

Return:
{
  "answer": "plain answer in 2-6 short sentences",
  "astro": "what Astro directly confirmed, or Not confirmed",
  "hermes": "Hermes' current prediction, or No saved prediction",
  "watch": "the next fact or price condition to watch",
  "levels": [{"label":"IN|TP|SL|WATCH", "value":"value or Not public"}],
  "sources": ["exact public Astro X status URLs only"],
  "confidence": 0-100 or null
}

USER QUESTION:
${clip(question, HERMES_CHAT_MAX_QUESTION)}

RECENT CHAT:
${JSON.stringify(safeConversation)}

CURRENT ACCEPTED FORECAST:
${JSON.stringify(compactForecast(forecast))}

RUNTIME STATUS:
${JSON.stringify({
  checkedAt: state?.checkedAt ?? null,
  forecastGeneratedAt: state?.forecastGeneratedAt ?? null,
  status: state?.status ?? null,
  reasoner: state?.reasoner ?? null,
  pendingAnalysis: state?.pendingAnalysis ?? null,
  marketPrice: state?.marketPrice ?? null,
  marketCandleAt: state?.marketCandleAt ?? null,
})}

DEEPSEEK BACKGROUND THESIS:
${JSON.stringify({
  updatedAt: thesis?.updatedAt ?? null,
  status: thesis?.status ?? null,
  thesis: thesis?.thesis ?? null,
  school: thesis?.school ?? null,
})}

APPROVED PRIVATE TELEGRAM CONTEXT (PARAPHRASE ONLY):
${JSON.stringify(compactTelegram(telegram))}

PUBLIC X SCOUT CONTEXT:
${JSON.stringify(compactX(x))}

HERMES AUDIT HISTORY:
${JSON.stringify(compactHistory(history))}`;
}

function unavailableReason(reason) {
  if (reason === "daily_cap") return "DeepSeek chat reached its daily limit. Try again later.";
  if (reason === "provider_rate_limit") return "DeepSeek is rate-limited right now. Try again shortly.";
  if (reason === "not_configured") return "DeepSeek chat is not configured on the VPS.";
  return "DeepSeek did not return a safe answer. The saved plan was not changed.";
}

export async function answerHermesQuestion({
  question,
  conversation = [],
  stateDirectory = process.env.ASTRO_STATE_DIR?.trim() || "/var/lib/astro-signal",
} = {}) {
  const normalizedQuestion = clip(question, HERMES_CHAT_MAX_QUESTION);
  if (!normalizedQuestion) {
    return { status: "invalid", error: "Ask a question first." };
  }
  const [forecast, state, thesis, telegram, x, history] = await Promise.all([
    readJson(join(stateDirectory, "forecast.json"), {}),
    readJson(join(stateDirectory, "state.json"), {}),
    readJson(join(stateDirectory, "deepseek-thesis.json"), {}),
    readJson(join(stateDirectory, "telegram-source.json"), {}),
    readJson(join(stateDirectory, "x-source.json"), {}),
    readJson(join(stateDirectory, "history.json"), {}),
  ]);
  const result = await callDeepSeekJson({
    budgetPath: join(stateDirectory, "deepseek-chat-budget.json"),
    dailyCap: Math.max(
      1,
      Number.parseInt(process.env.ASTRO_DEEPSEEK_CHAT_DAILY_CAP || "24", 10),
    ),
    system:
      "You are the DeepSeek V4 Flash response layer inside Hermes. Follow the supplied safety and evidence boundaries exactly.",
    prompt: buildHermesChatPrompt({
      question: normalizedQuestion,
      conversation,
      forecast,
      state,
      thesis,
      telegram,
      x,
      history,
    }),
    maxTokens: HERMES_CHAT_MAX_TOKENS,
    reasoningEffort: "none",
    timeoutMs: 45_000,
  });
  if (!result.available) {
    return {
      status: "unavailable",
      provider: "deepseek-v4-flash",
      error: unavailableReason(result.reason),
      reason: result.reason,
      context: {
        forecastGeneratedAt: state?.forecastGeneratedAt ?? forecast?.generatedAt ?? null,
        checkedAt: state?.checkedAt ?? null,
      },
    };
  }
  const answer = normalizeChatAnswer(result.value);
  if (!answer) {
    return {
      status: "unavailable",
      provider: result.model ?? "deepseek-v4-flash",
      error: "DeepSeek returned an incomplete answer. The saved plan was not changed.",
      reason: "invalid_answer",
    };
  }
  const pendingReview = Boolean(state?.pendingAnalysis);
  const safeAnswer = markPendingChatAnswer(answer, pendingReview);
  return {
    status: "ok",
    provider: result.model ?? "deepseek-v4-flash",
    answer: safeAnswer,
    context: {
      forecastGeneratedAt: state?.forecastGeneratedAt ?? forecast?.generatedAt ?? null,
      checkedAt: state?.checkedAt ?? null,
      marketPrice: state?.marketPrice ?? null,
      pendingReview: Boolean(state?.pendingAnalysis),
    },
    budgetRemaining: result.budget?.remaining ?? null,
  };
}
