# 02 - Medication Support and Confirmation
## Future Engineering Handoff


> **STATUS: PARKED / DO NOT IMPLEMENT.** This document is a future implementation contract. It is intentionally detailed enough for later execution, but it does not authorize production data collection, clinical use, model deployment, or patient monitoring. Before coding, complete the activation gates in this document and reconcile the spec with the then-current Steady repository.


**Consumes:** 00 shared evidence rules; existing Steady notification/safety architecture after future repo re-audit.  
**Creates for later handoffs:** generic `ScheduledAction` / patient confirmation semantics, sensitive-notification policy, patient task-center conventions.  
**Handoff 03 must reuse these primitives rather than create a second scheduler.**

## 1. Product promise

Steady can help a patient keep track of a medication schedule, record what they explicitly confirm or skip, surface reported barriers, and prepare the clinician with accurate between-visit context.

This is medication support, not medication management or prescribing.

## 2. Clinical semantics

The central data-model choice is that a scheduled dose has three different observational outcomes:

- `confirmed_taken`
- `explicitly_skipped`
- `unconfirmed`

`unconfirmed` is not a missed dose.

Steady must never write `missed` merely because a reminder window passed without response.

## 3. Source authority

Medication regimen source states:

```text
patient_reported
clinician_documented
authorized_record_import
```

Review state:

```text
unreviewed
reviewed
corrected
ended
```

The GUI shows both.

## 4. Patient UX

### 4.1 Medication setup

If clinician-entered:

```text
YOUR RECORDED MEDICATION

Sertraline 50 mg
Every morning at 8:00 AM
Recorded by Dr. Lee on Sep 2

Would you like Steady to remind you?
[Yes, remind me]
[No reminders]
```

If patient-entered:

```text
ADD A MEDICATION YOU TAKE

Name [                ]
Dose [                 ]
When do you usually take it? [          ]

This will be marked as patient-reported until reviewed by your care team.
[Save]
```

### 4.2 Dose interaction

```text
8:00 AM
Sertraline 50 mg

[I took it]
[I skipped it]
[Remind me later]
```

After `skipped`:

```text
Want to say what got in the way? Optional.

[Forgot]
[Didn't feel well / side effect]
[Ran out]
[Chose not to take it]
[Other]

[Add a note]
[Done]
```

### 4.3 Unconfirmed behavior

Do not nag indefinitely.

The patient task closes after the configured window and becomes `unconfirmed`. The next screen should not shame the patient or show a broken streak.

## 5. Clinician GUI

### 5.1 Session Prep

```text
MEDICATION CONTEXT

Sertraline 50 mg daily
Source: patient-reported
Clinician reviewed Aug 22

Since last session
Confirmed taken     9
Explicitly skipped  2
Unconfirmed         3

Patient-reported barriers
Aug 29 - nausea
Sep 1  - ran out

New since last visit
Patient reported starting melatonin; not yet reviewed

[Open medication timeline]
```

### 5.2 Patient medication timeline

```text
SEP 1  Sertraline 50 mg   explicitly skipped   ran out
SEP 2  Sertraline 50 mg   confirmed taken
SEP 3  Sertraline 50 mg   unconfirmed
```

Do not label the third row `missed`.

### 5.3 Command Center

```text
Review Today
Medication follow-up

Patient explicitly skipped 2 scheduled doses and reported nausea.
No medication recommendation generated.

[Review patient]
```

## 6. General scheduler dependency

Handoff 02 should produce a reusable scheduled-action primitive.

```ts
type ScheduledAction = {
  id: string;
  tenantId: string;
  personId: string;
  actionType: "medication_dose" | "assigned_practice" | "checkin" | "custom";
  sourceObjectId: string;
  dueAt: string;
  expiresAt?: string;
  state: "scheduled" | "confirmed" | "explicitly_skipped" | "unconfirmed" | "cancelled";
  privacyLabel: "generic" | "sensitive";
  notificationPolicyId?: string;
};
```

