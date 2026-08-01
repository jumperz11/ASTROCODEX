# Astro Intelligence — Product Requirements

Status: architecture baseline  
Last updated: 2026-08-01

## 1. Product promise

Astro Intelligence is a private research system that learns how AstronomerZero
observes, enters, manages, and exits market campaigns. Its job is to:

1. preserve what Astro actually said or did;
2. infer the most likely next observable Astro action before he publishes it;
3. freeze that inference so it cannot be rewritten after the result;
4. use Astro's next direct action as the answer key;
5. improve only when a source-backed lesson survives review and testing.

The product is not an autonomous trader. It never places a trade and must not
present a model inference as an Astro-confirmed position.

## 2. North-star outcome

The primary outcome is:

> Given all information available at time T, predict Astro's next observable
> position-management action and the condition that would make him change it.

The system is improving only if its frozen, out-of-sample behavior predictions
become more accurate and better calibrated. More text, more model calls, and
more chart lines are not evidence of improvement.

### Primary metric

- Accuracy of official, integrity-valid, resolved next-action predictions.

### Guardrail metrics

- Calibration gap between stated confidence and realized accuracy.
- Percentage of accepted predictions with exact evidence references.
- Percentage of used lessons with a source review and an outcome link.
- Time from a new approved source item to a material accepted update.
- Zero cases where inference is displayed as direct Astro confirmation.

## 3. Users and decisions

The initial user is the owner/operator. On a phone, the product must answer
three questions in this order:

1. **What is Astro confirmed to be doing?**
2. **What does Hermes predict Astro will do next?**
3. **What evidence or price condition would change that prediction?**

Details such as sources, lessons, history, system activity, and scoring remain
available one level deeper. They must not compete with the three primary
answers.

## 4. Product surfaces

### Today

The default view contains only:

- Astro now: direct-evidence state and verified levels.
- Hermes next: one frozen next action, confidence, horizon, and adjustment
  condition.
- Chart: confirmed Astro levels and a visually separate Hermes projection.
- Freshness: when Telegram, X, market data, and reasoning last succeeded.

### History

History is an immutable audit:

- Astro campaigns and public resolution;
- Hermes hypotheses as originally frozen;
- right, wrong, expired, invalidated, or superseded outcomes;
- predecessor and successor links;
- no deletion of failed predictions.

### Night School

Night School proves the learning chain:

`source → proposed lesson → independent source checks → shadow test → answer key → promotion decision`

It must distinguish:

- archive context from current evidence;
- source-supported from empirically promoted;
- selected for research from used in an accepted forecast;
- early statistics from proven improvement.

The owner is not asked to certify trading truth. The owner may choose **test
this** or **hide this** based on whether a rule is understandable and relevant.
That preference never promotes the lesson by itself.

### Live activity

Live activity reports real system events only: source checks, accepted new
items, reasoning runs, forecast decisions, notification delivery, and errors.
It never exposes fabricated chain-of-thought.

## 5. Source authority

Sources are ranked by what they are allowed to prove.

| Source | May prove Astro-confirmed state? | May inform Hermes? |
| --- | --- | --- |
| Exact public Astro X post | Yes | Yes |
| Approved private Astro Telegram source | Private-context only unless corroborated publicly | Yes |
| User-supplied Astro archive | No current-state proof | Yes |
| Verified market feed | No | Yes |
| DeepSeek/Luna/Grok output | No | Yes, as a bounded inference |
| Empirically promoted lesson | No | Yes |

Private Telegram wording must not be reproduced on the public-facing surface.
An archive analogy or market move alone can never create a confirmed long,
short, take-profit, or exit signal.

## 6. Canonical domain model

### Evidence event

An append-only observation with:

- source and evidence class;
- occurred and observed timestamps;
- stable source reference;
- immutable content hash;
- normalized payload.

An edited source item creates a new event revision. It does not overwrite the
older observation.

### Astro campaign

Allowed states:

`unknown → planned → open → partial → closed | invalidated | conflict`

Only direct evidence may move a campaign into `open`, `partial`, `closed`, or
`invalidated`. A model may propose a campaign projection, but that projection
must stay separate from the confirmed campaign.

### Hermes hypothesis

Allowed states:

`draft → frozen → watching → resolved | expired | superseded`

A frozen hypothesis is immutable. A changed view creates a successor linked to
its predecessor. "Three steps ahead" means:

1. next observable action;
2. adjustment condition;
3. successor phase after that condition.

It does not mean publishing three unrelated guesses.

### Lesson

Allowed states:

`proposed → source_supported | source_rejected → shadow_testing | hidden → promoted | retired`

