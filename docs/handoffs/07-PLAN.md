# Handoff 07 — implementation plan

**Specification:** [`07-demo-login-synthetic-population-and-planning-engine.pdf`](07-demo-login-synthetic-population-and-planning-engine.pdf)
— *Steady Demo Login, Synthetic Population and Deterministic Planning Engine*, 59 pages.

**Status:** Waves 0–5 done and shipped. Waves 6–8 open. This plan is the Wave 0 deliverable the handoff itself asks for
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

### Decisions confirmed with the author

Answered 2026-08-29, so they are settled rather than assumed. Recorded here because
the next person to read this plan will otherwise re-open all three.

| # | Question | Decision |
|---|---|---|
| A1 | The demo clinician has no panel over the 240 — they sit in the platform tenant with Alex and Sam, while the 240 live in eight organization tenants under twelve clinician *persons* with no logins. | **`clinician.demo@steady.local` becomes NE-C1**, inside NE Care Network A, and Alex and Sam move with them. One account, one tenant, a real panel of roughly forty of the 240 plus the two narrative personas. The alternative — a cross-tenant panel — was rejected: it would break the tenant scoping every other guard in the project enforces, leaving §30.6's boundary in place only for the aggregate roles. |
| A2 | The 240 were made sign-in-able (`st-<region>-<nnn>@steady.local`, patient password) so a presenter can open a specific archetype from the inside. | **Kept.** p14 lists "1 account" per profile, the environment holds no PHI, and the password is already documented. The address pattern is now named in the logins document rather than left to be discovered. |
| A3 | p15 prints `"seed": 100217` for `ST-WE-017` and no rule in the handoff derives it. | **No rule existed** — it was an illustrative value in a sample JSON blob. The formula in `demo-population-manifest.ts` stands: region offset (NE 100 000, MW 200 000, SO 300 000, WE 400 000) plus the row number, documented in place. |

| A4 | Who owns the planning thresholds (D5), what the numbers should be, and who signs a clinical review. | **Answered 2026-09-02.** Owner: **Founder, MSc Mathematics**, approved that date, recorded on every row of `policy_thresholds`. Thresholds: **p34's defaults as written** — 10 percentage points for the access gap, 12 for the follow-up gap, two windows for both repeat conditions — stored with p34's own caveat that they are product defaults for testing rather than validated clinical cutoffs. Clinical review: **the same signature covers it**, so a signal may advance out of `clinical_review` on the owner's authority. That last one is a real concentration of authority and is recorded as such in `PLANNING_OWNER.note`: p35 gives clinical review its own state precisely so the person who chose a threshold is not the person who judges whether a signal crossing it may affect programme content. Defensible over fabricated data; a deployment with patients in it needs two people. |

**Still needed from a human, and not yet:**

- **Whether the 240 get a nightly reset in the deployed demo, and on whose clock** (Wave 8).
  A reset currently takes about 12 seconds against p29's 120-second target, so the constraint
  is scheduling rather than duration.

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

**G2 (session claims) and D3 (scope resolution) closed in a follow-up.** The token now
carries every claim §1.3 names — environment, dataset_version, tenant_id, person_id (only
for a role that acts for a person), role, purpose, issued_at, expires_at and
allowed_projections — signed, with demo lifetimes of 60 minutes idle and 8 hours absolute.
**The claims grant nothing:** the account row stays authoritative, the claims are checked
against it, and a disagreement destroys the session rather than resolving in either
direction. A token that carries a role and is trusted for it has to be revoked; one that
carries a role and is checked for it revokes itself.

Scope now reads the session instead of counting tenants. The aggregate accounts are bound
to their tenants at seed time (after the org and payer seeds, since it points at tenants
they create), so `resolveOrgTenant()` is a read. Adding Wave 2's eight demo organizations
changes nothing.

**Two latent bugs this uncovered**, both the same class — configuration read at module load:

- `const SECRET = process.env.EMDR_SESSION_SECRET ?? "dev-only-secret-change-me"` meant a
  process where the variable is set after the module loads signs and verifies with the dev
  fallback, silently. Production is unaffected because the environment is set before the
  process starts, which is exactly why it would never have been noticed there.