Handoff 03 uses the same scheduler for assignment reminders where that behavior fits. It may extend `actionType`; it may not fork a second reminder subsystem.

## 7. Workflow

```text
REGIMEN CREATED / IMPORTED
       |
       v
SOURCE + REVIEW STATE
       |
       v
SCHEDULE EXPANDED INTO DOSE WINDOWS
       |
       v
ScheduledAction created
       |
       +--> reminder (if opted in)
       |
       +--> confirmed taken
       |
       +--> explicitly skipped -> optional reason
       |
       +--> no response -> unconfirmed
       |
       v
Medication event projection
       |
       v
Session Prep / Timeline
       |
       +--> deterministic follow-up provider
       |
       v
Optional Command Center review item
```

## 8. Database schema

```sql
CREATE TABLE medication_regimens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  medication_name_encrypted TEXT NOT NULL,
  dose_text_encrypted TEXT,
  route_text_encrypted TEXT,
  schedule_json_encrypted TEXT NOT NULL,
  source_class TEXT NOT NULL,
  source_id TEXT,
  review_state TEXT NOT NULL,
  active INTEGER NOT NULL,
  started_on TEXT,
  ended_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scheduled_actions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  source_object_id TEXT NOT NULL,
  due_at TEXT NOT NULL,
  expires_at TEXT,
  state TEXT NOT NULL,
  privacy_label TEXT NOT NULL,
  notification_policy_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX scheduled_actions_due
ON scheduled_actions(tenant_id, person_id, state, due_at);

CREATE TABLE medication_dose_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  regimen_id TEXT NOT NULL,
  scheduled_action_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  observation_state TEXT NOT NULL,
  patient_reason_code TEXT,
  patient_note_encrypted TEXT,
  observed_at TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE notification_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  quiet_hours_json TEXT,
  sensitive_content_allowed INTEGER NOT NULL DEFAULT 0,
  snooze_rules_json TEXT NOT NULL,
  active INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

Medication name and dosage are PHI and should follow the current encrypted-content pattern unless the future architecture deliberately changes that governance model.

## 9. Event contracts

- `medication.regimen_recorded.v1`
- `medication.regimen_reviewed.v1`
- `medication.regimen_corrected.v1`
- `medication.regimen_ended.v1`
- `scheduled_action.created.v1`
- `scheduled_action.confirmed.v1`
- `scheduled_action.explicitly_skipped.v1`
- `scheduled_action.unconfirmed.v1`
- `medication.barrier_reported.v1`

### Correction example

If a patient says the dose was entered incorrectly, append a correction event and superseding regimen state. Do not edit historical confirmation events to make them look like they referred to a different dose at the time.

## 10. Reminder orchestration

The scheduler should be general and support:

- timezone
- DST
- quiet hours
- snooze
- channel availability
- sensitive notification text policy
- cancellation when regimen changes
- offline/mobile delivery retry
- duplicate prevention

### Lock-screen privacy

Default notification:

> You have a Steady reminder.

Only show medication name/dose when patient explicitly chooses sensitive lock-screen content.

## 11. Medication regimen changes

Cases:

- patient reports new medication
- clinician confirms existing patient report
- dose changes
- medication discontinued
- PRN medication
- schedule changes
- temporarily held by clinician (if entered through authorized workflow)

The model should not infer any of these from conversation alone into the active regimen without the feature's confirmation/review rules.

## 12. PRN design

PRN is not a scheduled missed/confirmed model.

Represent separately:

```ts
type PrnMedicationUse = {
  regimenId: string;
  personId: string;
  usedAt: string;
  patientReportedReason?: string;
  patientReportedEffect?: string;
};
```

No `expected dose` means no `unconfirmed` interval.

## 13. Session Prep adapter

```ts
type MedicationPrep = {
  activeRegimens: Array<{
    regimenId: string;
    display: string;
    sourceClass: string;
    reviewState: string;
  }>;
  sinceLastSession: {
    confirmed: number;
    explicitlySkipped: number;
    unconfirmed: number;
  };
  barriers: EvidenceRef[];
  changesAwaitingReview: EvidenceRef[];
  limitations: string[];
};
```

Do not headline `85% adherence` because that collapses unconfirmed into a false denominator.

## 14. Response Fingerprint integration

Medication can be context in a time window.

Allowed:

> Sleep worsened during a week that also contained two explicitly skipped doses.

Not allowed:

> Missing medication caused the sleep worsening.

Medication is not treated as just another wellness intervention in the Fingerprint unless clinical governance explicitly defines a medication-response layer later.

## 15. Recovery Trajectory integration

Medication regimen change can be shown as a rail event, not a numerical axis.

Example:

```text
Symptoms lane  ---------o---o----o
Sleep lane     ------o---o----o--
Care rail              ^ med change
```

Source/review state must be visible.

## 16. Command Center provider

Candidate deterministic review reasons:

- clinician follow-up date reached
- patient explicitly skipped configured number of doses within policy window
- patient reported medication barrier such as supply issue
- patient reported concerning adverse effect requiring ordinary clinician review
- patient-reported regimen change awaits clinician review

Safety-relevant symptoms still route through existing safety policy; this feature does not invent a medication-specific crisis engine.

## 17. AI Gateway tasks

Potential low-risk tasks:

- `medication.barriers.summarize`
- `medication.session_prep.compose` (only if deterministic composition is insufficient)

Allowed output:

- concise barrier summary
- candidate clinician question

Prohibited:

- dose change
- stop/start instruction
- interaction advice
- efficacy judgement
- noncompliance label

## 18. API surface

```text
POST /api/member/medications
POST /api/member/medications/:id/reminders
POST /api/member/scheduled-actions/:id/confirm
POST /api/member/scheduled-actions/:id/skip
POST /api/member/scheduled-actions/:id/snooze
GET  /api/member/medications
GET  /api/clinician/member/:id/medications
POST /api/clinician/member/:id/medications/:regimenId/review
POST /api/clinician/member/:id/medications/:regimenId/correct
```

## 19. Failure states

- reminder delivery failed -> do not mark dose unconfirmed until action window policy independently expires
- patient offline -> normal unconfirmed state
- regimen changed mid-day -> cancel future old scheduled actions, retain prior
- duplicate tap -> idempotent confirmation
- wrong timezone -> correction event and schedule regeneration
- patient removes medication -> preserve history, end active state
- notification service down -> clinical record remains correct; do not invent missed doses

## 20. Security/privacy

- medication data encrypted per current PHI policy
- no medication name in analytics
- no medication name on lock screen by default
- tenant-scoped regimen and action writes
- patient can disable reminders without deleting regimen
- clinicians see only authorized patient medication context

## 21. Testing matrix

- timezone/DST
- same dose confirmation twice
- skipped with reason
- no response -> unconfirmed
- regimen corrected
- PRN behavior
- notification failure
- cross-tenant action ID attack
- withdrawn clinician access
- historical Session Prep cutoff
- Command Center threshold without false `missed`

## 22. Implementation phases

### Phase 0 - Clinical and legal boundary review
Define what Steady can display vs advise.

### Phase 1 - Regimen + provenance
No reminders yet.

### Phase 2 - General ScheduledAction primitive
Build it feature-agnostic enough for Handoff 03.

### Phase 3 - Patient confirmation GUI
Taken / skipped / unconfirmed.

### Phase 4 - Notification orchestration
Privacy-safe default.

### Phase 5 - Clinician view + Session Prep

### Phase 6 - Command Center provider

### Phase 7 - Optional authorized-record import
Separate integration governance.

## 23. Definition of Done before Handoff 03 may consume scheduler primitives

- `ScheduledAction` supports sensitive and nonsensitive action types.
- Confirmation is idempotent.
- Unconfirmed is preserved as its own state.
- Notification scheduler has quiet hours/timezone/privacy behavior.
- Action lifecycle is event-backed.
- Patient task GUI is reusable.
- Medication-specific content is not embedded in the generic scheduler.


## 24. Regimen state machine

```text
UNREVIEWED_PATIENT_REPORT
      | clinician confirms
      v
