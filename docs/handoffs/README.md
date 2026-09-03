# Handoffs — the build order

These are the founder-authored specifications that drive the build, **numbered in the order
they were issued and in the order they should be read.** Each one supersedes nothing; they
layer. Where a later handoff contradicts an earlier one, the later wins and the difference
should be recorded rather than silently resolved.

> **Handoff 05 reviewed the repository at commit `c39447a` — the commit immediately before
> the six feature commits handoff 04 produced.** It therefore describes a product without
> the member score boundary, the one-family type system, navigation, the patient directory,
> or the paced gate. Several of its findings read as reversals of handoff 04 but are more
> accurately gaps in the snapshot it saw. The two that were treated as real decisions are
> recorded in [`../site/gui-decisions.md`](../site/gui-decisions.md), each with the
> rationale it overrides and the steps to revert.
>
> **Handoff 06 records the same stale baseline** — `c39447a`, "327 unit/safety tests and 17
> end-to-end tests". Its own Wave 0 says to confirm the head and test baseline before
> building, and that reconciliation is in `gui-decisions.md`. Where 06 and 05 differ, 06
> controls; where either is stricter on safety, privacy, evidence or denominators, the
> stricter one controls (06 front matter).

They were uploads during working sessions and lived only in a session folder, which meant a
new context window could not find them. They are committed here so the specification
travels with the code.

| # | Handoff | Governs | Status |
|---|---|---|---|
| 01 | [Platform readiness and ADR 0010 Step 5](01-platform-readiness-and-adr0010-step5.pdf) | The ten go/no-go gates, the cutover window, the phase order (Phase 1 definition → Phase 2 security → Phase 3 data spine → Phase 4 clinical → Phase 5 pilot → Phase 6 payer → Phase 7 public) | **Phases 1, 2, 4 done.** Phase 3 (Postgres cutover + Step 5) held for its gated window |
| 02 | [Demo-first execution](02-demo-first-execution.pdf) | Making the environment demonstrable: deterministic seed, reset, scenario scripts, demo labelling, persona indicator, clinical policy modes | **Done** — [`../demo/completion-matrix.md`](../demo/completion-matrix.md). Two findings deferred by decision (F3, F4) |
| 03 | [Institutional website redesign](03-institutional-website-redesign.pdf) | The public surface: audience pages, one claims registry, Trust Center, Evidence, FAQ, the review gateway, demo legal copy, the copy guard | **Done** — [`../site/release-acceptance.md`](../site/release-acceptance.md) |
| 04 | [Presentation layer v1](04-presentation-layer-v1.pdf) | How data, gating, routing, and processing are rendered. The member score boundary, day states, the gate, the session flow, the visual system, component contracts | **◐ In progress** — [`../site/presentation-layer.md`](../site/presentation-layer.md). §§2, 3, 4, 5, 7, 8 done. **§6 is next and not started** |
| 05 | [GUI and decision-surface](05-gui-and-decision-surface.pdf) | How events, measures, gates, summaries, and audit history become screens people can act on. Role views, the presentation contract, gate states, components, tokens, charts, and the build order | **◐ In progress** — [`../site/gui-decisions.md`](../site/gui-decisions.md). Phase 0 and Phase 1 landed; Phases 2–5 open |
| 06 | [Web GUI, analytics and clinical presentation](06-web-gui-analytics-and-clinical-presentation.pdf) | **Supersedes 05 where they differ.** Part I reprints handoff 05; Part II is the coding annex — an 80-screen route atlas, the `ClinicianPatientProjection` contract, queue ordering, 20 page examples, 22 chart screens, the projection/API/component architecture, and a six-wave build order | **◐ In progress** — [`../site/gui-decisions.md`](../site/gui-decisions.md). **80 of 80 screens; 22 of 22 charts.** The screen atlas is complete. Remaining: the non-screen items in §§30–31 |
| 07 | [Demo login, synthetic population and planning engine](07-demo-login-synthetic-population-and-planning-engine.pdf) | Role-selectable demo access for six roles, 240 fabricated longitudinal patients across the four U.S. Census regions, a versioned metric dictionary and cohort registry, seven deterministic planning rules with an eight-state review machine, fairness controls, a model-registry shell, five screens, twelve APIs and ten release gates | **◐ In progress** — **Waves 0–6 done** (demo identity, seed manifest, deterministic generator, role projections, metrics, planning rules). **Wave 7 (governance: fairness controls, audit screen, model-registry shell) is open**; Wave 8 is part-built — the demo clock exists, the control centre, nightly reset and scenario scripts do not. [`07-PLAN.md`](07-PLAN.md) |

## A second program landed, and it is not in the table above

The table above is the **original** series, 01–07. In September 2026 a second, separately
numbered series was added to this folder: the **Clinical Intelligence Expansion**, five
handoffs plus an execution overview, ordered by
[`README_EXECUTION_ORDER.txt`](README_EXECUTION_ORDER.txt). It is **not started.**

