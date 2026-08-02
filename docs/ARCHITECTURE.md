# Astro Intelligence architecture

## Product objective

Astro Intelligence has three increasingly difficult jobs:

1. Reconstruct what Astro has directly said and what position management is
   publicly supported.
2. Build a separate Hermes thesis from Astro's history, current evidence, and
   live market structure.
3. Measure frozen predictions until the system can estimate Astro's next
   observable move before he posts it.

The primary learning label is Astro's observable decision behavior—not profit.
Hermes studies what he notices, waits for, avoids, enters, adds to, trims,
closes, invalidates, and changes after contradictory evidence.

Night School exposes the complete learning trail on the private dashboard:
archive or live source excerpt, source-entailment decision, test/hide
preference, lesson fingerprint, whether the current DeepSeek research selected
it, whether an accepted Hermes forecast tested it, and the later frozen
Astro-behavior outcome. The owner is never asked to certify trading truth.
Reading more archive messages is progress, not proof of improvement; only
better results on later unseen answer keys count.

The system is research-only. It never sends an order, chooses leverage, or
promotes a model inference into an Astro-confirmed signal.

## Operator truth loop

Every newly captured Astro item has three independently visible states:

1. **Seen** — Telegram ingestion or the Grok X scout stored the source item.
2. **Read** — the evidence gate and, when justified, Hermes completed analysis.
3. **Result** — the accepted plan changed, the existing plan was confirmed, or
   deeper review was explicitly deferred.

The private Updates surface reads these states from source ledgers and recorded
runtime events. It also exposes an AI Console that names the responsible
provider and reports only real actions and outcomes. A routine source poll may
say "no new post"; it must never be presented as Hermes analyzing a post.
Provider limits must appear as queued/deferred analysis, not as plan
confirmation.

## Canonical pipeline

```text
Approved Telegram channels ─┐
                            ├─> canonical SQLite event spine + projections
Grok OAuth X scout ─────────┘             │
                                          ├─> DeepSeek background thesis
Telegram export + live ledger ─> Codex ───┤   and cited school lessons
                                          │
                    test/hide preference ─┤   tagged lesson experiments
                                          │
Coinbase candles ─────────────────────────┼─> two-minute event detector
                                          │            │
                                          │            v
                                          └────> DeepSeek evidence gate
                                                       │
                                             material event only
                                                       │
                                                       v
                                              Luna Medium + MCP
                                                       │
                                              strict forecast validator
                                                       │
                                     forecast + frozen Hermes commitment
                                                       │
                                  market/behavior scoring + Telegram + UI
                                                       │
                                                       v
                                      guarded shadow autoresearch
```

## Source ownership

| Artifact | Owner | Purpose | May confirm an Astro trade? |
| --- | --- | --- | --- |
| `telegram-source.json` | Telegram user ingestion | Approved private channel context and chart media | No public claim; internal Hermes context only |
| `x-source.json` | Grok OAuth scout | Exact new public Astro status URLs | Yes, after validation |
| `codex-index.json` | Deterministic Night School indexer | Searchable archive and live-message memory | No; historical context only |
| `deepseek-thesis.json` | DeepSeek background worker | Current internal thesis, reviewed lessons, rejected candidates, Luna packet, bounded review signal | No |
| `learning-review.json` | Telegram review worker + owner | Pending lesson posts and immutable test/hide preferences (legacy fields map approve→test and reject→hide) | No |
| `deepseek-evidence-brief.json` | DeepSeek event gate | Materiality decision and compact campaign packet | No |
| `forecast.json` | Luna Medium through the protected validator | Accepted Astro/Hermes research state | Only direct X evidence can populate confirmed Astro facts |
| `history.json` | Deterministic VPS scanner | Immutable plays plus independent frozen market-path and Astro-behavior ledgers | No |
| `autoresearch-shadow.json` | Mechanical scorer + DeepSeek proposer | Rejected/accepted shadow policy experiments | Never automatically |
| `astro-ledger.sqlite` | Deterministic scanner | Canonical events, campaign projections, frozen hypothesis links, lessons, uses, parity | No; audit authority only during migration |

JSON remains the live read authority during the event-spine burn-in.
`astro-ledger.sqlite` is dual-written and reconciled on every successful scan.
No read cuts over until the parity, integrity, backup, and rollback criteria in
ADR-001 have passed.

## Provider responsibilities

### Grok

- Searches X only.
- Uses the existing OAuth session.
- Returns exact direct `@astronomer_zero` status URLs and faithful compact text.
- Does not search the school, build a thesis, or save a forecast.
- Runs every 30 minutes with a rolling daily cap.

### DeepSeek

DeepSeek has three cheap, bounded roles:

1. **Background thesis and school distillation**
   - Runs every ten minutes.
   - Processes the next unprocessed batch of protected archive entries.
   - Sends each candidate lesson through a separate source-entailment review,
     then to the Telegram **Lesson Test** topic as an understandable test/hide
     choice—not an expert truth judgment.
   - Hidden, pending, and pre-gate legacy candidates remain auditable.
   - Updates a compact internal thesis from Telegram, X, the accepted forecast,
     and prior cited lessons.
   - Skips the API call once the school is complete and inputs remain fresh.
2. **Event evidence gate**
   - Runs only when Telegram, X, a frozen checkpoint, or material market state
     changes.
   - Decides whether Luna Medium is justified.
   - Produces terse facts, contradictions, campaign state, and the one question
     Luna must answer.
3. **Shadow experiment proposer**
   - Runs nightly only after a scoring track has enough frozen outcomes.
   - Proposes one bounded confidence/horizon filter.
   - Cannot change the live forecast, playbook, or validator.

### Luna Medium

