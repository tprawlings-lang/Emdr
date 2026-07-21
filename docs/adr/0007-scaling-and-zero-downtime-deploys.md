# 0007 — Scaling & zero-downtime deploys

**Status:** Accepted (2026-07) — founder approved starting the migration now.
Execution tracked in `docs/audit-open-items.md`.

## Context
The app runs as a single instance (ADR 0004). Two consequences surfaced during
the production-readiness audit:

1. **Deploy downtime.** Because there is exactly one instance, every deploy has
   a ~30–60s window where the old container is stopping and the new one is
   booting — observed as brief `502`s on the live demo during each release.
   Render cannot do a zero-downtime rolling swap with a single instance that
   owns a mounted disk.
2. **Throughput ceiling.** The load test (`docs/load-test/`) puts the
   single-instance render-path ceiling around ~150 req/s / ~200 in-flight before
   p99 approaches the 2s budget. Vertical scaling (a bigger instance) is the only
   lever today.

The Pro workspace makes multi-instance and bigger plans *available*, but the app
is not yet safe to run with more than one writer:

- **SQLite on a local disk** — only one instance can own the file.
- **In-memory rate limiter** — each instance would keep its own counters, so
  limits would be N× looser across N instances.
- **In-process backup scheduler** (`src/instrumentation.ts`) — N instances would
  each run the nightly backup.
- **Hash-chained audit log** (ADR 0005) — assumes a single writer; concurrent
  appenders would race the `prev_hash → entry_hash` chain.

## Decision (proposed)
Keep the single instance for now. To reach zero-downtime deploys and horizontal
scale, adopt this sequenced path — each step is independently shippable:

1. **Datastore → Postgres** (or LiteFS/Turso). Removes the single-writer disk
   constraint. Largest step; port the better-sqlite3 queries and the audit
   append to a transactional Postgres writer.
2. **Shared rate-limit store (Redis/Upstash).** Replace the in-memory map in
   `src/lib/rate-limit.ts` with a shared counter so limits hold across instances.
3. **Externalize the scheduler.** Move nightly backups from the in-process timer
   to a Render Cron Job (or a leader-elected single runner) so it fires once
   regardless of instance count.
4. **Make the audit append concurrency-safe.** Serialize via a Postgres
   advisory lock or a single-writer append path so the chain stays intact.
5. **Then raise `numInstances ≥ 2`** — at which point Render does rolling,
   zero-downtime deploys automatically.

Until step 5, an interim mitigation for deploy downtime is a Render
**maintenance page** during releases (cosmetic only; does not remove the gap).

## Consequences
- Clear, ordered migration rather than a big-bang rewrite; the app keeps working
  at each step.
- Steps 1–4 are prerequisites — enabling multi-instance before them would
  silently corrupt the audit chain and loosen rate limits.
- Cost rises (Postgres + Redis + ≥2 instances). This is why it is **proposed,
  not accepted**: it needs a founder decision on when the reliability/scale
  benefit justifies the spend.