- `const DEMO = process.env.EMDR_DEMO === "1"` froze the session lifetime at import, so the
  value depended on import order rather than configuration.

The first was found by a **guard that passed for the wrong reason**: a test building an
expired token signed it with the real secret while the module verified with the fallback,
so the token was rejected on its signature and the expiry assertion never ran. Deleting the
expiry check entirely did not fail the test. Both are now read at call time, and the
mutation bites.

### Wave 2 — Seed manifest ✅ **DONE**
**Spec: pp11–27. Exit evidence: counts and balance checks pass.**

| Built | Where |
|---|---|
| All 240 rows, transcribed from pp16–27, with p29's balance checks computed from them | `src/lib/demo-population-manifest.ts` |
| Three separate dictionaries — member notes, operational notes, clinician comments — and fabricated names | `src/lib/demo-population-dictionaries.ts` |
| Eight organization tenants (two per region), twelve clinicians, 240 people with attributes and enrolments | `src/lib/demo-population-seed.ts` |
| `person_attributes` — p13's fields, on their own table | `src/lib/db.ts` |
| 13 unit guards, plus a source-only schema lint | `tests/demo-population.test.ts`, `tests/schema-lint.test.ts` |

**The transcription verified itself.** All 240 rows parsed out of the PDF and every one of
p29's balances passed on the first attempt — 240 exactly, 60 per region, 40 per band, 10 per
band per region, 30 per archetype, 240 distinct ids. A typo in a race or a state would have
surfaced as an off-by-one in one of those counts, which is worth more than proofreading 240
lines. A seventh check was added that p29 does not list: the archetype and the safety column
are two statements about the same person, and all 30 Safety-pause profiles carry a fixed
pause with none outside — the handoff is internally consistent, and now provably so.

**Three decisions Wave 2 had to make, because the handoff leaves them open:**

- **The seed formula is ours and stated.** p15 prints one profile carrying `"seed": 100217`
  for `ST-WE-017`, and no rule in the document derives that number. It illustrates the
  *shape* of a profile; the requirement beneath it is only that ids are deterministic within
  a dataset version. A written-down formula satisfies that; one reverse-engineered from a
  single printed value satisfies nothing.
- **Demographic attributes live off `persons`.** p13 permits them for representation,
  disparity and access audit and forbids them as care-selection rules, and the separation is
  what enforces it: a clinical query that selects a person does not carry race and ethnicity
  along by default, so reaching them is a join someone writes — which is the moment a
  reviewer can ask why.
- **Clinicians split 2/1 across each region's two organizations.** p11 names three clinicians
  and two organizations per region without saying how they divide. The uneven 160/80 split is
  deliberate: two organizations of identical size make every cross-organization comparison
  trivially equal, which hides exactly the difference the console exists to surface.

**Two guards were rewritten during this wave because they could not fail.** The backtick
schema-lint imported `db.ts`, whose *parse failure* is its entire subject — so the module
died on load and took the guard with it. And an assertion that arm A did not hold exactly
half the population was vacuous: each clinician slot holds exactly 80 people, so no two-way
split of three can produce 120/120. Both now bite.

### Wave 3 — Deterministic generator ✅ **DONE**
**Spec: pp14, 28–29. Exit evidence: stable event and projection hashes.**

| Built | Where |
|---|---|
| `StableRandom` (mulberry32), seeded `sha256(dataset_version:profile_seed)` | `src/lib/demo-population-generator.ts` |
| Eight archetype activity paths — check-in count, module and session ranges, curve shape, miss rate, authored gaps | same |
| Six months of history: 240 accounts, 483 consents, ~18k check-ins, ~1.3k measures, ~6.5k modules, ~620 sessions | same |
| Missingness with p28's six reasons, following the archetype rather than drawn at random | same |
| Edge cases on **named** profiles: duplicate, late arrival, partial measure, revoked consent | same |
| p29's data-quality manifest, 16 checks computed against the live database | `src/lib/demo-quality.ts`, rendered on `/admin/demo` |
| 11 unit guards | `tests/demo-generator.test.ts` |

