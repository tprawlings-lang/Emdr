# Handoff 07 — implementation plan

**Specification:** [`07-demo-login-synthetic-population-and-planning-engine.pdf`](07-demo-login-synthetic-population-and-planning-engine.pdf)
— *Steady Demo Login, Synthetic Population and Deterministic Planning Engine*, 59 pages.

**Status:** Wave 0 done, **Wave 1 done and shipped**. Waves 2–8 open. This plan is the Wave 0 deliverable the handoff itself asks for
(§6.1: *"Confirm current routes, roles, tenant model, event schemas and projection
versions. Exit evidence: gap list and ADRs; no duplicate subsystem"*).

Every section below cites the page that specifies it. Read the page before building the
row — this plan records decisions and gaps, it does not restate the specification.

---

## What the handoff asks for

Three things that ship together, because none of them demonstrates anything alone:

| # | Deliverable | Pages |
|---|---|---|
| 1 | **Role-selectable demo login** — six demo roles, server-bound sessions, a demo-admin control centre | 4–9 |
| 2 | **240 fabricated longitudinal patients** — 60 per U.S. Census region, six months of events, replayable from a seed manifest | 10–29 |
| 3 | **A deterministic planning engine** — versioned metrics, cohort registry, seven signal rules, an eight-state review machine, fairness audit | 30–38 |

Plus the surfaces and contracts that carry them: five screens (39–44), service and API
boundaries (45–50), and an eight-wave build order with release gates (51–58).

**The sentence the whole document turns on** (p1): *build the demo so every number can be
traced to a fabricated event, every role sees only its projection, and every planning
signal can be inspected, challenged and turned off.*

**And the one that decides what the planning engine is** (p2, p31): it answers *who uses
Steady, how usage differs by group, which modules associate with better observed results,
and where a controlled pilot should test a change.* **It does not decide what treatment a
person receives.** Descriptive and deterministic first; statistical models later, in shadow
mode, unable to touch a safety gate or a care decision.

---

## Wave 0 — the gap list

### What already exists and must be reused, not rebuilt

The handoff's final coding rules open with *"confirm existing code and schemas before
adding any new subsystem"* (p58) and its service table warns against a duplicate subsystem
(p46). Eleven of its building blocks are already in this repository:

| Handoff service (p46) | Already built | Where |
|---|---|---|
| Event ledger — immutable facts, corrections, replay | ✅ | `longitudinal_events`, deterministic ULIDs, replay guard in `tests/projections.test.ts` |
| Audit service — privileged reads, writes, exports, resets | ✅ | Hash-chained `audit_log`, `verifyAuditChain()` in `src/lib/audit.ts` |
| Seed registry — stable seeds, versions, expected hashes | ◐ | `ORG_SEED_VERSION` / `PAYER_SEED_VERSION`, `sha256(version:n)` ids, seeded PRNG, `npm run demo -- baseline` prints a fingerprint. **No manifest file, no expected-hash record** |
| Synthetic generator — fabricated events | ◐ | `demo-org-seed.ts` (4,820), `demo-payer-seed.ts` (12,480). **Neither produces per-person longitudinal history** |
| Projection service — role-safe views | ✅ | `src/lib/intelligence/organization.ts`, `payer.ts`, `assertAggregate()` |
| Presentation states | ✅ | `Envelope<T>` — all eight states, incl. `projection_failed`; §5.3's *"render a failed state rather than a number"* is already the contract |
| Small-cell suppression | ✅ | `SMALL_CELL = 11` in `src/components/charts/aggregate.tsx` — **exactly** p37's "suppress 1 through 10" |
| Chart contract — n/N, window, missingness, version | ✅ | `Figure` requires `summary` + `footnote`; `Count {n, of}`; nine §29.1 guards already fail the build |
| Safety engine — deterministic gates, precedence | ✅ | `src/lib/safety/*`, `rule-catalog.ts`, eight test files. p3 requires the demo use **this** engine, not a relaxed copy |
| Export labelling and audit | ✅ | `export_jobs`, governed export with filter hash, purpose, audit event and signature |
| Tenancy and minimum necessary | ✅ | `tenants`/`persons`/`accounts`/`role_assignments`, `TENANT_SCOPED_TABLES`, cross-tenant RLS suite |

**Consequence: this is not a greenfield build.** Roughly half the handoff is already
standing. The work is a role model, a population, a planning engine, and five screens.

### What is genuinely missing

| # | Gap | Spec | Size |
|---|---|---|---|
| G1 | **Six demo roles.** `users.role` is `CHECK (role IN ('member','clinician','admin'))`. Organization *and* payer both authenticate as `admin`; reviewer is not a role at all (`/review/*` is gated by an env access code); demo admin does not exist | pp6, 50 | **Large** — schema migration + auth split |
| G2 | **Session claims.** The token is `userId.issuedAt.epoch.signature`. §1.3 wants environment, dataset_version, tenant_id, person_id, role, purpose, expires_at and `allowed_projections`. Lifetime is 7-day idle / 30-day absolute; the demo wants 60 minutes / 8 hours | p7 | Medium |
| G3 | **Role-selectable login.** `src/app/login/page.tsx` is 88 lines with no role control | pp5–6 | Small |
| G4 | **240-profile population** with per-person six-month history, spanning person-level *and* aggregate views | pp10–28 | **Large** |
| G5 | **Census region and state** on persons | p11 | Small |
| G6 | **Demographic fields** — race, ethnicity, language, sex/gender, disability/access, socioeconomic — with the use rules on p13 | p13 | Medium |
| G7 | **Outcome archetypes** — eight patterns, 30 people each | p12 | Small (data) |
| G8 | **Metric dictionary** — ten versioned definitions. Metrics are currently computed ad hoc inside each projection with no registry and no version | p32 | Medium |
| G9 | **Cohort registry** — executable JSON definitions with immutable versions. *(Also what blocks `/review/research` in the GUI-launch table.)* | p33 | Medium |
| G10 | **Planning rule engine** — seven rules, thresholds in policy configuration with an owner and approval date | p34 | **Large** |
| G11 | **Planning-signal state machine** — eight states, no transition may change a patient's permitted activity | p35 | Medium |
| G12 | **Fairness and small-cell controls** — internal minimum n≥30, intersection checks, proxy review, human challenge | p37 | Medium |
| G13 | **Model registry shell** — eleven fields, shadow-mode only | p38 | Small |
| G14 | **Demo admin control centre** `/admin/demo` — six controls, each with a guard | p9 | Medium |
| G15 | **Five screens** — clinician population view, org/payer population overview, module utilization explorer, fairness audit, planning-signal detail | pp40–44 | **Large** |
| G16 | **Twelve API routes** | p47 | Medium |
| G17 | **Data-quality manifest** — eleven checks, and *the admin page blocks external demonstrations when the latest reset or projection verification failed* | p29 | Medium |
| G18 | **Nightly reset + scripted clock advance + scenario injection** | pp9, 29 | Medium |
| G19 | **Presenter scenario scripts** — a 10-minute investor path and a 25-minute clinical/engineering path, both from a fresh reset | p56 | Small |

### Decisions this plan makes, and why

Five things the handoff leaves to us, or where it meets the existing codebase awkwardly.
Each is a decision recorded here rather than discovered mid-build.

**D1 — `admin` is already taken, and means something else.**
In this codebase `admin` is the *aggregate* role: it reads a population and cannot reach a
person (`requireIntelligence()`). The handoff's "Demo Admin" is the opposite — it inspects
every tenant, person and event (p6). Reusing the name would be the most dangerous rename
in the project. **Decision: the six demo roles get their own names, and `admin` is retired
as a user-facing role.** Proposed: `patient` (aliasing the existing `member`),
`clinician`, `reviewer`, `payer`, `organization`, `demo_admin`. The migration must widen
the CHECK constraint and split `requireIntelligence()` into `requireOrganization()` and
`requirePayer()` — which also closes the real hole the read-time tenant check in
`/api/exports/[id]` currently papers over.

**D2 — the 240 do not replace the 4,820 and 12,480; they sit beside them.**
The existing populations give aggregate *scale* with no person-level story
(`display_name` is NULL for all 4,820 — deliberately, so the organization drilldown is
impossible rather than refused). The 240 give a person-level story that must also roll up.
**Decision: a third seed, `demo-population-seed.ts`, in its own eight demo-org tenants
(p11: NE/MW/SO/WE Care Network A and B), with its own `dataset_version`.** p29's manifest
check *"Profile count: 240 exactly"* therefore scopes to the demo-population dataset, not
to `persons` overall — otherwise it fails at 17,304 forever. This must be written into the
check itself, not assumed.

**D3 — adding eight organization tenants breaks `resolveOrgTenant()` on day one.**
It requires *exactly one* organization tenant without a payer contract and returns null
otherwise, so every organization screen would render "no organization in scope" the moment
the demo population lands. This exact failure already happened once when the payer seed
added a second organization-kind tenant. **Decision: fix scope resolution in Wave 1, before
the seed exists** — resolve from the session's `tenant_id` claim (G2) rather than by
counting tenants. The guard belongs in `tests/payer-boundary.test.ts` beside the existing
one.

**D4 — one population, two naming rules.**
The 240 need names for the clinician view (p6: *"assigned panel"*); the 4,820 must keep
`display_name` NULL. **Decision: the rule is per-dataset, not global, and the existing
aggregate-boundary guard must be tightened rather than relaxed** — it currently forbids
`display_name` anywhere under `src/app/organization`, which stays correct. The new risk is
the reverse: a demo-population person leaking into an aggregate projection. That needs its
own guard.

**D5 — thresholds are configuration with an owner, not constants.**
p34 is explicit that its numbers are *"product defaults for testing, not validated clinical
cutoffs"* and must be stored in policy configuration with an owner and approval date, safe
from quiet edits. **Decision: a `policy_thresholds` table with owner, approval date and
version — not a `const` in a rules file.** A threshold changed without a recorded owner is
the failure this row exists to prevent.

---

## Build order

Following §6.1 (p52). Each wave lists its exit evidence from the handoff, because that is
what makes a wave done rather than merely written.

### Wave 1 — Demo identity and role-bound sessions ✅ **DONE**
**Spec: pp4–8, 50. Exit evidence: cross-role negative tests and environment isolation.**

Shipped. Six roles, six accounts, six landing pages, and the boundary between the two
aggregate consoles enforced rather than commented.

| Built | Where |
|---|---|
| The six roles, their landing pages, both halves of p6's scope, and p50's permission matrix as data | `src/lib/roles.ts` |
| `admin` retired — CHECK constraints widened by table rebuild, existing rows migrated to `organization` | `src/lib/db.ts` (`widenRoleCheck`) |
| `requireOrganization`, `requirePayer`, `requireReviewer`, `requireDemoAdmin`, `requireReviewAccess` | `src/lib/auth.ts` |
| Role dropdown, and p6's can-see/cannot-see table under it | `src/app/login/page.tsx` |
| Role mismatch folded into the generic failure; the audit records which it was | `src/lib/actions.ts` |
| Six accounts, one password per role, environment-overridable | `src/lib/demo-seed.ts`, [`../demo/demo-logins.md`](../demo/demo-logins.md) |
| `/review/safety` — fixed scenarios replayed through the live gate engine | `src/lib/safety/scenarios.ts`, `src/app/review/safety/page.tsx` |
| `/admin/demo` — environment state, and p9's five unbuilt controls named | `src/app/admin/demo/page.tsx` |
| 13 unit guards, 10 e2e negative tests | `tests/demo-roles.test.ts`, `tests/e2e/demo-roles.spec.ts` |

**p8's five negative tests, all passing:** clinician credentials + Demo Admin selection
returns the *same generic failure* as any invalid pairing; the two aggregate consoles cannot
read each other; a patient cannot change `person_id` in a URL and learn whether another
subject exists (both ids answer identically); a role switch leaves no member name on any
payer screen; no demo password appears on any public page.

**What Wave 1 found.** Three defects that only existed because one role served two consoles:

1. **`/review/layout.tsx` called `requireClinician()`** with a comment saying the reviewer
   role was Wave 5 work. The moment `reviewer` existed that became an infinite redirect —
   a reviewer bounced to their landing page, which is inside the console, which bounced
   them again. Next rendered a page with no `<main>`; the e2e suite caught it.
2. **`payer.spec.ts` signed in with the organization's account** and passed, because one
   `admin` role opened both consoles. Same for the payer contract export.
3. **The app shell had no `banner` landmark.** `<main>` and `<nav>` existed; the bar
   carrying the role label and the FABRICATED flag had none, so a screen-reader user could
   reach the content and the navigation but not the two things the frame exists to keep on
   screen.

**Still open from Wave 1:** G2, the session claims. The token remains
`userId.issuedAt.epoch.signature`; §1.3's `environment`, `dataset_version`, `tenant_id`,
`purpose` and `allowed_projections` are not in it, and lifetimes are still 7-day idle /
30-day absolute rather than the demo's 60 minutes / 8 hours. **D3's scope-resolution fix is
also still open** — `resolveOrgTenant()` still counts tenants rather than reading the
session's, so it must be closed before Wave 2 adds eight demo organizations.

### Wave 2 — Seed manifest
**Spec: pp11–27. Exit evidence: counts and balance checks pass.**

- The 240-row manifest is *printed in the handoff* (pp16–27) — transcribe it, do not
  generate it. Region, state, age band, race, ethnicity, language, archetype, clinician,
  baseline, follow-up and safety state per person.
- Demographic fields (G6) with p13's use rules as column comments *and* guards.
- Dictionaries for names, free text and operational notes (p28: *never ask a language model
  to invent uncontrolled clinical narratives at runtime*).
- Balance checks: 60 per region, 10 per age band per region, 30 per archetype.

### Wave 3 — Deterministic generator
**Spec: pp14, 28–29. Exit evidence: stable event and projection hashes.**

- Six months of events per person from `demo_epoch` + seeded offsets, per p14's per-domain
  targets.
- p28's constraints: follow-up must match the authored archetype (never sampled
  independently); protected status must never determine success; missingness must be
  intentional and carry a reason — *not due, skipped, declined, interrupted, failed,
  unavailable*.
