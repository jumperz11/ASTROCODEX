"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import liveForecast from "./forecast.json";

type Evidence = {
  type: "astro" | "framework" | "inference";
  label: string;
  detail: string;
  source?: string;
  time?: string;
};

type Forecast = {
  generatedAt: string;
  mode: "live" | "demo";
  market: string;
  stance: string;
  stanceTone: "long" | "short" | "neutral";
  confidence: number;
  headline: string;
  summary: string;
  nextMove: string;
  invalidation: string;
  waitFor: string;
  bias: {
    cyclical: string;
    weekly: string;
    swing: string;
  };
  framework: {
    phase: string;
    typeA: string;
    sentiment: string;
    score: string;
  };
  levels: Array<{ label: string; value: string; kind: "entry" | "trim" | "risk" }>;
  evidence: Evidence[];
  scenarios: Array<{
    name: string;
    probability: number;
    description: string;
    trigger: string;
  }>;
  sources: Array<{ label: string; url: string }>;
  caveat: string;
};

const initialForecast: Forecast = {
  generatedAt: "2026-07-30T12:30:00+01:00",
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
      time: "17h",
    },
    {
      type: "astro",
      label: "Astro said",
      detail:
        "He later reported taking profit around 64K and 67.7K, describing five live wins in a row.",
      source: "https://x.com/astronomer_zero/status/2082796525126856769",
      time: "1h",
    },
    {
      type: "framework",
      label: "Framework-derived",
      detail:
        "Astro’s archive favors gradual execution: enter, compound selectively, then realize profit in stages instead of treating a thesis as binary.",
      time: "Codex Ch. 2–3",
    },
    {
      type: "inference",
      label: "Our inference",
      detail:
        "Because profit has already been realized, the next likely action is management of a runner—not an immediate fresh full-size position.",
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

const embeddedForecast =
  (liveForecast as Forecast).mode === "live"
    ? (liveForecast as Forecast)
    : initialForecast;

const candles = [
  [68, 48, 54, 62], [64, 38, 59, 43], [48, 29, 42, 35], [41, 20, 34, 26],
  [34, 14, 25, 30], [39, 21, 31, 24], [45, 19, 23, 40], [52, 35, 39, 47],
  [58, 40, 46, 53], [62, 44, 52, 48], [66, 47, 49, 61], [72, 55, 60, 68],
  [78, 59, 67, 64], [74, 52, 65, 57], [68, 48, 56, 63], [76, 57, 62, 70],
  [83, 66, 69, 78], [88, 70, 77, 74], [84, 65, 73, 68], [79, 61, 67, 75],
  [86, 69, 74, 82], [92, 74, 81, 78], [88, 71, 77, 84], [95, 79, 83, 90],
];

const rules = [
  {
    index: "01",
    title: "Direction before execution",
    body: "No bias, no trade. Establish the highest relevant timeframe first, then descend.",
    source: "Ch. 1 · message 619",
  },
  {
    index: "02",
    title: "Timeframe translation",
    body: "Bias timeframe ≈ execution timeframe × 12. Treat the ratio as guidance, not a rigid law.",
    source: "Ch. 1 · messages 178–184",
  },
  {
    index: "03",
    title: "Patterns, not fractals",
    body: "Use repeatable formats that adapt to context. Exact historical shapes are not predictions.",
    source: "Ch. 3 · messages 4254–4261",
  },
  {
    index: "04",
    title: "Data + logic",
    body: "Combine minimally correlated evidence; confidence must not come from several copies of one signal.",
    source: "Ch. 2 · messages 716–739",
  },
  {
    index: "05",
    title: "Plan before position",
    body: "A position changes only after the thesis changes. Document triggers, targets and invalidation first.",
    source: "Ch. 2 · messages 2893–2905",
  },
  {
    index: "06",
    title: "Sentiment confirms",
    body: "Sentiment follows recent price action. It confirms an existing plan; it does not create one alone.",
    source: "Ch. 4 · messages 4699–4799",
  },
];

function Tag({ type }: { type: Evidence["type"] }) {
  const copy = {
    astro: "ASTRO SAID",
    framework: "FRAMEWORK",
    inference: "INFERENCE",
  };
  return <span className={`source-tag ${type}`}>{copy[type]}</span>;
}

function ConfidenceRing({ value }: { value: number }) {
  return (
    <div
      className="confidence-ring"
      style={{ "--confidence": `${value * 3.6}deg` } as React.CSSProperties}
      aria-label={`${value}% confidence`}
    >
      <div>
        <strong>{value}</strong>
        <span>/ 100</span>
      </div>
    </div>
  );
}

function MarketChart({ tone }: { tone: Forecast["stanceTone"] }) {
  return (
    <div className="market-chart" aria-label="Illustrative BTC price structure">
      <div className="chart-grid" />
      <div className="chart-label label-a">67.7K · posted / flagged</div>
      <div className="chart-label label-b">64.0K · first trim</div>
      <div className="price-line line-a" />
      <div className="price-line line-b" />
      <div className="candles">
        {candles.map(([high, low, open, close], index) => {
          const up = close >= open;
          return (
            <div className="candle-slot" key={index}>
              <span
                className={`wick ${up ? "up" : "down"}`}
                style={{ bottom: `${low}%`, height: `${high - low}%` }}
              />
              <span
                className={`body ${up ? "up" : "down"}`}
                style={{
                  bottom: `${Math.min(open, close)}%`,
                  height: `${Math.max(3, Math.abs(close - open))}%`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className={`active-marker ${tone}`}>
        <span />
        LIVE THESIS
      </div>
      <div className="chart-axis">
        <span>JUL 23</span>
        <span>JUL 25</span>
        <span>JUL 27</span>
        <span>JUL 30</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [forecast, setForecast] = useState<Forecast>(embeddedForecast);
  const [activeView, setActiveView] = useState<"desk" | "evidence" | "playbook">("desk");
  const [question, setQuestion] = useState("What is Astro likely thinking right now?");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState("Validated Grok snapshot");

  useEffect(() => {
    const restore = window.setTimeout(() => {
      void fetch(`/forecast.json?ts=${Date.now()}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Forecast snapshot unavailable.");
          return (await response.json()) as Forecast;
        })
        .then((latest) => {
          setForecast(latest);
          setLastUpdated("Validated Grok snapshot");
          window.localStorage.setItem(
            "astro-intel-last-forecast",
            JSON.stringify(latest),
          );
        })
        .catch(() => {
          const saved = window.localStorage.getItem("astro-intel-last-forecast");
          if (!saved) return;
          try {
            setForecast(JSON.parse(saved) as Forecast);
            setLastUpdated("Restored validated snapshot");
          } catch {
            window.localStorage.removeItem("astro-intel-last-forecast");
          }
        });
    }, 0);

    return () => window.clearTimeout(restore);
  }, []);

  const timeLabel = useMemo(() => {
    const date = new Date(forecast.generatedAt);
    if (Number.isNaN(date.getTime())) return "Latest";
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${hour}:${minute} UTC`;
  }, [forecast.generatedAt]);

  async function refreshForecast() {
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch(`/forecast.json?ts=${Date.now()}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as Forecast & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "The validated snapshot is unavailable.");
      }
      setForecast(data);
      setLastUpdated("Validated Grok snapshot");
      window.localStorage.setItem("astro-intel-last-forecast", JSON.stringify(data));
      setNotice("Loaded the newest forecast accepted by the evidence gate.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to refresh right now.");
    } finally {
      setLoading(false);
    }
  }

  async function copyGrokTask(event: FormEvent) {
    event.preventDefault();
    const command = `npm run astro:run -- ${JSON.stringify(question)}`;
    try {
      await navigator.clipboard.writeText(command);
      setNotice("Copied the authenticated Grok command. Run it from this project.");
    } catch {
      setNotice(command);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Astro Intelligence home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>
            <strong>ASTRO</strong>
            <small>INTELLIGENCE</small>
          </span>
        </a>

        <nav aria-label="Primary navigation">
          <button className={activeView === "desk" ? "active" : ""} onClick={() => setActiveView("desk")}>Signal desk</button>
          <button className={activeView === "evidence" ? "active" : ""} onClick={() => setActiveView("evidence")}>Evidence</button>
          <button className={activeView === "playbook" ? "active" : ""} onClick={() => setActiveView("playbook")}>Playbook</button>
        </nav>

        <div className="status-cluster">
          <span className={`connection-dot ${forecast.mode}`} />
          <span>{forecast.mode === "live" ? "Grok OAuth · validated" : "Snapshot"}</span>
          <button className="sync-button" onClick={refreshForecast} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh snapshot"}
          </button>
        </div>
      </header>

      <section className="ticker-strip" aria-label="System status">
        <span><b>BTC SNAPSHOT</b> ≈64.66K <em>at capture</em></span>
        <span><b>FRAMEWORK</b> 4 / 10 chapters</span>
        <span><b>ARCHIVE</b> 5,049 posts · 448 images</span>
        <span><b>LAST READ</b> {timeLabel}</span>
        <span><b>MODE</b> Grok OAuth · evidence gated</span>
      </section>

      {activeView === "desk" && (
        <div className="desk" id="top">
          <section className="signal-hero">
            <div className="section-kicker">
              <span>LIVE THESIS / BTC</span>
              <span>{lastUpdated}</span>
            </div>

            <div className="hero-grid">
              <div className="thesis-copy">
                <div className="stance-line">
                  <span className={`stance-pill ${forecast.stanceTone}`}>{forecast.stance}</span>
                  <span>Updated {timeLabel}</span>
                </div>
                <h1>{forecast.headline}</h1>
                <p className="summary">{forecast.summary}</p>

                <div className="next-move">
                  <span className="next-index">01</span>
                  <div>
                    <small>LIKELY NEXT MOVE</small>
                    <p>{forecast.nextMove}</p>
                  </div>
                </div>

                <div className="thesis-actions">
                  <a href={forecast.sources[0]?.url || "https://x.com/astronomer_zero"} target="_blank" rel="noreferrer">
                    Open latest source ↗
                  </a>
                  <button onClick={() => setActiveView("evidence")}>Audit reasoning</button>
                </div>
              </div>

              <div className="confidence-card">
                <span className="micro-label">INFERENCE CONFIDENCE</span>
                <ConfidenceRing value={forecast.confidence} />
                <p>
                  Confidence measures source agreement—not the probability of profit.
                </p>
                <div className="confidence-legend">
                  <span><i className="astro-dot" /> Direct posts</span>
                  <span><i className="framework-dot" /> Codex rules</span>
                  <span><i className="inference-dot" /> Synthesis</span>
                </div>
              </div>
            </div>
          </section>

          <section className="chart-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">MARKET STRUCTURE</span>
                <h2>{forecast.market}</h2>
              </div>
              <div className="timeframes">
                <button>M</button><button>W</button><button className="active">2D</button><button>H6</button>
              </div>
            </div>
            <MarketChart tone={forecast.stanceTone} />
            <div className="level-row">
              {forecast.levels.map((level) => (
                <div key={level.label}>
                  <span className={level.kind} />
                  <small>{level.label}</small>
                  <strong>{level.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="analysis-grid">
            <article className="stack-card">
              <div className="panel-head compact">
                <div>
                  <span className="eyebrow">ASTRO STACK</span>
                  <h2>Framework alignment</h2>
                </div>
                <span className="version">v0.1</span>
              </div>
              <div className="stack-list">
                <div><span>01</span><small>Cyclical bias</small><strong>{forecast.bias.cyclical}</strong></div>
                <div><span>02</span><small>Weekly bias</small><strong>{forecast.bias.weekly}</strong></div>
                <div><span>03</span><small>Swing bias</small><strong>{forecast.bias.swing}</strong></div>
                <div><span>04</span><small>Market phase</small><strong>{forecast.framework.phase}</strong></div>
                <div><span>05</span><small>Type A</small><strong>{forecast.framework.typeA}</strong></div>
                <div><span>06</span><small>Sentiment</small><strong>{forecast.framework.sentiment}</strong></div>
              </div>
            </article>

            <article className="scenario-card">
              <div className="panel-head compact">
                <div>
                  <span className="eyebrow">SCENARIO MAP</span>
                  <h2>What changes the read</h2>
                </div>
              </div>
              <div className="scenarios">
                {forecast.scenarios.map((scenario, index) => (
                  <div className="scenario" key={scenario.name}>
                    <div className="scenario-rank">0{index + 1}</div>
                    <div>
                      <div className="scenario-title">
                        <strong>{scenario.name}</strong>
                        <span>{scenario.probability}%</span>
                      </div>
                      <div className="probability-bar"><i style={{ width: `${scenario.probability}%` }} /></div>
                      <p>{scenario.description}</p>
                      <small>TRIGGER · {scenario.trigger}</small>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="ask-panel">
            <div>
              <span className="eyebrow">RUN THE PRIVATE AGENT</span>
              <h2>Ask Astro Intelligence.</h2>
              <p>
                Grok uses your existing OAuth session. The connector rejects forecasts
                without exact Astro status URLs and a complete scenario map.
              </p>
            </div>
            <form onSubmit={copyGrokTask}>
              <label htmlFor="astro-question">Question</label>
              <div>
                <input
                  id="astro-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="What is Astro likely to do next?"
                />
                <button>Copy run command ↗</button>
              </div>
              {notice && <p className="notice">{notice}</p>}
            </form>
          </section>

          <section className="risk-strip">
            <div>
              <span className="risk-icon">!</span>
              <div>
                <small>KNOWN UNKNOWN</small>
                <p>{forecast.waitFor}</p>
              </div>
            </div>
            <div>
              <small>INVALIDATION</small>
              <p>{forecast.invalidation}</p>
            </div>
          </section>
        </div>
      )}

      {activeView === "evidence" && (
        <section className="evidence-view">
          <div className="view-intro">
            <span className="eyebrow">SOURCE LEDGER</span>
            <h1>Every conclusion should survive an audit.</h1>
            <p>
              Direct statements, framework rules, and probabilistic inference remain visibly separate.
            </p>
          </div>
          <div className="evidence-ledger">
            {forecast.evidence.map((item, index) => (
              <article key={`${item.label}-${index}`}>
                <div className="ledger-index">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <div className="ledger-meta">
                    <Tag type={item.type} />
                    <span>{item.time}</span>
                  </div>
                  <p>{item.detail}</p>
                  {item.source && (
                    <a href={item.source} target="_blank" rel="noreferrer">
                      Inspect source ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
          <div className="caveat-box">
            <span>BOUNDARY</span>
            <p>{forecast.caveat}</p>
          </div>
        </section>
      )}

      {activeView === "playbook" && (
        <section className="playbook-view">
          <div className="view-intro">
            <span className="eyebrow">VERSIONED RULEBOOK</span>
            <h1>The method underneath the prediction.</h1>
            <p>
              These are the durable decision rules extracted from the private archive. Corrections remain versioned.
            </p>
          </div>
          <div className="rule-grid">
            {rules.map((rule) => (
              <article key={rule.index}>
                <span>{rule.index}</span>
                <h2>{rule.title}</h2>
                <p>{rule.body}</p>
                <small>{rule.source}</small>
              </article>
            ))}
          </div>
          <div className="version-log">
            <div>
              <span>RULE UPDATE</span>
              <strong>Type A catastrophic invalidation</strong>
            </div>
            <p>
              Earlier archive reference: 35%. Later detailed rule: 25%. The engine uses the later rule and preserves the earlier statement for audit.
            </p>
          </div>
        </section>
      )}

      <footer>
        <div className="brand footer-brand">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>ASTRO</strong><small>INTELLIGENCE</small></span>
        </div>
        <p>Private research terminal · Human judgment remains the final gate.</p>
        <a href="https://x.com/astronomer_zero" target="_blank" rel="noreferrer">@astronomer_zero ↗</a>
      </footer>
    </main>
  );
}
