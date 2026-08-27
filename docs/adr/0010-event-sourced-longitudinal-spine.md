# 0010 — Event-sourced longitudinal spine; current-state tables become projections

**Status:** Proposed — required before Handoff A code lands.
Depends on [ADR 0007](0007-scaling-and-zero-downtime-deploys.md) (Postgres).
Paired with [ADR 0011](0011-tenancy-and-person-account-separation.md) — one migration.

## Context

The application has **29 mutable current-state tables**. `checkins`, `therapy_sessions`,
`practice_completions`, `ai_memory_items` and the rest record *outcomes*: the row is
updated in place, and prior meaning is lost. The one exception is `audit_log`, which is
append-only and hash-chained ([ADR 0005](0005-tamper-evident-audit-chain.md)) — it is
already the shape the rest of the system needs.

Master Architecture §4 requires the inverse of the current design:

> Mutable current-state views may exist for speed, but the authoritative history must
> preserve events.

Three downstream handoffs depend on this and cannot be built without it:

- **B1** — pattern jobs "consume versioned longitudinal events" and emit evidence-linked
  Pattern objects that can later be contradicted.
- **D4/D6** — model predictions must be "reconstructable at the point in time they were
  made, **without future-data leakage**." This is impossible against mutated rows: there
  is no way to know what a value *was* when a prediction was made.
- **E7** — "a complete patient journey can be reconstructed from original evidence through
  AI recommendations, human decisions, referral, outcome, utilization, and cost."

There is also a nearer-term reason. [ADR 0009](0009-clinical-lane-reclassification.md)
moves Steady into the PHI lane, where a correction must not erase the original —
"correctable by an authorized human without erasing original history" appears in the
downstream contract of every handoff, A through E.

**Cost of delay is the deciding factor.** Retrofitting an event spine is proportional to
accumulated history. Today that history is demo data.

## Decision

### 1. `LongitudinalEvent` is the authoritative write path

One append-only table is the system of record for anything that happens:

| Column | Purpose |
|---|---|
| `id` | ULID — monotonic, so ordering survives clock skew |
| `person_id` | Subject of the event (see ADR 0011 — *person*, not account) |
| `tenant_id` | Governance scope (ADR 0011) |
| `event_type` | Dotted, versioned: `daily_checkin.completed`, `assessment.scored`, `intervention.completed`, `intervention.response_recorded`, `memory.patient_corrected`, `pattern.proposed`, `safety_rule.triggered`, `clinician.reviewed` |
| `payload` | JSONB, validated against a registered schema for that type+version |
| `payload_version` | Schema version — payload shapes evolve, old events stay readable |
| `actor_id`, `actor_type` | Who caused it: patient, clinician, system, model, integration |
| `occurred_at` | When it happened in the world |
| `recorded_at` | When Steady learned of it — **these differ** for ingested data, and D4 needs both |
| `source_system` | `steady` now; EHR/claims/ADT later (reserved per A9) |
| `provenance` | Rule version, model version, prompt version, evidence IDs |
| `correlation_id` | Ties a user action to every downstream effect |

Events are **immutable**. A correction appends a new event that supersedes an earlier one
by reference; nothing is updated or deleted.

### 2. Current-state tables become projections

The existing 29 tables are **not dropped**. They are redefined as read models rebuilt
from events, which keeps every query, page, and test working:

```
command → validate → append LongitudinalEvent → update projection(s) → respond
```

Projection updates run in the same transaction as the append during Handoff A. Moving
them asynchronous is a later decision, made only when scale evidence requires it and
recorded in its own ADR.

### 3. Replay is a tested capability, not an aspiration

`rebuildProjections(personId?, sinceEventId?)` reconstructs read models from events. A
test asserts that a full rebuild produces byte-identical projections to the incremental
path. Without this test the spine is decorative — it is the difference between claiming
replay and having it.

### 4. Migration path

