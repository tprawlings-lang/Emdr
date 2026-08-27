# Gap analysis — current codebase vs. Handoff A

Verified against the shipping code on 2026-08-27. The purpose is to separate *what
already satisfies Handoff A* from *what conflicts with it*, so the conflicts can be
closed with ADRs before history accumulates and the fixes get expensive.

## 1. What already maps to Handoff A

| Handoff A requirement | Current state | Verdict |
|---|---|---|
| **A4 Memory architecture** — typed, not raw chat | 9 typed memory categories with source, provenance, decay, member view/edit/delete | **Strong.** Add confidence, sensitivity, AI-use permission, scope, supersession history |
| **A6 Safety state machine** — deterministic rules before generative response | 30-rule engine, crisis regex pre-filter runs before every model call, output guard, kill switches | **Strong on execution order.** Needs typed *states* (see conflict 4) |
| **A3 Assessment** — instrument/version, responses, score, severity | PC-PTSD-5, PCL-5, ITQ, PHQ-9, GAD-7 with versions, risk flags, trends | **Strong.** Enforce instrument-version immutability |
| **Provenance / audit** — auditable without relying on generated prose | Append-only hash-chained audit log across 8 event families | **Ahead of spec.** This is a genuine asset |
| **A3 Consent** — purpose, scope, effective/withdrawn | Versioned, scoped consent ledger | **Match.** Add research/model-development permissions |
| **A1 Infrastructure** — PostgreSQL, queue, observability | Postgres migration code-complete and verified; SQLite/PG dual layer | **Ready to cut over** |
| **A8 UX scope** — onboarding, check-in, companion, memory view, measures, interventions, safety routing | All shipped, web + native iOS | **Match** |
| **A10 Testing** — domain rules, golden safety cases, migration, permission, audit tests | 259 automated + 17 e2e, red-team harnesses, CI gates | **Strong foundation** |

**The existing build is the proof-of-execution the VC document cites** (30 safety rules,
14-step gate, 259 tests, 2 psychologist reviews). It should be evolved, not replaced.

## 2. Conflicts that need an ADR before Handoff A closes

Ordered by cost-of-delay — the first three get dramatically more expensive with every
week of accumulated production data.

### Conflict 1 — Not event-sourced 🔴
**Spec (00 §4):** "Mutable current-state views may exist for speed, but the authoritative
history must preserve events."
**Current:** 29 tables, all mutable current-state. `checkins`, `therapy_sessions`,
`practice_completions` record outcomes, not events.
**Why it matters:** every downstream handoff depends on replay — B's pattern jobs consume
"versioned longitudinal events," D requires predictions "reconstructable at the point in
time they were made, without future-data leakage," E requires reconstructing a full
patient journey. Without an event spine, C/D/E are not buildable.
**Migration path:** introduce `LongitudinalEvent` as the write path, project existing
tables as read models, backfill current rows as synthetic genesis events.

### Conflict 2 — No tenancy 🔴
**Spec (A2):** "Tenant/organization fields exist now even for direct-to-consumer users;
consumer tenancy can be represented by a platform tenant."
**Current:** zero organization/tenant columns in the schema.
**Why it matters:** C requires "tenant isolation enforced at the data-access layer and
tested with cross-tenant attack cases," and consumer records must "later enroll into an
enterprise program without identity duplication." Retrofitting tenancy across 29 tables
after enterprise data exists is one of the most expensive migrations in this program —
and it is nearly free today.

### Conflict 3 — Person identity conflated with account 🔴
**Spec (A2):** "Person identity is distinct from account identity and organization
enrollment."
**Current:** a single `users` table is person, account, and role.
**Why it matters:** C ingests "people who do not yet have a Steady account" — population
members with claims/EHR data and no login. That is structurally impossible against the
current model.

