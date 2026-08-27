# Steady Clinical — workflow specification

**Phase 1 deliverable** (Platform Readiness Review, 2026-08-27) and the Handoff B3
requirement. **Status: specification. None of this is built.**

**Why this document comes before the code.** The clinician workflow determines what PHI
moves where, who may see it, which alerts exist and who owns them, what may be exported, and
who is accountable for a review. Those are the inputs to the threat model, the permission
model, the audit requirements, and the pilot protocol. Building the enterprise foundations
first and defining the workflow afterwards means hardening the architecture around guesses.

**Audience:** the clinical reviewers, the security reviewer, and whoever builds this. It is
written so a clinician who has never seen the product can say "no, that is not how this
works" — which is the only way it gets to be right.

---

## 0. The governing constraints

Six constraints bound every design choice below. They are not negotiable within this
document; changing one changes the product's regulatory posture.

1. **Steady does not diagnose and does not treat.** It observes, structures, routes, and
   escalates. A clinician diagnoses and treats.
2. **The AI never decides.** It drafts, summarises, and flags. Every clinical consequence
   passes through a human or through a deterministic, clinician-authored rule. Autonomy
   means more automation *of clinician-validated rules*, never the model deciding more.
3. **Every AI-produced statement carries citations** to the evidence it rests on, and the
   clinician can open that evidence. An uncited summary is not reviewable, and an
   unreviewable summary is not usable in care.
4. **Nothing is erased.** Corrections append and supersede (ADR 0010). A clinician can
   correct the record; nobody can make the original disappear.
5. **Tenant isolation is absolute.** A clinician sees their caseload within one tenant.
   There is no product path to another tenant's data.
6. **The member is not a passive subject.** They can see what is remembered about them,
   correct it, and withdraw consent — and doing so is itself an event.

---

## 1. Caseload and priority workflow

The clinician's home surface. One question answered above all: **who needs me today, and
why?**

### Ordering

The list is ordered by **clinical need, not by recency and not by contract tier**. Priority
review is a Premium *scheduling* benefit — a request queues at a higher severity so it sorts
sooner — and it changes **nothing** about the clinical bar for the decision itself. This is
already true in the code and must stay true: a paying member does not get a lower threshold.

Ordering inputs, most urgent first:

| Band | Trigger | Expected response |
|---|---|---|
| **Immediate** | Harm-urge flag, crisis routing, feels-unsafe on today's check-in | Same day, named owner |
| **High** | Session hard stop; post-session distress unresolved; sustained deterioration across ≥3 check-ins | Within one working day |
| **Standard** | Unlock request; scheduled review; instrument score crossing a threshold | Within the review window |
| **Watch** | Pattern proposed but not confirmed; engagement drop | Next scheduled review |

### Every row shows

Person label, band and the *reason* for the band (never a bare score), days since last
contact, what changed since the clinician last looked, and the single action available.

**The reason is mandatory.** A caseload that says "high priority: 34" teaches a clinician to
trust a number they cannot interrogate. It must say "high: hard stop in body-scan on
2026-09-02, post-session distress 8/10, no contact since."

### Open questions for the clinical reviewers

- Is caseload assignment explicit (a clinician owns named members) or pooled (any clinician
  in the tenant may act)? This determines whether "assigned to" is a permission or a label.
- What is the maximum caseload before the ordering stops being meaningful?
- Who covers when the owning clinician is unavailable, and how is that recorded?

---

## 2. Patient timeline and evidence views

One chronological record per person, assembled from the event log — which is why ADR 0010
had to come first. The timeline **is** the events; it is not a summary of them.

### Lanes

| Lane | Shows |
|---|---|
| State | Daily check-ins: activation, shutdown, dissociation, sleep, safety flags |
| Measurement | Instrument administrations with scores and version |
| Care | Sessions: module, pre/peak/post SUDS, outcome, hard stops |
| Intervention | Practices and lessons completed |
| Decisions | Unlock requests and decisions, overrides, clinician actions |
| Consent | Grants and withdrawals, with scope and policy version |

### Requirements

- **Every item opens to its original evidence.** A score opens the instrument and its
  version; a routing decision opens the check-in and the rule that fired.
- **Reconstructed history is visibly marked.** Genesis events (`payload_version 0`,
  `source_system: 'backfill'`) are labelled as reconstructed and are never presented as
  original evidence. A clinician must be able to tell what Steady *observed* from what it
  *inferred after the fact*.
- **Point-in-time view.** "What did Steady know on 2026-09-02?" is answerable and must not
  leak later facts. The capability exists (`rebuildProjections({ asOf })`); the surface does
  not.
- **Encrypted content is not on the timeline by default.** Companion transcripts and
  item-level answers require an explicit, audited open with a stated reason.

### Open question

Does the clinician see companion conversation content at all, and under what conditions?
Three defensible answers — never; only on escalation; always within the caseload — with very
different member-trust and privacy consequences. **The reviewers decide this, not the
build.** It is the highest-stakes open question in this document.