1. Introduce the table, the schema registry, and the append helper. No behaviour change. ✅
2. **Dual-write**: every existing mutation appends its event *and* writes the current
   table as it does today. Both paths active, nothing depends on events yet. ✅
3. Backfill existing rows as synthetic genesis events (`payload_version: 0`,
   `source_system: 'backfill'`, `occurred_at` from the row's own timestamp). These are
   explicitly marked as reconstructed, never presented as original evidence. ✅
4. Flip reads to projections rebuilt from events; verify byte-identical output. ✅
5. Remove direct writes to the current tables. The event append becomes the only path.

Steps 1–3 are non-breaking and can ship incrementally. Step 4 is the cutover.

**Implementation note (step 4, shipped).** `lib/projections.ts` folds the event log into
the current-state tables, and `tests/projections.test.ts` + `tests/projections-demo.test.ts`
assert the byte-identical property this ADR calls the difference between claiming replay
and having it.

*The rebuild never writes live tables.* It folds into `spine_rebuild_*` shadow tables and
diffs. A verifier that truncates production tables to prove itself is a worse liability
than the drift it detects, and it could not be run against a PHI database at all.

*Writing the test is what found the real work.* The dual-write payloads could not rebuild
anything, and none of it was visible by reading the code:

- **No payload carried the current-state row's primary key**, so every rebuild invented
  new ids. Fixed by adding `projectionId` to the payloads that produce a row, which is
  what `payload_version: 2` marks. A version-1 event is reported as an unreconstructable
  gap rather than given a fabricated id — an invented id is silent drift, a reported gap
  is a fact.
- **Consent was written at seven places and recorded an event at two.** The other five
  wrote history the spine never saw. The write and the event now live together in
  `spine.grantConsent` / `withdrawConsent`, and all seven call it; the fix is structural
  rather than "instrument five more call sites and hope the eighth remembers."
- **The unlock workflow had no request event at all** — only the clinician's decision, so
  a replay had no row to decide *on*. `module_unlock.requested` was added.
- **Upsert-keyed writes named a row that did not exist.** A second check-in on a day, or a
  re-read of a lesson, updates the existing row and keeps its id; the call sites minted a
  fresh id inline and passed *that* to the recorder, so a replay produced a duplicate
  instead of an update. `spine.upsertRowId` resolves the id the write will actually land
  on, and the projectors distinguish insert-only columns (`created_at`, `requested_at`)
  from ones an update overwrites.
- **`detail_json` was unrecoverable**: it accrues at both session start and finish, so the
  terminal event now carries it.
- **Two clock reads could straddle a second.** The row took `CURRENT_TIMESTAMP` and the
  event took its own moments later, which would make a replay differ occasionally and
  unreproducibly. Instrumented writes now compute the timestamp once (`spine.nowStamp`)
  and pass the same value to both — which also removes the last backend-specific date
  functions from these queries.

*What is deliberately NOT a full projection.* `users`/`accounts` hold credentials,
`screenings` holds encrypted item responses, and `ai_memory_items` holds encrypted values;
in each case the event carries the coded structure and the protected content stays in its
own governance zone (ADR 0009 §1). You cannot rebuild from events what the events were
designed never to contain, so these are partial projections and `PROJECTED_TABLES` is the
honest list of the six rebuilt in full.

*Scope boundary.* Reads already ran against the current-state tables, so nothing had to be
repointed; what changed is that those tables are now *verified* projections rather than
asserted ones. The event append is not yet the only write path — that is step 5, and it is
the point at which dual-write stops being a safe resting place.

Verified end to end: the live product path (check-in, repeat check-in, practices, lessons,
a full session lifecycle, consent grant and withdrawal) and the genesis-backfilled demo
dataset (three weeks, nine sessions including a hard stop, unlock requests and decisions)
both replay byte-identically, and a point-in-time replay excludes facts recorded after the
cut.

One migration note: the genesis seed for an unlock decision changed from
`module_unlocks:<id>` to `module_unlocks:<id>:decided` to match the request event's
naming. A database already backfilled under the old seed will gain a second, differently
identified decision event on the next run; re-seeding or deleting the old rows is the fix
while history is still demo data.

**Implementation note (step 2, shipped).** The check-in, screening, and session writes
are duplicated between the web path (`lib/actions.ts`) and the mobile path
(`lib/mobile/*.ts`). Instrumenting each independently would double that duplication and
let the two event streams drift — the same change applied to one path and not the other
would silently produce different history for web and mobile members. The event *shapes*
therefore live once in `lib/spine.ts`; both call sites invoke the same recorder.

Identity dual-write (`provisionPerson`) turned out to be a **prerequisite**, not a
parallel concern: `longitudinal_events.person_id` references `persons(id)`, so a user
created since the last boot would have had no person row and every append for them would
have failed the foreign key. Signup on both paths now provisions the person, account, and
role assignment before any event is appended.

Recorders are best-effort (`appendEventSafe`): during dual-write a spine failure must
never break a working product path. A test asserts exactly this — a completion for an
unprovisioned person still writes its current-state row and simply records no event.

**Implementation note (step 3, shipped).** Idempotency is achieved without a tracking
table: a genesis event's id is `ulidFrom(sourceTimestamp, "table:rowId")` — the time
component is the source row's own timestamp, and the random component is a hash of the
source row's identity. Re-running therefore produces identical ids, and the insert is a
no-op. The same construction gives chronological ordering for free: reconstructed events
sort into their true position relative to each other and to live events, rather than
bunching at the moment the backfill ran.

`occurred_at` is the source row's timestamp; `recorded_at` defaults to now. That
asymmetry is exactly what the two columns are for, and it is asserted in the tests.

One refinement was needed. Source timestamps are second-resolution, so a session that
starts and ends within the same second produces two events whose ULID time components are
identical — and `ulidFrom` then breaks the tie by *hash*, which is arbitrary. A session
could therefore appear to end before it began. The terminal event's id is now built from
`max(endedAt, startedAt + 1ms)`, a nudge below the precision of the recorded value, while
`occurred_at` keeps the true source timestamp. Ordering is derived from the same
expression, so the sort and the ids agree.

Verified against the demo dataset: 69 events reconstructed across 8 types spanning the
full multi-week history, chronologically ordered, and a second run inserts nothing.

### 5. Scope boundary for Handoff A

In scope now: the table, schema registry, dual-write, backfill, replay, and the event
types the current product already emits.

Deliberately **not** in scope: an external event bus, CQRS read/write splitting,
cross-service projections, or event-driven integration. Those are C-and-later concerns.
This ADR buys the *history guarantee*, not a distributed architecture.

## Consequences

**Gains**

- B, D, and E become buildable. Without this they are not.
- Corrections preserve history — the PHI-lane requirement, satisfied structurally rather
  than by policy.
- Point-in-time reconstruction makes model evaluation honest: a prediction can be scored
  against exactly what was known when it was made.
- The hash-chained audit log and the event spine reinforce each other — audit answers
  *who did what*, events answer *what the system knew*.

**Costs**

- Every mutation becomes two writes during the dual-write window.
- Event schemas need versioning discipline from day one; a sloppy `payload` shape is
  permanent in a way a column never was.
- Storage grows monotonically. Retention and archival policy must be defined before
  enterprise volumes (Handoff C), not after.
- Developer ergonomics get worse before better: "just update the row" stops being available.

**Risks**

- *Half-migration.* Dual-write is a comfortable resting place, and a system that appends
  events nobody reads is pure cost. Step 4 must have an owner and a date.
- *Event design errors.* Getting `event_type` granularity wrong is expensive to correct.
  Mitigation: model the types against the A→E chain (Person → State → Signal → Assessment
  → Need → Risk → Intervention → Response → …) rather than against current UI actions.