**The exit evidence, measured.** Two independent resets produce the identical baseline hash.
`npm run demo -- verify` reports **19,736 events applied, 0 differences, 0 gaps** — byte-identical
replay. A reset takes about 12 seconds against p29's 120-second target.

**How the events are written, and why it is not the pseudocode.** p28 sketches a loop that
appends events directly. This writes **current-state rows** and lets the existing genesis
backfill derive the ledger, because the replay guard requires every event carrying a
projector to name the row it rebuilds. The organization seed learned this the expensive way:
it wrote clinical event types for people with no clinical records, and the guard reported
8,008 events claiming rows they could not reconstruct. Events with no current-state row —
safety gates, clinician actions, corrections, missingness — are written directly, because
they carry history the current-state tables never held.

**A real tenancy defect, found by replay.** The genesis backfill wrote **every reconstructed
event into the platform tenant**, regardless of where its person lived. It was invisible for
as long as every seeded user happened to be in the platform tenant; the 240-profile
population is the first cohort in organization tenants, and replay immediately reported
thousands of rows rebuilding into the wrong one. An event in the wrong tenant is read by a
query scoped to that tenant and missed by one scoped to the right one — p29's "cross-tenant
references: 0" is the check it would have failed.

**Three of the generator's own defects, caught by its guards.** p14's per-person targets were
emergent rather than structural, so a per-day probability produced one person with 1 check-in
and another with 134 against a stated bound of 18–90; drawing miss slots into a `Set`
collapsed collisions and produced people with ten measures against a ceiling of eight; and a
`consent.withdrawn` fixture without a `projectionId` failed the replay guard exactly as
designed. All three are now checked by number rather than assumed.

**Two guards were strengthened after failing to detect their own mutation.** A coherence
check comparing early responders to no-change used a bare `>`, which two groups drawn from
the same distribution satisfy about half the time — it now requires a 1.25× margin. And the
cross-tenant check ran against a database with no reconstructed events at all, so it could
not have found the defect it was written for; it now runs the backfill first.

### Wave 4 — Role projections ✅ **DONE**
**Spec: pp6, 46, 50. Exit evidence: the same events produce correct minimum-necessary views.**

| Built | Where |
|---|---|
| The clinician's panel — person-level, named, tenant-scoped | `src/lib/clinical/panel.ts`, `/clinician/population` |
| The population overview — aggregate, laundered, shared by both consoles | `src/lib/intelligence/population.ts`, `/organization/population`, `/payer/population` |
| The demo clinician bound as NE-C1 in NE Care Network A, with Alex and Sam | `src/lib/demo-population-seed.ts` |
| A network-operator account for the demo networks | `src/lib/demo-seed.ts` |
| The access pathway for the 240, so handoff 06's funnel screens work over them too | `src/lib/demo-population-generator.ts` |
| 12 unit guards, 9 e2e | `tests/role-projections.test.ts`, `tests/e2e/role-projections.spec.ts` |

**The exit evidence, checked as an equality rather than asserted.** The panel counts 42
people and the organization counts 42; the improvement count derived from the panel's own
rows equals the organization's; so does the missed-measure total. They cannot disagree,
because there is nothing for them to disagree about.

**Two mechanisms, deliberately different.** Person-level views are scoped in the SQL, so a
caller cannot widen them by passing a different argument. Aggregate views go through
`assertAggregate`, which **throws rather than filters** — a projection carrying a person id
does not render with the id hidden, because it would still have carried it into every cache
and log on the way.

**A file in the wrong place, caught by an existing guard.** `buildClinicianPanel` first
lived in `src/lib/intelligence/`, and `tests/aggregate-boundary.test.ts` fails the build on
a person identifier anywhere in that directory. The choice was to carve an exception into
the guard or move the file; the guard's rule is "nothing under intelligence/ touches a
person", and a rule with one exception is a rule somebody adds a second exception to. It
moved to `src/lib/clinical/panel.ts`.

**Two organization accounts, and the second is not a duplicate.** There are two organization
populations here by design (D2): Northside's 4,820 have no names so a drilldown is
impossible, and the 240 do. An organization sees its own tenant, so one account cannot report
on both. `org.demo` stays on Northside and correctly renders **empty** on the population
screen; `network.demo` operates NE Care Network A. This is only possible because D3 made
scope a read of the session rather than a count of organization tenants.