---

## 3. Alerts: severity and response ownership

An alert without a named owner and a deadline is a notification, and notifications are how
things get missed.

| Alert | Severity | Owner | Deadline | Auto-resolves |
|---|---|---|---|---|
| Harm urge on check-in | Immediate | Named on-call clinician | Same day | Never — closure requires a documented human contact |
| Crisis routing triggered | Immediate | Named on-call clinician | Same day | Never |
| Session hard stop | High | Assigned clinician | 1 working day | Never |
| Post-session distress unresolved | High | Assigned clinician | 1 working day | Never |
| Sustained deterioration | Standard | Assigned clinician | Review window | On documented review |
| Unlock request | Standard | Any clinician in tenant | Review window | On decision |
| Engagement drop | Watch | Care manager | Next review | On re-engagement |

### Rules

- **Every alert closes with a documented action.** Not "acknowledged" — what was done.
- **Unclosed Immediate and High alerts escalate** on a defined schedule to a named
  supervisor. The escalation path must exist before the pilot, because the failure mode is
  an alert nobody owned at 5pm on a Friday.
- **Alert volume is a monitored metric.** Alert fatigue is a safety failure, not an
  annoyance: if clinicians are dismissing a category in bulk, that category is miscalibrated
  and the threshold is a clinical decision to revisit.
- **The member is never told an alert fired**, unless the response includes contacting them.
  Surveillance the member cannot see is a trust problem; surveillance theatre is worse.

### Open questions

- Coverage model: does "on-call clinician" mean a rota, and what are its hours? Steady is
  available at 3am; a clinician is not. **What the member is told about that gap must be
  explicit in consent**, and the crisis surface must never depend on a clinician.
- Does an Immediate alert have any automated member-facing consequence (for example, pausing
  processing modules) or is it purely a human signal?

---

## 4. AI summaries with citations

The clinician-facing summary is the highest-leverage and highest-risk AI surface in the
product: it saves the most time and it is where an unreviewable fabrication would do the
most damage.

### Contract

- Structured, not prose: what changed, what the evidence is, what is unresolved.
- **Every claim carries a citation** to the events it rests on. A claim that cannot cite is
  not displayed.
- The summary states its own coverage window and what it did **not** look at.
- Provenance is recorded per generation: model version, prompt version, retrieval scope,
  and the event ids in context (ADR 0012).
- **Uncertainty is displayed, not smoothed.** "Three check-ins missing in this window" is
  more useful than a confident sentence covering a gap.
- The summary is **never** the record. It is a reading aid over the timeline, and the
  timeline is authoritative.

### Explicitly out of scope for the AI

Diagnosis, treatment recommendation, risk *scores*, and any statement about what the
clinician should do. It reports what happened and what changed. Deterministic
clinician-authored rules — not the model — do the flagging.

---

## 5. Clinician approval, correction, and override

Three distinct actions with different meanings, deliberately not collapsed into one button:

| Action | Means | Effect |
|---|---|---|
| **Approve** | "This is accurate and I have read it" | Records review; does not change the record |
| **Correct** | "This is wrong" | Appends a correcting event that supersedes the original by reference; the original stays visible and marked as superseded |
| **Override** | "The rule is right in general and wrong here" | Opens or closes access against the pacing rules, with a **mandatory reason**, recorded as a clinician decision |

### Rules

- **Correction never erases.** ADR 0010 §1 — this is a PHI-lane requirement met
  structurally rather than by policy.
- **Override requires a reason and is auditable for quality review.** Already true in the
  code (`clinicianOverrideModule`); it must stay true.
- **Override relaxes pacing only.** The daily safety read, cooldowns, caps, and the kill
  switch still hold. A clinician can decide someone is ready sooner; nobody can override a
  safety stop.
- **Approving an AI summary does not make it evidence.** The events remain the evidence; the
  approval records that a human read it.

---

## 6. Feedback taxonomy

Clinician feedback is the training signal for everything Handoff B and D want to learn. It
has to be structured at the point of capture, because free text cannot be aggregated and
"thumbs down" cannot be acted on.

| Category | Meaning | Consumes into |
|---|---|---|
| `accurate` | The claim matches the evidence | Baseline quality metric |
| `unsupported` | The claim outruns its citations | Model evaluation — the highest-priority defect class |
| `incomplete` | True but missed something material | Retrieval scope review |
| `miscalibrated` | Right observation, wrong severity | Rule threshold review |
| `not_clinically_useful` | Accurate and beside the point | Product surface review |
| `harmful_if_acted_on` | Would lead to a wrong action | **Immediate review; halts the surface if it recurs** |

Every feedback item links to the generation's provenance, so a defect is traceable to a
model version, prompt version, and retrieval scope. **`harmful_if_acted_on` has a standing
response procedure**, not a backlog ticket.

---

## 7. Escalation and re-entry

### Escalation

