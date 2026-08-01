# ADR-001: Add a canonical event spine before replacing live reads

Date: 2026-08-01  
Status: accepted

## Context

The current product works, but its state is distributed across forecast,
history, Telegram, X, DeepSeek, review, autoresearch, and runtime JSON files.
Each file is internally useful; together they do not provide one durable
identity for an evidence item, hypothesis, lesson use, or answer key.

Replacing the live path immediately would put a working monitor at risk and
make semantic drift hard to detect.

## Decision

Add a local SQLite database at
`/var/lib/astro-signal/astro-ledger.sqlite`. During the migration:

- JSON remains the live read authority;
- every successful scan synchronizes a normalized SQLite shadow ledger;
- synchronization is idempotent and transactional;
- append-only evidence events preserve revisions;
- current-state tables are rebuildable projections;
- parity compares the JSON entities with their ledger projections;
- the dashboard reports the ledger as healthy, degraded, or missing.

## Why SQLite

- the product runs on one VPS and has a single low-volume writer;
- transactions and constraints are more valuable than a network database;
- Node 22 already provides `node:sqlite`;
- WAL mode supports the signal API reading while the scanner writes;
- backup and migration remain simple.

## Consequences

Positive:

- every learning claim can be traced end to end without asking the owner to
  certify trading expertise;
- failed hypotheses cannot silently disappear;
- predecessor/successor relationships become explicit;
- later UI simplification can query one coherent model.

Trade-offs:

- JSON and SQLite coexist temporarily;
- the scanner performs an extra local transaction;
- parity must be monitored before any read cutover.

## Failure policy

During Phase 1, a ledger sync failure:

- is recorded as an architecture health warning;
- does not change or delete the last accepted forecast;
- does not fabricate fallback data;
- is retried on the next scan.

A commitment conflict or failed database integrity check is fail-closed for the
ledger projection. The JSON signal remains untouched while the warning is
visible.

## Read cutover criteria

No live endpoint may use SQLite as its primary state until:

1. schema and integrity checks are healthy;
2. migrated entity parity has passed continuously for at least seven days;
3. backup and restore have been tested;
4. the JSON and SQLite API responses have matching semantic hashes;
5. rollback is documented and rehearsed.
