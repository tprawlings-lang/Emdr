# Documentation triage — after the A→E reclassification

**Purpose:** every document in this repository, classified against the A→E platform
program ([`docs/strategy/`](strategy/)) and [ADR 0009](adr/0009-clinical-lane-reclassification.md).
The risk this prevents is handing a reviewer, clinician, or investor a document that
accurately describes a company we are no longer building.

**Legend**

| Status | Meaning |
|---|---|
| ✅ **Current** | Accurate as-is. Safe to circulate. |
| ➕ **Current, elevated** | Accurate, and *more* important under A→E than before. |
| ⚠️ **Needs rescope** | Substantially right, but scoped to the wellness-lane consumer product. |
| 🔄 **Needs rewrite** | Describes the superseded model. Misleading if circulated. |
| 🛑 **Superseded** | Historical record. Keep for provenance; do not act on. |
| 📉 **Possibly out of scope** | May drop out of the near-term plan entirely — confirm before investing further. |
| 🆕 **Missing** | Required by A→E or by a beta audience; does not exist yet. |

---

## Architecture decision records

| File | Status | Note |
|---|---|---|
| `adr/0001-wellness-lane-posture.md` | 🛑 Superseded | Superseded by ADR 0009. Its own Consequences section anticipated this reclassification and named counsel sign-off as the mechanism — keep it as the provenance for that decision. |
| `adr/0002-app-layer-field-encryption.md` | ➕ Current, elevated | Correct, and now load-bearing for PHI rather than for consumer free text. |
| `adr/0003-security-headers-and-csp.md` | 🛑 Superseded | Superseded by ADR 0008 (already noted there). |
| `adr/0004-single-instance-architecture.md` | 🛑 Superseded | Incompatible with enterprise tenancy. Header updated to Superseded (by 0007, 0009). |
| `adr/0005-tamper-evident-audit-chain.md` | ➕ Current, elevated | Partially satisfies Handoff E7 (reconstruct a patient journey from original evidence). Built early; keep. |
| `adr/0006-stateless-hmac-sessions.md` | ⚠️ Needs rescope | Must accommodate enterprise SSO/SCIM (Handoff C2). Revocation-via-account-status does not cover enterprise deprovisioning. |
| `adr/0007-scaling-and-zero-downtime-deploys.md` | ➕ Current, elevated | Moves from optional to prerequisite. Postgres is Handoff A infrastructure. |
| `adr/0008-nonce-based-csp.md` | ✅ Current | Security reviewers will expect exactly this. |
| `adr/README.md` | ✅ Current | Updated: 0009–0012 added; 0001/0003/0004 marked superseded; Handoff A prerequisite note. |
| `adr/0010-event-sourced-longitudinal-spine.md` | ✅ Current | Written. Proposed; ship as one migration with 0011. |
| `adr/0011-tenancy-and-person-account-separation.md` | ✅ Current | Written. Proposed; highest cost-of-delay item in the programme. |
| `adr/0012-ai-gateway.md` | ✅ Current | Written. Proposed; consumes 0010 and 0011. |

## Compliance and governance

| File | Status | Note |
|---|---|---|
| `../COMPLIANCE.md` | 🔄 Needs rewrite | Titled "wellness-lane launch gates"; every item is scoped to that frame. Needs a parallel clinical/HIPAA track. **Highest-priority rewrite** — it is the document a diligence reviewer opens first. |
| `signoff-checklist.md` | ⚠️ Needs rescope | Structure (signatures / gates / on-hold / signing packets) is still exactly right. Contents are scoped to the autonomous-EMDR programme. Rescope rather than rewrite. |
| `audit-open-items.md` | ⚠️ Needs rescope | External-account items (Stripe, auth, email, R2) still stand. Consumer-billing items drop in priority; BAA and HIPAA items are missing. |
| `go-live-runbook.md` | ➕ Current, elevated | The "one capability at a time, each behind its own flag, after its own gate" discipline maps directly onto the A→E phase gates and onto ADR 0009's environment tiers. Reusable with minimal edits. |
| `incident-response.md` | ⚠️ Needs rescope | Breach-notification frame changes from FTC HBNR to HIPAA where PHI is involved. |
| `disaster-recovery.md` | ✅ Current | RPO/RTO targets stand. Re-verify against Postgres. |
| `backups.md` | ✅ Current | Mechanism unchanged; the `pg_dump` path is already documented. |

