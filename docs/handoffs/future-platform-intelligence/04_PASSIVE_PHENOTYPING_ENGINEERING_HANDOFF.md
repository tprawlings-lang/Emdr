# 04 - Passive Digital Phenotyping
## Future Engineering Handoff


> **STATUS: PARKED / DO NOT IMPLEMENT.** This document is a future implementation contract. It is intentionally detailed enough for later execution, but it does not authorize production data collection, clinical use, model deployment, or patient monitoring. Before coding, complete the activation gates in this document and reconcile the spec with the then-current Steady repository.


**Consumes:** Handoff 01 `ExternalSource`, `MeasurementEvidence`, quality/coverage, `PersonalBaseline`, patient connected-data GUI; current Command Center/Session Prep/Recovery architecture.  
**Must not recreate:** source registry, baseline engine, generic measurement storage semantics.  
**Privacy burden:** high. Start with minimum-necessary derived signals only.

## 1. Product promise

With explicit opt-in, Steady may use a small set of phone-derived behavioral features to identify changes in a patient's own routine between visits.

This is not surveillance and not psychiatric prediction.

## 2. What the original research suggested vs what this handoff permits

The source research considered raw location, accelerometer, screen usage, app categories, calls/text metadata and ambient audio.

Future Steady should intentionally narrow the first release.

### Allowed Phase-1 candidates

- on-device daily movement summary
- coarse mobility radius or routine variability computed on-device
- screen-active timing summary without app names
- optional coarse time-away-from-usual-location aggregate if separately approved
- device/permission/collection availability

### Prohibited or separately gated

- raw GPS trail
- exact home/work coordinates
- app names or browsing history
- contact graph
- call/text recipient metadata
- message content outside already-authorized Steady content
- keystroke content
- background microphone
- ambient conversation
- continuous audio

## 3. Patient trust model

The patient must see a human-readable statement for every signal.

```text
ROUTINE SIGNALS

Movement pattern
Shared - Steady receives a daily movement summary.
It does not receive your exact walking route.

Screen timing
Not shared

Routine location pattern
Paused

[See data examples]
[Change sharing]
[Pause all]
[Disconnect]
```

### Permission request sequence

Do not ask for every OS permission in one screen. Ask just in time after the patient turns on the specific feature.

## 4. Patient-facing data example

```text
WHAT STEADY RECEIVED YESTERDAY

Movement summary
- active time: 42 minutes
- movement level: within recent range

Routine location summary
- not enabled

Screen timing
- last active period ended later than recent pattern

Steady did NOT receive:
- messages
- app names
- exact route
- microphone audio
```

This is a trust feature, not optional copy.

## 5. Clinician UX

### Session Prep

```text
BETWEEN-VISIT ROUTINE

Movement
Recent 10-day level is below this person's 28-day baseline
Coverage: 9/10 days

Daily timing
Later than baseline on 6 of 8 available days

Patient report
Sleep quality also declined during this period

Steady Noticed
Movement and sleep self-report changed during the same period.
Association only.

[View evidence]
```

### Patient trend

Separate lanes:

- movement summary
- screen timing (if enabled)
- patient-reported sleep
- Return-to-Life function

Never invent a single `behavioral health score`.

## 6. Workflow

```text
Patient enables one data class
      |
      v
OS permission / mobile collector
      |
      v
ON-DEVICE REDUCTION
      |
      | raw source never leaves device where feasible
      v
ExternalSource (reuse H01)
      |
      v
MeasurementEvidence (reuse H01)
      |
      v
quality / coverage
      |
      v
PersonalBaseline (reuse H01)
      |
      v
feature-specific change evaluator
      |
      +--> insufficient / source gap
      |
      +--> persistent change -> DerivedSignal
      |
      v
Session Prep / Recovery Trajectory
      |
      v
optional Command Center provider
```

## 7. Architecture

Suggested boundaries:

```text
mobile/
  sensing/
    movement.ts
    screen-timing.ts
    routine-location.ts
    permission-state.ts
    daily-reducer.ts

src/lib/integrations/mobile-signals/
  ingest.ts
  schemas.ts
  policies.ts

src/lib/clinical/evidence-adapters/
  passive-signals.ts

src/lib/clinical/attention-providers/
  routine-change.ts
```

### 7.1 On-device reduction

Where possible, compute daily aggregate on the device and send only the aggregate Steady actually needs.

