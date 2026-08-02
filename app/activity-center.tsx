"use client";

import { useEffect, useMemo, useState } from "react";

export type AstroItem = {
  id: string;
  source: "x" | "telegram";
  channels: string[];
  postedAt: string | null;
  activityAt: string | null;
  seenAt: string | null;
  analyzedAt: string | null;
  outcome:
    | "queued"
    | "confirmed"
    | "changed"
    | "deferred"
    | "read";
  text: string;
  url: string | null;
  hasMedia: boolean;
};

export type ConsoleEvent = {
  id?: string;
  at: string;
  service?:
    | "telegram"
    | "x"
    | "scanner"
    | "hermes"
    | "notifications"
    | "school"
    | "system";
  kind?: string;
  stage: string;
  status: "working" | "done" | "quiet" | "warning" | "error";
  importance?: "normal" | "important" | "alert";
  title: string;
  detail: string;
};

type LessonSource = {
  ref: string;
  source?: string;
  date?: string;
  author?: string;
  excerpt?: string;
};

type LearningLesson = {
  id: string;
  rule: string;
  category: string;
  connection:
    | "used_in_accepted_forecast"
    | "selected_for_current_research"
    | "available_to_hermes";
  sources: LessonSource[];
};

type SchoolAudit = {
  progress: {
    processed: number;
    total: number;
    percent: number;
    lessons: number;
    pendingReview: number;
  };
  improvement: {
    behavior: {
      resolved: number;
      hits: number;
      wrong: number;
      hitRate: number | null;
      requiredExamples: number;
      readyForResearch: boolean;
      direction: "too_early" | "improving" | "declining" | "flat";
    };
    mode: string;
  };
  lessons: LearningLesson[];
};

type ReasonerState = {
  status?: string;
  provider?: string;
  stage?: string;
  material?: boolean;
  remaining?: number;
  error?: string;
} | null;

