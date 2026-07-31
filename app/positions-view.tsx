"use client";

type Level = {
  label: string;
  value: string;
  kind: "entry" | "trim" | "risk";
};

type ExecutionLevel = {
  state: string;
  level: string;
  condition: string;
};

type Evidence = {
  type: "astro" | "framework" | "inference";
  label: string;
  detail: string;
  source?: string;
  time?: string;
};

type Projection = {
  horizonHours: number;
  confidence: number;
  checkpoints: Array<{
    label: string;
    price: number;
    kind: "transition" | "confirmation" | "target";
    condition: string;
  }>;
  invalidation: {
    price: number | null;
    condition: string;
  };
  behavior: {
    action: string;
    horizonHours: number;
    condition: string;
  };
};

type Audit = {
  marketStatus: string;
  official: boolean;
  integrity: string;
  evaluationQuality: string;
  anchorPrice: number;
  latestPrice: number;
  hitCheckpoints: number;
  totalCheckpoints: number;
  behaviorAction: string | null;
  behaviorStatus: string;
} | null;

type Props = {
  forecast: {
    generatedAt: string;
    decision: {
      position: string;
      status: string;
      risk: string;
    };
    signal: {
      state: string;
      readerStep: string;
    };
    execution: {
      entry: ExecutionLevel;
      takeProfit: ExecutionLevel;
      exit: ExecutionLevel;
    };
    levels: Level[];
    evidence: Evidence[];
    scenarios: Array<{
      name: string;
      probability: number;
      trigger: string;
    }>;
    hermes: {
      horizon: string;
      projection?: Projection;
    };
  };
  hermesAudit: Audit;
};

