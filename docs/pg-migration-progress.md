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
- [ ] 3 — Profile / gating / fitness-screener / instruments.
- [ ] 4 — Companion (companion.ts, companion-ai.ts) + program-plan + tracks.
- [x] 5 — Billing (billing done; session-focus done) + session-focus.
- [ ] 6 — actions.ts residual sites + pages (dashboard, screening, measures,
      clinician, session complete).
- [ ] 7 — Backup: SQLite `.backup()` stays for the sqlite backend; add a
      `pg_dump` path for Postgres (task 16).
- [ ] 8 — Remove `getDb()` from app code (keep only inside data.ts's sqlite
      backend); grep confirms zero remaining sites.

## Verification each slice
`npx tsc --noEmit` (real errors only) → `npm run test:safety` → build.
