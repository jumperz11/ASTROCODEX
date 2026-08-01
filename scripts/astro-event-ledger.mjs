import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const ASTRO_LEDGER_SCHEMA_VERSION = 3;

const RUNTIME_SERVICES = new Set([
  "telegram",
  "x",
  "scanner",
  "hermes",
  "notifications",
  "school",
  "system",
]);
const RUNTIME_STATUSES = new Set([
  "working",
  "done",
  "quiet",
  "warning",
  "error",
]);
const RUNTIME_IMPORTANCE = new Set(["normal", "important", "alert"]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function iso(value, fallback) {
  const parsed = new Date(value || "").getTime();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function text(value, fallback = "", limit = 2_000) {
  const normalized =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (normalized || fallback).slice(0, limit);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sourceRef(message, index) {
  const chat =
    message?.chatId ??
    message?.peerId ??
    message?.sourceChatId ??
    message?.chat?.id ??
    "unknown";
  const id =
    message?.id ??
    message?.messageId ??
    message?.sourceId ??
    sha256(stableJson(message)).slice(0, 20);
  return `${chat}:${id || index}`;
}

function xRef(post, index) {
  return text(
    post?.url ??
      post?.source ??
      post?.statusUrl ??
      post?.statusId ??
      post?.id,
    `x:${index}:${sha256(stableJson(post)).slice(0, 20)}`,
    1_000,
  );
}

function hypothesisState(kind, prediction) {
  if (kind === "behavior") {
    const status = prediction?.behaviorOutcome?.status ?? "unscored";
    if (status === "active") return "watching";
    if (status === "hit" || status === "wrong") return "resolved";
    if (status === "expired") return "expired";
    return "frozen";
  }
  const status = prediction?.marketStatus ?? prediction?.status ?? "active";
  if (status === "active") return "watching";
  if (status === "superseded") return "superseded";
  if (status === "expired") return "expired";
  return "resolved";
}

function campaignState(play) {
  if (play?.status === "open") return "open";
  if (play?.status === "win" || play?.status === "loss") return "closed";
  return "unknown";
}

function lessonState(candidate, decision, acceptedLesson) {
  if (decision?.status === "approved") {
    return "shadow_testing";
  }
  if (decision?.status === "rejected") return "hidden";
  if (candidate?.review?.verdict === "supported") return "source_supported";
  if (candidate?.review?.verdict === "rejected") return "source_rejected";
  if (acceptedLesson?.quality?.humanReview?.status === "approved") {
    return "shadow_testing";
  }
  if (acceptedLesson?.quality?.status === "supported") return "source_supported";
  return "proposed";
}

function openLedger(path, { readOnly = false } = {}) {
  if (!readOnly) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const database = new DatabaseSync(path, { readOnly });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (!readOnly) {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
  }
  return database;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      evidence_class TEXT NOT NULL,
      entity_id TEXT,
      content_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE (source, kind, source_ref, content_hash)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS events_time_idx
      ON events (occurred_at DESC);
    CREATE INDEX IF NOT EXISTS events_source_kind_idx
      ON events (source, kind, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS events_entity_idx
      ON events (entity_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      authority TEXT NOT NULL,
      state TEXT NOT NULL,
      direction TEXT,
      opened_at TEXT,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      source_refs_json TEXT NOT NULL,
      source_state_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS campaigns_state_idx
      ON campaigns (state, updated_at DESC);

    CREATE TABLE IF NOT EXISTS campaign_transitions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns (id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS campaign_transitions_campaign_idx
      ON campaign_transitions (campaign_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS hypotheses (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      predecessor_id TEXT,
      successor_id TEXT,
      state TEXT NOT NULL,
      action TEXT,
      direction TEXT,
      confidence REAL,
      horizon_hours REAL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      commitment_hash TEXT,
      integrity TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      lesson_refs_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      outcome_json TEXT,
      PRIMARY KEY (kind, id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS hypotheses_state_idx
      ON hypotheses (kind, state, created_at DESC);

    CREATE TABLE IF NOT EXISTS lessons (
      fingerprint TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      rule TEXT NOT NULL,
      state TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      source_review_json TEXT,
      owner_review_json TEXT,
      proposed_at TEXT,
      updated_at TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS lessons_state_idx
      ON lessons (state, updated_at DESC);

    CREATE TABLE IF NOT EXISTS lesson_uses (
      lesson_fingerprint TEXT NOT NULL,
      context_kind TEXT NOT NULL,
      context_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      used_at TEXT NOT NULL,
      reason TEXT,
      PRIMARY KEY (lesson_fingerprint, context_kind, context_id, stage),
      FOREIGN KEY (lesson_fingerprint)
        REFERENCES lessons (fingerprint)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS lesson_uses_context_idx
      ON lesson_uses (context_kind, context_id);

    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      source_hashes_json TEXT NOT NULL,
      counts_json TEXT NOT NULL,
      parity_json TEXT NOT NULL,
      error TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS sync_runs_time_idx
      ON sync_runs (finished_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      service TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      importance TEXT NOT NULL,
      entity_ref TEXT,
      dedupe_key TEXT,
      UNIQUE (service, kind, dedupe_key)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS runtime_events_time_idx
      ON runtime_events (occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS runtime_events_service_idx
      ON runtime_events (service, occurred_at DESC);
  `);
  database
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at)
       VALUES (?, ?)`,
    )
    .run(ASTRO_LEDGER_SCHEMA_VERSION, new Date().toISOString());
  database.exec("PRAGMA optimize");
}

function insertEvent(database, event) {
  const payloadJson = stableJson(event.payload);
  const contentHash = sha256(payloadJson);
  const id = sha256(
    `${event.source}|${event.kind}|${event.sourceRef}|${contentHash}`,
  );
  database
    .prepare(
      `INSERT OR IGNORE INTO events (
        id, occurred_at, observed_at, source, kind, source_ref,
        evidence_class, entity_id, content_hash, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      event.occurredAt,
      event.observedAt,
      event.source,
      event.kind,
      event.sourceRef,
      event.evidenceClass,
      event.entityId ?? null,
      contentHash,
      payloadJson,
    );
  return id;
}

function upsertHypothesis(
  database,
  kind,
  prediction,
  predecessorId,
  successorId,
  observedAt,
  acceptedLessonRefs,
) {
  const id = text(prediction?.id, "", 500);
  if (!id) return null;
  const existing = database
    .prepare(
      `SELECT commitment_hash
       FROM hypotheses
       WHERE kind = ? AND id = ?`,
    )
    .get(kind, id);
  const incomingCommitment = text(prediction?.commitmentHash, "", 256) || null;
  if (
    existing?.commitment_hash &&
    incomingCommitment &&
    existing.commitment_hash !== incomingCommitment
  ) {
    throw new Error(
      `Commitment conflict for ${kind} hypothesis ${id}; refusing to rewrite frozen history.`,
    );
  }

  const createdAt = iso(prediction?.createdAt ?? id, observedAt);
  const evidenceRefs = unique(
    array(prediction?.sources).map((source) =>
      text(source?.url ?? source?.source ?? source, "", 1_000),
    ),
  );
  const payloadJson = stableJson(prediction);
  const payloadHash = sha256(payloadJson);
  const outcome =
    kind === "behavior"
      ? prediction?.behaviorOutcome ?? null
      : {
          status: prediction?.marketStatus ?? prediction?.status ?? null,
          reason: prediction?.outcomeReason ?? null,
          checkpoints: array(prediction?.checkpoints).map((checkpoint) => ({
            label: checkpoint?.label ?? null,
            price: checkpoint?.price ?? null,
            hitAt: checkpoint?.hitAt ?? null,
            hitPrice: checkpoint?.hitPrice ?? null,
          })),
        };
  const action =
    kind === "behavior"
      ? text(prediction?.behavior?.action, "", 120) || null
      : null;
  const direction =
    kind === "market"
      ? text(prediction?.direction, "", 80) || null
      : null;
  const horizonHours =
    kind === "behavior"
      ? numberOrNull(
          prediction?.behavior?.horizonHours ?? prediction?.horizonHours,
        )
      : numberOrNull(prediction?.horizonHours);
  const resolvedAt =
    prediction?.resolvedAt ??
    prediction?.behaviorOutcome?.resolvedAt ??
    null;

  database
    .prepare(
      `INSERT INTO hypotheses (
        kind, id, predecessor_id, successor_id, state, action, direction,
        confidence, horizon_hours, created_at, resolved_at, commitment_hash,
        integrity, evidence_refs_json, lesson_refs_json, payload_hash,
        payload_json, outcome_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, id) DO UPDATE SET
        predecessor_id = excluded.predecessor_id,
        successor_id = excluded.successor_id,
        state = excluded.state,
        action = excluded.action,
        direction = excluded.direction,
        confidence = excluded.confidence,
        horizon_hours = excluded.horizon_hours,
        resolved_at = excluded.resolved_at,
        commitment_hash = COALESCE(hypotheses.commitment_hash, excluded.commitment_hash),
        integrity = excluded.integrity,
        evidence_refs_json = excluded.evidence_refs_json,
        lesson_refs_json = excluded.lesson_refs_json,
        payload_hash = excluded.payload_hash,
        payload_json = excluded.payload_json,
        outcome_json = excluded.outcome_json`,
    )
    .run(
      kind,
      id,
      predecessorId,
      successorId,
      hypothesisState(kind, prediction),
      action,
      direction,
      numberOrNull(prediction?.confidence),
      horizonHours,
      createdAt,
      resolvedAt ? iso(resolvedAt, observedAt) : null,
      existing?.commitment_hash ?? incomingCommitment,
      text(prediction?.integrity, "legacy", 80),
      stableJson(evidenceRefs),
      stableJson(acceptedLessonRefs),
      payloadHash,
      payloadJson,
      stableJson(outcome),
    );
  insertEvent(database, {
    occurredAt: createdAt,
    observedAt,
    source: "hermes",
    kind: `${kind}_hypothesis_revision`,
    sourceRef: id,
    evidenceClass: "inference",
    entityId: `hypothesis:${kind}:${id}`,
    payload: prediction,
  });
  return id;
}

function syncHypothesisKind(
  database,
  kind,
  predictions,
  observedAt,
  acceptedLessonRefs,
) {
  const ordered = [...array(predictions)]
    .filter((prediction) => prediction?.id)
    .sort(
      (left, right) =>
        new Date(left.createdAt ?? left.id ?? 0).getTime() -
        new Date(right.createdAt ?? right.id ?? 0).getTime(),
    );
  return ordered.map((prediction, index) =>
    upsertHypothesis(
      database,
      kind,
      prediction,
      ordered[index - 1]?.id ?? null,
      ordered[index + 1]?.id ?? null,
      observedAt,
      prediction?.id === ordered.at(-1)?.id ? acceptedLessonRefs : [],
    ),
  );
}

function collectLessons(thesis, review) {
  const accepted = new Map(
    array(thesis?.lessons).map((lesson) => [
      text(lesson?.fingerprint, "", 256),
      lesson,
    ]),
  );
  const candidates = new Map(
    array(thesis?.lessonCandidates).map((candidate) => [
      text(candidate?.fingerprint, "", 256),
      candidate,
    ]),
  );
  const decisions = object(review?.decisions);
  const fingerprints = unique([
    ...accepted.keys(),
    ...candidates.keys(),
    ...Object.keys(decisions),
  ]);
  return fingerprints.map((fingerprint) => ({
    fingerprint,
    accepted: accepted.get(fingerprint) ?? null,
    candidate: candidates.get(fingerprint) ?? null,
    decision: decisions[fingerprint] ?? null,
  }));
}

function syncLessons(database, thesis, review, observedAt, forecast) {
  const lessons = collectLessons(thesis, review);
  const upsert = database.prepare(
    `INSERT INTO lessons (
      fingerprint, category, rule, state, source_refs_json,
      source_review_json, owner_review_json, proposed_at, updated_at,
      payload_hash, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (fingerprint) DO UPDATE SET
      category = excluded.category,
      rule = excluded.rule,
      state = excluded.state,
      source_refs_json = excluded.source_refs_json,
      source_review_json = excluded.source_review_json,
      owner_review_json = excluded.owner_review_json,
      proposed_at = COALESCE(lessons.proposed_at, excluded.proposed_at),
      updated_at = excluded.updated_at,
      payload_hash = excluded.payload_hash,
      payload_json = excluded.payload_json`,
  );

  for (const item of lessons) {
    const payload = item.accepted ?? item.candidate ?? {
      fingerprint: item.fingerprint,
    };
    const sourceReview =
      item.candidate?.review ??
      (item.accepted?.quality
        ? {
            verdict:
              item.accepted.quality.status === "supported"
                ? "supported"
                : "unknown",
            reviewedAt: item.accepted.quality.reviewedAt ?? null,
            reason: item.accepted.quality.reason ?? null,
          }
        : null);
    const sourceRefs = unique([
      ...array(item.accepted?.sourceRefs),
      ...array(item.candidate?.sourceRefs),
      ...array(item.candidate?.review?.supportedRefs),
    ]);
    const payloadJson = stableJson(payload);
    const updatedAt = iso(
      item.decision?.decidedAt ??
        item.accepted?.learnedAt ??
        item.candidate?.candidateAt,
      observedAt,
    );
    upsert.run(
      item.fingerprint,
      text(
        item.accepted?.category ?? item.candidate?.category,
        "unknown",
        80,
      ),
      text(
        item.accepted?.rule ?? item.candidate?.rule,
        "Review record retained without the original rule text.",
        2_000,
      ),
      lessonState(item.candidate, item.decision, item.accepted),
      stableJson(sourceRefs),
      sourceReview ? stableJson(sourceReview) : null,
      item.decision ? stableJson(item.decision) : null,
      iso(
        item.candidate?.candidateAt ?? item.accepted?.learnedAt,
        observedAt,
      ),
      updatedAt,
      sha256(payloadJson),
      payloadJson,
    );
    insertEvent(database, {
      occurredAt: updatedAt,
      observedAt,
      source: "night_school",
      kind: "lesson_revision",
      sourceRef: item.fingerprint,
      evidenceClass: "reviewed_learning",
      entityId: `lesson:${item.fingerprint}`,
      payload: {
        state: lessonState(item.candidate, item.decision, item.accepted),
        lesson: payload,
        sourceReview,
        ownerReview: item.decision,
      },
    });
  }

  const useStatement = database.prepare(
    `INSERT OR IGNORE INTO lesson_uses (
      lesson_fingerprint, context_kind, context_id, stage, used_at, reason
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const uses = [];
  const knownFingerprints = new Set(
    lessons.map((item) => item.fingerprint),
  );
  const researchId = text(thesis?.updatedAt, "current-research", 500);
  for (const fingerprint of unique(
    array(thesis?.lunaPacket?.appliedLessonFingerprints),
  )) {
    if (!knownFingerprints.has(fingerprint)) {
      throw new Error(
        `Night School research references unknown lesson ${fingerprint}.`,
      );
    }
    useStatement.run(
      fingerprint,
      "research",
      researchId,
      "selected",
      iso(thesis?.updatedAt, observedAt),
      "Selected in the current bounded Night School research packet.",
    );
    uses.push(`${fingerprint}|research|${researchId}|selected`);
  }
  const forecastId = text(forecast?.generatedAt, "", 500);
  for (const fingerprint of unique(array(forecast?.hermes?.lessonRefs))) {
    if (!knownFingerprints.has(fingerprint)) {
      throw new Error(
        `Accepted forecast references unknown lesson ${fingerprint}.`,
      );
    }
    if (!forecastId) {
      throw new Error(
        "Accepted forecast lesson references require a generatedAt identity.",
      );
    }
    useStatement.run(
      fingerprint,
      "accepted_forecast",
      forecastId,
      "accepted",
      iso(forecast?.generatedAt, observedAt),
      "Explicitly referenced by the accepted Hermes forecast.",
    );
    uses.push(
      `${fingerprint}|accepted_forecast|${forecastId}|accepted`,
    );
  }
  return {
    fingerprints: lessons.map((item) => item.fingerprint),
    uses,
  };
}

function syncCampaigns(database, trackRecord, observedAt) {
  const plays = array(trackRecord?.plays);
  const statement = database.prepare(
    `INSERT INTO campaigns (
      id, authority, state, direction, opened_at, updated_at, closed_at,
      source_refs_json, source_state_hash, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      authority = excluded.authority,
      state = excluded.state,
      direction = excluded.direction,
      opened_at = excluded.opened_at,
      updated_at = excluded.updated_at,
      closed_at = excluded.closed_at,
      source_refs_json = excluded.source_refs_json,
      source_state_hash = excluded.source_state_hash,
      payload_json = excluded.payload_json`,
  );
  for (const play of plays) {
    const id = text(play?.id, "", 500);
    if (!id) continue;
    const payloadJson = stableJson(play);
    const updatedAt = iso(
      play?.closedAt ?? trackRecord?.reviewedAt,
      observedAt,
    );
    const sourceRefs = unique(
      array(play?.sources).map((source) =>
        text(source?.url ?? source, "", 1_000),
      ),
    );
    const previous = database
      .prepare(
        `SELECT state, source_state_hash
         FROM campaigns
         WHERE id = ?`,
      )
      .get(id);
    const hasTransition = Boolean(
      database
        .prepare(
          `SELECT 1
           FROM campaign_transitions
           WHERE campaign_id = ?
           LIMIT 1`,
        )
        .get(id),
    );
    const nextState = campaignState(play);
    const sourceStateHash = sha256(payloadJson);
    statement.run(
      id,
      "audited_direct_record",
      nextState,
      text(play?.direction, "", 80) || null,
      play?.openedAt ? iso(play.openedAt, observedAt) : null,
      updatedAt,
      play?.closedAt ? iso(play.closedAt, observedAt) : null,
      stableJson(sourceRefs),
      sourceStateHash,
      payloadJson,
    );
    const sourceEventId = insertEvent(database, {
      occurredAt: updatedAt,
      observedAt,
      source: "astro_audit",
      kind: "campaign_revision",
      sourceRef: id,
      evidenceClass: "audited_direct_record",
      entityId: `campaign:${id}`,
      payload: play,
    });
    if (!hasTransition || !previous || previous.state !== nextState) {
      const fromState =
        hasTransition && previous ? previous.state : null;
      const transitionId = sha256(
        `${id}|${fromState ?? "none"}|${nextState}|${sourceStateHash}`,
      );
      database
        .prepare(
          `INSERT OR IGNORE INTO campaign_transitions (
            id, campaign_id, from_state, to_state, occurred_at,
            source_event_id, reason, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          transitionId,
          id,
          fromState,
          nextState,
          updatedAt,
          sourceEventId,
          fromState
            ? "Audited direct record changed campaign state."
            : "Audited campaign entered the canonical projection.",
          stableJson({ sources: sourceRefs, result: play?.result ?? null }),
        );
    }
  }
  return plays.map((play) => text(play?.id, "", 500)).filter(Boolean);
}

function sourceIds(database, source, kind) {
  return new Set(
    database
      .prepare(
        `SELECT DISTINCT source_ref
         FROM events
         WHERE source = ? AND kind = ?`,
      )
      .all(source, kind)
      .map((row) => row.source_ref),
  );
}

function projectionIds(database, table, where = "", parameters = []) {
  return new Set(
    database
      .prepare(`SELECT id FROM ${table} ${where}`)
      .all(...parameters)
      .map((row) => row.id),
  );
}

function parityReport(database, expected) {
  const actual = {
    telegram: sourceIds(database, "telegram", "source_message"),
    x: sourceIds(database, "x", "source_post"),
    market: projectionIds(
      database,
      "hypotheses",
      "WHERE kind = ?",
      ["market"],
    ),
    behavior: projectionIds(
      database,
      "hypotheses",
      "WHERE kind = ?",
      ["behavior"],
    ),
    campaigns: projectionIds(database, "campaigns"),
    lessons: new Set(
      database
        .prepare("SELECT fingerprint FROM lessons")
        .all()
        .map((row) => row.fingerprint),
    ),
    lessonUses: new Set(
      database
        .prepare(
          `SELECT
             lesson_fingerprint || '|' || context_kind || '|' ||
             context_id || '|' || stage AS id
           FROM lesson_uses`,
        )
        .all()
        .map((row) => row.id),
    ),
  };
  const missing = Object.fromEntries(
    Object.entries(expected).map(([key, values]) => [
      key,
      unique(values).filter((value) => !actual[key].has(value)),
    ]),
  );
  const expectedCounts = Object.fromEntries(
    Object.entries(expected).map(([key, values]) => [key, unique(values).length]),
  );
  const ledgerCounts = Object.fromEntries(
    Object.entries(actual).map(([key, values]) => [key, values.size]),
  );
  const ok = Object.values(missing).every((values) => values.length === 0);
  return {
    ok,
    expected: expectedCounts,
    ledger: ledgerCounts,
    missing,
  };
}

function databaseCounts(database) {
  const count = (table) =>
    Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return {
    events: count("events"),
    campaigns: count("campaigns"),
    campaignTransitions: count("campaign_transitions"),
    hypotheses: count("hypotheses"),
    lessons: count("lessons"),
    lessonUses: count("lesson_uses"),
    syncRuns: count("sync_runs"),
    runtimeEvents: count("runtime_events"),
  };
}

export function defaultLedgerPath(stateDirectory) {
  return (
    process.env.ASTRO_LEDGER_PATH?.trim() ||
    join(stateDirectory, "astro-ledger.sqlite")
  );
}

export function recordRuntimeEvent(path, event = {}) {
  if (!path) throw new Error("A ledger path is required.");
  const occurredAt = iso(event.at ?? event.occurredAt, new Date().toISOString());
  const service = RUNTIME_SERVICES.has(event.service)
    ? event.service
    : "system";
  const kind = text(event.kind, "activity", 80).toLowerCase();
  const status = RUNTIME_STATUSES.has(event.status)
    ? event.status
    : "done";
  const importance = RUNTIME_IMPORTANCE.has(event.importance)
    ? event.importance
    : "normal";
  const title = text(event.title, "System activity", 160);
  const detail = text(event.detail, "A real system event was recorded.", 500);
  const entityRef = text(event.entityRef, "", 500) || null;
  const dedupeKey = text(event.dedupeKey, "", 500) || null;
  const id = dedupeKey
    ? sha256(`${service}|${kind}|${dedupeKey}`)
    : randomUUID();
  const database = openLedger(path);
  try {
    migrate(database);
    database
      .prepare(
        `INSERT OR IGNORE INTO runtime_events (
          id, occurred_at, service, kind, status, title, detail,
          importance, entity_ref, dedupe_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        occurredAt,
        service,
        kind,
        status,
        title,
        detail,
        importance,
        entityRef,
        dedupeKey,
      );
    const saved = database
      .prepare(
        `SELECT id, occurred_at, service, kind, status, title, detail,
                importance, entity_ref
         FROM runtime_events
         WHERE id = ?`,
      )
      .get(id);
    database.close();
    chmodSync(path, 0o600);
    return saved
      ? {
          id: saved.id,
          at: saved.occurred_at,
          service: saved.service,
          kind: saved.kind,
          stage: saved.kind,
          status: saved.status,
          title: saved.title,
          detail: saved.detail,
          importance: saved.importance,
          entityRef: saved.entity_ref,
        }
      : null;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function readRuntimeEvents(path, { limit = 60 } = {}) {
  if (!path || !existsSync(path)) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 60));
  let database;
  try {
    database = openLedger(path, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT id, occurred_at, service, kind, status, title, detail,
                importance, entity_ref
         FROM runtime_events
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?`,
      )
      .all(safeLimit)
      .reverse();
    database.close();
    return rows.map((row) => ({
      id: row.id,
      at: row.occurred_at,
      service: row.service,
      kind: row.kind,
      stage: row.kind,
      status: row.status,
      title: row.title,
      detail: row.detail,
      importance: row.importance,
      entityRef: row.entity_ref,
    }));
  } catch {
    database?.close();
    return [];
  }
}

export function syncRuntimeLedger({
  path,
  observedAt = new Date().toISOString(),
  forecast = {},
  history = {},
  telegram = {},
  x = {},
  thesis = {},
  review = {},
} = {}) {
  if (!path) throw new Error("A ledger path is required.");
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const database = openLedger(path);
  migrate(database);

  const telegramMessages = array(telegram?.messages);
  const xPosts = array(x?.posts);
  const telegramRefs = telegramMessages.map(sourceRef);
  const xRefs = xPosts.map(xRef);
  const acceptedLessonRefs = unique(array(forecast?.hermes?.lessonRefs));
  const expected = {
    telegram: telegramRefs,
    x: xRefs,
    market: array(history?.hermesPredictions)
      .map((item) => text(item?.id, "", 500))
      .filter(Boolean),
    behavior: array(history?.behaviorPredictions)
      .map((item) => text(item?.id, "", 500))
      .filter(Boolean),
    campaigns: [],
    lessons: [],
    lessonUses: [],
  };
  const sourceHashes = {
    forecast: sha256(stableJson(forecast)),
    history: sha256(stableJson(history)),
    telegram: sha256(stableJson(telegramMessages)),
    x: sha256(stableJson(xPosts)),
    thesis: sha256(stableJson(thesis)),
    review: sha256(stableJson(review)),
  };

  try {
    database.exec("BEGIN IMMEDIATE");
    telegramMessages.forEach((message, index) => {
      insertEvent(database, {
        occurredAt: iso(
          message?.activityAt ??
            message?.date ??
            message?.sentAt ??
            message?.createdAt,
          observedAt,
        ),
        observedAt,
        source: "telegram",
        kind: "source_message",
        sourceRef: telegramRefs[index],
        evidenceClass: "private_direct_context",
        entityId: `telegram:${telegramRefs[index]}`,
        payload: message,
      });
    });
    xPosts.forEach((post, index) => {
      insertEvent(database, {
        occurredAt: iso(
          post?.createdAt ?? post?.postedAt ?? post?.date ?? post?.time,
          observedAt,
        ),
        observedAt,
        source: "x",
        kind: "source_post",
        sourceRef: xRefs[index],
        evidenceClass: "public_direct",
        entityId: `x:${xRefs[index]}`,
        payload: post,
      });
    });
    if (forecast && Object.keys(forecast).length) {
      const forecastId = text(forecast.generatedAt, observedAt, 500);
      insertEvent(database, {
        occurredAt: iso(forecast.generatedAt, observedAt),
        observedAt,
        source: "forecast_store",
        kind: "accepted_forecast",
        sourceRef: forecastId,
        evidenceClass: "validated_projection",
        entityId: `forecast:${forecastId}`,
        payload: forecast,
      });
    }

    syncHypothesisKind(
      database,
      "market",
      history?.hermesPredictions,
      observedAt,
      acceptedLessonRefs,
    );
    syncHypothesisKind(
      database,
      "behavior",
      history?.behaviorPredictions,
      observedAt,
      acceptedLessonRefs,
    );
    const lessonSync = syncLessons(
      database,
      thesis,
      review,
      observedAt,
      forecast,
    );
    expected.lessons = lessonSync.fingerprints;
    expected.lessonUses = lessonSync.uses;
    expected.campaigns = syncCampaigns(
      database,
      history?.trackRecord,
      observedAt,
    );

    const parity = parityReport(database, expected);
    if (!parity.ok) {
      throw new Error(
        `Ledger parity failed: ${stableJson(parity.missing)}`,
      );
    }
    const counts = databaseCounts(database);
    const finishedAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO sync_runs (
          id, started_at, finished_at, status, schema_version,
          source_hashes_json, counts_json, parity_json, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        startedAt,
        finishedAt,
        "healthy",
        ASTRO_LEDGER_SCHEMA_VERSION,
        stableJson(sourceHashes),
        stableJson(counts),
        stableJson(parity),
        null,
      );
    database.exec("COMMIT");
    database.close();
    chmodSync(path, 0o600);
    return {
      status: "healthy",
      schemaVersion: ASTRO_LEDGER_SCHEMA_VERSION,
      lastSyncAt: finishedAt,
      runId,
      counts: { ...counts, syncRuns: counts.syncRuns + 1 },
      parity,
    };
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The transaction may already have been closed by SQLite.
    }
    const message =
      error instanceof Error ? error.message : "Unknown ledger sync failure.";
    try {
      database
        .prepare(
          `INSERT INTO sync_runs (
            id, started_at, finished_at, status, schema_version,
            source_hashes_json, counts_json, parity_json, error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          startedAt,
          new Date().toISOString(),
          "degraded",
          ASTRO_LEDGER_SCHEMA_VERSION,
          stableJson(sourceHashes),
          stableJson({}),
          stableJson({ ok: false }),
          message,
        );
    } finally {
      database.close();
    }
    throw error;
  }
}

export function readLedgerHealth(
  path,
  { verifyIntegrity = false } = {},
) {
  if (!path || !existsSync(path)) {
    return {
      status: "missing",
      schemaVersion: null,
      lastSyncAt: null,
      runId: null,
      counts: null,
      parity: null,
      integrity: "not_checked",
      bytes: 0,
      error: "The event ledger has not been created yet.",
    };
  }
  let database;
  try {
    database = openLedger(path, { readOnly: true });
    const migration = database
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get();
    const latest = database
      .prepare(
        `SELECT id, finished_at, status, counts_json, parity_json, error
         FROM sync_runs
         ORDER BY finished_at DESC
         LIMIT 1`,
      )
      .get();
    const integrity = verifyIntegrity
      ? database.prepare("PRAGMA integrity_check").get().integrity_check
      : "not_checked";
    const counts = databaseCounts(database);
    database.close();
    database = null;
    return {
      status:
        latest?.status === "healthy" &&
        JSON.parse(latest?.parity_json || "{}")?.ok === true &&
        (!verifyIntegrity || integrity === "ok")
          ? "healthy"
          : "degraded",
      schemaVersion: Number(migration?.version || 0),
      lastSyncAt: latest?.finished_at ?? null,
      runId: latest?.id ?? null,
      counts,
      parity: latest?.parity_json
        ? JSON.parse(latest.parity_json)
        : null,
      integrity,
      bytes: statSync(path).size,
      error: latest?.error ?? null,
    };
  } catch (error) {
    database?.close();
    return {
      status: "degraded",
      schemaVersion: null,
      lastSyncAt: null,
      runId: null,
      counts: null,
      parity: null,
      integrity: "unknown",
      bytes: existsSync(path) ? statSync(path).size : 0,
      error:
        error instanceof Error
          ? error.message
          : "Unknown ledger health failure.",
    };
  }
}