- Edge cases as fixtures: duplicate event, late arrival, correction, stale projection,
  partial measure, revoked consent, cross-tenant request.
- The eleven-check quality manifest (G17) and the reset contract.

### Wave 4 — Role projections
**Spec: pp6, 46, 50. Exit evidence: the same events produce correct minimum-necessary views.**

Six views over one ledger. The rule that makes this wave meaningful is that they are
*projections of the same events*, so a discrepancy between the clinician's and the
organization's number is a bug rather than a difference of opinion.

### Wave 5 — Metrics
**Spec: pp32–33, 48. Exit evidence: metric fixtures match hand calculations.**

- The ten-metric dictionary (G8) with versions.
- The cohort registry (G9): executable JSON, immutable versions, *resolve eligibility
  before group filters — never remove non-users from an engagement denominator* (p33).
- p48's typed aggregate response: numerator, denominator, missingness breakdown,
  suppression, status, all four versions, refresh time, lineage reference.
- **Hand-calculate the fixtures.** A metric checked only against its own implementation is
  checked against nothing.

### Wave 6 — Planning rules
**Spec: pp34–36, 44, 49. Exit evidence: no person-level actions; full audit.**

- Seven rules (G10), thresholds in policy configuration (D5).
- The eight-state machine (G11).
- The planning-signal object (p49) — `allowed_actions` supplied by the **server** after
  policy evaluation; *the client never invents or widens the action set*.
