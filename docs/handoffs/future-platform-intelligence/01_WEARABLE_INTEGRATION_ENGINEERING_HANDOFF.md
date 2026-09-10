# 01 - Wearable Device Integration
## Future Engineering Handoff


> **STATUS: PARKED / DO NOT IMPLEMENT.** This document is a future implementation contract. It is intentionally detailed enough for later execution, but it does not authorize production data collection, clinical use, model deployment, or patient monitoring. Before coding, complete the activation gates in this document and reconcile the spec with the then-current Steady repository.


**Consumes:** current Steady event/tenant/AI/evidence architecture.  
**Creates for later handoffs:** `ExternalSource`, measured-data normalization conventions, `PersonalBaseline`, quality/coverage states, connected-data patient GUI pattern.  
**Later consumers:** Handoff 04 Passive Phenotyping and Handoff 05 Communication Change Signals. Handoff 03 may consume sleep/activity as intervention-response context.

## 1. Product promise

With explicit patient permission, Steady can incorporate selected health-platform data such as sleep and activity into the longitudinal record so clinicians can see material changes between visits and compare them with the patient's own prior pattern.

The feature is not a remote vital-signs monitor and is not a diagnostic engine.

### MVP questions

- How much usable sleep/activity data exists?
- Has sleep duration/timing changed from this person's own baseline?
- Has activity changed from this person's own baseline?
- Did a measured change occur during the same period as a patient-reported or treatment event?
- Is the source currently connected and trustworthy enough for display?

## 2. Scope

### Phase-1 metrics

- sleep duration
- sleep interval/timing when source supports it
- daily steps/activity count
- active minutes when normalized reliably

### Phase-2 candidates

- resting heart rate
- HRV with source-specific quality policy

### Explicitly out of initial scope

- ECG interpretation
- arrhythmia detection
- blood pressure treatment guidance
- proprietary vendor stress scores treated as clinical truth
- raw minute-by-minute feed on the clinician home screen
- automatic psychiatric diagnosis from physiologic data

## 3. UX architecture

### 3.1 Patient onboarding flow

```text
Settings -> Connected data -> Health data

CONNECT HEALTH DATA

Choose what Steady may use:
[x] Sleep duration and timing
[x] Activity and steps
[ ] Resting heart rate
[ ] Heart-rate variability

How it will be used:
- show changes from your own recent pattern
- help prepare your clinician for visits
- help compare practice/session recovery over time

Your clinician will see summaries and trends, not a live fitness feed.

[What exactly is collected?]
[Connect]
[Not now]
```

Required patient-visible fields after connection:

- platform/source
- data classes shared
- last successful sync
- data coverage
- pause/disconnect
- whether historical data is retained after disconnect
- link to data-use explanation

### 3.2 Patient trend view

Patient view is optional for MVP but should be designed now. It must avoid making normal variance feel like failure.

```text
YOUR HEALTH DATA

Sleep
Recent 7-day average: 6h 18m
Your recent baseline: 7h 02m
5 of 7 nights available

Activity
Recent 7-day average: 4,460 steps
Your recent baseline: 5,210
7 of 7 days available

This information is descriptive, not a diagnosis.
```

### 3.3 Clinician patient view

```text
MEASURED HEALTH SIGNALS

Sleep                                  5/7 nights
6h 18m recent average
Baseline 7h 02m
[Open trend]

Activity                               7/7 days
4,460 recent average
Baseline 5,210
[Open trend]

Data source: Apple Health
Last sync: Sep 3 07:41
[Evidence & source details]
```

### 3.4 Trend GUI

Use one metric per lane, shared time axis only.

```text
SLEEP HOURS
8 |        o  o
7 |  o  o        baseline band
6 |     o      o
5 |                    o
  +------------------------- time

ACTIVITY
7000 | o      o
5000 |   o  o      baseline band
3000 |              o   o
     +---------------------- time
```

Do not put HRV, sleep hours and steps on one normalized 0-100 scale.

## 4. Workflow

```text
Patient enables metric scope
        |
        v
Mobile client requests OS authorization
        |
        v
ExternalSource connected event
        |
        v
Incremental import cursor reads records
        |
        v
Normalize units / timezone / source identity
        |
        v
Deduplicate on source record id
        |
        v
Append measurement source event
        |
        v
Update daily metric projection
        |
        v
Quality + coverage calculation
        |
        +--> insufficient -> display gap only
        |
        v
PersonalBaseline compute/update
        |
        v
Change evaluator
        |
        +--> no material change -> no attention item
        |
        +--> material persistent change -> typed DerivedSignal
        |
        v
Session Prep / trajectory / fingerprint adapters
        |
        v
Optional Command Center provider
```

