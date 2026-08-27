# 0009 — Reclassify to the clinical/PHI lane; environment tiers govern un-gating

**Status:** Proposed — **counsel review has not commenced.** No healthcare or privacy
counsel has been engaged, and no sign-off exists.

**What has and has not been decided.** Architectural work has proceeded *against this
ADR's assumptions* — the event spine, tenancy model, and data-zone vocabulary all assume
the clinical/PHI lane. That is deliberate exploration of a reversible technical direction,
and it is **not** the lane reclassification itself. The reclassification is a legal and
regulatory decision that only counsel can make, and until they do:
>
> - The live product remains in the **wellness lane** under [ADR 0001](0001-wellness-lane-posture.md)
>   and `COMPLIANCE.md`, whatever the architecture anticipates.
> - **No real patient, payer, or employee health data enters any environment.** All
>   development and demonstration runs on fabricated data ([ADR 0013](0013-event-authoritative-writes.md)
>   gate G10).
> - No HIPAA-lane claim may be made to investors, clinicians, or security reviewers.
>   "Architected for" is accurate; "compliant with" is not.
Supersedes [ADR 0001](0001-wellness-lane-posture.md). Supersedes the runtime
assumptions in [ADR 0004](0004-single-instance-architecture.md).

## Context

ADR 0001 put Steady in the **wellness lane**: no diagnosis, no treatment claims,
regulatory frame FTC Act §5 / Health Breach Notification Rule / state consumer-health
privacy law — explicitly **not HIPAA**. That was correct for a self-guided consumer
program.

ADR 0001 also anticipated this moment, in its own Consequences section:

> *Moving to clinician-gated care is a deliberate reclassification requiring counsel
> sign-off, not a silent change.*

The A→E platform program ([`docs/strategy/`](../strategy/)) is that reclassification.
It specifies a supervised clinical workflow, enterprise tenancy, and ingestion of
EHR/claims/ADT data. Master Architecture §9 requires a *"HIPAA-capable security posture
and BAA-ready vendors where required."* Handoff C requires FHIR/SMART on FHIR, HL7/ADT,
claims ingestion, SSO and SCIM. Handoff E links outcomes to utilization and cost.

A product that receives claims and EHR data on behalf of a covered entity, and supports
a care team acting on it, is not a wellness product. Continuing to operate under ADR 0001
while building A→E would leave the compliance posture describing a system that no longer
exists.

Separately: the beta is being built to be shown to **investors, clinicians, and security
reviewers**, and will not be public or used for care until testing completes. That
creates a legitimate need to demonstrate capabilities that are gated in production —
without weakening the gates themselves.

## Decision

### 1. Reclassify to the clinical/PHI lane

Steady is planned and built as a **HIPAA-capable platform**. Concretely:

- Design for the Business Associate role when serving covered entities; execute BAAs with
  every subprocessor that may touch PHI (model provider, hosting, storage, email, error
  reporting) **before** any real patient data is processed.
- Apply the HIPAA Security Rule administrative, physical, and technical safeguards, and
  the Privacy Rule minimum-necessary standard, as design inputs — not as a later audit.
- Breach handling moves from the FTC Health Breach Notification Rule to HIPAA breach
  notification where PHI is involved. State consumer-health privacy law (WA MHMD,
  CCPA/CPRA) continues to apply to any non-HIPAA consumer channel.
- The consumer subscription channel, if retained, becomes a **separately-scoped product
  surface** with its own posture. Consumer and PHI data do not share a governance zone.

### 2. Claims discipline is retained, and re-scoped