- p36's five-level release ladder, which fixes the permitted wording per level.
- p44's required phrase on every candidate signal, and its blocked actions: no direct
  patient assignment, no gate change, no payer restriction.

### Wave 7 — Governance
**Spec: pp37–38, 43. Exit evidence: reviewers can block or retire output.**

- Fairness controls (G12) and the audit screen (p43) — *"the screen must make it easier to
  discover uneven access or harm, not easier to stereotype a group. Do not rank races,
  assign grades to demographic groups, or use red and green labels on protected
  identities."*
- Model registry shell (G13), shadow-mode only.
- p36's prohibition on race correction factors.

### Wave 8 — Demo hardening
**Spec: pp9, 29, 56. Exit evidence: cold-start rehearsal passes twice.**

- The control centre (G14), nightly reset and clock advance (G18), scenario scripts (G19).
- p29: the admin page **blocks external demonstrations** when the latest reset or projection
  verification failed, and *a presenter must never repair the demo by editing database rows
  directly*.

---

## The ten release gates

p54. These are the definition of done for the whole handoff, and each maps to a guard file
in the way the existing §29.1 rules already do:

| Gate | Blocks release when |
|---|---|
| Truth | Any screen can be mistaken for real data |
| Security | Any cross-role or cross-tenant leak |
| Safety | Demo bypass or a relaxed safety rule |
| Reproducibility | Manual repair or nondeterministic output |
| Data quality | An orphan, invalid or contradictory story |
| Analytics | A metric calculated only in the client |
| Fairness | Protected-group output can drive person-level care |
| Planning | Any automatic treatment or access decision |
| Operations | A failed reset or a silent audit failure |
| Clinical review | Outcome or causal overclaim |

