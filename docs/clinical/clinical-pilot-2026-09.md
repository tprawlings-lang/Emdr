# `clinical-pilot-2026-09` — proposed clinical review packet

**Status: PROPOSED. Not submitted, not reviewed, not ratified.** No reviewer has
seen this. Nothing in it is approved, and nothing in it authorises contact with a
real participant.

**Created because** the Demo-First handoff §9 requires a *separate* packet:

> Preserve the prior consumer review record `beta-clinrev-2026-07`. It does not cover
> multi-tenancy, the clinician surface, clinical-record summaries, the payer view, or BLS
> Part 6. Create a separate proposed packet named `clinical-pilot-2026-09` for the future
> T2 design.

`beta-clinrev-2026-07` remains valid for what it covered and is **not superseded, amended,
or reinterpreted** by this document. Two records, two scopes.

---

## 1. What the existing sign-off covers, and what it does not

| | `beta-clinrev-2026-07` (ratified 2026-07-22, **with conditions**) |
|---|---|
| **Covers** | The consumer wellness product: the deterministic safety rule set and its thresholds, the 14-step gate chain, instrument scoring, the companion's safety behaviour, and member-initiated resourcing |
| **Conditions attached** | Independent privacy/security review; human-factors testing of the session UI under stress; autonomous stimulation stays OFF; the engine stays in shadow |
| **Does NOT cover** | Multi-tenancy · a clinician-facing surface · AI summaries over clinical records · caseload and alert ownership · a payer or population view · BLS Part 6 · any real participant |

The gap is not a technicality. The reviewers assessed a self-guided product where the
member was the only person who saw their data. A clinician surface introduces a second
reader, an accountability chain, and an AI system summarising a clinical record — none of
which was in front of them.

---

## 2. Scope proposed for review

**Tier**: T2 supervised pilot (handoff §2) — limited real participants, one organization,
one named care team, under protocol.

**Proposed boundary, requiring confirmation:** adults 18+, capacity to consent, supervised,
synthetic-first, a single organization, a limited named care team.

**Explicitly out of scope:** public availability, payer or employer deployment, claims,
diagnosis, treatment, autonomous stimulation, and any use of the engine to govern access.

---

## 3. What is submitted for review

| # | Item | Where | State |
|---|---|---|---|
| 1 | Clinician workflow specification | [`steady-clinical-workflow.md`](steady-clinical-workflow.md) | Draft, unreviewed |
| 2 | Configurable policy modes and their T0/T1 defaults | `src/lib/clinical-policy.ts` | Implemented; **all defaults provisional** |
| 3 | Alert taxonomy: severities, owners, deadlines, escalation | Workflow §3 | Draft |
| 4 | AI summary contract and what the model may not assert | Workflow §4 | Draft |
| 5 | Approve / correct / override as distinct actions | Workflow §5 | Draft |
| 6 | Escalation and re-entry criteria | Workflow §7 | Draft |
| 7 | Inclusion and exclusion criteria | Workflow §8 | Draft, needs operationalising in the screener |
| 8 | Safety-monitoring responsibilities and cadence | Workflow §9 | Draft, **owners unnamed** |
| 9 | Adverse-event definitions and reporting route | — | **Missing — reviewer decision** |
| 10 | BLS Part 6 position and its separate gates | Workflow §10, §11 below | Draft |
| 11 | Current-vs-target architecture and PHI data flow | [`../architecture/current-vs-target.md`](../architecture/current-vs-target.md) | Complete |
| 12 | Security package | [`../security/`](../security/) | Draft, unreviewed externally |

---

## 4. Policy modes requiring ratification

Implemented as versioned configuration (`clinical-policy-2026-08-t1`) so reviewers can
compare alternatives against a working system rather than imagine them. **Every default
below is a demonstration assumption. A default is not an approval.**

| Policy | T0/T1 default | Alternatives available to demonstrate | Decision needed |
|---|---|---|---|
| Companion content visibility | `escalation_excerpt` | `never`, `member_shared`, `always` | Consent basis, minimum necessary, member disclosure, model egress |
| Caseload model | `hybrid` | `owned`, `pooled` | Accountability, staffing, licensure, handoff |
| Out-of-hours coverage | `business_hours` | `none`, `extended`, `24_hour` | Operating schedule and the exact member-facing language |
| Immediate alert consequence | `pause_processing` | `notify_only`, `lock_workflow`, `emergency_path` | Named responder, deadline, severity bands |
| Re-entry | `clinician_decision` | `automatic`, `timed` | Protocol and BLS-specific clearance |
| Autonomous engine | `shadow` | `recommend` | Promotion evidence and rollback authority |