function money(value: number | null | undefined) {
  return Number.isFinite(value)
    ? `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "Not public";
}

function targetLabel(
  kind: Projection["checkpoints"][number]["kind"],
  index: number,
  targetNumber: number,
) {
  return kind === "target" ? `TP${targetNumber}` : `T${index + 1}`;
}

export default function PositionsView({ forecast, hermesAudit }: Props) {
  const direct = [...forecast.evidence]
    .filter((item) => item.type === "astro" && item.source)
    .sort(
      (left, right) =>
        new Date(right.time || "").getTime() -
        new Date(left.time || "").getTime(),
    );
  const directSource = direct[0];
  const publicTargets = forecast.levels
    .filter((level) => level.kind === "trim")
    .filter(
      (level, index, all) =>
        all.findIndex((candidate) => candidate.value === level.value) === index,
    )
    .slice(0, 4);
  const astroTargets = publicTargets.length
    ? publicTargets
    : [
        {
          label: "Public take-profit map",
          value: forecast.execution.takeProfit.level,
          kind: "trim" as const,
        },
      ];
  let hermesTp = 0;
  const leadingScenario = [...forecast.scenarios].sort(
    (left, right) => right.probability - left.probability,
  )[0];

  return (
    <section className="positions-view">
      <div className="positions-intro">
        <div>
          <span className="eyebrow">POSITION CONTROL</span>
          <h1>Entries, targets, profit and close—in one place.</h1>
          <p>
            Astro is direct public evidence. Hermes is a frozen model prediction.
            They are scored separately and never merged.
          </p>
        </div>
        <div className="positions-price">
          <small>BTC NOW</small>
          <strong>{money(hermesAudit?.latestPrice)}</strong>
          <span>{forecast.signal.state.toUpperCase()} · RESEARCH STATE</span>
        </div>
      </div>

      <div className="position-books">
        <article className="position-book astro-book">
          <header>
            <div>
              <span>ASTRO · PUBLIC</span>
              <h2>{forecast.decision.position}</h2>
            </div>
            <b>DIRECT</b>
          </header>

          <div className="position-book-state">
            <small>WHERE HE IS</small>
            <strong>{forecast.decision.status}</strong>
            <p>{forecast.execution.entry.condition}</p>
          </div>

          <div className="position-ladder">
            <div className="position-step entry">
              <span>ENTRY</span>
              <strong>{forecast.execution.entry.level}</strong>
              <small>{forecast.execution.entry.state}</small>
            </div>
            {astroTargets.map((target, index) => (
              <div className="position-step target" key={`${target.label}-${target.value}`}>
                <span>{index < 2 ? `T${index + 1}` : `TP${index - 1}`}</span>
                <strong>{target.value}</strong>
                <small>{target.label}</small>
              </div>
            ))}
            <div className="position-step close">
              <span>CLOSE</span>
              <strong>{forecast.execution.exit.level}</strong>
              <small>{forecast.execution.exit.state}</small>
            </div>
          </div>

          <div className="position-close-rule">
            <small>WHERE / WHEN ASTRO WOULD CLOSE</small>
            <strong>{forecast.execution.exit.condition}</strong>
            <p>
              If Astro did not publish a close price, it stays “Not public.” The
              model cannot fill that gap.
            </p>
          </div>

          {directSource?.source && (
            <a href={directSource.source} target="_blank" rel="noreferrer">
              Latest position evidence · {directSource.label} ↗
            </a>
          )}
        </article>

        <article className="position-book hermes-book">
          <header>
            <div>
              <span>HERMES · PREDICTION</span>
              <h2>
                {forecast.hermes.projection
                  ? `${forecast.hermes.projection.confidence}% model path`
                  : "No scoreable map yet"}
              </h2>
            </div>
            <b>{hermesAudit?.official ? "OFFICIAL" : "EXPERIMENTAL"}</b>
          </header>

          <div className="position-book-state">
            <small>LIVE SCORE STATE</small>
            <strong>
              {hermesAudit
                ? `${hermesAudit.marketStatus.toUpperCase()} · ${hermesAudit.hitCheckpoints}/${hermesAudit.totalCheckpoints} TARGETS`
                : "WAITING FOR AUDIT"}
            </strong>
            <p>
              {hermesAudit?.integrity === "valid"
                ? "Frozen map · valid integrity · candle checked"
                : "Not included in the official score"}
            </p>
          </div>

          <div className="position-ladder">
            <div className="position-step entry">
              <span>ANCHOR</span>
              <strong>{money(hermesAudit?.anchorPrice)}</strong>
              <small>Prediction frozen here</small>
            </div>
            {forecast.hermes.projection?.checkpoints.map((checkpoint, index) => {
              if (checkpoint.kind === "target") hermesTp += 1;
              const hit = Boolean(
                hermesAudit && index < hermesAudit.hitCheckpoints,
              );
              return (
                <div
                  className={`position-step target ${hit ? "hit" : ""}`}
                  key={`${checkpoint.label}-${checkpoint.price}`}
                >
                  <span>
                    {targetLabel(
                      checkpoint.kind,
                      index,
                      Math.max(1, hermesTp),
                    )}
                  </span>
                  <strong>{money(checkpoint.price)}</strong>
                  <small>{hit ? "Reached · saved" : checkpoint.label}</small>
                </div>
              );
            })}
            <div className="position-step close">
              <span>WRONG IF</span>
              <strong>
                {money(forecast.hermes.projection?.invalidation.price)}
              </strong>
              <small>Rebuild the map</small>
            </div>
          </div>

          <div className="position-close-rule">
            <small>HERMES INVALIDATION</small>
            <strong>
              {forecast.hermes.projection?.invalidation.condition ||
                "No frozen invalidation yet."}
            </strong>
            <p>
              {forecast.hermes.projection
                ? `${forecast.hermes.projection.horizonHours}h path · next Astro behavior: ${forecast.hermes.projection.behavior.action.replaceAll("_", " ")}`
                : forecast.hermes.horizon}
            </p>
          </div>
        </article>
      </div>

      <section className="position-opportunity">
        <div>
          <small>OPPORTUNITY WATCH · NOT AN ORDER</small>
          <strong>{forecast.signal.readerStep}</strong>
        </div>
        <div>
          <small>LEADING HERMES SCENARIO</small>
          <strong>
            {leadingScenario
              ? `${leadingScenario.name} · ${leadingScenario.probability}%`
              : "Insufficient inputs"}
          </strong>
          <span>{leadingScenario?.trigger}</span>
        </div>
        <div className="telegram-ready">
          <small>TELEGRAM</small>
          <strong>Event alerts</strong>
          <span>Post · target hit · close · invalidation · Hermes result</span>
        </div>
      </section>
    </section>
  );
}