ACTIVE_REVIEWED
      | correction
      v
ACTIVE_CORRECTED
      | end/discontinue record
      v
ENDED
```

A new regimen version can supersede an old one. Historical dose confirmations stay linked to the regimen version active at the time.

## 25. Schedule expansion rules

The schedule expander creates future `ScheduledAction` windows for a bounded horizon, not years of rows.

Suggested behavior:

- expand 7-14 days ahead
- replenish idempotently
- cancel future actions when regimen ends/changes
- preserve past actions
- PRN excluded from expansion

## 26. Notification state machine

```text
PENDING
 -> QUEUED
 -> SENT
 -> DELIVERY_UNKNOWN / DELIVERED (if provider supports)
 -> SNOOZED -> QUEUED
 -> CANCELLED
```

Notification delivery state is operational. It must not mutate the clinical observation state of the dose.

## 27. Patient task-center integration

This handoff should create a reusable shell:

```text
TODAY IN STEADY

Medication reminder       8:00 AM
[Open]

Daily check-in            Anytime today
[Start]

Assigned practice         Before Sep 8
[Open]
```

Handoff 03 adds assigned-practice cards to this same surface.

## 28. Clinician correction UX

```text
CORRECT MEDICATION RECORD

Current recorded entry
Sertraline 50 mg every morning
Source: patient-reported Aug 20