## Strategy and investor

| File | Status | Note |
|---|---|---|
| `strategy/README.md` | ✅ Current | Index for the A→E programme. |
| `strategy/Steady_Engineering_Executive_Summary.pdf` | ✅ Current | The entry point for architecture review and estimation. |
| `strategy/Steady_Master_Engineering_Handoff_Series_A_to_E.pdf` | ✅ Current | The build spec. |
| `strategy/Steady_Future_Platform_VC.pdf` | ✅ Current | The raise narrative. |
| `strategy/gap-analysis.md` | ✅ Current | Current codebase mapped against Handoff A; seven conflicts ordered by cost-of-delay. |
| `investor/Steady-Investor-Deck-Source.pdf` | 🔄 Needs rewrite | Built for the consumer thesis: Calm/Headspace competitive matrix, three-tier consumer pricing as the model, CAC/retention/upsell loop as the growth engine. The VC PDF supersedes its thesis. **Do not circulate alongside the new deck** — they argue different companies. |
| `investor/deck-source.html` | 🔄 Needs rewrite | Source for the above. Section 3 (product inventory) and section 8 (risks) are largely salvageable; sections 2, 5, 6, 7 are not. |
| `competitive-positioning.md` | 🔄 Needs rewrite | Standing directive names Abby.gg as the competitor. A→E benchmarks are **Limbic** (patient continuity, 650k assessments across 45% of NHS Talking Therapies) and **NeuroFlow** (enterprise risk/navigation/outcomes). The governed-knowledge argument survives; the target does not. |

## Technical reference

| File | Status | Note |
|---|---|---|
| `architecture.md` | 🔄 Needs rewrite | Diagrams a single Next.js service over SQLite. Does not describe the longitudinal spine, tenancy, the AI Gateway, or the three surfaces. |
| `api.md` | ⚠️ Needs rescope | Documents the current mobile API. Handoff A requires versioned APIs over a different domain model. |
| `pg-migration-progress.md` | ➕ Current, elevated | Migration is code-complete and verified; only ops steps remain. Now on the critical path. |
| `load-test/README.md`, `load-test/steady-load.js` | ✅ Current | Baseline methodology stands; thresholds need re-running against enterprise scale. |

## Autonomous safety programme

The deterministic engine work is **not wasted** — it is Handoff A6 (safety state machine)
and it is the strongest technical evidence in the VC narrative. What changes is that it
now operates under clinician supervision rather than replacing it.

