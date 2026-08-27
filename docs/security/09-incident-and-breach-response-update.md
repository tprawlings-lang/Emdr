# 9 — Incident and breach response: clinical-lane update

**Phase 2 security package**, item 9 of 10. This **supplements** the existing runbook at
[`../incident-response.md`](../incident-response.md); it does not replace it.

**Why an update rather than a rewrite.** The existing runbook is concrete, correct, and
written for the **wellness lane**: it routes breach decisions through the FTC Health Breach
Notification Rule and state consumer-health law. That remains the operative process **today**,
because Steady is in the wellness lane, holds no PHI, and is nobody's Business Associate.
The additions below take effect **only** when the lane reclassification (ADR 0009) completes
and PHI is present — and they must be in place before it is.

> **Both processes must be legible at once during the transition.** A responder at 2am
> should not have to work out which regime applies. §1 answers that in one question.

---

## 1. Which regime applies — decide this first

| Question | If yes | If no |
|---|---|---|
| Did the incident involve data from a covered entity or health plan, under a BAA? | **HIPAA breach rules** (§2 below), *plus* any state overlay | ↓ |
| Did it involve identifiable consumer health data from the direct-to-consumer product? | **FTC HBNR** — existing runbook, unchanged | ↓ |
| Neither (fabricated data, code, infrastructure only) | Internal incident: contain, fix, postmortem. **No external notification obligation** | — |

**Today every incident falls in the third row**, because no real health data exists anywhere.
That will change on the first real participant, and this table is the thing to re-read then.

---

## 2. HIPAA breach obligations (once PHI is present)

Applies when Steady is a Business Associate to a covered entity.

### Definition

A breach is the acquisition, access, use, or disclosure of PHI not permitted by the Privacy
Rule that compromises its security or privacy. **It is presumed to be a breach** unless a
four-factor risk assessment demonstrates a low probability of compromise:

1. Nature and extent of the PHI, including identifiers and likelihood of re-identification
2. The unauthorized person who used it or to whom it was disclosed
3. Whether the PHI was actually acquired or viewed
4. The extent to which the risk has been mitigated

**The presumption runs against us.** "We think it was fine" is not an assessment; the four
factors must be documented in writing whether or not notification follows.

### Timelines

| Obligation | Deadline | Notes |
|---|---|---|
| Notify the covered entity | **Without unreasonable delay, and no later than 60 days** from discovery — and per the BAA, which frequently requires far sooner (often 24–72 hours) | **The BAA governs.** Read the executed agreement, not this table. |
| Provide breach details to the covered entity | As specified in the BAA | Individuals affected, what was involved, what happened, mitigation |
| Individual and HHS notification | **The covered entity's obligation**, not ours, unless the BAA assigns it | Do not notify individuals directly without the covered entity's agreement — doing so can itself be a violation |

For the direct-to-consumer channel, Steady is a **controller**, not a Business Associate,
and the existing HBNR path in the base runbook applies.

### Encryption safe harbour, and why it is narrower than it looks

PHI rendered unusable through encryption meeting HHS guidance is not "unsecured PHI," and
its disclosure is not a reportable breach. Steady encrypts free-text fields with AES-256-GCM
and encrypts backups with `age`.

**Do not over-claim this.** The safe harbour requires that the **keys were not also
compromised**, and today `EMDR_DATA_KEY` sits in the same environment as the data it
protects (item 3, T2.3). A compromise that yields the environment yields both. Additionally,
coded clinical values — scores, risk flags, check-in routing — are stored **in clear** so the
deterministic gates can read them, and those are identifying health data on their own.

Assume the safe harbour applies **only** to encrypted free-text fields, **only** where key
compromise is genuinely excluded, and document the reasoning.

---

## 3. Incident types specific to this system

The base runbook covers key rotation, evidence snapshot, and scope assessment. These are the
scenarios particular to Steady's architecture, each with the first action that is not
obvious.

| Scenario | First action beyond the base runbook |
|---|---|
| **Cross-tenant data exposure** | Determine which isolation layer failed (item 7 §3). Query the audit log for `cross_tenant_access` entries. Because tenant scoping fails *closed*, an exposure means a bypass of the repository, not a failed predicate — look for direct `data()` use on the affected path. |
| **Model provider incident** | Establish what was in prompts during the window: full conversation transcripts and model-exposable memories for affected members (item 1 §4). Retention terms in the BAA determine whether historical prompts are still held. Set `EMDR_KILL_GENERATIVE=1`. |
| **Audit chain verification failure** | Treat as tampering until proven otherwise. Snapshot before any repair. The chain identifies the entry where continuity broke — that is the timeline anchor. |
| **Encryption key compromise** | Rotating `EMDR_DATA_KEY` makes existing rows unreadable — **snapshot first**, then re-encrypt. This is the one destructive rotation and the base runbook is right to flag it. |
| **Safety defect — a gate fails open** | `EMDR_DISABLE_NEW_SESSIONS=1` immediately. Then determine whether any member reached a module they should not have: query `therapy_sessions` against the gate chain for the affected window. This is an **adverse event** as well as a security incident and follows the clinical reporting route. |
| **Event/projection divergence** | Run `verifyProjections()`. Drift means the log and the current state disagree — establish which is correct before repairing either, because the log is meant to be authoritative and a "repair" in the wrong direction destroys evidence. |
| **Real data found in a non-production environment** | Contain, purge, and treat as a breach of gate **G10** regardless of exposure. Determine how it arrived; that path is the actual defect. |

---

## 4. Roles

| Role | Responsibility | Named |
|---|---|---|
| Security Official | Declares incidents, owns this process | ❌ **Unnamed** — §164.308(a)(2), and free to close |
| Incident commander | Runs the response | Founder by default |
| Clinical lead | Assesses member-safety impact, owns adverse-event reporting | ❌ Unnamed |
| Counsel | Breach determination and notification decisions | ❌ Not engaged |
| Covered entity contact | Per BAA | n/a — no BAAs |

**Every clinical-lane role in this table is unnamed.** That is the gap to close first,
because a response process with no named responder is a document, not a capability.

---

## 5. Testing this process

An untested runbook fails on first use. Required before pilot:

| Exercise | Cadence | Acceptance |
|---|---|---|
| Tabletop: cross-tenant exposure | Before pilot, then annually | Participants reach a correct notification decision using only these documents |
| Tabletop: model provider incident | Before pilot | Scope of exposed content correctly identified |
| Technical: key rotation on synthetic data | Before pilot | Rotation completes; data remains readable after re-encryption |
| Technical: backup restore | Before pilot, then quarterly | Gate **G6** — restore + audit-chain verification pass |
| Technical: audit chain verification | Monthly, automated | Failure alerts (item 8) |

---

## 6. What must be added to the base runbook when the lane changes

A checklist for that moment, so the transition is not improvised:

1. Covered entity contacts and their BAA-specified notification deadlines
2. Named Security Official, clinical lead, and engaged counsel
3. The four-factor risk assessment template
4. Adverse-event reporting route (clinical, distinct from security)
5. Cyber liability insurer and breach hotline — flagged as pending in the base runbook
6. Data-processing agreements for any non-US members, if in scope