## 5. Architecture

### 5.1 Modules

Suggested future module boundaries:

```text
src/lib/external-data/
  source-registry.ts
  consent.ts
  measurements.ts
  baseline.ts
  quality.ts
  normalization.ts

src/lib/integrations/health/
  apple-health.ts
  health-connect.ts
  import-cursor.ts
  mappings.ts

src/lib/clinical/evidence-adapters/
  wearable.ts

src/lib/clinical/attention-providers/
  wearable-change.ts
```

Exact paths must be reconciled with the future repo. The boundary matters more than the names.

### 5.2 One source registry

Handoff 04 must reuse the source registry created here. Do not create `wearable_connections` and later a completely separate `phone_sensor_connections` abstraction if they share consent/source lifecycle semantics.

### 5.3 Import strategy

Prefer mobile-mediated HealthKit/Health Connect import rather than storing long-lived vendor OAuth credentials for every wearable brand.

Import must support:

- cursor/checkpoint
- retries
- idempotency
- late-arriving data
- source corrections
- deleted/withdrawn source permissions
- timezone changes
- device/source transition

## 6. Database schema

```sql
CREATE TABLE external_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  source_class TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_scopes_json TEXT NOT NULL,
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT NOT NULL,
  paused_at TEXT,
  disconnected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX external_sources_person
ON external_sources(tenant_id, person_id, status);

CREATE TABLE external_measurements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  numeric_value REAL,
  categorical_value TEXT,
  unit TEXT,
  quality_state TEXT NOT NULL,
  source_device_label TEXT,
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(source_id, source_record_id)
);

CREATE INDEX external_measurements_window
ON external_measurements(tenant_id, person_id, metric_type, occurred_at);

CREATE TABLE daily_measurement_features (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  numeric_value REAL NOT NULL,
  unit TEXT NOT NULL,
  coverage_ratio REAL NOT NULL,
  quality_state TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  source_event_ids_json TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  UNIQUE(tenant_id, person_id, metric_date, metric_type, algorithm_version)
);

CREATE TABLE personal_baselines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  observation_count INTEGER NOT NULL,
  coverage_ratio REAL NOT NULL,
  center_value REAL NOT NULL,
  variability_value REAL,
  source_ids_json TEXT NOT NULL,
  computed_at TEXT NOT NULL
);
```

### 6.1 What is authoritative

- Raw imported source record: source evidence.
- Daily metric: deterministic projection.
- Baseline: derived projection with policy version.
- Change statement: derived signal, not source evidence.

## 7. Event contracts

### `external_source.connected.v1`

```json
{
  "sourceId": "...",
  "sourceClass": "health_platform",
  "provider": "apple_health",
  "consentVersion": "...",
  "scopes": ["sleep", "activity"]
}
```

### `measurement.recorded.v1`

```json
{
  "measurementId": "...",
  "sourceId": "...",
  "sourceRecordId": "...",
  "metricType": "sleep_duration",
  "occurredAt": "...",
  "numericValue": 6.2,
  "unit": "hours",
  "qualityState": "valid"
}
```

Other events:

- `external_source.permission_changed.v1`
- `external_source.paused.v1`
- `external_source.disconnected.v1`
- `measurement.daily_feature_computed.v1`
- `measurement.baseline_computed.v1`
- `measurement.change_detected.v1`
- `measurement.source_transitioned.v1`

## 8. Personal baseline policy

Each metric has its own policy object.

```ts
type BaselinePolicy = {
  metricType: string;
  version: string;
  minimumObservations: number;
  minimumCoverage: number;
  lookbackDays: number;
  estimator: "median" | "mean";
  outlierPolicy: string;
  sourceTransitionPolicy: string;
};
```

MVP example policies should be deliberately conservative. Do not invent significance thresholds from intuition. They require clinical/product review and test fixtures.

## 9. Change signal state machine

```text
INSUFFICIENT_DATA
    |
    | enough baseline + current coverage
    v
OBSERVING
    |
    | threshold crossed but not persistent
    v
POSSIBLE_CHANGE
    |
    | persistence criterion met
    v
MATERIAL_CHANGE
    |
    +--> RETURNED_TO_BASELINE
    +--> SOURCE_GAP
```

Command Center eligibility begins only at `MATERIAL_CHANGE`, not first threshold crossing.

