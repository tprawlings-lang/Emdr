# Steady Future Platform Intelligence Program
## Deferred Implementation Controller and Dependency Map


> **STATUS: PARKED / DO NOT IMPLEMENT.** This document is a future implementation contract. It is intentionally detailed enough for later execution, but it does not authorize production data collection, clinical use, model deployment, or patient monitoring. Before coding, complete the activation gates in this document and reconcile the spec with the then-current Steady repository.


**Target repo location:** `docs/handoffs/future-platform-intelligence/`  
**Package role:** The execution controller for five future add-ons.  
**Required reading order:** 00 -> 01 -> 02 -> 03 -> 04 -> 05.

## 1. Why this package exists

The source research identified five high-impact future capabilities for Steady: passive smartphone-derived behavioral data, wearables, medication support, digital therapeutic modules, and voice/text signal analysis. The research is directionally useful, but a future coding handoff must do more than describe features. It must specify how each addition enters Steady's evidence model, how it appears to patients and clinicians, how it is stored, how it fails, what it is allowed to influence, and what the next handoff is allowed to assume.

This package therefore turns those five ideas into one deferred engineering program.

The goal is not to create five independent products. The goal is to extend the same longitudinal clinical intelligence system with new evidence classes and controlled between-visit workflows.

## 2. Future build order

| Order | Handoff | Why it comes here | Shared primitive it contributes |
|---|---|---|---|
| 01 | Wearable Integration | High-value measured data with understandable consent and limited interpretation | External source registry, health-data ingestion, quality/coverage model, personal-baseline service |
| 02 | Medication Support | Adds scheduled patient actions and clinician follow-up without requiring predictive AI | General scheduled-action/confirmation semantics, notification orchestration, patient task surface |
| 03 | Digital Therapeutic Modules | Reuses task/reminder infrastructure and already-existing Steady module/gating concepts | Assignment/run lifecycle, versioned intervention content, structured response capture |
| 04 | Passive Digital Phenotyping | Reuses the measurement, baseline, consent, and quality primitives already proven | Privacy-minimized mobile signal collection and behavioral-change providers |
| 05 | Communication Change Signals | Highest validation/bias burden; should reuse everything before it | Research-grade multimodal feature extraction with strict model/retention boundaries |

## 3. The dependency graph

```text
CURRENT STEADY INTELLIGENCE LAYER
Clinician Thoughts -> Session Prep -> Return-to-Life -> Response Fingerprint
        -> Command Center -> Recovery Trajectory -> Therapeutic Load
                              |
                              v
00 FUTURE PROGRAM CONTRACTS
        |
        v
01 WEARABLES
ExternalSource + Measurement + Quality + PersonalBaseline
        |
        +--------------------+
        |                    |
        v                    v
02 MEDICATION            04 PASSIVE PHENOTYPING
ScheduledAction          MobileSignalSource
Confirmation             Reuses PersonalBaseline
Notifications            Reuses Quality/Coverage
        |
        v
03 DIGITAL MODULES
Reuses ScheduledAction / Notifications
Extends existing modules / gates
Feeds Response Fingerprint / Return-to-Life
        |
        +--------------------+
                             v
05 COMMUNICATION CHANGE SIGNALS
Reuses Source/Consent/Quality/Baseline/AI provenance
Research-first; no independent safety authority
```

## 4. What the senior engineer must NOT do

- Do not implement a generic `future_signals` table and dump every feature into it.
- Do not create a second event system.
- Do not create a second patient-task scheduler in Handoff 03 after Handoff 02 creates the general scheduling primitive.
- Do not create separate baseline code for wearables, passive phone data, and communication signals. One typed personal-baseline service should support them with feature-specific policies.
- Do not put every derived signal into the safety alert table.
- Do not create a universal patient health, stress, adherence, or recovery score.
- Do not permit feature code to call model providers directly.
- Do not assume the file paths in this package remain correct years later. Re-audit first.

## 5. Shared future platform primitives

### 5.1 ExternalSource

A common record for patient-authorized external or device-derived sources.