Out of Steady and into human care. Triggered by an Immediate alert, a clinician judgement,
or a member request. Steady's role ends at handoff: it provides the evidence packet, records
that escalation occurred, and does not pretend to manage what happens next.

- What is handed over, and to whom, is **consented in advance and re-confirmed at the
  moment** wherever the member is able to consent.
- Escalation is an event. So is its outcome, when known.
- **Processing modules close on escalation** and do not reopen automatically.

### Re-entry

Returning to the program after escalation, a hard stop, or a long absence is a **clinical
decision, never an automatic one**. Re-entry requires a documented clinician decision, a
fresh readiness assessment, and a re-confirmed safety plan. This is the point at which an
otherwise-good product does harm by being too easy to resume.

---

## 8. Pilot inclusion and exclusion

To be finalised with the clinical reviewers. Current assumption, requiring confirmation:
**adults only, supervised, synthetic-first, one organization, one limited care team.**

| | |
|---|---|
| **Include** | Adults 18+; capacity to consent; a named responsible clinician; stable contact route |
| **Exclude** | Active psychosis; acute suicidality or recent attempt; substance dependence needing medical management; no fixed care route; anyone the program-fit screener hard-stops |
| **Withdrawal** | At any time, without justification, without losing access to crisis resources |

Exclusion criteria must be **operationalised in the screener**, not left to judgement at
enrolment — a criterion nobody can apply consistently is not a criterion.

---

## 9. Safety-monitoring responsibilities

Who watches what, and how often. Unassigned monitoring is unperformed monitoring.

| What | Who | Cadence |
|---|---|---|
| Immediate/High alert queue | On-call clinician | Continuous during cover hours |
| Unclosed alert escalations | Named supervisor | Daily |
| Adverse events | Protocol owner | Per occurrence, logged |
| Hard-stop rate and reasons | Clinical lead | Weekly |
| Deterministic rule divergence (shadow vs live) | Engineering + clinical lead | Weekly |
| AI feedback, `harmful_if_acted_on` | Clinical lead | Per occurrence |
| Alert volume and dismissal rate | Clinical lead | Weekly |
| Consent withdrawals and reasons | Protocol owner | Weekly |

**Adverse event definition, threshold, and reporting route are a reviewer decision** and
must be settled before the first participant — not defined in response to the first event.

---

## 10. BLS Part 6 oversight

Bilateral stimulation Part 6 continues as a **parallel clinical validation workstream** with
its own reviewer, protocol owner, evidence owner, and schedule. Within this workflow:

- Member-facing BLS access stays **gated** until Part 6's own clinical and security
  conditions pass. It is not covered by any other sign-off.
- Member-initiated resourcing (Phase 4a) is live and flag-gated; **autonomous stimulation
  remains OFF** — an explicit condition of the existing clinician sign-off.
- The clinician surface shows BLS participation, session outcomes, and adverse events under
  the Part 6 protocol specifically, separated from ordinary session history so the
  validation evidence is not entangled with routine care.

---

## 11. Rescoped clinical sign-off

The signed configuration `beta-clinrev-2026-07` was ratified **for the consumer wellness
product**. The platform pivot is a material scope change: multi-tenancy, a clinician-facing
surface, AI summaries over clinical records, and enterprise distribution were not in front
of the reviewers when they signed.

**That sign-off does not extend to this workflow**, and presenting it as though it does
would misrepresent what the reviewers agreed to. The rescoped packet needs:

1. What changed since `beta-clinrev-2026-07`, stated plainly.
2. This workflow specification, reviewed section by section.
3. The alert taxonomy, severities, owners, and deadlines.
4. Escalation and re-entry criteria.
5. Inclusion and exclusion criteria.
6. The AI summary contract, and what the model is forbidden to assert.
7. Adverse event definitions and reporting routes.
8. The Part 6 relationship and its separate gates.
9. A new configuration version and a fresh sign-off ledger entry.

---

## 12. Decisions needed from the clinical reviewers

Ordered by how much downstream work each unblocks.

| # | Decision | Blocks |
|---|---|---|
| 1 | Does the clinician see companion conversation content — never, on escalation, or always? | Permission model, threat model, member consent copy |
| 2 | Caseload assignment: explicit ownership or pooled? | Permission model, alert ownership |
| 3 | Coverage hours and the out-of-hours path; what members are told | Consent copy, alert deadlines, crisis surface |
| 4 | Adverse event definition, threshold, and reporting route | Pilot protocol, monitoring |
| 5 | Confirm inclusion/exclusion and how each is operationalised in the screener | Screener rules, enrolment |
| 6 | Does an Immediate alert have an automated member-facing consequence? | Gate chain changes |
| 7 | Re-entry criteria after hard stop or escalation | Gate chain changes |
| 8 | Whether the autonomous engine may govern anything during the pilot | Flag policy, §10 of the README |

Nothing in §1–§11 should be built before decisions 1, 2, and 3 are settled — each of them
changes the data model, not just the interface.
