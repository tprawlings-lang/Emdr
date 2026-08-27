# 0013 — Event-authoritative writes: scope, atomicity, failure policy, and rollback

**Status:** Proposed — this is the **Step 5 technical specification** required by the
Platform Readiness Review (2026-08-27) before [ADR 0010](0010-event-sourced-longitudinal-spine.md)
step 5 may execute. Target cutover window **2026-09-14 to 2026-09-18**, subject to the ten
go/no-go gates in §7.
Depends on [ADR 0007](0007-scaling-and-zero-downtime-deploys.md) (Postgres),
[ADR 0010](0010-event-sourced-longitudinal-spine.md) (the spine),
[ADR 0011](0011-tenancy-and-person-account-separation.md) (tenancy).

## Context

ADR 0010 steps 1–4 are shipped: events are appended alongside every instrumented write, a
genesis backfill reconstructs pre-spine history, and `lib/projections.ts` proves the
current-state tables rebuild byte-identically from the log. Step 5 — making the event
append the **only** write path — is the cutover ADR 0010 flags as its principal risk, and
the readiness review held it for cause. Seven findings block it:

| # | Finding | Current condition |
|---|---|---|
| 1 | Projection scope | Six tables rebuild fully; credentials, encrypted screenings, and encrypted memory are partial by design. No document says which are in scope. |
| 2 | Failure behavior | `appendEventSafe` swallows append failures and lets the current-state write succeed. Correct for dual-write, fatal for authoritative writes. |
| 3 | Atomicity | Append and projection update must commit together, and a failure must roll back both. Today they are separate statements. |
| 4 | Tenant call sites | The repository layer enforces `TenantContext` when used; product call sites were never migrated behind it. |
| 5 | Postgres RLS context | The data layer never issues `SET LOCAL app.tenant_id`, so the RLS policies would match no rows. |
| 6 | RLS CI | The attack suite existed but was not CI-blocking. **Closed 2026-08-27** — `tenant-isolation` is now a blocking job. |
| 7 | Operations | Secret manager, database roles, one-time load, restore proof, and rollback rehearsal are open. |

The distinction that matters, and which the security package must state plainly: **the
repository contains tenant-safe building blocks and tested RLS policies; the running
SQLite application does not yet enforce end-to-end tenant isolation.** Building blocks are
not controls until they are on the path every request takes.

## Decision

### 1. Authoritative scope is an explicit list, not "everything"

Step 5 makes the event log authoritative for exactly these commands and tables. Anything
absent from this list keeps writing as it does today; nothing is implicitly included.

| Command (web + mobile) | Table | Event type(s) |
|---|---|---|
| `submitCheckin` / `submitCheckinMobile` | `checkins` | `daily_checkin.completed` |
| `startSession` / `startSessionMobile` | `therapy_sessions` | `session.started` |
| `finishSession` / `finishSessionMobile` | `therapy_sessions` | `session.completed`, `session.hard_stopped` |
| `recordPracticeCompletion` | `practice_completions` | `intervention.completed` |
| `markLessonRead` | `lesson_reads` | `lesson.read` |
| `grantConsent` / `withdrawConsent` | `consents` | `consent.granted`, `consent.withdrawn` |
| `requestUnlock` | `module_unlocks` | `module_unlock.requested` |
| `decideUnlock`, `clinicianOverrideModule`, `clinicianCloseModule` | `module_unlocks` | `module_unlock.decided` |

Eight commands, six tables. Each is already dual-writing and each has a projector proven
byte-identical (`tests/projections.test.ts`, `tests/projections-demo.test.ts`).

### 2. Tables deliberately excluded, and why

These are **partial projections**: the event carries the coded structure, and the protected
content stays in its own governance zone (ADR 0009 §1). You cannot rebuild from events what
the events were designed never to contain, so they are excluded from Step 5 rather than
half-included.

| Table | Protected content the event does not carry | Disposition |
|---|---|---|
| `users`, `accounts` | Password hashes and credential material | **Out of scope.** Identity events remain informational; authentication is never event-sourced. |
| `screenings` | Encrypted item-level responses | **Out of scope for Step 5.** The event is authoritative for score and coded risk flags only. |
| `ai_memory_items` | Encrypted memory values | **Out of scope for Step 5.** The event records that something was remembered and where it came from. |
| `audit_log` | — | **Never a projection.** It is an independent hash-chained record (ADR 0005); the two must be able to disagree, which is what makes cross-checking them meaningful. |
| All other current-state tables | — | Out of scope; direct writes continue. |