**Defects this wave surfaced:**

1. **A silent zero.** The population overview returned `ready` with every figure at zero for
   an organization holding none of the demo population — a console reporting "0 covered, 0
   active, 0 improved" has told the reader something false with great confidence. It now
   returns `empty` with a reason.
2. **`refreshDemoDaily` wrote today's check-in with a defaulted tenant.** Correct for exactly
   as long as every demo member lived in the platform tenant. Once Alex and Sam moved, that
   was the one row of theirs still filed under the old tenant, and replay caught it.
3. **An import cycle.** `db.ts` computed a tenant id at module load from a module that
   imports back from `db.ts`; the cycle resolved with one side undefined and announced itself
   as "cannot read DATASET_VERSION of undefined" in an unrelated test file. Third instance
   this handoff of the same root cause — configuration evaluated at module load.
4. **A header reading 0%.** The organization shell counts `care.started`, which the Wave 3
   generator never emitted, so a fully-engaged demo network reported "0 of 44 started care".
   The generator now writes the access pathway, which makes handoff 06's funnel screens work
   over these tenants too.

**Four of my own guards could not fail, and were rewritten.** An empty-group check measured
140 characters past the heading and was reading its neighbour's; a denominator check accepted
any "of N" within 80 characters and passed on a card whose own denominator had been deleted;
a panel-ranking check tripped on the sentence disclaiming ranking; and the `affirmative()`
helper — the project's existing fix for that last family — split on newlines, so any
disclaimer that wrapped across two lines lost its negation. That helper is fixed in both
files that use it.

### Wave 5 — Metrics ✅ **DONE**
**Spec: pp32–33, 48. Exit evidence: metric fixtures match hand calculations.**

| Built | Where |
|---|---|
| The ten-metric dictionary, each with a version, its required display and what it must **not** be read as | `src/lib/metrics/dictionary.ts` |
| The cohort registry — executable JSON, immutable versions, recursive hash | `src/lib/metrics/cohorts.ts` |
| The arithmetic, **pure over typed observations** | `src/lib/metrics/compute.ts` |
| The database layer that produces observations and computes nothing | `src/lib/metrics/population-metrics.ts` |
| p48's typed response, rendered with its failed state | `src/components/app/MetricPanel.tsx` |
| 11 hand calculations, 7 population invariants, 9 contract guards | `tests/metrics.test.ts` |

**The exit evidence is arithmetic written out in the tests.** Each fixture is three or four
people, and the expected answer is worked through in the comment — 10 active weeks over 30
observed, 6 complete of 12 due, 1 retained of 3 observable. A metric checked against its own
implementation is checked against nothing, so the computation is **pure**: it takes rows and
returns a number, with no database in reach. The loading layer is separate and is checked by
invariants over the 240. Neither half could catch both kinds of mistake.

**Suppression moved out of the computation.** It was applied inside `base()`, which meant
every hand calculation read a withheld value instead of the answer — a suppression bug would
have hidden behind the suppression. p29 scopes small-cell suppression to "aggregate
**external** views", so it is a disclosure control applied at the boundary by
`suppressExternal`, and p37's internal minimum analysis size (n ≥ 30) is a different control
that belongs to the fairness layer.

**Four defects the guards caught in this wave's own code:**

1. **The cohort hash ignored nested keys.** `JSON.stringify(c, Object.keys(c).sort())` looks
   like key-order normalisation and is not — the replacer array is an allow-list applied at
   every depth, so changing a cohort's age band left its fingerprint identical. A hash that
   ignores the part most likely to change is worse than none, because it is trusted.
2. **The population view divided two fields to make a percentage**, which p48 forbids the
   client from doing. It now reads `pct()`, which cannot render a rate without its
   denominator.
3. **Six missingness reasons were squeezed into four buckets**, relabelling "skipped" as
   "unavailable" — which made a system outage the largest category by construction and would
   have pointed an investigation at the delivery pipeline instead of at reminders. The six
   are now one-to-one, and the numbers moved: 182 skipped, 90 unavailable.
