"use client";

import { useEffect, useMemo, useState } from "react";

type LearningLesson = {
  id: string;
  rule: string;
  category: string;
  sources: Array<{ ref: string }>;
  connection:
    | "used_in_accepted_forecast"
    | "selected_for_current_research"
    | "available_to_hermes";
};

type LearningAudit = {
  progress: {
    processed: number;
    total: number;
    percent: number;
    lessons: number;
  };
  lessons: LearningLesson[];
  improvement: {
    behavior: {
      resolved: number;
      hits: number;
      wrong: number;
      hitRate: number | null;
      requiredExamples: number;
      readyForResearch: boolean;
      recentRate: number | null;
      delta: number | null;
      direction: "too_early" | "improving" | "declining" | "flat";
    };
  };
};

function connectionLabel(connection: LearningLesson["connection"]) {
  if (connection === "used_in_accepted_forecast") return "USED IN THE CURRENT READ";
  if (connection === "selected_for_current_research") return "BEING TESTED NOW";
  return "SAVED IN MEMORY";
}

export default function LearningPulse({ onOpen }: { onOpen: () => void }) {
  const [audit, setAudit] = useState<LearningAudit | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/live-history?ts=${Date.now()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          schoolAudit?: LearningAudit | null;
        };
        if (!response.ok || !payload.schoolAudit || !active) return;
        setAudit(payload.schoolAudit);
      } catch {
        // The saved signal remains usable while the learning audit reconnects.
      }
    }
    void load();
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, []);

  const verdict = useMemo(() => {
    const behavior = audit?.improvement.behavior;
    if (!behavior) {
      return {
        label: "CHECKING",
        title: "Loading the real score…",
        body: "Hermes is not called smarter until later Astro actions score its frozen predictions.",
        tone: "waiting",
      };
    }
    if (!behavior.readyForResearch) {
      const remaining = Math.max(
        0,
        behavior.requiredExamples - behavior.resolved,
      );
      return {
        label: "TOO EARLY TO PROVE",
        title: `${behavior.hits} right · ${behavior.wrong} wrong`,
        body: `${remaining} more Astro answer ${
          remaining === 1 ? "key is" : "keys are"
        } needed before we judge improvement.`,
        tone: "waiting",
      };
    }
    if (behavior.direction === "improving") {
      return {
        label: "IMPROVING",
        title: `${behavior.recentRate}% right recently`,
        body: `Up ${behavior.delta ?? 0} points against the previous matched window.`,
        tone: "better",
      };
    }
    if (behavior.direction === "declining") {
      return {
        label: "NEEDS ADJUSTMENT",
        title: `${behavior.recentRate}% right recently`,
        body: `Down ${Math.abs(behavior.delta ?? 0)} points. Changes remain in shadow testing.`,
        tone: "worse",
      };
    }
    return {
      label: "NO CLEAR IMPROVEMENT YET",
      title: `${behavior.hitRate ?? "—"}% right overall`,
      body: "The measured result is not clearly better or worse yet.",
      tone: "flat",
    };
  }, [audit]);

  const featuredLesson =
    audit?.lessons.find(
      (lesson) => lesson.connection === "used_in_accepted_forecast",
    ) ??
    audit?.lessons.find(
      (lesson) => lesson.connection === "selected_for_current_research",
    ) ??
    audit?.lessons[0] ??
    null;

  return (
    <section className="home-learning-pulse">
      <header>
        <div>
          <small>HERMES LEARNING</small>
          <h2>Is it actually getting smarter?</h2>
        </div>
        <button onClick={onOpen}>Open Night School →</button>
      </header>

      <div className="home-learning-grid">
        <article className={`learning-verdict ${verdict.tone}`}>
          <small>{verdict.label}</small>
          <strong>{verdict.title}</strong>
          <p>{verdict.body}</p>
        </article>

        <article className="learning-numbers">
          <div>
            <small>ARCHIVE READ</small>
            <strong>{audit ? `${audit.progress.percent}%` : "—"}</strong>
          </div>
          <div>
            <small>LESSONS SAVED</small>
            <strong>{audit?.progress.lessons ?? "—"}</strong>
          </div>
          <div>
            <small>ANSWER KEYS</small>
            <strong>
              {audit
                ? `${audit.improvement.behavior.resolved}/${audit.improvement.behavior.requiredExamples}`
                : "—"}
            </strong>
          </div>
        </article>

        <article className="learning-current">
          <small>
            {featuredLesson
              ? connectionLabel(featuredLesson.connection)
              : "CURRENT LEARNING"}
          </small>
          <strong>
            {featuredLesson?.rule ||
              "Waiting for the next source-checked Astro lesson."}
          </strong>
          <p>
            {featuredLesson
              ? `${featuredLesson.category.toUpperCase()} · ${
                  featuredLesson.sources.length
                } cited source${featuredLesson.sources.length === 1 ? "" : "s"}`
              : "Reading more messages alone does not count as improvement."}
          </p>
        </article>
      </div>
    </section>
  );
}
