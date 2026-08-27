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

1. Create `tenants`, insert the platform tenant, add `tenant_id` everywhere. ✅
2. Backfill every existing row to the platform tenant. ✅
3. Create `persons`; one Person per existing user; `accounts` referencing them. ✅
4. Move `role` to `RoleAssignment`, scoped to the platform tenant. ✅
5. Repoint foreign keys from `user_id` to `person_id`.
6. Introduce the repository layer and `TenantContext`; migrate call sites. ✅ *(layer and
   isolation tests shipped; call-site migration follows ADR 0010 step 4)*
7. Retire `users` once nothing reads it.

**Implementation refinement (steps 1–4, shipped).** `persons.id` is set **equal to
`users.id`**. Every existing `user_id` foreign key is therefore already a valid
`person_id`, which turns step 5 from a data migration across 27 tables into a rename —
the single largest risk reduction available in this ADR, and the reason to do the
identity split before any further data accumulates.

`tenant_id` was added with `DEFAULT '<platform tenant>'` rather than as a nullable
column later tightened, so steps 1 and 2 collapsed into one non-breaking change: existing
rows are correct by construction and `NOT NULL` holds from the start.

Accounts receive their own ULID rather than reusing the user id, because a person may
hold more than one account or none — the asymmetry is the point of the split.

Steps 1–2 are mechanical and non-breaking. Steps 3–5 are the substance. Sequence this
**with ADR 0010** — both rewrite the same tables, and doing them separately means paying
the migration cost twice.

**Implementation note (step 6, shipped).** Both halves of §3 exist, and both are proven
by attack cases rather than asserted:

*Application layer* — `src/lib/repository.ts`. A `Repository` cannot be constructed
without a `TenantContext`, and it ANDs `tenant_id = ?` onto every statement it issues.
Three properties are deliberate rather than incidental: `insert` stamps the tenant from
the context and **ignores** any caller-supplied `tenant_id`; `update` strips `tenant_id`
from the value set, so moving a record between tenants can never be a field write; and a
table absent from `TENANT_SCOPED_TABLES` is **refused** rather than silently queried
unscoped — the failure mode of forgetting the scope is a loud error, not a quiet breach.
Writes return no row count, so a caller cannot infer a foreign row's existence from an
affected-rows value. `crossTenantContext()` is the only escape hatch, is greppable by
name, and writes an audit record with its stated reason.

*Database layer* — `scripts/pg-schema.sql`. Row-level security is enabled **and forced**
(so it binds the table owner too) on every table carrying `tenant_id`, with the policy
set generated from the system catalog rather than a hardcoded list: a new tenant-scoped
table cannot be added and left unprotected. The application connects as `steady_app`,
which is neither superuser nor schema owner, and sets `app.tenant_id` per transaction —
so a statement issued with no tenant matches **no rows**, never all of them. Cross-tenant
access is a *role* (`steady_platform_admin`), not a session flag, which is what makes
this genuine defence in depth: an application-layer compromise cannot grant itself the
policy by setting a variable. `longitudinal_events` and `audit_log` are additionally
granted only `SELECT, INSERT`, so ADR 0010's immutability holds at the privilege level
and not merely by convention.

*Verification* — `tests/tenant-isolation.test.ts` (18 cases) covers the application
layer. `scripts/verify-rls.sh` covers the database layer by standing up a throwaway
Postgres cluster, applying the real schema, and attacking it as `steady_app`: reads by
foreign id, enumeration, aggregates, foreign update and delete, an insert stamped with a
foreign tenant, a query with no tenant set, an attempt to assume the admin role, and
attempts to mutate the event log. All twelve are refused; sanctioned platform-admin
access still works.

Running that schema against a real cluster also surfaced a defect no amount of reading
would have: `practice_completions`, `lesson_reads`, `upsell_events`, `autopilot_plans`,
and `autopilot_events` had been added to the SQLite schema during the tiering and
Autopilot work and never mirrored here, so the tenancy `ALTER`s referenced tables
Postgres had never been told to create. The Postgres schema had apparently never been
executed. It now is, twice per run, as part of the check.

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