## 10. Session Prep adapter

Produces evidence objects, not prose alone.

```ts
type WearablePrepEvidence = {
  metricType: string;
  recentWindow: { from: string; to: string; value: number; coverage: number };
  baseline: { value: number; window: string; policyVersion: string };
  changeState: string;
  evidenceIds: string[];
  limitations: string[];
};
```

Example rendering:

> Sleep averaged 6h 18m across 5 available nights, below the recent 28-day personal baseline of 7h 02m. Two nights are missing. Source: Apple Health.

## 11. Response Fingerprint integration

Wearable measurements may enrich a response pattern only when time alignment and data quality are explicit.

Example:

```text
Grounding - 12 observed uses
Patient-reported distress improved after 9/12.
Valid paired heart-rate measurements exist for 9 uses; HR was lower after 7/9.
No causal claim is made.
```

The fingerprint should carry separate evidence channels rather than collapse them into a composite success score.

## 12. Recovery Trajectory integration

Add measurement lanes rather than a normalized total score.

Candidate domains:

- measured sleep
- measured activity
- patient-reported sleep
- symptoms
- Return-to-Life function

Contradictions are useful. If self-report improves while measured sleep worsens, show both.

## 13. Therapeutic Load integration

Wearable evidence can add recovery context, e.g. post-session sleep remains lower than baseline, but cannot independently produce `reduce load` or `progress` authority.

## 14. Command Center provider

Possible non-safety reasons:

- Sleep materially changed from personal baseline and persisted for policy window.
- Activity materially changed with strong data coverage.
- Data source failed where clinician workflow specifically depends on it.

One row example:

```text
Sarah M. - Review Today
Sleep pattern changed across the last 6 available nights
Recent average 5h 48m vs personal baseline 7h 04m
Coverage 6/7 nights
[Review Sarah]
```

Never:

- `High anxiety based on HRV`
- `Depression relapse detected`
- `Crisis risk due to low activity`

## 15. API contracts

```text
POST /api/member/external-sources/health/connect
POST /api/member/external-sources/:id/pause
POST /api/member/external-sources/:id/disconnect
POST /api/mobile/health/import
GET  /api/member/connected-data
GET  /api/clinician/member/:id/measured-health
GET  /api/clinician/member/:id/measured-health/:metric
```

Server resolves person/tenant. Mobile payload cannot select a foreign patient.

## 16. Consent and privacy

Metric-level consent is required. The patient can share sleep and refuse HRV.

On disconnect:

- future import stops immediately
- connection state changes durably
- retained historical data follows approved retention policy
- UI states clearly whether historical evidence remains visible

No external analytics gets raw measurements.

## 17. Data-quality UI

Every metric view can show:

- data coverage
- source
- last sync
- source transition
- known gap
- quality warning

Bad example: `Sleep worsening 22%` with no denominator or coverage.

Good example: `5 of 7 nights available; recent average below personal baseline.`

## 18. Failure modes

- Duplicate import -> idempotent no-op.
- Late source correction -> append/update projection with source lineage; do not rewrite history invisibly.
- Source permission removed -> no more import; mark coverage gap.
- Travel/timezone -> normalize local-day semantics and record transition.
- New device -> record source transition; do not automatically compare incompatible metrics.
- Sparse HRV -> do not display trend.
- Model summary unavailable -> deterministic view still works.

## 19. Security test matrix

- foreign tenant source ID
- foreign person measurement request
- forged mobile person_id
- revoked consent with queued import
- export excludes foreign source
- source metadata does not leak tokens
- clinical read permissions expire
- analytics payload contains no health values

## 20. Implementation phases

### Phase 0 - Repo delta and data-governance approval
No code.

### Phase 1 - Shared source registry + consent
Create `ExternalSource` and patient connected-data UI.

### Phase 2 - Sleep/activity import
One platform at a time; source fixtures first.

### Phase 3 - Daily projection + quality
Prove idempotent import and reproducible daily summaries.

### Phase 4 - PersonalBaseline service
This is a shared future primitive. API must be metric-agnostic enough for Handoff 04/05.

### Phase 5 - Clinician trend + Session Prep
No attention signal yet.

### Phase 6 - Downstream adapters
Response Fingerprint and Recovery Trajectory.

### Phase 7 - Command Center provider
Only after false-positive review on synthetic/replayed histories.

### Phase 8 - Optional HR/HRV
Separate approval.

## 21. Definition of Done before Handoff 02 is allowed to depend on this

