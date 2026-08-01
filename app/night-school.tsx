"use client";

import { useEffect, useMemo, useState } from "react";

type SchoolSource = {
  ref: string;
  source: string;
  date: string | null;
  author: string;
  excerpt: string;
};

type SchoolLesson = {
  id: string;
  category: string;
  rule: string;
  when: string;
  sequence: string;
  failsWhen: string;
  sources: SchoolSource[];
  review: {
    source: string;
    human: "approved" | "rejected" | "legacy";
    reviewedAt: string | null;
    reason: string;
  };
  connection:
    | "used_in_accepted_forecast"
    | "selected_for_current_research"
    | "available_to_hermes";
};

type SchoolAudit = {
  updatedAt: string | null;
  status: string;
  provider: string;
  progress: {
    processed: number;
    total: number;
    percent: number;
    complete: boolean;
    lessons: number;
    pendingReview: number;
  };
  review: {
    approved: number;
    rejected: number;
    legacy: number;
  };
  lessons: SchoolLesson[];
  currentResearch: {
    thesis: string;
    question: string;
    counterCase: string;
    selectedLessonRefs: string[];
  };
  ahead: {
    action: string;
    confidence: number;
    horizonHours: number;
    condition: string;
    createdAt: string | null;
    status: string;
    adjustIf: string;
    nextPhase: string;
    longerMove: string;
  };
  improvement: {
    behavior: {
      resolved: number;
      hits: number;
      wrong: number;
      hitRate: number | null;
      requiredExamples: number;
      readyForResearch: boolean;
      recentWindow: number;
      recentRate: number | null;
      previousRate: number | null;
      delta: number | null;
      direction: "too_early" | "improving" | "declining" | "flat";
      averageConfidence: number | null;
      calibrationGap: number | null;
    };
    market: {
      examples: number;
      requiredExamples: number;
    };
    researchStatus: string;
    mode: string;
    note: string;
    experiments: Array<{
      id: string;
      track: string;
      hypothesis: string;
      result: string;
      baselineScore: number | null;
      candidateScore: number | null;
    }>;
  };
};