**`active` autonomy is deliberately unreachable by configuration** — the code refuses it —
because promoting the engine to govern member access is a clinical decision with staged
evidence requirements, not an environment variable.

**The three highest-impact decisions** are companion visibility, caseload ownership, and
coverage. They do not block T0/T1 construction. They do block T2 permissions,
accountability, consent, and operating language.

---

## 5. Questions for the reviewers

Ordered by how much downstream work each unblocks. The first three change the data model,
not just the interface.

| # | Question | Consequence |
|---|---|---|
| 1 | May a clinician see companion conversation content — never, on escalation only, when the member shares, or always? | Permission model, threat model, member consent copy, model egress |
| 2 | Is caseload assignment owned, pooled, or hybrid? | Permission model, alert ownership, audit requirements |
| 3 | What coverage is committed, and what exactly are members told? | Consent copy, alert deadlines, crisis-surface design |
| 4 | Adverse event: definition, threshold, reporting route, timeline? | Pilot protocol, monitoring, this packet |
| 5 | Are the inclusion/exclusion criteria right, and how is each operationalised in the screener? | Screener rules, enrolment |
| 6 | Does an Immediate alert have an automated member-facing consequence, or is it purely a human signal? | Gate chain changes |
| 7 | What must be true for re-entry after a hard stop or escalation? | Gate chain changes |
| 8 | May the engine advance from shadow to recommend during the pilot? | Flag policy |
| 9 | Is any clinician-facing AI summary acceptable at pilot, or should the first pilot be summary-free? | Whether Phase 4's AI surface ships to T2 at all |
| 10 | Does BLS Part 6 participate in this pilot, or run entirely separately? | Protocol structure |

Question 9 is worth asking plainly: **the safest first pilot may have no AI summary at
all.** The timeline and alerts are useful without one, and the summary is the surface where
an unreviewable fabrication would do the most damage.

---

## 6. What must exist before this packet can be submitted

| # | Prerequisite | Owner | State |
|---|---|---|---|
| 1 | Named clinical reviewers | Founder | ❌ |
| 2 | Healthcare and privacy counsel engaged; ADR 0009 lane determination | Founder + Counsel | ❌ |
| 3 | Named security reviewer, and their report | Founder + Security | ❌ |
| 4 | Adverse-event definitions and reporting route | Clinical lead | ❌ |
| 5 | Pilot protocol, consent forms, training materials | Clinical + Counsel | ❌ |
| 6 | Executed BAAs with every vendor reaching PHI | Founder | ❌ |
| 7 | Steady Clinical prototype, tested against synthetic scenarios | Engineering | ⏳ Phase 4 |
| 8 | Caseload scoping, read auditing, MFA for clinical roles | Engineering | ❌ |
| 9 | Postgres cutover with RLS active on the request path | Engineering | ⏳ Phase 3 |
| 10 | Backup restore rehearsed | Ops | ❌ |

**Nine of ten are open, and six of those need a person named rather than code written.**
That is the honest state of pilot readiness.

---

## 7. BLS Part 6

Part 6 remains an **active parallel clinical-validation workstream**. It is not folded into
this packet and is not covered by it.

| T0/T1 may build and demonstrate | Not claimed or activated |
|---|---|
| Synthetic protocol states and transitions | Clinical effectiveness |
| Eligibility and exclusion simulation | Final participant eligibility |
| Pause, stop, escalation, grounding, re-entry paths | Autonomous real-person operation |
| Clinician review queue and evidence capture | Approved clinical protocol |
| Versioned content and policy selection | Final content approval |
| Outcome and safety-event instrumentation | Validated outcome interpretation |

Member-facing access stays gated behind Part 6's own evidence and approvals. Every BLS
screen and script must state that the workflow is simulated, uses fabricated data, and is
not approved clinical care.

---

## 8. Ratification record

*Empty. This packet has not been reviewed.*

| Reviewer | Role | Date | Verdict | Conditions |
|---|---|---|---|---|
| — | — | — | — | — |

When ratified, this section carries the signed verdicts and a new configuration version,
and `clinical-policy.ts` is updated to set `approved: true` with the packet name — at which
point, and only then, the product may stop describing these modes as provisional.