- ExternalSource lifecycle works and is tenant-safe.
- Metric-level consent works.
- Source import is idempotent.
- Daily summaries replay consistently.
- PersonalBaseline has policy version and point-in-time tests.
- Coverage/missing states render honestly.
- Session Prep can consume measured evidence.
- Feature-off mode leaves current Steady unchanged.
- No clinician-facing diagnostic inference exists.


## 22. Source mapping contract

Each platform-specific importer maps native source types into Steady canonical metrics.

Example mapping table:

| Native source | Canonical metric | Unit | Aggregation | Notes |
|---|---|---|---|---|
| HealthKit sleep analysis | sleep_duration | hours | nightly interval union | Preserve source/device and timezone |
| HealthKit step count | steps | count/day | sum | Deduplicate overlapping sources |
| Health Connect sleep session | sleep_duration | hours | nightly interval | Quality policy required |
| Health Connect steps | steps | count/day | sum | Source precedence policy required |

Do not assume all devices measure the same thing because labels match.

## 23. Duplicate and source-precedence policy

Multiple devices may write the same metric. The importer must not double-count Apple Watch + phone steps.

Create a versioned source-precedence policy per metric. Example concepts:

```ts
type SourcePrecedencePolicy = {
  metricType: string;
  version: string;
  preferredSourceClasses: string[];
  overlapResolution: "prefer_priority" | "merge_nonoverlap" | "reject_ambiguous";
};
```

The policy version belongs in the daily projection provenance.

## 24. Timezone and local-day rules

Sleep and activity are human-day metrics. Store source timestamps in UTC, but derive daily features using the person's effective local timezone at occurrence time.

Required tests:

- overnight sleep crossing midnight
- DST spring/fall transition
- travel to new timezone
- delayed import after timezone changed

## 25. Import command contract

```ts
type ImportHealthBatch = {
  sourceId: string;
  cursorBefore?: string;
  cursorAfter: string;
  records: Array<{
    sourceRecordId: string;
    nativeType: string;
    startAt: string;
    endAt?: string;
    value?: number;
    unit?: string;
    sourceDevice?: string;
    metadata?: Record<string, unknown>;
  }>;
};
```

Server behavior:

1. resolve authenticated person/tenant
2. verify source belongs to person and scope permits native type
3. validate/clamp batch size
4. normalize each record
5. idempotently append/write
6. persist cursor only after accepted batch transaction
7. schedule projection rebuild for affected local days

## 26. File-level future implementation map

```text
src/lib/external-data/source-registry.ts        NEW/shared
src/lib/external-data/measurement.ts            NEW/shared
src/lib/external-data/quality.ts                NEW/shared
src/lib/external-data/baseline.ts               NEW/shared
src/lib/integrations/health/apple-health.ts      NEW
src/lib/integrations/health/health-connect.ts    NEW
src/lib/integrations/health/normalization.ts     NEW
src/lib/clinical/evidence-adapters/wearable.ts   NEW
src/lib/clinical/attention-providers/wearable.ts NEW
src/app/member/settings/connected-data/*         NEW/extend
src/app/clinician/member/[id]/*                  EXTEND
src/lib/spine.ts                                 ADD event schemas
src/lib/projections.ts                           ADD projections/replay
src/lib/db.ts + scripts/pg-schema.sql            ADD mirrored schema
```

Exact paths must be updated after repo re-audit.

## 27. Observability

Operational metrics:

- connections by provider/state
- import success/failure count
- duplicate ratio
- data-lag hours
- daily projection failures
- quality-state distribution
- baseline availability rate
- attention-provider candidate count

No raw health values in general application telemetry.

## 28. Rollout cohorts

Suggested order:

1. internal synthetic users
2. staff test tenant with nonclinical data
3. clinician pilot with explicit participants
4. one enterprise tenant behind flag
5. broader rollout

Do not activate HRV merely because sleep/activity rollout succeeds.

## 29. Acceptance scenarios

### Scenario A - useful measured context
Patient shares 28 days of sleep and activity. Sleep falls for 6 nights with 6/7 coverage. Session Prep shows recent vs baseline, source and missing night. Command Center may show Review Today only if policy persistence threshold is met.

### Scenario B - no false signal from missing device
Patient stops wearing watch for 5 days. Coverage drops. UI shows source gap. No `sleep worsened` signal is generated.

### Scenario C - contradictory evidence
Patient reports sleeping better, device-derived duration decreases. Both appear with provenance. Steady does not resolve the contradiction automatically.

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