```ts
type ExternalSource = {
  id: string;
  tenantId: string;
  personId: string;
  sourceClass: "health_platform" | "mobile_sensor" | "authorized_record" | "patient_device";
  provider: string;
  status: "connected" | "paused" | "permission_lost" | "disconnected";
  consentVersion: string;
  consentScopes: string[];
  connectedAt: string;
  disconnectedAt?: string;
};
```

Handoff 01 owns this primitive. Handoffs 04 and 05 consume it rather than recreate it.

### 5.2 MeasurementEvidence

```ts
type MeasurementEvidence = {
  evidenceId: string;
  tenantId: string;
  personId: string;
  sourceId: string;
  metricType: string;
  occurredAt: string;
  recordedAt: string;
  numericValue?: number;
  categoricalValue?: string;
  unit?: string;
  provenanceClass: "external_device_measured" | "system_measured";
  qualityState: "valid" | "partial" | "stale" | "device_gap" | "invalid";
  sourceRecordId?: string;
  algorithmVersion?: string;
};
```

### 5.3 PersonalBaseline

Baseline is a service, not a table name alone.

```ts
type BaselineWindow = {
  metricType: string;
  policyVersion: string;
  from: string;
  to: string;
  observations: number;
  coverage: number;
  center: number;
  variability?: number;
  sourceIds: string[];
};
```

Rules:

- baseline is patient-specific
- minimum observations and coverage are policy-defined per metric
- baseline is never silently recomputed across a known source/device transition without recording that transition
- historical baseline can be reconstructed at a cutoff
- a baseline is descriptive, not a normative goal

### 5.4 ScheduledAction

Handoff 02 owns the general patient action scheduler and confirmation model. Medication dose windows are the first consumer; Handoff 03 reuses the same orchestration for clinician-assigned practice where appropriate.

```ts
type ScheduledAction = {
  id: string;
  tenantId: string;
  personId: string;
  actionType: "medication_dose" | "assigned_practice" | "checkin" | "custom";
  dueAt: string;
  privacyLabel: "generic" | "sensitive";
  state: "scheduled" | "confirmed" | "explicitly_skipped" | "unconfirmed" | "cancelled";
  sourceObjectId: string;
};
```

### 5.5 DerivedSignal

Derived signals are typed, source-linked and limited in authority.

```ts
type DerivedSignal = {
  id: string;
  tenantId: string;
  personId: string;
  signalType: string;
  sourceFeature: string;
  evidenceIds: string[];
  windowFrom: string;
  windowTo: string;
  state: string;
  algorithmVersion: string;
  limitations: string[];
  provenanceClass: "model_derived" | "system_measured";
};
```

## 6. Shared data-flow contract

```text
collect / import
    -> validate consent + source ownership
    -> normalize source record
    -> append source event
    -> update feature projection
    -> run quality policy
    -> optionally update personal baseline
    -> optionally create derived change signal
    -> expose through typed adapter
    -> Session Prep / Timeline / Response Fingerprint / Recovery Trajectory
    -> Command Center only if deterministic attention-provider policy allows
```

## 7. Shared consent model

Consent must be granular enough that a patient can allow one class and refuse another.

Required concepts:

- feature family
- specific data scope
- purpose
- who may see it
- whether model processing is allowed
- whether raw source can be retained
- date/version of consent
- pause/disconnect
- effect of withdrawal on future collection
- historical retention state

A future implementation may attach these to the current consent system rather than introduce a new top-level consent product. The invariant is the behavior, not the exact table name.

## 8. Shared clinician presentation hierarchy

A new source should appear in Steady in this order:

1. **Evidence detail** - what was measured/reported and by what source.
2. **Patient longitudinal view** - raw/normalized trend with coverage.
3. **Session Prep** - concise material change since last session.
4. **Response Fingerprint / Return-to-Life / Recovery Trajectory** - only through typed adapters.
5. **Command Center** - only after a deterministic provider decides the change deserves review.
6. **Therapeutic Load** - only as one source among multiple, never an automatic progression decision.

## 9. Shared patient GUI

Every connected-data feature must provide a consistent `My connected data` surface:

```text
MY CONNECTED DATA

Apple Health               Connected
  Sleep                    Shared
  Activity                 Shared
  Heart rate               Not shared

Medication reminders       On

Phone routine signals      Paused

Voice change analysis      Not enabled

[Review what Steady uses]
[Change permissions]
[Pause / disconnect]
```

The patient should not have to hunt through five settings areas to understand what Steady is collecting.

## 10. Shared testing obligations

Every handoff must include:

- tenant-isolation attack cases
- permission/consent withdrawal
- point-in-time reconstruction
- duplicate-source ingestion
- source/device transition
- partial/missing data
- correction/supersession
- model-output validation when applicable
- UI evidence drill-down
- analytics PHI exclusion
- feature-off behavior
- downstream adapter tests

## 11. Shared observability

Operational telemetry may contain:

- source connection success/failure
- import counts
- aggregate latency
- algorithm version
- feature flags
- error class
- consent-state codes

It must not contain patient text, medication name/dose, journal content, raw location, raw voice, clinical thread names, or other patient content.

## 12. Activation gate before Handoff 01

Before future implementation begins, the senior engineer must produce a one-page repo delta note answering:

- Is ADR 0010 authoritative-write cutover complete?
- Is TenantContext enforced on every relevant product path?
- Is ADR 0012 AI Gateway implemented and mandatory?
- What is the current database runtime?
- Is there a production mobile client capable of HealthKit/Health Connect access?
- What notification service exists?
- What current module/catalog schema exists?
- What consent/retention implementation exists?
- Which existing current-intelligence handoffs have shipped?

No coding starts until that delta note exists.

## 13. Release order and dependency acceptance

Handoff 02 may not start merely because Handoff 01 compiles. Handoff 01 must demonstrate stable source ingestion, coverage, consent withdrawal, baseline reconstruction, and typed downstream adapters.

Handoff 03 may not start until Handoff 02's generic scheduled-action/notification primitives are production-proven or consciously split into a shared package.

Handoff 04 may not start until the data-minimization and patient-control patterns from 01 are proven.

Handoff 05 is explicitly research-gated and may remain parked indefinitely even if 01-04 ship.


## 16. Cross-handoff ownership matrix

| Concern | Owner handoff | Later handoff behavior |
|---|---|---|
| External source lifecycle | 01 Wearables | 04/05 reuse; may extend source classes only |
| Measurement normalization | 01 Wearables | 04 reuse; 05 uses only where numeric feature model fits |
| Personal baseline service | 01 Wearables | 04/05 reuse with feature-specific policy |
| Notification scheduler | 02 Medication | 03 reuse; no second scheduler |
| Patient task center | 02 Medication | 03 extend with practice cards |
| Versioned intervention catalog | 03 Modules | future intervention work extends it |
| Mobile on-device minimization | 04 Passive | 05 borrows privacy pattern, not sensor code |
| Voice/text research pipeline | 05 Communication | no upstream handoff depends on it |

## 17. Program-level feature flags

Suggested future flags:

```text
FUTURE_EXTERNAL_SOURCES
FUTURE_WEARABLE_SLEEP_ACTIVITY
FUTURE_MEDICATION_SUPPORT
FUTURE_SCHEDULED_ACTIONS
FUTURE_CLINICIAN_ASSIGNED_MODULES
FUTURE_PASSIVE_ROUTINE_SIGNALS
FUTURE_COMMUNICATION_RESEARCH
```

Flags should be tenant-aware. Turning a feature off stops new workflow behavior but does not erase historical events.

## 18. Program-level migration philosophy

Every handoff follows the same activation sequence:

```text
schema -> write path -> replay/projection test -> read-only UI -> downstream adapter
       -> clinician workflow -> optional AI -> optional attention provider
```

Do not start with an AI summary or Command Center alert before the source and read-only longitudinal views are proven.

## 19. Program-level rollback

Rollback must be defined per phase:

- disable new ingestion/assignment/reminder behavior with flag
- preserve already-recorded source events
- stop scheduled jobs safely
- leave historical clinician views readable where appropriate
- never delete or rewrite event history to simulate rollback
- if a derived projection is defective, rebuild it from source events after fixing versioned logic

