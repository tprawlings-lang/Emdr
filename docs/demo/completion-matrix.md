# Codebase preflight and completion matrix

**Mandated by** the Demo-First Execution Handoff (27 Aug 2026) §3. No implementation under
that handoff begins until this is recorded against the live repository.

**Conducted:** 2026-08-27 · **Against:** `claude/launch-status-vh6vbo` @ `dd99714`
(`main` and `claude/gifted-keller-501y5d` are at the same commit)

> Per §3's conflict rule: where the handoff's dated snapshot and the live code disagree, the
> live code wins and the disagreement is recorded below rather than silently resolved.

---

## 1. Repository state

| Item | Value |
|---|---|
| Active branch | `claude/launch-status-vh6vbo` |
| HEAD | `dd99714f598f9f673be5d5c77b8e5cb46ecd281a` |
| Working tree | **Clean** — no uncommitted changes |
| Branch relationships | `main`, `claude/gifted-keller-501y5d`, `claude/launch-status-vh6vbo` and all three `origin/*` refs are **identical** at `dd99714` |
| Open PRs | **#10** draft "Phase 0: investor prototype build program" → `main`, based on `20db9b6` (**~7 commits stale**); **#11, #8, #2, #1** Dependabot |

**Note on PR #10:** it targets a `main` that has moved substantially. It is founder action
#7 (close / update / supersede) and has **not** been actioned. Nothing in the current work
depends on it.

---

## 2. Checks run, with exact commands and outcomes