Its numbering restarts at 01, so `01_Steady_Return_to_Life_Goals...` and
`01-platform-readiness...` are different documents from different programs. Read the
filename prefix, not the number.

| # | Handoff | Adds | Status |
|---|---|---|---|
| 00 | [Execution overview](00_Steady_Clinical_Intelligence_Expansion_Execution_Overview.pdf) | The dependency map, the repository foundations each feature must extend rather than duplicate, and eight cross-feature invariants | Read |
| 01 | [Return-to-Life Goals](01_Steady_Return_to_Life_Goals_Engineering_Handoff.pdf) | Functional goals and observable progress ladders — the outcome layer | **Not started** |
| 02 | [Treatment Response Fingerprint](02_Steady_Treatment_Response_Fingerprint_Engineering_Handoff.pdf) | Evidence-linked patterns of how one person responds to an intervention in a context | **Not started** |
| 03 | [Between-Visit Care Command Center](03_Steady_Between_Visit_Care_Command_Center_Engineering_Handoff.pdf) | One clinician action surface for non-safety attention signals | **Not started** |
| 04 | [Personalized Recovery Trajectory](04_Steady_Personalized_Recovery_Trajectory_Engineering_Handoff.pdf) | Per-domain trajectories and descriptive deviation detection | **Not started** |
| 05 | [Therapeutic Load & Readiness](05_Steady_Therapeutic_Load_Readiness_Engineering_Handoff.pdf) | Stabilize / maintain / consider-progression decision support | **Not started** |

**The order is load-bearing.** Document 00 states that later handoffs consume contracts
created by earlier ones — 05 depends on all four before it. They are not independent
features that can be picked off by interest.

**Its stated prerequisite is the Clinician Thoughts / Clinical Memory / Session Prep
Specification v2.1** ([`Steady_Clinician_Thoughts_Engineering_Spec_v2_1.pdf`](Steady_Clinician_Thoughts_Engineering_Spec_v2_1.pdf)),
as "the common clinician-memory and evidence layer".

| Phase | What it is | Status |
|---|---|---|
| 0 | Architecture gate — seven tables, flags, tenancy | **Done** |
| 1 | Capture and transcript | **Done** |
| 2 | Structured organization — extraction, candidates, review cards, Save Thoughts | **Done** |
| 3 | Threads and follow-ups | **Done** |
| 4 | Session Prep | Not started |
| 5 | Ask Steady | Not started |

Approved clinical memory exists as of Phase 2 and longitudinal threads as of Phase 3 —
between them, the layer the expansion consumes. Handoff 02 (Treatment Response Fingerprint)
reaches for exactly this: intervention-response patterns over time are threads.

Phase 4 (Session Prep) is next in the spec's own order.

## `future-platform-intelligence/` is parked, deliberately

That subfolder is marked **PARKED / DO NOT IMPLEMENT** by its own README. Five engineering
handoffs — wearables, medication support, clinician-assigned modules, passive phenotyping,
communication-change signals — kept as a future program, not a backlog. Do not start them,
and do not treat their presence in this folder as scope.

## Reading order for a fresh context window

1. **[`../../README.md`](../../README.md) — the RESUME HERE block, then the GUI LAUNCH
   section.** Together they name the live job, what is left of it, and the page in handoff
   06 that specifies each remaining item.
2. **Handoff 06, §24–§31 (pp. 37–101)** — the coding annex. The live specification for
   screens and charts.
3. **[`07-PLAN.md`](07-PLAN.md)** — the plan for handoff 07, including its Wave 0 gap list
   and the eleven subsystems it must reuse rather than rebuild. Read this before starting
   any demo-login, synthetic-population or planning work, and read it before handoff 07
   itself: it records five decisions the PDF leaves open.
4. **[`../site/gui-decisions.md`](../site/gui-decisions.md)** — two deliberate reversals of
   handoff 04 and how to undo each. Read before changing a member or clinical surface.
5. Only then the older handoffs, and only if the work reaches back into them.

## How 06 and 07 relate

Handoff 06 builds the screens. Handoff 07 gives them a population worth looking at, a login
that reaches all six roles, and a planning layer above them. They overlap in three places —
the review console, the aggregate population view, and the cohort registry — and
[`07-PLAN.md`](07-PLAN.md) resolves each rather than leaving it to be discovered. Two of
handoff 06's open items close as a side effect of 07's first wave.

## The rule that governs all of them

Every one of these documents restates it, so it is worth stating once here:

> No real participant data, public access, care operations, payer data exchange, or
> employee-health use until the required review gates pass. Any real-person information
> found in a T0/T1 environment is a stop condition.

And on claims: never "HIPAA compliant", "clinically validated", "secure", or "approved" as
a general label — dated evidence and exact scope instead. Do not quote a test count,
security control, clinical review, or branch state to a reviewer unless it ties to the
exact demonstration commit.