**Protected-content strategy (deferred, named).** Bringing an encrypted column under
event authority needs a design where the event carries an immutable reference to
ciphertext that replay never regenerates. That is a real decision with key-rotation and
right-to-erasure consequences, and it gets its own ADR before any of the three tables above
enters authoritative scope. Step 5 does not wait on it.

### 3. One transaction, or nothing

Every authoritative command commits its event and its projection together:

```
withTenantTransaction(ctx, async (c) => {
  const eventId = await appendEvent(args, c);   // required; throws on failure
  await applyProjection(c, event);              // same connection, same transaction
});
```

Three changes make this possible, all mechanical:

- `appendEvent(args, c?)` accepts an optional `DataClient` so it can join a caller's
  transaction instead of opening its own.
- The projectors in `lib/projections.ts` are lifted to take a target table prefix, so the
  same code writes shadow tables during verification and live tables during a command.
  **The projection logic that runs in production is the logic replay proves**, rather than a
  second implementation that happens to agree today.
- `withTenantTransaction` wraps `data().tx()` and, on Postgres, issues
  `SET LOCAL app.tenant_id = $1` as the transaction's first statement (§5).

*A known defect to fix first:* the SQLite `tx()` in `lib/data.ts` passes the shared `base`
client to its callback rather than a transaction-scoped one, and issues bare
`BEGIN`/`COMMIT`. That is harmless for a single-connection SQLite process but silently
breaks under nesting — an authoritative command calling a helper that also opens a
transaction would commit early. Nesting must either be made re-entrant (savepoints) or
made an error. This is Sep 2–4 work.

### 4. Failure policy: authoritative appends fail closed

`appendEventSafe` — which catches append failures and lets the current-state write proceed
— is **removed from every command in §1**. It was correct for dual-write, where a spine
failure must never break a working product path. Under event authority the inverse holds:
an event that did not land is history that does not exist, so the command must fail.

| Path | Policy |
|---|---|
| The eight authoritative commands | **Fail closed.** Append failure aborts the transaction and surfaces an error to the caller. |
| Non-authoritative dual-write sites (assessments, memory, identity) | Best-effort append retained until each is brought into scope by a later step. |

`appendEventSafe` keeps its name and its comment about being a migration artifact, so its
remaining call sites stay greppable and countable.