Legacy lessons remain clearly marked. A new lesson becomes `shadow_testing`
after it passes source checks. It may be promoted only after it is linked to
enough frozen, resolved predictions and improves an unseen holdout against the
baseline. Owner feedback can hide or restore a candidate, but cannot make an
unsupported lesson true.

## 7. Model responsibilities

### Deterministic services

- collect and normalize approved sources;
- deduplicate and timestamp observations;
- validate schemas and evidence boundaries;
- freeze predictions and commitment hashes;
- score outcomes;
- update projections, health, and notifications.

### Grok OAuth

- transport and inspect current public X evidence;
- return exact status URLs;
- never act as the long-term memory or scoring authority.

### DeepSeek

- perform inexpensive repetitive archive distillation;
- propose source-backed lessons and counter-cases;
- prepare bounded research packets;
- never promote its own lesson or change a confirmed signal.

### Luna

- reason on material evidence changes;
- combine the current campaign, promoted lessons, and verified market context;
- create a bounded Hermes successor hypothesis when needed;
- preserve Astro/Hermes separation.

### Owner

- choose whether an understandable lesson is worth testing or should be hidden;
- decide product policy;
- never needs to approve routine read-only collection or scoring.

### Lesson promotion gate

The promotion gate is deterministic:

1. the exact cited source exists;
2. the proposed rule is entailed by that source;
3. a counter-case and falsification condition are recorded;
4. the lesson is used only in tagged shadow hypotheses;
5. a minimum resolved sample exists;
6. a time-ordered holdout beats the current baseline without worsening
   calibration;
7. Luna performs a final contradiction review;
8. the promotion and its evidence are written to the audit ledger.

Until these checks pass, the lesson may inform Night School research but cannot
quietly become a trusted production rule.

## 8. System invariants

1. One source item has one stable identity and may have multiple immutable
   content revisions.
2. One official prediction has one immutable commitment hash.
3. A replacement prediction links to, but never mutates, its predecessor.
4. Direct evidence and inference are never merged into one authority class.
5. A tested or used lesson must link to the exact hypothesis it influenced.
6. A resolved prediction retains the answer-key source when available.
7. No model may promote its own lesson without deterministic holdout evidence
   and an independent contradiction review.
8. No failed prediction may be deleted.
9. A write is not healthy until the old JSON state and new ledger agree on the
   migrated entities.
10. The private dashboard remains private.

## 9. Architecture

The target architecture is a deterministic event spine with projections:

```text
Telegram ─┐
X / Grok ─┼─> normalized evidence events ─┐
Archive ──┤                               │
Market ───┘                               ├─> reasoning gate ─> frozen Hermes hypothesis
                                            │                      │
Promoted lessons ──────────────────────────┘                      │
                                                                   v
Astro's next direct action ───────────────> deterministic scoring / answer key
                                                                   │
                                      ┌────────────────────────────┼─────────────┐
                                      v                            v             v
                                  Dashboard                    Telegram      Night School
```

SQLite is the canonical audit spine on the VPS. Existing JSON files remain the
live read authority during migration. The scanner dual-writes a shadow ledger,
then runs parity checks. Reads may move to SQLite only after repeated parity and
integrity success.

## 10. Delivery phases

### Phase 1 — event spine (this implementation)

- create versioned SQLite schema;
- backfill sources, hypotheses, campaigns, lessons, and uses;
- run idempotent sync after each successful scan;
- expose parity and integrity health;
- keep all existing signal semantics unchanged.

### Phase 2 — canonical lifecycle

- create direct-evidence campaign transitions;
- add explicit predecessor/successor IDs at hypothesis creation time;
- cut history and Night School reads over after a parity burn-in;
- add daily verified ledger backup.

### Phase 3 — measurable improvement

- evaluate shadow lesson cohorts against unseen outcomes;
- promote research policy only after a minimum sample and holdout improvement;
- show calibration and regime-specific performance;
- keep autoresearch shadow-only until promotion criteria pass.

## 11. Explicit non-goals

- autonomous trade execution;
- pretending to know Astro's private intent;
- copying paid Telegram content into a public page;
- a live chain-of-thought feed;
- adding macro/news/funding/on-chain inputs before the Astro evidence loop is
  reliable;
- optimizing for notification volume or model activity.

## 12. Release acceptance

Phase 1 is complete when:

- a clean install creates the schema idempotently;
- a repeat sync creates no duplicate evidence;
- all current JSON hypotheses, reviewed lessons, lesson tests/uses, and audited
  campaigns are represented;
- commitment-hash conflicts fail closed;
- parity is visible in health and Night School;
- a ledger failure degrades the architecture health but does not corrupt or
  replace the last accepted signal;
- existing tests, lint, build, private access, and live services remain healthy.