4. **Time to review paired a pause with the next clinician action of any kind**, giving a
   median of 593 hours — the average distance between two unrelated events, not a latency.
   The generator now writes an explicit documented response referencing the gate, and the
   median is 10 hours with a p90 of 32.

**One artefact made legible rather than hidden.** Day-180 retention on a 180-day window is
structurally unobservable, and reported 0 of 18 with 224 censored — arithmetically right and
reads as a finding. Results now carry `mostly_censored`, and the panel draws it as *not
observable yet* instead of as zero per cent.

### Wave 6 — Planning rules ✅ **DONE**
**Spec: pp34–36, 44, 49. Exit evidence: no person-level actions; full audit.**

| Built | Where |
|---|---|
| p34's seven rules, **pure** over readings, withheld-then-triggered | `src/lib/planning/rules.ts` |
| Thresholds as policy configuration with an owner, an approval date and an append-only table | `src/lib/planning/policy.ts`, `policy_thresholds` |
| p36's five-level release ladder, and the wording check that enforces it | `src/lib/planning/ladder.ts` |
| p35's eight-state machine, and p49's server-supplied action set | `src/lib/planning/lifecycle.ts` |
| p49's signal object, with p44's required phrase on the object rather than on a screen | `src/lib/planning/signal.ts` |
| Detection, persistence, review and lineage | `src/lib/planning/service.ts`, `src/lib/planning/scope.ts` |
| p44's nine-section detail screen and the rule list beside it | `/review/planning`, `/review/planning/[id]` |
| Three of p47's twelve routes | `/api/planning/signals`, `…/:id/review`, `…/:id/lineage` |
| Windowed metrics, so "repeats in two windows" is evaluable at all | `loadObservations(tenantIds, window)` |
| 50 unit guards, 5 e2e | `tests/planning.test.ts`, `tests/e2e/planning.spec.ts` |

**The exit evidence, as structure rather than assertion.** *No person-level actions* is
enforced by what `src/lib/planning` may contain and import: the build fails on a
`person_id`, a `user_id` or a `display_name` anywhere in the directory, and on an import of
the safety engine, the gating chain, the member modules or the clinical modules. A
transition writes one row saying a signal moved; there is no code path from that row to a
gate, because the gate is not reachable from here. *Full audit* is checked by driving a
signal through the machine and reading the hash-chained log back — state changes, refused
actions, blocked actions and lineage views all land in it.

**Thresholds are configuration, and the table enforces it.** `policy_thresholds` refuses an
`UPDATE` of a value, an owner or an approval date, and refuses a `DELETE`, by trigger. A
change is a new version row; the old one stays readable, so a signal raised last month can
still be read against the number that was actually in force. The seed is insert-if-absent,
so a redeploy cannot overwrite an owner. And `loadThresholds()` **refuses** rather than
falling back to the constants in the source — a fallback would make the owner record
optional in practice while appearing mandatory in the schema.

The guard that makes D5 real is not a source review. Every rule is evaluated against a
**recording** threshold accessor, the keys it actually read are collected, and each is
checked against the table in both directions: no rule may compare against a number that has
no policy row, and no policy row may sit there unread. A rule that reached for a literal
reads no key, so it shows up as an unread threshold rather than as a diff somebody had to
notice.

**Three of the seven rules produce nothing in this deployment, and each names the input it
does not have.** That is p34's "no output when" column working, not a shortfall:

- **REGION_CAPACITY** — there is no open-slot feed. The organization capacity screen already
  renders in the partial state for this reason and names the missing source above the chart;
  a planning rule that fired anyway would have to invent the denominator.
- **SAFETY_REVIEW_LOAD** — the review events are counted and the staffed coverage schedule
  they would be measured against does not exist as data.
- **MODULE_SIGNAL** — p34's condition is that a confidence interval must not cross zero, and
  `computeObservedChange` reports the observed *range* and says in its own comment that
  calling it an interval estimate would promote the finding a rung on p36's ladder.

**ACCESS_GAP is withheld too, and now for two reasons, both worth recording.** The 240 all
enrolled in a single month, so the second window contains one entrant — and activation is a
cohort-entry metric, so p34's "denominator below threshold" is the correct answer to a
window with nobody in it. Since the access model landed, the *first* condition it trips is
missingness: at 30.5% against a 30% limit, an access comparison genuinely is unreliable
before the denominator question is even reached. Both are true and the more fundamental one
is masked by the earlier check, which is a limitation of reporting one reason per rule.