| Command | Result |
|---|---|
| `npm run test:safety` | **339 tests, 339 pass, 0 fail, 0 skipped, 0 todo** |
| `npm run test:e2e` | **17 tests, 16 pass, 1 FAIL** — see §5 finding **F1** |
| `npm run test:rls` | **PASS** — 12 cross-tenant attack assertions against a real Postgres 16 cluster |
| `npm run build` | **Compiled successfully** |
| `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** |
| `grep TODO\|FIXME\|XXX` over `src/` | **0 occurrences** |

> **The correct numbers to quote for this commit are 339 unit/safety and 16/17 e2e.** Earlier
> conversation reported "17/17"; that was accurate for a first run against a freshly-seeded
> database and is **not** reproducible. Per handoff §4, no test count may be quoted that
> cannot be tied to the exact demonstration commit.

---

## 3. Completion matrix

Status is one of **Complete** / **Partial** / **Missing** / **Superseded**.

### ADR 0010 — event spine

| Requirement | Status | Evidence | Gap / next action | Owner |
|---|---|---|---|---|
| Event table, schema registry, append helper | **Complete** | `src/lib/events.ts`; `longitudinal_events` in `db.ts` + `scripts/pg-schema.sql`; `tests/spine.test.ts` | — | Engineering |
| Dual-write on every instrumented path | **Complete** | `src/lib/spine.ts`; `tests/dual-write.test.ts` | — | Engineering |
| Genesis backfill | **Complete** | `src/lib/spine-backfill.ts`; `tests/spine-backfill.test.ts` (7) | **Not runnable outside tests** — no operator entry point (**F2**) | Engineering |
| Projection rebuild, byte-identical | **Complete** | `src/lib/projections.ts`; `tests/projections.test.ts` (11) + `tests/projections-demo.test.ts` (6) | **Not runnable outside tests** (**F2**) | Engineering |
| Comparison / idempotency tests | **Complete** | Re-run backfill inserts 0; replay byte-identical on live path and demo dataset | — | Engineering |
| Step 5 — event-authoritative writes | **Missing (by decision)** | Specified in ADR 0013 | Held for the Sep 14–18 gated window. Correct per handoff §12 | Engineering |
| Rollback flag `EMDR_EVENT_AUTHORITATIVE` | **Missing** | Specified in ADR 0013 §7 | **Does not exist in code** (**F3**). Required by gate G9 before cutover | Engineering |

### ADR 0011 — tenancy and identity

| Requirement | Status | Evidence | Gap / next action | Owner |
|---|---|---|---|---|
| `tenants` / `persons` / `accounts` / `role_assignments` split | **Complete** | `db.ts` migrate; `src/lib/tenancy.ts` | — | Engineering |
| `tenant_id` on every durable record | **Complete** | 27 tables + spine tables; `TENANT_SCOPED_TABLES` | — | Engineering |
| Repository enforcing `TenantContext` | **Complete (built)** / **Missing (adopted)** | `src/lib/repository.ts`; `tests/tenant-isolation.test.ts` (18) | **Zero product call sites use it.** 28 `src/lib` modules import `data()` directly; `repo()` / `withTenantTransaction()` appear **0 times** in product code (**F4**) | Engineering |
| Tenant-bound transactions; `app.tenant_id` | **Complete (built)** / **Missing (adopted)** | `withTenantTransaction`; `tests/tenant-transaction.test.ts` (12) | Same as F4; **dormant on SQLite** regardless | Engineering |
| Postgres RLS, forced, catalog-generated | **Complete (built)** / **Dormant (running app)** | `scripts/pg-schema.sql`; `scripts/verify-rls.sh` CI-blocking | **App runs on SQLite — RLS enforces nothing today** | Security |
| FK repoint `user_id` → `person_id`; retire `users` | **Missing (deferred)** | — | Low urgency: `persons.id == users.id` makes it a rename | Engineering |

### Safety, audit, encryption

| Requirement | Status | Evidence |
|---|---|---|
| Deterministic gate chain governs members | **Complete** | `src/lib/gating.ts` `checkModuleAccess`, 14 gates; `@safety` suite |
| Autonomous engine | **Complete (shadow)** | `src/lib/safety/`; governs nothing; `EMDR_AUTONOMOUS_SAFETY` default off |
| Crisis / SOS / grounding never gated | **Complete** | Never behind subscription, tier, or a successful write |
| Kill switches | **Complete** | `EMDR_KILL_GENERATIVE`, `EMDR_KILL_BLS`, `EMDR_KILL_ESCALATION`, `EMDR_KILL_PROVIDER_SHARING`, `EMDR_DISABLE_NEW_SESSIONS` |
| Hash-chained audit log | **Complete** | `src/lib/audit.ts`; 8 families; `tests/audit-chain.test.ts` |
| Audit covers **reads** | **Missing** | Records what was done, not what was seen — required for the clinician surface |
| App-layer field encryption | **Complete** | `src/lib/crypto.ts` AES-256-GCM |
| Output guard on model responses | **Complete** | `src/lib/safety/companion-guard.ts` |

### Documentation

| Requirement | Status | Evidence | Gap |
|---|---|---|---|
| Clinical workflow spec | **Complete (draft)** | `docs/clinical/steady-clinical-workflow.md` | Unreviewed; 8 open reviewer decisions |
| Security package | **Complete (draft)** | `docs/security/` — 8 files, 10 items | Unreviewed; **no configurable-policy-mode framing** (**F5**) |
| Current-vs-target architecture | **Complete** | `docs/architecture/current-vs-target.md` | — |
| ADR index and statuses accurate | **Complete** | `docs/adr/README.md` | — |
| New clinical review packet `clinical-pilot-2026-09` | **Missing** | — | Handoff §9 requires it as a **separate** packet preserving `beta-clinrev-2026-07` (**F6**) |

### Demo operations (handoff §5, §7, §14)

| Requirement | Status | Gap |
|---|---|---|
| Deterministic, versioned seed | **Partial** | `src/lib/demo-seed.ts` is deterministic but **unversioned** and has no baseline hash |
| **Full reset / re-seed** | **Missing** | No reset exists anywhere (**F7**) — and the demo banner *claims* data "reset periodically", which is untrue |
| Scenario-level reset | **Missing** | (**F7**) |
| Guided scenario scripts | **Missing** | (**F8**) |
| Health check | **Missing** | (**F9**) |
| Persistent demo banner with mandated wording | **Partial** | A banner exists in `src/app/layout.tsx` but does **not** carry the mandated `DEMO - FABRICATED DATA - NOT CLINICAL CARE`, and shows only when `EMDR_DEMO=1` (**F10**) |
| Fabricated-persona indicator | **Missing** | (**F10**) |
| Environment sample file | **Missing** | No `.env.example`; 38 env vars are discoverable only by grep (**F11**) |
| Backup / restore | **Partial** | `npm run backup` / `npm run restore` exist; **restore never rehearsed** |

### Handoff surfaces not yet built (correctly Phase 4+)

| Surface | Status |
|---|---|
| Clinician caseload, timeline, alerts, AI summaries, approve/correct/override | **Missing** — Phase 4, specified in the clinical workflow doc |
| Payer / population view | **Missing** |
| Configurable clinical policy modes (§6) | **Missing** (**F5**) |
| BLS Part 6 labelled simulation | **Partial** — resourcing exists and is flag-gated; no Part 6 protocol simulation |

---

## 4. Handoff snapshot versus live code

§4 lists a dated snapshot to verify. Result:

| Snapshot claim | Verdict |
|---|---|
| "ADR 0010 steps 1–4 complete" | **Confirmed** |
| "ADR 0011 steps 1–6 complete" | **Partially incorrect.** Step 6 is built but has **zero adoption** in product code. "Complete" overstates it; the matrix records Built / Not adopted separately |
| "327 unit tests and 17/17 e2e" (earlier report) | **Superseded.** Live: **339** unit/safety; e2e **16/17** |
| "A later branch report cited 339 automated tests" | **Confirmed** for unit/safety |
| "Clinical workflow file added" | **Confirmed** — `docs/clinical/steady-clinical-workflow.md` |
| "Security package added" | **Confirmed** — `docs/security/`, 8 files |
| "Companion full stored transcript sent to the model, not coded memory" | **Confirmed against live code.** `companion-ai.ts` `loadHistory()` decrypts stored messages; the system prompt also carries memories, goals, and trauma areas. Already corrected in `docs/architecture/current-vs-target.md` and documented in `docs/security/01` §4 |

---

## 5. New findings from this preflight

| ID | Finding | Severity |
|---|---|---|
| **F1** | **E2E is not hermetic.** It writes to `.data/emdr.db` in the working directory and never resets, so `clinician-autonomous.spec.ts` passes on a fresh database and fails on every re-run: other specs' sign-offs accumulate and the register shows "2 agreed" where the test asserts "1 agreed". Verified — 5 rows in `autonomous_signoffs`, 3 from an earlier run, 2 from this one. **Not a code regression.** | High — makes the suite unreproducible, which handoff §14 requires |
| **F2** | Backfill, replay, and verification are reachable **only from tests**. A security reviewer cannot run "event replay reproduces the same state" (handoff §10) | High |
| **F3** | `EMDR_EVENT_AUTHORITATIVE` is specified in ADR 0013 §7 but **does not exist in code** | Medium — required by gate G9 |
| **F4** | Tenant enforcement has **zero adoption**: `repo()` / `withTenantTransaction()` appear 0 times in product code while 28 modules import `data()` directly | High — already disclosed in docs, now quantified |
| **F5** | No configurable clinical policy modes (handoff §6). Policy is hard-coded, so reviewers cannot compare alternatives | High for T1 |
| **F6** | `clinical-pilot-2026-09` packet does not exist | Medium |
| **F7** | **No reset or re-seed anywhere**, and the demo banner claims data resets periodically | High |
| **F8** | No guided scenario scripts | Medium |
| **F9** | No health check | Medium |
| **F10** | Demo banner lacks the mandated wording and there is no fabricated-persona indicator | High — it is the labelling rule |
| **F11** | No `.env.example` | Low |

---

## 6. Assumptions that remain provisional

1. **Policy defaults** — companion visibility, caseload model, out-of-hours coverage, alert
   consequence, re-entry, autonomous mode — use the handoff §6 T0/T1 defaults. They are
   demonstration assumptions, **not clinical approval**, and the three highest-impact ones
   remain open reviewer decisions.
2. **Hosting, Postgres provider, and secret store are unnamed**, so T0/T1 continues on
   SQLite with keys in environment variables. Owner recorded as **Founder – TBD**.
3. **No reviewer, counsel, or security group is named.** Every review-dependent item is
   provisional.
4. **Vendor inventory is derived from code only** and may be incomplete — anything with no
   trace in the repository (spreadsheets, scheduling, support inboxes) is unassessed.
5. **`beta-clinrev-2026-07` is preserved and does not extend** to multi-tenancy, the
   clinician surface, clinical-record summaries, the payer view, or BLS Part 6.

---

## 7. Work authorised by this preflight

Ordered. Findings **F1, F7, F10** are the demo-integrity floor and come first.

| # | Work | Closes | State |
|---|---|---|---|
| 1 | Hermetic e2e + deterministic seed/reset with a versioned baseline | F1, F7 | ✅ `adad442` |
| 2 | Mandated demo labelling and fabricated-persona indicator | F10 | ✅ `adad442` |
| 3 | Operator entry points for backfill, replay, verify, and health check | F2, F9 | ✅ `adad442` — `npm run demo` |
| 4 | `.env.example` | F11 | ✅ `adad442` |
| 5 | Configurable clinical policy modes, versioned and environment-scoped | F5 | ✅ `src/lib/clinical-policy.ts` |
| 6 | Guided scenario scripts | F8 | ✅ `scenario-scripts.md` |
| 7 | `clinical-pilot-2026-09` proposed packet | F6 | ✅ `../clinical/clinical-pilot-2026-09.md` |
| 8 | Phase 4 — Steady Clinical prototype | Handoff §9 | ⏳ Next |

### Findings still open after this work

| ID | Finding | Why it stays open |
|---|---|---|
| **F3** | `EMDR_EVENT_AUTHORITATIVE` not implemented | ADR 0010 Step 5 is held for its gated window (Sep 14–18). Reserved and documented in `.env.example` so it is not reinvented |
| **F4** | Tenant enforcement has zero product adoption | Phase 3 work; requires the Postgres cutover to be meaningful. Disclosed in every document that touches isolation |

### Verification after this work

| Command | Result |
|---|---|
| `npm run test:safety` | **355 pass, 0 fail** (339 → 355: +8 demo reset, +8 clinical policy) |
| `npm run test:e2e` | **17/17**, verified reproducible across three consecutive runs |
| `npm run test:rls` | 12 assertions pass |
| `npm run demo -- verify` | Deterministic seed, idempotent backfill, byte-identical replay |
| `npm run build` | Compiles |

**Not authorised here:** ADR 0010 Step 5 (its own gated window), any real data, any claim of
clinical, security, or production readiness.