- Runs only after DeepSeek marks an event material.
- Receives recent evidence, the durable DeepSeek thesis, cited school lessons,
  and shadow-calibration status.
- Must independently call the protected playbook and Codex search tools.
- Is the only model allowed to propose a complete Hermes forecast.
- Can save only through `save_astro_forecast`, which enforces the schema,
  evidence URLs, scenarios, signal discipline, and scoreable projection.

Luna Light is only a fallback evidence gate when DeepSeek is unavailable.

## Learning loops

### Astro School loop

The deterministic Codex index owns the raw memory. DeepSeek never replaces it.
Each background run receives a bounded archive batch plus recent allowlisted
live Telegram messages and may propose only lessons citing those exact refs. A
second bounded model review checks the lesson against the exact source text.
Source-supported candidates then appear in Telegram with **Test it** and
**Hide it**. "Test it" means Hermes may attach the fingerprint to future
predictions so the rule can be measured; it does not certify or promote the
rule. Promotion requires a minimum resolved sample, chronological holdout
improvement, acceptable calibration, and an independent contradiction review.
Supported lessons deduplicate by their rule, conditions, and sequence. Hidden
and pending candidates remain in the audit trail. Processed refs are persisted,
preventing repeated paid work. The nightly index rebuild carries forward live
Telegram entries after they leave the rolling ingestion window, preventing
long-term forgetting.

### Live evidence versus learning

Every message from the two approved Astro channels enters the deterministic
live ledger first. Position, entry, TP, close, invalidation, or material thesis
changes wake the current-evidence gate immediately and may update the Signals
topic after Luna and the forecast validator agree. Educational commentary and
reusable execution habits may also become lesson candidates, but those
candidates cannot alter the current signal. A single Astro message may travel
through both lanes: its present-tense trade facts affect the current map, while
its reusable principle remains a tagged experiment until later outcomes justify
trust.

### Prediction loop

Market-path and Astro-behavior predictions have separate commitments.

The market map is frozen with:

- direction and horizon;
- two to four ordered checkpoints;
- confidence and invalidation.

Rolling middle references cannot replace an active campaign map. A successor is
created only after completion or when direction, endpoints, invalidation, or
horizon materially changes.

The behavior ledger separately freezes one observable Astro action and its
horizon. The scanner scores market paths from candles and behavior from later
direct Astro evidence. A new behavior hypothesis never erases or restarts the
longer market test.

At each 2,000-item reviewed-school milestone and at initial-pass completion,
the background worker creates one review token. The scanner consumes it once
through the normal evidence gate. Luna Medium runs only when the gate and
protected-source verification find a material thesis difference. The milestone
itself is never treated as new Astro evidence.

### Autoresearch loop

Market-path outcomes and Astro-behavior outcomes are different datasets:

- Market track: `hit`, `partial`, `invalidated`, or `expired`.
- Behavior track: direct `hit` or `wrong`, even if its longer market map was
  later superseded.

Each track needs a minimum sample before experiments run. Experiments use a
chronological holdout and must beat the current shadow policy by at least 0.02.
The winning result remains shadow-only until explicitly reviewed.

## Service schedule

| Service | Schedule | Paid model use |
| --- | --- | --- |
| Telegram user ingestion | Continuous polling | None |
| VPS scanner | Every 2 minutes | None unless a material trigger exists |
| DeepSeek background | Every 10 minutes | One thesis call plus a source-review call when lesson candidates exist |
| Telegram lesson testing | Continuous; one pending lesson at a time | None |
| Grok X scout | Every 30 minutes | One bounded Grok OAuth call |
| Watchdog | Every 5 minutes | None |
| Codex index rebuild | Nightly around 02:15 UTC | None |

The Telegram transport retries transient errors in place. After three
consecutive failures it exits deliberately and systemd restarts it with a fresh
MTProto connection. Until a healthy poll succeeds, the scanner fails closed.
| DeepSeek autoresearch | Nightly around 03:30 UTC | At most two calls and only with enough outcomes |

## Failure behavior

- Telegram unhealthy: scanner fails closed and keeps the last forecast.
- Grok limited: cached X evidence remains available; no newest-X completeness is
  claimed.
- DeepSeek unavailable: Luna Light may classify a bounded event.
- Luna unavailable: no new forecast is saved.
- Invalid model output: validator rejects it and preserves the last forecast.
- Market feed unavailable: health alert; no fallback price is invented.
- Background thesis stale: it is marked stale and treated only as old context.

## Current measurement baseline

At the August 1 architecture audit:

- 14,187 protected school entries and 896 media items were indexed.
- Both approved Telegram channels were healthy.
- Eight market hypotheses and seven behavior hypotheses existed.
- Fifty source/review lesson records and two exact lesson-use links were
  backfilled into the canonical spine.
- Six behavior predictions were resolved: four right and two wrong.
- No market-path prediction had yet reached a valid terminal outcome; six had
  been superseded.

This means the system has early evidence about predicting Astro's next public
behavior, but not enough terminal market paths for honest path calibration.
The architecture records that distinction instead of reporting a misleading
combined win rate.

## Long-term route to predicting Astro before a call

1. Preserve every approved observation and never rewrite frozen predictions.
2. Finish the full school distillation with source-backed lessons.
3. Accumulate at least 12 behavior outcomes and 20 terminal market outcomes.
4. Compare Hermes against simple baselines, not only its own hit rate.
5. Promote no policy based on training data; require chronological holdout
   improvement.
6. Track whether a forecast predicted Astro's behavior, BTC's path, both, or
   neither.
7. Add macro/news inputs later only as separately labeled evidence; they must
   never blur what came from Astro.

The near-term objective is therefore not “more predictions.” It is fewer,
frozen, source-backed predictions that survive long enough to be scored.
