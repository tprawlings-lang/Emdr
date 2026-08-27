# 0011 — Tenancy from day one; person identity separate from account identity

**Status:** Proposed — required before Handoff A code lands.
Paired with [ADR 0010](0010-event-sourced-longitudinal-spine.md) — one migration.
Implements the governance zones named in [ADR 0009](0009-clinical-lane-reclassification.md).

## Context

The schema has **one `users` table** carrying identity, credentials, and role together:

```sql
users(id, email, name, role CHECK(member|clinician|admin), password_hash, status, created_at)
```

Every one of the other 28 tables scopes by `user_id`. There is **no organization or
tenant column anywhere in the schema.**

Handoff A2 requires the opposite, explicitly and immediately:

> Person identity is distinct from account identity and organization enrollment.
> Tenant/organization fields exist **now** even for direct-to-consumer users; consumer
> tenancy can be represented by a platform tenant.

Two later requirements make this non-optional:

- **C1** — "tenant isolation enforced at the data-access layer and tested with
  cross-tenant attack cases," and "consumer records can later enroll into an enterprise
  program **without identity duplication**."
- **C3** — population identification must "support people who do **not yet have a Steady
  account**." A payer supplies a covered population; most of those people have never
  logged in, and many never will. Against the current model they are unrepresentable:
  every row requires a `user_id`, and a `user` requires `email` and `password_hash`.

This is the highest cost-of-delay item in the entire program. Adding a tenant dimension
across 29 tables is a weekend today and a multi-week, high-risk migration once enterprise
data exists — with the added hazard that a mistake means **cross-tenant PHI exposure**.

## Decision

### 1. Split identity into three entities

| Entity | Is | Has | Notes |
|---|---|---|---|
| **Person** | A human being Steady holds data about | Demographics-minimum, timezone, locale | May exist with **no account** — the C3 population case. This is the subject of every clinical record and every `LongitudinalEvent`. |
| **Account** | A login | Email, credentials, status, MFA | Optional. Links to exactly one Person. A clinician's account and their patient record, if they are also a patient, are the same Person with one account and two role assignments. |
| **Tenant** | A governance boundary | Organization, facility, program, contract population | Always present. Consumer users belong to a **platform tenant** so the column is never null and the query path is uniform. |

`RoleAssignment(person_id, tenant_id, role, scope)` replaces `users.role`. Role becomes a
relationship, not an attribute — a clinician at two organizations is one Person with two
assignments, which the current model cannot express.

`Enrollment(person_id, tenant_id, program_id, eligibility, effective_from, effective_to)`
carries a Person into an enterprise program without duplicating identity. Enrollment is
**time-bounded**: historical program membership is preserved, never overwritten.

`ExternalIdentifier(person_id, source_system, external_id, ...)` maps EHR/claims/payer IDs
to canonical Person IDs. Per C2, **external IDs are never primary keys.**

### 2. `tenant_id` on every durable record

Every table gains `tenant_id`, including `LongitudinalEvent`. Not "where it seems
relevant" — everywhere, so that isolation is a single invariant rather than a per-table
judgement call.

### 3. Isolation is enforced at the data-access layer

Tenant scoping does **not** live in query call sites, where one forgotten `WHERE` clause
is a breach. It is enforced beneath them:

- All access goes through a repository layer that requires an explicit `TenantContext`.
- A query issued without a tenant context throws, rather than returning everything.
- Postgres row-level security as defence-in-depth once on PG (ADR 0007), so a bug in the
  application layer still cannot cross tenants.
- Cross-tenant access is possible only through an explicitly-named, audited escape hatch
  used by platform administration — never by product code.

### 4. Isolation is a tested property

Per C1, cross-tenant attack cases are part of the suite, not a later pen-test finding:

- Every read path, given tenant A's context and tenant B's record ID, returns not-found.
- Every write path rejects a foreign-tenant target.
- Enumeration via IDs, search, exports, and aggregate counts leaks nothing across tenants.
- A test fails if a new table is added without `tenant_id` — a schema-level guard, so the
  invariant survives contributors who have not read this ADR.

### 5. Governance zones attach to tenancy

ADR 0009 §1 and Master §7 define six data zones (operational, patient memory, clinical
record, analytics, research, model development). Zone is recorded per record and enforced
alongside tenant: retrieval is `(tenant, zone, purpose)`, which is what makes
"minimum necessary" mechanical rather than aspirational.

### 6. Migration path

1. Create `tenants`, insert the platform tenant, add nullable `tenant_id` everywhere.
2. Backfill every existing row to the platform tenant. Set `NOT NULL`.
3. Create `persons`; one Person per existing user; `accounts` referencing them.
   `users` becomes a compatibility view during transition.
4. Move `role` to `RoleAssignment`, scoped to the platform tenant.
5. Repoint foreign keys from `user_id` to `person_id`, keeping `user_id` as a
   deprecated alias until call sites migrate.
6. Introduce the repository layer and `TenantContext`; migrate call sites.
7. Drop the compatibility view and the alias.

Steps 1–2 are mechanical and non-breaking. Steps 3–5 are the substance. Sequence this
**with ADR 0010** — both rewrite the same tables, and doing them separately means paying
the migration cost twice.

## Consequences

**Gains**

- Handoff C becomes reachable. Population ingestion, enterprise enrollment, and tenant
  isolation all become additive rather than a rewrite.
- Consumer→enterprise conversion works without identity duplication — a member whose
  employer later contracts with Steady keeps their history.
- A security reviewer can be shown tenant isolation as a tested invariant with RLS behind
  it. This is among the first things an enterprise diligence process probes.
- `RoleAssignment` fixes a modelling error already latent today: a clinician who is also a
  member cannot be represented.

**Costs**

- Touches all 29 tables and most query call sites — the largest mechanical change in
  Handoff A.
- The repository layer adds indirection where direct queries exist today.
- Composite indexes need revisiting; `tenant_id` belongs at the front of most of them.

**Risks**

- *Incomplete migration.* A single table without `tenant_id`, or one path bypassing the
  repository, is a cross-tenant PHI leak. Mitigation: the schema-level test in §4, plus a
  lint rule forbidding raw client access outside the repository layer.
- *Doing it later.* The genuine risk is deferral. Every week of delay adds rows; every
  enterprise conversation makes it more urgent; and the migration gets riskier precisely
  as the data becomes more sensitive.
