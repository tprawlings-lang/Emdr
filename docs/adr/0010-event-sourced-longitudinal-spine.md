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
   table as it does today. Both paths active, nothing depends on events yet.
3. Backfill existing rows as synthetic genesis events (`payload_version: 0`,
   `source_system: 'backfill'`, `occurred_at` from the row's own timestamp). These are
   explicitly marked as reconstructed, never presented as original evidence.
4. Flip reads to projections rebuilt from events; verify byte-identical output.
5. Remove direct writes to the current tables. The event append becomes the only path.

Steps 1–3 are non-breaking and can ship incrementally. Step 4 is the cutover.

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