**The population had to be given something to find.** The manifest is balanced on every
dimension p29 checks — 60 per region, 40 per band, 40 per race, 30 per archetype, 10 of each
language in each region — so the population it describes contains no disparity at all.
Measured before anything was added, the largest follow-up difference between any declared
cohort and the eligible population was **3.4 percentage points against a threshold of 12**:
every rule evaluated to "no gap", and a screen that has never had anything to show has not
been tested.

That is what `src/lib/demo-population-disparity.ts` is for, and it is described in its own
section below.

**What Wave 6 found.**

0. **A perfectly balanced population, which is a defect.** Everything above under "the
   authored access model" — the manifest describes a population with no disparity in it, so
   every planning rule correctly reported nothing, and neither the engine nor the screens
   had ever been exercised. Found by running the engine against the real data rather than
   against fixtures, which is what `scripts/testing/planning-probe.ts` and
   `scripts/testing/disparity-report.ts` exist for.
1. **Windowing a cohort-entry metric.** The first windowed loader clipped a person's *first
   action* to the window, so everybody who enrolled before it read as a failure to activate.
   It announced itself as **86.7 percentage points of drift on a population that had not
   moved**, which tripped DATA_QUALITY and blocked the whole release — the rule doing exactly
   its job on a number that was wrong. A window now selects the *enrolment cohort* for
   activation and the *activity* for everything else, and `enrolledInWindow` carries the
   distinction into `compute.ts`.
2. **A guard that could never pass.** p34 lists "missingness high" under ACCESS\_GAP, and it
   was applied to FOLLOWUP\_GAP as well, which looked like prudence. Follow-up completion
   *is* a missingness measure: the authored barrier produced an 18-point gap and 41%
   missingness, and the rule that exists to report the first was silenced by the second.
   Every cohort with a real follow-up gap was withheld for having one. This project has
   spent a lot of this handoff on guards that could not fail; a guard that cannot pass is
   the same mistake wearing the other coat.
3. **A fairness alert on a region.** The disparity reading was built for every cohort, so
   FAIRNESS\_ALERT would have fired on "the Midwest" — a category error in both directions,
   diluting the alert and implying a reporting dimension is a protected class. It now
   withholds on any cohort not defined by a protected attribute, with that as the stated
   reason.
4. **A person id inside the planning engine.** The data-quality reading queried orphan and
   cross-tenant events directly, which names `person_id` in SQL. The choice was to carve an
   exception into the boundary guard or move the query; the query moved to
   `demo-quality.ts`, which already owns those checks — and the planning screen and the
   admin page can no longer disagree about whether the environment is releasable.

**Four of these guards were mutation-tested by deliberately breaking the code**: removing
FOLLOWUP\_GAP's missingness exclusion, hard-coding a threshold instead of reading policy,
letting a blocked action into the allowed set, and silencing DATA\_QUALITY when its reading
is missing. All four failed the build.

### The authored access model

`src/lib/demo-population-disparity.ts`. Six named real-world mechanisms with stated
magnitudes, applied by the generator on top of each archetype's own path. Three rules govern
what may go in.

**A mechanism is operational, not dispositional.** Every entry is something the *service*
did — a measure that was never delivered, an appointment that took longer to arrange — or a
documented property of a life stage. Nothing says a group tries less hard. A fabricated
population that encodes a stereotype teaches it to everyone who reads the console, under the
authority of a screen built to prevent exactly that. **The guard is a permutation test**:
every profile's access model is recomputed under all six races and both ethnicities and must
return the identical answer. It cannot be satisfied by a comment.

**Every mechanism is confounded on purpose.** p36 opens by listing the reasons a difference
may not be what it appears to be. If the fabricated gaps are clean, the release ladder is
decoration — a reviewer follows the obvious explanation and is right every time.

**Not every gap crosses the line.** Real operational data has differences of every size and
most are not actionable. The magnitudes are tuned so some cohorts trip p34's thresholds and
some visibly do not.