The CI banned-vocabulary gate stays. What changes is the standard it enforces:
wellness-lane language forbade all treatment claims; the clinical lane permits accurate
description of a supervised clinical workflow while continuing to forbid **outcome and
efficacy claims that are not evidenced** (see the VC document's own proof standard:
"Steady must prove engagement, clinical usefulness, safe routing, outcome movement,
utilization impact, and true cost per active patient before making savings claims").

Marketing/product copy asserting cost savings, clinical superiority, or comparative
effectiveness remains prohibited until the corresponding evidence exists.

### 3. Environment tiers govern un-gating

Feature gates exist for two different reasons, and the reclassification separates them:

- **Safety gates** protect a person who is using the product.
- **Claims gates** protect the truthfulness of what we say about the product.

Neither is protecting a synthetic user in a demo. So un-gating is permitted freely where
no real person and no real data are involved, and is enforced where they are.

| Tier | Data | Who uses it | Un-gating |
|---|---|---|---|
| **T0 — Demo** | Fabricated only | Investors, security reviewers, internal demos | **Any capability may be un-gated**, except the safety floor below |
| **T1 — Internal test** | Synthetic + staff self-testing | Staff, clinician design partners evaluating the workflow | **Any capability may be un-gated**, except the safety floor |
| **T2 — Supervised pilot** | Real, consented participants under clinician supervision | Pilot cohorts | Gates enforced. Un-gating a capability requires that capability's own sign-off |
| **T3 — Production** | Real PHI | Patients, care teams, enterprise | Full gates. No un-gating without the completed gate |

**The safety floor — never un-gated, in any tier.** Because real people (a clinician
tester, an investor, a staff member) type real distress into demo systems:

- Deterministic crisis detection runs before every model call.
- Crisis routing to 988/emergency resources remains reachable and functional.
- The output guard's never-say list stays enforced.
- The global kill switch remains operative.

**Enforcement is technical, not procedural.** A single `STEADY_ENV_TIER`
(`demo` | `internal` | `pilot` | `production`) governs every un-gate flag, following the
pattern already proven by `testOpenGated()` in `src/lib/gating.ts`, which honours
`EMDR_OPEN_GATED` only when `EMDR_DEMO=1`:

- Every un-gate flag is **inert** unless the tier is `demo` or `internal`.
- The application **fails to boot** if the tier is `pilot` or `production` while any
  un-gate flag is set, in the same fail-fast manner as the existing env-guard for
  encryption secrets.
- The active tier and the set of un-gated capabilities are written to the audit log at
  boot, so any recorded session can be attributed to the configuration that produced it.
- T0/T1 environments carry a persistent visible banner identifying them as
  non-clinical demonstration systems.

**Data never crosses tiers upward.** A T0/T1 datastore is never promoted to T2/T3.
Synthetic data is generated, not migrated.

### 4. Counsel is the gate

Per ADR 0001, this reclassification is not effective until counsel confirms it in
writing. Counsel review covers: the Business Associate posture and BAA template, the
consumer-channel carve-out, breach-notification obligations across both frames, consent
and data-rights language for the clinical lane, and the revised claims standard in §2.

## Consequences

**Cascades that must be tracked** (see [`docs/docs-triage.md`](../docs-triage.md)):

- `COMPLIANCE.md` is scoped to wellness-lane gates and needs a parallel clinical/HIPAA
  track — a rewrite, not an edit.
- ADR 0004's single-instance runtime is incompatible with enterprise tenancy; ADR 0007's
  Postgres and multi-instance work moves from optional to prerequisite.
- ADR 0006's stateless HMAC sessions must accommodate enterprise SSO/SCIM.
- ADR 0002's field encryption remains correct and becomes load-bearing for PHI.
- ADR 0005's tamper-evident audit chain remains correct and partially satisfies Handoff E's
  journey-reconstruction requirement.
- A vendor/subprocessor register with BAA status becomes a required artifact.
- A HIPAA security risk analysis and a threat model become required artifacts, neither of
  which exists today.

**What this buys:**

- The beta can demonstrate the full system to investors, clinicians, and security teams
  without weakening any production gate, because the gates are environment-scoped and
  technically enforced.
- Security reviewers can assess the real surface rather than a subset.
- The `beta-clinrev-2026-07` clinical configuration must be re-scoped by the reviewers
  (a supervised clinical model is a material change), but supervised care is a *lower*
  clinical-risk posture than autonomous self-guided reprocessing, and may remove the
  autonomous-BLS staged rollout from the near-term critical path entirely.

**What this costs:**

- HIPAA posture is an ongoing programme — workforce training, risk analysis, incident
  response, vendor management — not a one-time gate.
- Enterprise sales will diligence this posture. It must be real before the first pilot,
  not before the first contract.

## Open questions for counsel

1. Does Steady act as Business Associate, covered entity, or neither, per channel?
2. Can the consumer subscription channel remain wellness-lane while the enterprise
   channel is HIPAA, and what separation does that require?
3. Does the reclassification change the EMDRIA/self-administration exposure previously
   raised, given EMDR becomes one modality within a supervised workflow?
4. What claims are permissible about a supervised clinical workflow prior to outcomes
   evidence?