**Member-facing behavior on failure.** A failed authoritative command must not present as
success. The safety-critical case is a check-in: if it cannot be recorded, the member is
told plainly and is *not* routed as though a check-in had happened, because the routing
decision (§5 of the README's gate chain) depends on the check-in that was never stored.
Crisis surfaces, SOS, and grounding remain reachable regardless — they are never gated on a
successful write.

### 5. Tenant context travels with the transaction

Finding #5 is the gap that makes RLS decorative: the policies test the session variable
`app.tenant_id`, and nothing sets it. On the authoritative path:

```
withTenantTransaction(ctx, fn)
  → data().tx(async (c) => {
      if (backend === "postgres") await c.run("SET LOCAL app.tenant_id = ?", [ctx.tenantId]);
      return fn(c);
    })
```

`SET LOCAL` is scoped to the transaction and reverts on commit or rollback, so a pooled
connection can never leak one tenant's context into the next request — the failure mode
that would turn a connection pool into a cross-tenant data leak. Cross-tenant
administration sets no variable and instead connects as `steady_platform_admin`, whose
policy is role-based and cannot be assumed by the application role (verified in
`scripts/verify-rls.sh`).

A test must assert the negative directly: **a transaction that fails to set the tenant sees
zero rows, never all rows.** That property is already proven at the database level; Step 5
extends it to the application's own transaction helper.

### 6. Idempotency and retry

Authoritative commands are retryable without duplicating history:

- **Event ids are ULIDs generated per append**, so a naive retry would duplicate. Commands
  therefore key idempotency on the projection row, not the event: the projectors are
  already upserts keyed by `projectionId`, and `spine.upsertRowId` resolves the id a write
  will land on before the command runs. A retried check-in updates the same row it did the
  first time.
- **A retry that reaches the database twice appends two events and one projection row.**
  That is the correct outcome under event sourcing: both attempts genuinely happened and
  the log says so, while the current state reflects the last one. History is a record of
  attempts, not a deduplicated summary.
- **Transient database failures are not retried inside the transaction.** The command fails,
  the transaction rolls back, and the caller decides. Silent retry inside an authoritative
  write is how partial history gets created.

### 7. Rollback is a flag, rehearsed before it is needed

`EMDR_EVENT_AUTHORITATIVE` (default **off**) selects the write path. Off is today's
verified dual-write; on is the authoritative path. Rollback is therefore one configuration
change with no schema step and no data migration — the property gate **G9** requires.

The flag stays available through the first accepted release after cutover. Removing it is a
separate, deliberate change once the soak period has passed.

Because dual-write already writes both the event and the row, **rolling back loses no
history**: events appended under authority remain valid events, and the projections they
produced remain the same rows dual-write would have produced. This is the whole reason step
4 had to prove byte-identity before step 5 could be scheduled.

### 8. Observability

Cutover is monitored on five signals, each with an alert (**G8**):

| Signal | Meaning |
|---|---|
| Append failure rate | Events rejected — the authoritative path is refusing writes. |
| Projection failure rate | Transactions rolled back after a successful append. |
| Replay drift | A scheduled `verifyProjections()` finding any diff at all. |
| Tenant-context failures | A transaction reaching the data layer without a tenant. |
| Event-log growth vs. command volume | A ratio shift means duplicate or missing appends. |

Replay drift is the one that matters most and is cheapest to miss: it is the difference
between "we believe the log is authoritative" and "we check daily that it is."

## Consequences

**Gains**

- The event log becomes the system of record in fact rather than in intent — the condition
  Handoffs B, D, and E are specified against.
- Corrections stop being able to erase history on the paths that carry the most clinical
  meaning.
- RLS stops being dormant on the authoritative path, which is what converts ADR 0011's
  tested policies into an enforced control.

**Costs**

- Eight commands gain a failure mode they did not have. Each needs a member-facing error
  path that is honest rather than silently degrading.
- Projection code moves onto the request path, so a projector bug becomes a command
  failure rather than a reporting inaccuracy.
- The excluded tables leave the system in a mixed state — some history authoritative, some
  not — until the protected-content ADR lands. This must be stated in the security package
  rather than smoothed over.

**Risks**

- *Scope creep during the window.* The list in §1 is the scope. Adding a table mid-cutover
  forfeits the seven-day soak that justifies the date.
- *A date defended at the cost of a gate.* The schedule explicitly yields: if the
  infrastructure choice or the tenant transaction design slips, the window moves and the
  application stays on verified dual-write. The soak is not compressed to protect a date.
- *Rollback that was never rehearsed.* A flag nobody has flipped in anger is a hypothesis.
  Gate G9 requires rehearsal before cutover, not documentation of intent.

## Go/no-go gates

Step 5 executes only when **all ten** show PASS. A partial pass is a no-go.

| Gate | Name | Pass condition | Owner |
|---|---|---|---|
| G1 | Authoritative scope | Every command and table is listed; partial projections explicitly excluded or assigned a protected-content strategy | Architecture |
| G2 | Atomic transaction | Event append and projection update commit together; event failure fails the command | Engineering |
| G3 | Tenant context | Every in-scope request carries authenticated tenant context through the data transaction | Engineering + Security |
| G4 | RLS enforcement | Application role is non-owner, non-superuser; `SET LOCAL app.tenant_id` works; the twelve attack cases block CI | Security |
| G5 | Replay | Full replay produces zero gaps and byte-identical results for every fully projected table | Engineering |
| G6 | Postgres rehearsal | Synthetic migration, backup, restore, audit-chain verification, and rollback all pass | Engineering + Ops |
| G7 | Soak | Seven consecutive days, zero unexplained divergence across web, mobile, clinician, and scheduled paths | Engineering |
| G8 | Observability | Alerts exist for append failure, projection failure, replay drift, tenant-context failure, and database saturation | Engineering + Security |
| G9 | Rollback | One documented command or configuration change restores dual-write, rehearsed before cutover | Engineering |
| G10 | Data restriction | Only fabricated data exists in the environment during cutover — no patient or staff health data | Founder + Compliance |

**Status: G4 partially closed** (CI job added 2026-08-27; `SET LOCAL` wiring outstanding).
All others open.

## Execution schedule

Dates assume founder decisions arrive within 48 hours and synthetic staging exposes no
material defect. Real PHI is prohibited throughout.

| Window | Work block | Exit |
|---|---|---|
| Aug 27 – Sep 1 | Scope and transaction design | **This document, approved** |
| Sep 2 – Sep 4 | Tenant and RLS plumbing; migrate the first in-scope call sites; close bypass paths | Tenant-context tests and RLS CI green |
| Sep 3 – Sep 5 | Infrastructure decision: managed Postgres, secret system, non-owner roles, backup ownership | Synthetic staging ready |
| Sep 5 – Sep 7 | Migration and rollback rehearsal | Rehearsal signed off |
| Sep 7 – Sep 14 | Seven-day dual-write soak; compare projections daily | Seven consecutive clean days |
| Sep 14 – Sep 18 | Cutover behind the reversible flag | Step 5 complete or rolled back safely |
| First 72h after | Intensive monitoring | Cutover accepted |
