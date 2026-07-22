# Technical verification report

**Config:** `beta-clinrev-2026-07` · Ledger §E gate 6.
**Last run:** 2026-07-22.

Covers the four required dimensions: deterministic routing, logging, crash
recovery, and regression.

## 1. Deterministic routing

The access engine (`evaluateAccess`) and session reducer (`postSet`, etc.) are
**pure functions**: no I/O, no model call, no clock read (time is passed as
`nowMs`). Given identical inputs they return byte-identical output — pinned by
`safety-core.test.ts` ("evaluation is deterministic (same inputs → identical
output)", `assert.deepEqual`). The AI companion cannot call the engine to widen
access; it is advisory only and passes through the output guard.

- **Intersection correctness:** most-restrictive-wins verified in
  `safety-core.test.ts` ("most restrictive wins when several rules fire") and
  adversarially in `safety-redteam.test.ts` ("a strong readiness score cannot
  bypass a crisis").
- **No favorable default on missing input:** `MISSING_CHECKIN` →
  grounding-only, verified in core + red-team suites.
- **Beta invariant:** `activatingSessionsAllowed` is false for all inputs
  (autonomous stimulation disabled) — verified in the revised core tests.

## 2. Logging (tamper-evident audit chain)

Routing decisions produce a **content-free coded audit record** (`buildRoutingAuditDetail`)
— rule ids, coded scores, dispositions; **no member free text** (asserted in
`safety-core.test.ts`: "audit detail is content-free"). Records are appended to a
SHA-256 **hash chain** (`audit.ts`): `entry_hash = sha256(prev_hash + canonical
content)`, so any retroactive edit or deletion is detectable via
`verifyAuditChain()`.

- Chain integrity + tamper detection: `tests/audit-chain.test.ts` (3 tests).
- **Concurrency:** the append is serialized with a Postgres
  transaction-scoped advisory lock (`pg_advisory_xact_lock`), covering the
  multi-instance case including the empty/genesis table; SQLite is single-writer.

## 3. Crash recovery

- The engine holds **no state** — every decision is recomputed from persisted
  inputs, so a crash mid-decision loses nothing and cannot leave a partial
  routing.
- The session reducer is a **pure state transition**; the caller persists
  `SessionState` after each step. On restart the session resumes from the last
  persisted phase; `stimulationLocked` and `containment` are sticky (a locked
  session never silently re-opens).
- Audit appends are transactional (BEGIN/COMMIT); a crash mid-append rolls back,
  leaving the chain tip intact.
- Data layer verified booting + round-tripping on real Postgres 16
  (`docs/pg-migration-progress.md`).

## 4. Regression

Full deterministic safety suite — **166 tests, 166 pass, 0 fail** (`npm run
test:safety`):

| Suite | Tests |
|---|---|
| safety-core | 23 |
| safety-session | 16 |
| safety-scoring | 8 |
| safety-journey | 10 |
| safety-companion | 12 |
| safety-governance | 5 |
| safety-redteam (golden + adversarial) | 10 |
| therapy-kb | 11 |
| experience-voice + voice-consent-gate | 9 |
| audit-chain | 3 |
| + companion/session/narration/crypto/retry/guard | remainder |

**Production build:** `npm run build` — compiled successfully, TypeScript
type-check passed across the app, all 26 routes generated (Next.js 16, 2026-07-22).

## 5. Governance surface

- `/api/safety-status` serves mode (`shadow` / `governing`), config version,
  provisional flag, active stages, and kill switches — no secrets, no member
  data (`safetyCoreStatus()`).
- Config is versioned (`SAFETY_CONFIG_VERSION = "beta-clinrev-2026-07"`); a bump
  resets all per-rule sign-offs.
- Kill switches (`EMDR_KILL_*`) disable generative conversation, provider
  sharing, and escalation automation independently without taking the platform
  down.

## Standing caveat
This report verifies *implementation fidelity and determinism*. It is not a
substitute for the independent **privacy/security review** (gate 4) or
**human-factors testing** (gate 5), which require external parties — see
[`07-privacy-security-and-human-factors-plan.md`](07-privacy-security-and-human-factors-plan.md).