| File | Status | Note |
|---|---|---|
| `autonomous/README.md` | ⚠️ Needs rescope | Frame it as Handoff A6 rather than as a path to removing human oversight. |
| `autonomous/00-clinical-synthesis.md` | ➕ Current, elevated | The clinical corpus behind the rules. Durable. |
| `autonomous/01-signoff-ledger.md` | ⚠️ Needs rescope | Per-rule sign-off structure is reusable. `beta-clinrev-2026-07` needs re-scoping for the supervised model — a material change under the standing condition. |
| `autonomous/02-policy-and-copy-changes.md` | 🔄 Needs rewrite | Written for the wellness-lane→autonomous copy swap. The lane change is now different. |
| `autonomous/03-conversation-audit-2026-07.md` | ✅ Current | Findings remain valid. |
| `autonomous/evidence/01-clinical-implementation-spec.md` | ➕ Current, elevated | Decision tables and pseudocode carry directly into A6. |
| `autonomous/evidence/02-evidence-matrix.md` | ✅ Current | Parameter→evidence mapping stands. |
| `autonomous/evidence/03-technical-verification.md` | ⚠️ Needs rescope | Scoped to the single-instance wellness deployment. |
| `autonomous/evidence/04-red-team-closure.md` | ➕ Current, elevated | Adversarial testing is exactly what security reviewers ask for. |
| `autonomous/evidence/05-staged-validation-protocol.md` | ➕ Current, elevated | The staged-cohort methodology transfers cleanly to clinical pilots. |
| `autonomous/evidence/06-claims-communications-review.md` | ⚠️ Needs rescope | Claims standard changes under ADR 0009 §2. |
| `autonomous/evidence/06a-F1-consent-copy-proposal.md` | ✅ Current | Applied; historical record. |
| `autonomous/evidence/07-privacy-security-and-human-factors-plan.md` | ⚠️ Needs rescope | Human-factors protocol transfers. The privacy/security half must be rescoped from wellness to PHI. |
| `autonomous/evidence/08-security-review-handoff-packet.md` + `.pdf` | 🔄 Needs rewrite | **Scoped to the wellness-lane autonomous engine.** A reviewer assessing an enterprise PHI platform would find it addresses the wrong system. This is the single most important rewrite for the security-team audience. |
| `autonomous/clinician-signoff-SIGNED-*.pdf`, `clinician-signoff-form.docx` | ✅ Current | Signed record. Immutable. |
| `autonomous/bls-protocol-SIGNED-*.pdf`, `bls-protocol-signoff-form.docx` | ✅ Current | Signed record. Immutable. |
| `autonomous/bls-validation/*` (5 files + 2 PDFs) | 📉 Possibly out of scope | The Part-6 programme validates **autonomous** self-guided reprocessing. Under a supervised clinical model this may not be needed near-term — which would remove 9–15 months from the critical path. **Confirm with the clinical reviewers before investing further here.** Keep the signed determinations regardless. |

---

## Missing artifacts, by beta audience

ADR 0009 lets the beta demonstrate everything in a T0/T1 environment. These are the
documents each audience will ask for that do not exist yet.

### For security reviewers 🔴 — the largest gap

| Artifact | Why |
|---|---|
| **Threat model** | STRIDE or equivalent over the A→E surface. Nothing exists today. |
| **Data-flow diagram with PHI zones** | Master §7 defines six governance zones (operational, patient memory, clinical record, analytics, research, model development). No diagram shows what crosses between them. |
| **Vendor / subprocessor register with BAA status** | Required before any real PHI. Model provider, hosting, storage, email, error reporting. |
| **HIPAA security risk analysis** | Required by the Security Rule. Not optional, not deferrable past pilot. |
| **Rewritten security-review handoff packet** | The existing one describes the wrong system. |
| **Tenancy isolation test plan** | Handoff C1 requires "cross-tenant attack cases." |

### For clinicians 🔴

| Artifact | Why |
|---|---|
| **Steady Clinical design specification** | Handoff B3 lists the workflow — caseload priority, patient timeline, alerts, AI summaries with citations, feedback capture — but nothing specifies it. **Clinicians cannot meaningfully test what has not been designed.** |
| **Rescoped clinical configuration** | `beta-clinrev-2026-07` covers self-guided EMDR. The supervised model needs its own scope. |
| **Clinician feedback taxonomy** | Handoff B4 defines the label set; it needs to exist in the product to be tested. |

### For investors ✅

Covered by `strategy/Steady_Future_Platform_VC.pdf`. The only action is to **retire the
consumer-thesis deck** so the two are never circulated together.

---

## Recommended order

1. **ADR 0009 to counsel.** Everything below is contingent on the reclassification.
2. **Mark ADR 0004 superseded; add 0009 to the ADR index.** Ten minutes; removes the one
   actively misleading header.
3. ~~**ADRs 0010–0012**~~ — ✅ written. Ship 0010 + 0011 as a single migration; 0012
   follows, since it depends on both.
4. **Rewrite `COMPLIANCE.md`** with a parallel clinical track.
5. **Security artifacts** — threat model, PHI data-flow, vendor/BAA register. Longest
   external lead time; start early.
6. **Steady Clinical design spec** — gates the clinician audience entirely.
7. **Confirm BLS Part-6 scope** with the reviewers before further investment there.
8. **Retire the consumer investor deck.**