## 20. Coding-agent / senior-engineer execution contract

When a future engineer begins one handoff, they should produce a short implementation plan before modifying code:

1. current repo paths that implement the equivalent shared primitive
2. ADRs that constrain the change
3. schema migration plan
4. event types to add
5. source/projection ownership
6. feature flag
7. unit/integration/e2e test list
8. privacy/clinical sign-off references
9. downstream adapters being activated in this phase
10. explicit items deferred

The engineer should not silently simplify the handoff by collapsing provenance classes, removing quality states, or replacing source-linked objects with generated prose.

## 21. Program-level Definition of Done

The five add-ons are considered fully implemented only when all of the following hold:

- a patient can inspect and control every optional data source
- a clinician can trace every material statement to its source
- device/phone/source gaps remain visible
- Session Prep remains concise despite additional evidence streams
- Command Center remains an attention surface rather than an alert wall
- Return-to-Life and Response Fingerprint can consume new evidence without source flattening
- Recovery Trajectory can display new lanes without a universal composite score
- Therapeutic Load remains clinician decision support
- no model output gains safety, prescribing, or treatment-progression authority by accident
- point-in-time reconstruction still works across the new event families

## Repository baseline this future handoff is anchored to

This package was prepared against Steady's September 2026 architecture on branch `claude/gifted-keller-501y5d`. Before implementation, the engineer must re-audit the current repository and update stale assumptions.

Known architectural facts at package creation:

- Runtime is Next.js App Router with SQLite/WAL today; Postgres is a documented future path.
- ADR 0010 event spine has steps 1-4 implemented, with authoritative-write cutover still separately gated at the time this package was prepared.
- ADR 0011 provides tenant/person/account building blocks and repository-level TenantContext, but end-to-end call-site enforcement must be rechecked before implementation.
- ADR 0012 defines the required AI Gateway boundary; no future feature in this package may call a model provider directly.
- Clinician surfaces already favor evidence-linked summaries, explicit provenance, deterministic safety, and server-side work prioritization.
- The existing/current intelligence roadmap includes Clinician Thoughts, Session Prep, Return-to-Life Goals, Treatment Response Fingerprint, Command Center, Recovery Trajectory, and Therapeutic Load & Readiness. These future handoffs extend those systems rather than replace them.



## Non-negotiable Steady rules carried into this feature

1. **Source before inference.** A derived signal never becomes original evidence.
2. **Patient and tenant scope before retrieval.** Authorization happens before search, aggregation, or model context assembly.
3. **No source flattening.** Patient report, clinician observation, device measurement, imported record, and model inference remain distinguishable.
4. **No future-data leakage.** Historical reconstruction uses the evidence available at the requested cutoff.
5. **Corrections append.** New evidence supersedes; it does not erase source history.
6. **Missing is not normal.** Missing, unavailable, unconfirmed, stale, and insufficient data remain explicit states.
7. **AI cannot outrank deterministic safety.** Model output cannot clear safety, unlock gated care, prescribe, or assign clinical urgency.
8. **No causal wording from observational overlap.** Use `associated with`, `coincided with`, `during the same period`, or equally restrained language.
9. **Every material generated clinician claim cites evidence.** If it cannot cite, it is withheld.
10. **Feature-specific data can feed existing Steady intelligence only through typed adapters with provenance intact.**


## 14. Package file map

- `00_FUTURE_PLATFORM_PROGRAM_OVERVIEW.md`
- `01_WEARABLE_INTEGRATION_ENGINEERING_HANDOFF.md`
- `02_MEDICATION_SUPPORT_ENGINEERING_HANDOFF.md`
- `03_CLINICIAN_ASSIGNED_MODULES_ENGINEERING_HANDOFF.md`
- `04_PASSIVE_PHENOTYPING_ENGINEERING_HANDOFF.md`
- `05_COMMUNICATION_CHANGE_SIGNALS_RESEARCH_HANDOFF.md`
- matching PDFs under `pdf/`
- original research under `reference/`

## 15. Final directive

The objective is not more data. The objective is to make new between-visit evidence useful without weakening Steady's existing trust model.