function relativeTime(value: string | null | undefined, now: number) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time)) return "time unknown";
  const seconds = Math.max(0, Math.floor((now - time) / 1_000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function absoluteTime(value: string | null | undefined) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function outcomeCopy(outcome: AstroItem["outcome"]) {
  const copy = {
    queued: {
      label: "WAITING FOR HERMES",
      title: "The post was seen. Analysis has not finished.",
      tone: "waiting",
    },
    deferred: {
      label: "DEEPER REVIEW QUEUED",
      title: "The post is safe, but the deeper model reached its usage limit.",
      tone: "warning",
    },
    confirmed: {
      label: "PLAN CONFIRMED",
      title: "Hermes read it. The existing plan still fits.",
      tone: "confirmed",
    },
    changed: {
      label: "PLAN CHANGED",
      title: "Hermes read it and updated the saved plan.",
      tone: "changed",
    },
    read: {
      label: "READ BY HERMES",
      title: "Hermes processed this source.",
      tone: "confirmed",
    },
  };
  return copy[outcome];
}

function serviceName(service?: ConsoleEvent["service"]) {
  return (
    {
      x: "GROK",
      hermes: "HERMES · LUNA",
      school: "DEEPSEEK",
      telegram: "TELEGRAM READER",
      scanner: "MONITOR",
      notifications: "ALERT BOT",
      system: "SYSTEM",
    }[service || "system"] || "SYSTEM"
  );
}

function lessonConnection(connection: LearningLesson["connection"]) {
  if (connection === "used_in_accepted_forecast") return "USED IN CURRENT PLAN";
  if (connection === "selected_for_current_research") return "BEING TESTED";
  return "SAVED IN MEMORY";
}

export default function ActivityCenter({
  items,
  activity,
  reasoner,
  now,
  sourceSummary,
}: {
  items: AstroItem[];
  activity: ConsoleEvent[];
  reasoner: ReasonerState;
  now: number;
  sourceSummary: {
    telegram: string;
    x: string;
  };
}) {
  const [mode, setMode] = useState<"posts" | "console" | "learning">("posts");
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [consoleScope, setConsoleScope] = useState<"ai" | "all">("ai");
  const [school, setSchool] = useState<SchoolAudit | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/live-history?ts=${Date.now()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          schoolAudit?: SchoolAudit | null;
        };
        if (active && response.ok && payload.schoolAudit) {
          setSchool(payload.schoolAudit);
        }
      } catch {
        // The source and console feeds remain usable while school reconnects.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const latest = items[0] ?? null;
  const latestOutcome = latest ? outcomeCopy(latest.outcome) : null;
  const visiblePosts = showAllPosts ? items : items.slice(0, 12);
  const consoleEvents = useMemo(() => {
    const aiServices = new Set(["x", "hermes", "school", "notifications"]);
    return [...activity]
      .reverse()
      .filter(
        (event) =>
          consoleScope === "all" || aiServices.has(event.service || "system"),
      )
      .slice(0, 60);
  }, [activity, consoleScope]);
  const connectedLessons = useMemo(
    () =>
      [...(school?.lessons ?? [])].sort((left, right) => {
        const rank = {
          used_in_accepted_forecast: 0,
          selected_for_current_research: 1,
          available_to_hermes: 2,
        };
        return rank[left.connection] - rank[right.connection];
      }),
    [school],
  );
  const behavior = school?.improvement.behavior;

  return (
    <section className="activity-center">
      <header className="activity-hero">
        <div>
          <span>RECORDED ACTIVITY · NO FAKE THINKING</span>
          <h1>Updates</h1>
          <p>See what Astro posted, what each AI actually did, and what Hermes learned.</p>
        </div>
        <div className="activity-source-health">
          <span><i /> Telegram {sourceSummary.telegram}</span>
          <span><i /> X {sourceSummary.x}</span>
        </div>
      </header>

      <nav className="activity-switch" aria-label="Update sections">
        <button
          className={mode === "posts" ? "active" : ""}
          onClick={() => setMode("posts")}
        >
          <strong>Astro posts</strong>
          <small>{items.length} captured</small>
        </button>
        <button
          className={mode === "console" ? "active" : ""}
          onClick={() => setMode("console")}
        >
          <strong>AI console</strong>
          <small>Real actions</small>
        </button>
        <button
          className={mode === "learning" ? "active" : ""}
          onClick={() => setMode("learning")}
        >
          <strong>Learning</strong>
          <small>Proof, not claims</small>
        </button>
      </nav>

      {mode === "posts" && (
        <div className="astro-feed">
          {latest && latestOutcome && (
            <article className={`latest-processing ${latestOutcome.tone}`}>
              <div>
                <small>LATEST ASTRO UPDATE</small>
                <strong>{latestOutcome.label}</strong>
                <p>{latestOutcome.title}</p>
              </div>
              <ol aria-label="Latest update processing">
                <li className="done"><i>1</i><span>Seen</span></li>
                <li className={latest.analyzedAt ? "done" : latest.outcome === "deferred" ? "warning" : ""}>
                  <i>2</i><span>{latest.analyzedAt ? "Hermes read it" : "Waiting for Hermes"}</span>
                </li>
                <li className={["confirmed", "changed", "read"].includes(latest.outcome) ? "done" : latest.outcome === "deferred" ? "warning" : ""}>
                  <i>3</i><span>{latest.outcome === "changed" ? "Plan changed" : latest.outcome === "confirmed" ? "Plan confirmed" : latest.outcome === "deferred" ? "Review queued" : "Decision pending"}</span>
                </li>
              </ol>
            </article>
          )}

          <div className="astro-post-list">
            {visiblePosts.length ? (
              visiblePosts.map((item) => {
                const result = outcomeCopy(item.outcome);
                return (
                  <article className="astro-post" key={item.id}>
                    <header>
                      <div>
                        {item.channels.map((channel) => (
                          <span className={item.source} key={channel}>{channel}</span>
                        ))}
                        {item.hasMedia && <span className="media">CHART / MEDIA</span>}
                      </div>
                      <time title={absoluteTime(item.activityAt || item.postedAt)}>
                        {relativeTime(item.activityAt || item.postedAt, now)}
                      </time>
                    </header>
                    <p>{item.text}</p>
                    <footer>
                      <span className={`post-result ${result.tone}`}>
                        <i /> {result.label}
                      </span>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer">Open original ↗</a>
                      )}
                    </footer>
                  </article>
                );
              })
            ) : (
              <article className="activity-empty">
                <strong>Waiting for the first connected Astro post.</strong>
                <p>The saved plan remains visible on the Now page.</p>
              </article>
            )}
          </div>
          {items.length > 12 && (
            <button
              className="activity-more"
              onClick={() => setShowAllPosts((shown) => !shown)}
            >
              {showAllPosts ? "Show newest 12" : `Show all ${items.length} captured posts`}
            </button>
          )}
        </div>
      )}

      {mode === "console" && (
        <div className="ai-console-shell">
          <header>
            <div>
              <span><i /> LIVE ACTION LOG</span>
              <strong>What the models are doing</strong>
            </div>
            <div className="console-filter">
              <button className={consoleScope === "ai" ? "active" : ""} onClick={() => setConsoleScope("ai")}>AI only</button>
              <button className={consoleScope === "all" ? "active" : ""} onClick={() => setConsoleScope("all")}>Everything</button>
            </div>
          </header>
          {reasoner && ["rate_limited", "degraded"].includes(reasoner.status || "") && (
            <article className="console-warning">
              <strong>Hermes needs attention</strong>
              <p>
                {reasoner.status === "rate_limited"
                  ? "Luna reached its current usage limit. New evidence stays saved, but a deeper review may be queued."
                  : reasoner.error || "The deeper Hermes review is temporarily unavailable."}
              </p>
            </article>
          )}
          <div className="ai-console" aria-live="polite">
            {consoleEvents.length ? consoleEvents.map((event, index) => (
              <article className={event.status} key={event.id || `${event.at}-${index}`}>
                <time>{relativeTime(event.at, now)}</time>
                <div>
                  <span>{serviceName(event.service)}</span>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </div>
              </article>
            )) : (
              <article className="quiet">
                <time>now</time>
                <div>
                  <span>SYSTEM</span>
                  <strong>No recorded AI action yet</strong>
                  <p>The console only displays work that actually happened.</p>
                </div>
              </article>
            )}
          </div>
          <p className="console-boundary">
            This is an action log, not private chain-of-thought. It records inputs checked, tools used, and accepted outcomes.
          </p>
        </div>
      )}

      {mode === "learning" && (
        <div className="learning-room">
          <section className="learning-score">
            <article>
              <small>ARCHIVE READ</small>
              <strong>{school ? `${school.progress.percent}%` : "—"}</strong>
              <p>{school ? `${school.progress.processed.toLocaleString()} of ${school.progress.total.toLocaleString()} items` : "Loading source audit…"}</p>
            </article>
            <article>
              <small>LESSONS SAVED</small>
              <strong>{school?.progress.lessons ?? "—"}</strong>
              <p>Each lesson keeps links back to Astro’s archive.</p>
            </article>
            <article className={behavior?.readyForResearch ? "ready" : "waiting"}>
              <small>IS HERMES SMARTER?</small>
              <strong>
                {behavior?.readyForResearch
                  ? `${behavior.hitRate ?? "—"}% right`
                  : "TOO EARLY"}
              </strong>
              <p>
                {behavior
                  ? `${behavior.hits} right · ${behavior.wrong} wrong · ${behavior.resolved}/${behavior.requiredExamples} answer keys`
                  : "Waiting for scored predictions."}
              </p>
            </article>
          </section>

          <header className="lesson-heading">
            <div>
              <span>WHAT DEEPSEEK FOUND · WHAT HERMES CAN USE</span>
              <strong>Source-checked Astro lessons</strong>
            </div>
            <p>Saved lessons do not change the live plan unless fresh evidence also supports them.</p>
          </header>
          <div className="lesson-list">
            {connectedLessons.slice(0, 16).map((lesson) => (
              <article key={lesson.id}>
                <header>
                  <span>{lessonConnection(lesson.connection)}</span>
                  <small>{lesson.category}</small>
                </header>
                <strong>{lesson.rule}</strong>
                <details>
                  <summary>{lesson.sources.length} Astro source{lesson.sources.length === 1 ? "" : "s"} <b>+</b></summary>
                  <div>
                    {lesson.sources.slice(0, 4).map((source) => (
                      <blockquote key={source.ref}>
                        <p>{source.excerpt || source.ref}</p>
                        <cite>{source.author || source.source || "Astro archive"}{source.date ? ` · ${source.date}` : ""}</cite>
                      </blockquote>
                    ))}
                  </div>
                </details>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
