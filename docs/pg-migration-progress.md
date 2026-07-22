# Postgres migration — call-site port progress (ADR 0007, task 15)

**Goal:** replace every synchronous `getDb()` data-access site with the async
`data()` layer (already built, dual SQLite/Postgres). Behavior-preserving while
`EMDR_DB` is unset (SQLite backend wraps the sync handle); Postgres is selected
only at cutover.

**Method:** bottom-up, vertical slices. Each slice converts a module's data
access to `await data()` and updates every caller, compiling green and passing
the test suite before commit. The repo is never left half-migrated.

**Reality:** the Postgres *capability* is not usable until 100% of sites are
ported — a partial migration is safe (still runs on SQLite) but does not yet
enable multi-instance/Postgres. Tracking to zero remaining `getDb()`.

## Slices

- [x] **1 — Safety decision chain**: `safety/gather.ts`, `safety/decide.ts`,
      `safety/signoff.ts` + callers (clinician console, export route, actions,
      companion-ai).
- [x] 2 — Auth + audit (audit has 56 fire-and-forget call sites; convert with a
      grep sweep to ensure every call is awaited).
- [x] 3 — Profile / gating / fitness-screener / instruments.
- [x] 4 — Companion (companion.ts, companion-ai.ts, program-plan, track-recommender) (companion.ts, companion-ai.ts) + program-plan + tracks.
- [x] 5 — Billing (billing done; session-focus done) + session-focus.
- [ ] 6 — actions.ts residual sites + pages (dashboard, screening, measures,
      clinician, session complete).
- [ ] 7 — Backup: SQLite `.backup()` stays for the sqlite backend; add a
      `pg_dump` path for Postgres (task 16).
- [ ] 8 — Remove `getDb()` from app code (keep only inside data.ts's sqlite
      backend); grep confirms zero remaining sites.

## Verification each slice
`npx tsc --noEmit` (real errors only) → `npm run test:safety` → build.

## ✅ Async conversion COMPLETE (all app getDb() removed)
Every application `getDb()` call site is ported to the async `data()` layer.
Remaining `getDb()` lives only in `db.ts` (the layer) and `data.ts`'s sqlite
backend. App source: 0 type errors, 167 tests pass, builds clean, still on
SQLite (behavior-preserving).

## ⚠️ Remaining BEFORE the Postgres cutover can actually run
Structural async is done, but two things still block flipping `EMDR_DB=postgres`:
1. **SQL dialect normalization.** Some queries embed SQLite-only SQL that
   Postgres does not understand — `datetime('now')`, `julianday(...)`,
   `INSERT OR IGNORE`, `strftime`. These must be normalized (compute
   timestamps in JS and pass as params; `INSERT ... ON CONFLICT DO NOTHING`;
   `julianday` age math in JS). `ON CONFLICT ... DO UPDATE` already works in
   both. Grep `datetime('now'|julianday|INSERT OR IGNORE|strftime` to find them.
2. **backup.ts** — SQLite `.backup()` needs a `pg_dump` path for the Postgres
   backend (task 16).
Then: provision Postgres, set DATABASE_URL, flip EMDR_DB=postgres, verify.

## Audit hash-chain note
`audit()` now wraps read-latest + insert in `data().tx()`. Under multi-instance
Postgres, concurrent appends could still race the chain tip; add
`SELECT ... FOR UPDATE` / a Postgres advisory lock before enabling >1 instance.