| # | Mechanism | What it does | The ambiguity it creates |
|---|---|---|---|
| M1 | Interpreter-dependent delivery | Measures go undelivered when an interpreter cannot be booked, three times more often in the site arm with no contracted line | p11 authors interpreter need **independently of language**, so a language cohort's gap is carried by the third of it that needs one — and the answer is interpreter capacity, not the language |
| M6 | Instrument translation coverage | The follow-up instrument is deployed in Spanish and not in Mandarin | Applies to the *whole* language cohort, unlike M1. This is why the two languages behave differently, and why stratifying resolves one and not the other |
| M2 | Age gradient | Older members start slower and then complete follow-up **more** reliably; younger members are the reverse | A genuine **reversal**. Whichever metric is picked, a different band looks worst — "which group is doing worse" is unanswerable until somebody names the metric |
| M3 | Distance to a first appointment | Seven predominantly rural states, spread across **all four regions** | A regional difference is partly a composition difference, and only a cohort defined by *state* can tell them apart |
| M4 | Unaccommodated functional access need | Screen-reader and captions users lose a little engagement and delivery | Small, and real: a screen-reader user meeting an unlabelled control does not complain, they stop |
| M5 | Coverage and scheduling instability | Engagement drops while completion-when-due does not | The two metrics disagree about the same person — the reason p32 refuses to let one be read off the other |

**What it produces, measured.** Network follow-up completion 67%; per-person bounds still
inside p14's 18–90 check-ins and 4–8 measures; all sixteen of p29's checks pass; replay
byte-identical.

| Cohort | Follow-up completion | Fires at 12pp? |
|---|---|---|
| Mandarin preferred | **−15.4pp** | **yes** |
| Needs an interpreter | −16.7pp | (the operational driver) |
| Spanish preferred | −7.2pp | no — visible and sub-threshold |
| Rural states | −2.4pp, but **activation 41% against 61%** | no — it is a speed problem, not a completion one |
| Any region | ±1pp | no |
| 65+ | **+5.7pp**, activation **28%** | — the reversal |
| 18–24 | −2.5pp, activation **80%** | — the other end of it |

**The stratification is the point.** Both language cohorts look like the same finding and
are not:

| | Overall | Interpreter need held out |
|---|---|---|
| Spanish | −7.2pp | **−2.7pp** — the gap was the interpreter |
| Mandarin | −15.4pp | **−14.4pp** — it survives; the instrument is not translated |

**So p44's "Alternative explanations" is now computed rather than listed.** The first version
of that section rendered the rule's static limitation strings — "observational", "no
adjustment for confounders" — which are true, generic and useless: a reader who has decided
what a signal means is not talked out of it by a disclaimer, only by a number.
`src/lib/planning/explanations.ts` runs five checks against the same observations the signal
was computed from, and each one either finds something or says it looked and did not:
composition, a stratified recomputation, the **cause mix** (were the missing measures the
service's or the person's?), differential missingness, and group size. It is **pure over
observations**, so it is checked against arithmetic worked out in the test comments.

Stratifying is level 2 on p36's ladder, so those sentences open with *"Observed within these
strata"* and may not say the stratum caused anything. Both branches of that wording are
guarded, and both were mutation-tested.

**One threshold key was doing two jobs.** `analysis.min_denominator` was applied to a metric
denominator by the rules and to a headcount by FAIRNESS\_ALERT and the explanation layer. The
consequence was concrete: the stratified check that separates the two language stories was
refused because holding out interpreter need left 26 *people* — on a rate resting on nearly
two hundred observations. It is now two keys with the same value and different meanings,
`analysis.min_denominator` and `analysis.min_group_size`.

**What Wave 6 deliberately does not build.** p50 gives the organization and payer roles a
"subset" grant on `planning_review`, and they get none. The reason is a gap in the cohort
registry rather than in the authorization: every cohort declared so far is defined by
region, age or language and spans several organizations, so there is nothing for a
single-tenant subset to be a subset *of*. Those cohorts arrive with Wave 7, where the
small-cell and minimum-analysis-size questions a per-organization cohort immediately raises
also get answered. Nine of p47's twelve routes remain unbuilt (G16).

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