---

## Where this sits against the other handoffs

Handoff 06 (**GUI launch**, in progress) builds the screens. Handoff 07 gives them a
population worth looking at, a login that reaches all six of them, and a planning layer
above them. **They overlap in three places, and 07 resolves each in 06's favour or
supersedes it explicitly:**

| Overlap | Resolution |
|---|---|
| 06's `/review/*` console (5 of 13 screens built) vs 07's reviewer role | 07 gives the reviewer an identity and a landing page (`/review/safety`); 06 specifies the screens. Build 07's role first — 06's `/review/access` is the same binding |
| 06's `/organization/*` and `/payer/*` vs 07's population overview (p41) | 07's screen is a *new* aggregate over the 240, sharing the shared contract on p41. It does not replace 06's nine and ten screens |
| 06's cohort-registry gap (blocks `/review/research`) vs 07's cohort registry (p33) | **Same gap. 07 specifies it.** Build it once, in Wave 5 |

Two of 06's eighteen open items are closed as a side effect of 07's Wave 1: the
`/review/access` binding, and the scope resolution that currently fakes it.

**Where 06 and 07 differ, 07 is later and controls. Where either is stricter on safety,
privacy, evidence or denominators, the stricter one controls.**

---

## Open questions for a human

Not blockers — p57 lists ten decisions that explicitly do not block the first build. These
three are the ones that touch existing architecture and are worth answering before Wave 1
rather than after:

1. **Does `admin` disappear entirely, or stay as a legacy alias?** D1 proposes retiring it.
   Anything still holding `role = 'admin'` after the migration is a security question, not
   a cosmetic one.
2. **Do the 240 get a nightly reset in production-demo, and on whose clock?** p29 targets
   under 120 seconds; the current full reset takes roughly that already at 17,304 persons.
3. **Who owns the planning thresholds** (D5)? p34 requires a named owner and approval date
   before the rules can fire at all.
