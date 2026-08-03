"use client";

import { FormEvent, useMemo, useState } from "react";

type ChatLevel = { label: string; value: string };

type ChatAnswer = {
  answer: string;
  astro?: string;
  hermes?: string;
  watch?: string;
  levels?: ChatLevel[];
  sources?: string[];
  confidence?: number | null;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  answer?: ChatAnswer;
};

function answerText(answer: ChatAnswer) {
  return [answer.answer, answer.astro, answer.hermes, answer.watch]
    .filter(Boolean)
    .join(" ");
}

export default function HermesChat({
  reviewBlocked,
  reviewPending,
  signal,
}: {
  reviewBlocked: boolean;
  reviewPending: boolean;
  signal: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Ask me about Astro’s confirmed position, the saved Hermes prediction, IN / TP / SL, or what would change the read. I use DeepSeek on the VPS and never change the plan from chat.",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const suggestions = useMemo(
    () => [
      "What is Astro doing now?",
      "What are the current IN, TP, and SL levels?",
      "What does Hermes predict next, and what would prove it wrong?",
    ],
    [],
  );

  async function ask(value: string) {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/hermes-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          conversation: [...messages, userMessage].slice(-6).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });
      const payload = (await response.json()) as {
        status?: string;
        error?: string;
        answer?: ChatAnswer;
      };
      if (!response.ok || payload.status !== "ok" || !payload.answer?.answer) {
        throw new Error(payload.error || "Hermes could not answer right now.");
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: answerText(payload.answer),
          answer: payload.answer,
        },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Hermes could not answer right now.",
      );
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <section className="hermes-chat-view" aria-label="Ask Hermes">
      <header className="hermes-chat-head">
        <div>
          <span className="eyebrow">PRIVATE RESEARCH CHAT</span>
          <h1>Ask Hermes</h1>
          <p>
            Plain answers from DeepSeek using the current Astro sources, Hermes
            map, Codex lessons, and live status. Chat cannot save a forecast or
            place a trade.
          </p>
        </div>
        <div className="hermes-chat-status">
          <span><i /> DEEPSEEK · VPS</span>
          <strong>{signal.replaceAll("_", " ").toUpperCase()}</strong>
          <small>
            {reviewBlocked
              ? "New Astro information is waiting for model capacity."
              : reviewPending
                ? "The latest source is queued for review."
                : "Using the latest accepted review."}
          </small>
        </div>
      </header>

      <div className="hermes-chat-suggestions" aria-label="Suggested questions">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={sending}
            onClick={() => void ask(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="hermes-chat-log" aria-live="polite">
        {messages.map((message, index) => (
          <article className={`hermes-chat-message ${message.role}`} key={`${message.role}-${index}`}>
            <small>{message.role === "user" ? "YOU" : "HERMES · DEEPSEEK"}</small>
            <p>{message.content}</p>
            {message.answer && (
              <div className="hermes-chat-facts">
                <article>
                  <small>ASTRO CONFIRMED</small>
                  <strong>{message.answer.astro || "Not confirmed"}</strong>
                </article>
                <article>
                  <small>HERMES PREDICTS</small>
                  <strong>{message.answer.hermes || "No saved prediction"}</strong>
                </article>
                <article>
                  <small>WATCH NEXT</small>
                  <strong>{message.answer.watch || "No change condition saved"}</strong>
                </article>
                {!!message.answer.levels?.length && (
                  <div className="hermes-chat-levels">
                    {message.answer.levels.map((level, levelIndex) => (
                      <span key={`${level.label}-${levelIndex}`}>
                        <b>{level.label}</b> {level.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
        {sending && (
          <article className="hermes-chat-message assistant working">
            <small>HERMES · DEEPSEEK</small>
            <p>Checking the saved plan and latest sources…</p>
          </article>
        )}
      </div>

      {error && <p className="hermes-chat-error">{error}</p>}

      <form className="hermes-chat-form" onSubmit={submit}>
        <label htmlFor="hermes-question">Ask a simple question</label>
        <div>
          <input
            id="hermes-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Did Astro enter, take profit, or close?"
            maxLength={1_000}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !question.trim()}>
            {sending ? "Checking…" : "Ask Hermes"}
          </button>
        </div>
      </form>
    </section>
  );
}