Correction
Dose should be 25 mg beginning Aug 27

[Save correction]

This preserves the prior record and adds a corrected version.
```

## 29. File-level future implementation map

```text
src/lib/scheduling/actions.ts                 NEW/shared
src/lib/scheduling/notifications.ts           NEW/shared
src/lib/medications/regimens.ts               NEW
src/lib/medications/schedule-expander.ts      NEW
src/lib/medications/evidence.ts               NEW
src/lib/clinical/evidence-adapters/meds.ts     NEW
src/lib/clinical/attention-providers/meds.ts   NEW
src/app/member/today/*                         NEW/extend shared task center
src/app/member/settings/notifications/*        EXTEND
src/app/clinician/member/[id]/medications/*    NEW
src/lib/spine.ts                               ADD events
src/lib/projections.ts                         ADD regimen/action projections
```

## 30. Observability

Allowed metrics:

- scheduled actions created
- notification sends/failures
- confirmation-state counts without medication identity
- time from scheduled action to response
- regimen correction count
- Command Center provider candidate count

Do not log medication name/dose or patient reason text.

## 31. Acceptance scenarios

### Scenario A - no-response is honest
Three dose windows pass. Patient confirms two and does not respond to one. Session Prep says 2 confirmed, 0 explicitly skipped, 1 unconfirmed. It does not say 67% adherent.

### Scenario B - regimen correction
Clinician corrects dose effective yesterday. Old event remains. Future scheduled actions use corrected version. Historical confirmations remain linked to prior version when appropriate.

### Scenario C - notification outage
Push provider is down. Actions still exist. No doses are marked skipped. Operational alert may fire for notification service, not patient clinical alert.

## 32. Release acceptance checklist

- [ ] generic scheduler has no medication-specific assumptions
- [ ] lock-screen privacy default tested
- [ ] PRN tested separately
- [ ] patient and clinician correction flows tested
- [ ] historical Session Prep cutoff tested
- [ ] notification outage cannot fabricate adherence data
- [ ] Command Center reasons use explicit patient observations only

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