Example: instead of 1,400 GPS points, send:

```json
{
  "featureDate": "2026-09-03",
  "featureType": "coarse_mobility_radius",
  "value": 3.8,
  "unit": "km",
  "sourceSamples": 1400,
  "coverageHours": 19.2
}
```

Even this feature requires privacy review before activation.

## 8. Database design

Reuse `external_sources`, `external_measurements`, `daily_measurement_features`, and `personal_baselines` from Handoff 01.

Only add feature-specific configuration/state when needed:

```sql
CREATE TABLE passive_signal_preferences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  collection_policy_version TEXT NOT NULL,
  processing_scope TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, person_id, signal_type)
);

CREATE TABLE passive_signal_device_state (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  permission_state TEXT NOT NULL,
  last_sample_at TEXT,
  last_upload_at TEXT,
  collector_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Do not introduce a second baseline table.

## 9. Event contracts

Reuse general source/measurement events. Add only domain events if they add meaning:

- `passive_signal.preference_changed.v1`
- `passive_signal.permission_changed.v1`
- `passive_signal.collection_gap_detected.v1`
- `passive_signal.change_detected.v1`

A raw location point event is not part of the default Steady event spine.

## 10. Feature policies

Each signal needs a versioned policy:

```ts
type PassiveSignalPolicy = {
  signalType: string;
  version: string;
  minimumCoverage: number;
  baselinePolicyVersion: string;
  changeThreshold: number;
  persistenceDays: number;
  cooldownDays: number;
  allowedClinicalSurfaces: string[];
};
```

Thresholds require evaluation. The numbers must not be invented during implementation.

## 11. Travel and context

Travel is the classic false positive.

If location/movement pattern changes because the patient is traveling, the signal should either:

- identify a known travel context from patient-provided information, or
- present the change without a clinical interpretation.

Never say `social withdrawal` simply because movement radius fell.

## 12. Command Center provider

A routine signal can create a non-safety item only when:

- permission is active
- source health is valid
- baseline is valid
- coverage threshold met
- persistence rule met
- policy allows Command Center surfacing
- not in provider cooldown unless materially new

Example:

```text
Review Today
Routine movement changed for 9 available days
24% below recent personal baseline
Patient-reported sleep also worsened in this period
[Review patient]
```

## 13. Recovery Trajectory integration

Passive signal lanes can be useful as context, especially when function and symptoms diverge.

Example:

```text
Symptoms: improving
Return-to-Life: improving
Movement: little change
Sleep self-report: worsening
```

The value is the contradiction, not a composite score.

## 14. Therapeutic Load integration

Passive signals can support recovery context only. A lower movement signal does not mean the patient should reduce or increase treatment intensity.

## 15. AI Gateway role

Most feature change detection should be deterministic.

Optional task:

`clinician.routine_change.summarize`

The model receives only normalized authorized evidence, not raw location.

Allowed:

> Movement and sleep self-report changed during the same period.

Not allowed:

> The patient is becoming depressed and isolating.

## 16. Privacy threat model

Threats to design against:

- clinician overinterprets routine data
- account compromise exposes sensitive movement history
- raw location accidentally reaches analytics
- patient believes Steady is reading communications
- OS permission remains on after in-app feature disabled
- source data collected for one purpose is reused for another
- device shared with family member
- travel creates false clinical narrative

Mitigations must appear in code and patient UI, not only policy documents.

## 17. Retention

Prefer derived daily summaries over raw source retention.

If raw source temporarily exists for processing:

- encrypt
- set short retention
- record deletion job result
- do not expose it to ordinary clinician UX
- do not send it to model providers

## 18. API surface

```text
GET  /api/member/connected-data/passive
POST /api/member/connected-data/passive/:signalType/enable
POST /api/member/connected-data/passive/:signalType/pause
POST /api/member/connected-data/passive/:signalType/disable
POST /api/mobile/passive-signals/daily
GET  /api/clinician/member/:id/routine-signals
```

## 19. Failure states

- permission revoked
- background collection throttled by OS
- battery saver suppresses collection
- phone turned off
- patient travels
- patient changes phones
- source clock wrong
- collection version changes
- insufficient coverage
- model narrative fails

Each failure becomes a source/quality state before any clinical change interpretation.

## 20. Test program

### Synthetic histories

- stable baseline, no change
- activity drop with complete coverage
- activity drop with 30% coverage -> no signal
- permission loss -> source gap
- travel week -> descriptive only
- device transition
- delayed upload
- out-of-order daily features
- future cutoff excludes later days
- consent withdrawal during queued upload

### Security

- raw location never appears in logs/analytics
- cross-tenant source injection denied
- mobile cannot forge person ID
- disabled signal rejected at ingestion

## 21. Implementation phases

### Phase 0 - Patient acceptability + privacy design
No production code.

### Phase 1 - Reuse H01 source/baseline services
Prove no new parallel substrate is required.

### Phase 2 - Movement daily summary only
On-device reduction.

### Phase 3 - Patient transparency GUI
Show what Steady received.

### Phase 4 - Clinician read-only trend + Session Prep
No Command Center yet.

### Phase 5 - Evaluation and false-positive review

### Phase 6 - Command Center provider

### Phase 7 - Optional second signal class
Separate consent/approval.

## 22. Definition of Done before Handoff 05 research can use the same substrate

- source registry reuse proven
- baseline reuse proven
- granular consent works
- on-device minimization works
- patient can inspect what Steady collected
- raw location not retained by default
- no psychiatric diagnosis/inference
- Command Center signal remains non-safety and evidence-linked


## 23. Mobile collector contract

The collector must be policy-driven from server-signed configuration, not hardcoded to collect everything the OS permits.

```ts
type MobileCollectionPolicy = {
  version: string;
  allowedSignals: Array<{
    signalType: string;
    collectionMode: "on_device_daily" | "event_summary";
    minimumOSPermission: string;
    retentionOnDeviceHours: number;
  }>;
};
```

If the server disables a signal, the mobile client stops collecting it at the next policy refresh and refuses uploads for that class.

## 24. Battery and OS-health design

Passive collection must not materially harm battery life. Engineering acceptance should include:

- background execution budget
- upload batching
- Wi-Fi/cellular policy where relevant
- retry backoff
- battery impact measurement
- OS throttling behavior

A clinical feature that causes users to disable the app is a product failure.

## 25. Privacy review checklist per signal

For every new signal class answer:

1. What exact raw data exists on device?
2. What exact aggregate leaves the device?
3. Can the aggregate reveal precise location or social relationships?
4. Who can see it?
5. Does it go to a model?
6. How long is raw/derived data retained?
7. What happens on withdrawal?
8. What false clinical story could a clinician infer from it?
9. How does the UI prevent that story?

No signal is added until this checklist is approved.

## 26. File-level future implementation map

```text
mobile/sensing/policy.ts                         NEW
mobile/sensing/movement.ts                       NEW
mobile/sensing/screen-timing.ts                  FUTURE
mobile/sensing/daily-reducer.ts                  NEW
mobile/sensing/upload.ts                         NEW
src/lib/external-data/*                          REUSE H01
src/lib/passive-signals/policies.ts              NEW
src/lib/clinical/evidence-adapters/passive.ts     NEW
src/lib/clinical/attention-providers/passive.ts   NEW
src/app/member/settings/connected-data/*          EXTEND H01
src/app/clinician/member/[id]/*                   EXTEND
```

## 27. Observability

Allowed:

- collector version
- permission state code
- upload success/failure
- days with adequate coverage
- battery-impact aggregate from test cohorts
- derived signal candidate count

Never log raw location, app identifiers, contact metadata, or patient movement values in general telemetry.

## 28. Acceptance scenarios

### Scenario A - true routine change, adequate data
Movement aggregate decreases for 10 days with 90% coverage. Baseline valid. Session Prep shows descriptive change. Command Center provider may surface review after persistence policy.

### Scenario B - phone left at home
Movement drops but phone-usage/coverage metadata indicates collector availability is poor. Signal becomes source-gap/insufficient, not clinical change.

### Scenario C - vacation
Movement radius changes sharply. No interpretation such as avoidance or instability. If travel context exists, it is displayed as context.

### Scenario D - consent withdrawal
Patient disables movement sharing at 14:03. Queued post-withdrawal upload is rejected. Prior retained evidence follows policy and UI explains it.

## 29. Release acceptance checklist

- [ ] on-device reduction proven
- [ ] H01 source/baseline reuse verified
- [ ] patient can see example of exactly what leaves device
- [ ] permission withdrawal stops collection/upload
- [ ] no raw GPS by default
- [ ] travel/source-gap cases tested
- [ ] no independent safety authority
- [ ] battery/OS behavior measured

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