function dateLabel(value: string | null) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not recorded";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function actionLabel(value: string) {
  const labels: Record<string, string> = {
    hold: "Hold the current idea",
    trim: "Take some profit",
    close: "Close the position",
    flip_long: "Change from short to long",
    flip_short: "Change from long to short",
    readd: "Add again",
    silence: "Stay quiet",
    post_update: "Post an update",
    unscored: "Prediction pending",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function connectionLabel(value: SchoolLesson["connection"]) {
  return {
    used_in_accepted_forecast: "USED BY HERMES",
    selected_for_current_research: "SELECTED NOW",
    available_to_hermes: "IN MEMORY",
  }[value];
}

export default function NightSchool() {
  const [audit, setAudit] = useState<SchoolAudit | null>(null);
  const [error, setError] = useState("");

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
        if (!response.ok || !payload.schoolAudit) {
          throw new Error("Night School is waiting for the live VPS.");
        }
        if (!active) return;
        setAudit(payload.schoolAudit);
        setError("");
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Night School is temporarily unavailable.",
        );
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
        title: "Waiting for the learning ledger.",
        body: "No claim is made until the VPS returns frozen predictions and their outcomes.",
        tone: "waiting",
      };
    }
    if (!behavior.readyForResearch) {
      return {
        label: "TOO EARLY TO PROVE",
        title: `${behavior.resolved}/${behavior.requiredExamples} Astro answer keys collected`,
        body:
          behavior.hitRate === null
            ? "No resolved pre-call predictions yet."
            : `Hermes is ${behavior.hitRate}% right so far. That is an early measurement, not proof it is improving.`,
        tone: "waiting",
      };
    }
    if (behavior.direction === "improving") {
      return {
        label: "EARLY IMPROVEMENT",
        title: `Recent accuracy ${behavior.recentRate}%`,
        body: `Up ${behavior.delta} points from the previous matched window.`,
        tone: "better",
      };
    }
    if (behavior.direction === "declining") {
      return {
        label: "NEEDS ADJUSTMENT",
        title: `Recent accuracy ${behavior.recentRate}%`,
        body: `Down ${Math.abs(behavior.delta ?? 0)} points. Hermes should test a safer policy in shadow mode.`,
        tone: "worse",
      };
    }
    return {
      label: "NO CLEAR CHANGE",
      title: `Recent accuracy ${behavior.recentRate ?? behavior.hitRate}%`,
      body: "The latest matched window is not meaningfully better or worse yet.",
      tone: "flat",
    };
  }, [audit]);

  if (!audit) {
    return (
      <section className="night-school-view">
        <div className="night-school-loading">
          <span>ASTRO NIGHT SCHOOL</span>
          <strong>{error || "Loading the real learning ledger…"}</strong>
          <p>The last accepted Astro and Hermes signals remain unchanged.</p>
        </div>
      </section>
    );
  }

  const behavior = audit.improvement.behavior;
  const appliedLessons = audit.lessons.filter(
    (lesson) => lesson.connection !== "available_to_hermes",
  ).length;

  return (
    <section className="night-school-view">
      <header className="night-school-head">
        <div>
          <span>ASTRO NIGHT SCHOOL · AUDITABLE MEMORY</span>
          <h1>Is Hermes actually learning?</h1>
          <p>
            Every lesson shows its Astro source, its review status, whether
            Hermes used it, and what happened to the next frozen prediction.
          </p>
        </div>
        <div className={`school-verdict ${verdict.tone}`}>
          <small>{verdict.label}</small>
          <strong>{verdict.title}</strong>
          <p>{verdict.body}</p>
        </div>
      </header>

      <section className="school-proof-stats" aria-label="Night School facts">
        <article>
          <small>ARCHIVE READ</small>
          <strong>{audit.progress.percent}%</strong>
          <span>
            {audit.progress.processed.toLocaleString()} /{" "}
            {audit.progress.total.toLocaleString()} items
          </span>
          <i>
            <b style={{ width: `${audit.progress.percent}%` }} />
          </i>
        </article>
        <article>
          <small>SOURCE-CHECKED MEMORY</small>
          <strong>{audit.progress.lessons}</strong>
          <span>{audit.progress.pendingReview} waiting for your review</span>
        </article>
        <article>
          <small>ASTRO ANSWER KEYS</small>
          <strong>
            {behavior.resolved}/{behavior.requiredExamples}
          </strong>
          <span>{behavior.hitRate ?? "—"}% right so far</span>
        </article>
        <article>
          <small>CONNECTED TO CURRENT READ</small>
          <strong>{appliedLessons}</strong>
          <span>exact lesson references—not similarity claims</span>
        </article>
      </section>

      <section className="school-ahead">
        <header>
          <div>
            <small>THREE STEPS AHEAD</small>
            <h2>Hermes must predict, watch, then adjust.</h2>
          </div>
          <span>
            FROZEN {audit.ahead.confidence}% · {audit.ahead.horizonHours || "—"}H
          </span>
        </header>
        <div>
          <article className="now">
            <span>01</span>
            <small>NEXT ASTRO ACTION</small>
            <strong>{actionLabel(audit.ahead.action)}</strong>
            <p>{audit.ahead.condition}</p>
          </article>
          <i>→</i>
          <article>
            <span>02</span>
            <small>ADJUST THE STRATEGY IF</small>
            <strong>{audit.ahead.adjustIf}</strong>
            <p>Hermes creates a successor thesis; the old prediction stays frozen for scoring.</p>
          </article>
          <i>→</i>
          <article>
            <span>03</span>
            <small>AFTER THAT</small>
            <strong>{audit.ahead.nextPhase}</strong>
            <p>{audit.ahead.longerMove}</p>
          </article>
        </div>
      </section>

      <section className="school-trace">
        <header>
          <small>THE REAL CONNECTION</small>
          <h2>Source → lesson → Hermes → answer key</h2>
        </header>
        <div>
          <article>
            <span>1</span>
            <strong>Read Astro</strong>
            <p>Both Telegram channels, the supplied archive, charts and exact X posts.</p>
          </article>
          <article>
            <span>2</span>
            <strong>Propose a rule</strong>
            <p>DeepSeek extracts one reusable behavior and checks it against the cited text.</p>
          </article>
          <article>
            <span>3</span>
            <strong>You approve it</strong>
            <p>Only approved new lessons enter Hermes memory. Older lessons stay visibly marked.</p>
          </article>
          <article>
            <span>4</span>
            <strong>Freeze a prediction</strong>
            <p>Hermes records what Astro may do before the next answer arrives.</p>
          </article>
          <article>
            <span>5</span>
            <strong>Astro answers</strong>
            <p>His next direct action marks Hermes right or wrong without rewriting history.</p>
          </article>
        </div>
      </section>

      <div className="school-workspace">
        <section className="school-memory">
          <header>
            <div>
              <small>LESSON LEDGER</small>
              <h2>What Hermes learned—and from where</h2>
            </div>
            <span>{audit.lessons.length} visible</span>
          </header>

          <div className="school-lesson-list">
            {audit.lessons.map((lesson) => (
              <details
                className={`school-lesson ${lesson.connection}`}
                key={lesson.id}
              >
                <summary>
                  <div>
                    <span>{lesson.category.toUpperCase()}</span>
                    <b>{connectionLabel(lesson.connection)}</b>
                  </div>
                  <strong>{lesson.rule}</strong>
                  <small>
                    {lesson.sources.length} source
                    {lesson.sources.length === 1 ? "" : "s"} ·{" "}
                    {lesson.review.human === "approved"
                      ? "approved by you"
                      : "source-checked before manual review"}
                  </small>
                  <i>+</i>
                </summary>
                <div className="school-lesson-detail">
                  <dl>
                    <div>
                      <dt>USE WHEN</dt>
                      <dd>{lesson.when}</dd>
                    </div>
                    <div>
                      <dt>ASTRO SEQUENCE</dt>
                      <dd>{lesson.sequence}</dd>
                    </div>
                    <div>
                      <dt>DO NOT USE WHEN</dt>
                      <dd>{lesson.failsWhen}</dd>
                    </div>
                    <div>
                      <dt>SOURCE REVIEW</dt>
                      <dd>{lesson.review.reason}</dd>
                    </div>
                  </dl>
                  <div className="lesson-sources">
                    {lesson.sources.map((source) => (
                      <article key={source.ref}>
                        <header>
                          <strong>{source.source}</strong>
                          <time>{dateLabel(source.date)}</time>
                        </header>
                        <p>{source.excerpt}</p>
                        <small>{source.ref}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </details>
            ))}
            {!audit.lessons.length && (
              <div className="school-empty">
                <strong>No approved memory yet.</strong>
                <p>Night School will show a lesson only after its source survives review.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="school-research">
          <section>
            <header>
              <small>CURRENT NIGHT RESEARCH</small>
              <span>{audit.status.toUpperCase()}</span>
            </header>
            <strong>{audit.currentResearch.question}</strong>
            <p>{audit.currentResearch.thesis}</p>
            <div>
              <small>COUNTER-CASE</small>
              <p>{audit.currentResearch.counterCase}</p>
            </div>
          </section>

          <section>
            <header>
              <small>AUTORESEARCH</small>
              <span>{audit.improvement.researchStatus.toUpperCase()}</span>
            </header>
            <strong>
              {behavior.resolved}/{behavior.requiredExamples} behavior examples
            </strong>
            <p>
              At {behavior.requiredExamples}, the system can test whether a
              stricter confidence or time-horizon rule improves unseen results.
            </p>
            <i className="research-progress">
              <b
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(
                      (behavior.resolved /
                        Math.max(1, behavior.requiredExamples)) *
                        100,
                    ),
                  )}%`,
                }}
              />
            </i>
            <div className="research-score">
              <span>
                <small>RIGHT</small>
                <strong>{behavior.hits}</strong>
              </span>
              <span>
                <small>WRONG</small>
                <strong>{behavior.wrong}</strong>
              </span>
              <span>
                <small>EARLY TREND</small>
                <strong>{behavior.direction.replaceAll("_", " ")}</strong>
              </span>
            </div>
            <p className="research-boundary">
              Autoresearch runs in shadow mode. It never silently changes the
              live Hermes policy.
            </p>
          </section>

          {audit.improvement.experiments.length > 0 && (
            <section>
              <header>
                <small>SHADOW EXPERIMENTS</small>
                <span>{audit.improvement.experiments.length}</span>
              </header>
              {audit.improvement.experiments.map((experiment) => (
                <article className="research-experiment" key={experiment.id}>
                  <strong>{experiment.hypothesis}</strong>
                  <p>
                    {experiment.track.toUpperCase()} ·{" "}
                    {experiment.result.replaceAll("_", " ").toUpperCase()}
                  </p>
                </article>
              ))}
            </section>
          )}
        </aside>
      </div>

      <footer className="school-truth">
        <strong>What “smarter” means here</strong>
        <p>
          More correct frozen predictions on later unseen Astro actions, with
          honest calibration. Reading more messages alone does not count as
          improvement.
        </p>
        <span>UPDATED {dateLabel(audit.updatedAt)}</span>
      </footer>
    </section>
  );
}