### Conflict 4 — Safety state is implicit, not a typed state machine 🟡
**Spec (A6):** "Safety transitions are explicit states, not booleans. Examples: normal,
elevated-review, cooldown, blocked-pathway, crisis-routing, re-entry-pending."
**Current:** the 14-step gate returns allow/deny plus an action string; cooldowns are
derived by querying history rather than held as state.
**Why it matters:** less severe — behavior is already correct and tested. But A6 also
requires "re-entry follows typed criteria and authorization," which has no representation
today. Refactor is contained to `gating.ts` + the safety module.

### Conflict 5 — No AI Gateway 🟡
**Spec (A7):** "All model calls pass through a Steady AI Gateway. No feature calls a model
provider directly."
**Current:** four call sites hit the provider directly — `companion-ai.ts`,
`mobile/voice.ts`, `program-plan.ts`, `actions.ts`.
**Why it matters:** the gateway owns structured-output validation, tool allowlisting with
risk tiers, prompt/version registry, evaluation/golden sets, cost and latency logging, and
provenance. B's evaluation framework and D's Learning Ledger both depend on it. Contained,
buildable work — roughly a 3–4 week module plus call-site migration.

### Conflict 6 — Interventions are not versioned 🟡
**Spec (A5):** "Intervention and InterventionVersion are separate. Never overwrite a
protocol used in historical sessions."
**Current:** the 20 practices are code constants with no version field. Editing a script
silently changes the meaning of every historical completion.
**Also missing:** contraindications, target state, prerequisites, response measure,
clinical approval status, and delayed-response capture (B2 needs the last one to learn
intervention-response relationships).

### Conflict 7 — Truth model not represented 🟡
**Spec (00 §5):** FACT / OBSERVATION / PATTERN / HYPOTHESIS / RECOMMENDATION / DECISION as
distinct types with distinct authority.
**Current:** memory items are typed by subject (trigger, grounding tool…) but not by
epistemic status. Nothing distinguishes "the patient told us this" from "we inferred it."
**Why it matters:** this is the spec's central claim — "the generated sentence is
disposable; the structured evidence and provenance are permanent." It is also what makes
Steady explainable to a clinician or a payer.

## 3. Product-positioning changes that follow

- **Consumer tiers become an optional channel.** The Base/Plus/Premium ladder is now one
  of four revenue paths, and the VC document marks consumer "OPTIONAL CHANNEL" against
  PMPM/PEPM, enterprise SaaS, and outcome-aligned as near-term. The pricing work is not
  wasted, but it is no longer the thesis.
- **EMDR becomes one modality, not the identity.** The new documents describe "grounding,
  sleep, regulation," PHQ-9/GAD-7 plus trauma measures, and a 16-modality technique
  library. This materially reduces the EMDRIA/self-administration exposure that has been
  the hardest open item on the sign-off checklist.
- **Autopilot is renamed and rescoped.** Its function maps to E6 "orchestration engine"
  with authority tiers (informational, patient-choice, clinician-approval, prohibited
  autonomous action) — a stricter framing than the current implementation uses.
- **Benchmarks change from Calm/Headspace to Limbic and NeuroFlow.** The competitive
  matrix in `docs/investor/` is now aimed at the wrong set of competitors.

## 4. Clinical sign-off implications ⚠️

The standing condition on `beta-clinrev-2026-07` is that **any material change resets the
clinical sign-off.** Repositioning from self-guided EMDR to a supervised behavioral-health
companion with a clinical workflow is a material change of scope.

This is not purely a setback:

- **Supervised clinical (Handoff B) puts a human back in the loop**, which is *easier* to
  get signed off than autonomous self-guided reprocessing.
- The hardest blocked item — autonomous BLS with a staged Phase-4 rollout — may become
  **out of scope entirely** for the near term, removing 9–15 months from the critical path.
- What the reviewers must re-scope: the intervention set, the supervision model, and
  whether the deterministic engine's role changes under clinician oversight.

**Action:** put re-scoping on the agenda for clinician Session A rather than discovering
it later.
