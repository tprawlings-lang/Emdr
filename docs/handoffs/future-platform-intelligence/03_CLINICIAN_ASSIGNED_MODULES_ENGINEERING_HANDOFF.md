# 03 - Clinician-Assigned Digital Therapeutic Modules
## Future Engineering Handoff


> **STATUS: PARKED / DO NOT IMPLEMENT.** This document is a future implementation contract. It is intentionally detailed enough for later execution, but it does not authorize production data collection, clinical use, model deployment, or patient monitoring. Before coding, complete the activation gates in this document and reconcile the spec with the then-current Steady repository.


**Consumes:** Handoff 02 `ScheduledAction`/notifications/task-center patterns; existing Steady module catalog, gating, session lifecycle, Return-to-Life, Response Fingerprint, Session Prep, Command Center.  
**Creates:** versioned clinician-assigned intervention framework and structured home-practice response stream.  
**Do not build a second module platform.**

## 1. Product promise

A clinician can assign an approved Steady practice or guided intervention between visits. The patient completes it in a low-friction interface. The run creates structured evidence that can feed Session Prep, Response Fingerprint, Return-to-Life, Recovery Trajectory and Command Center.

The system closes the loop around between-visit practice without turning homework completion into a compliance score.

## 2. Content lanes

Use explicit content governance.

```text
WELLNESS
- grounding
- breathing
- psychoeducation
- general journaling

CLINICIAN_ASSIGNED
- structured CBT exercise
- behavioral activation
- clinician-defined exposure preparation
- clinician-approved exposure practice
- trauma-related work only within existing safety/gating policy
```

A module can exist in both product catalogs only if the version/gating rules say so.

## 3. Module definition contract

```ts
type ModuleDefinition = {
  moduleId: string;
  version: string;
  title: string;
  category: string;
  clinicalLane: "wellness" | "clinician_assigned";
  expectedMinutes: number;
  requiredGates: string[];
  contraindicationRuleIds: string[];
  inputSchemaVersion: string;
  responseSchemaVersion: string;
  outcomeMeasureIds: string[];
  contentOwner: string;
  clinicalReviewId: string;
  state: "draft" | "approved" | "retired";
};
```

The existing Steady module definitions should be migrated/extended to this shape if needed. Do not duplicate the catalog.

## 4. Clinician UX - assignment

```text
ASSIGN BETWEEN-VISIT PRACTICE

Search [ grounding                         ]

Grounding: 5-4-3-2-1
5 min | Wellness
Goal fit: regulation / present-moment orientation

[Preview patient experience]
[Assign]

Assignment options
Due / review date        [ Sep 8 ]
Reminder                 [ On ]
Link to Return-to-Life   [ Grocery shopping ]
Collect before/after     [ Distress ]
Clinician note           [___________________]

[Assign to Sarah]
```

The clinician must preview exactly what the patient will see.

## 5. Patient UX - task center

Reuse Handoff 02 task-center/scheduler visual conventions.

```text
YOUR PRACTICE

Grounding: 5-4-3-2-1
About 5 minutes
Assigned by Dr. Lee
Review date Sep 8

[Start practice]
[Not now]

You can stop at any time.
```

No streaks by default. No red overdue badge implying failure.

### During run

```text
Step 2 of 5
Notice four things you can physically feel.

[Back]
[Continue]
[Stop practice]
```

### Completion

```text
Practice complete

Before: distress 6/10
Right now: [ 3 ]

Did this feel useful?
[Yes] [Not sure] [No]

Anything you want your clinician to know? Optional
[____________________]

[Finish]
```

## 6. Assignment lifecycle

```text
DRAFT (clinician UI only)
   -> ASSIGNED
   -> AVAILABLE
   -> STARTED
   -> COMPLETED
      | STOPPED_BY_PATIENT
      | HARD_STOPPED_BY_POLICY
      | EXPIRED / CLOSED_BY_CLINICIAN
```

An assignment can have multiple runs if configured. Assignment state and run state are separate.

## 7. Workflow

```text
APPROVED MODULE VERSION
        |
        v
CLINICIAN ASSIGNS
        |
        v
ScheduledAction / reminder (reuse Handoff 02)
        |
        v
PATIENT STARTS
        |
        v
PRE-RUN GATE / CHECK
        |
        +--> blocked -> show safe alternative / clinician review path
        |
        v
RUN STEPS
        |
        +--> patient stop
        +--> deterministic hard stop
        |
        v
POST-RUN RESPONSE
        |
        v
intervention.response_recorded
        |
        +--> Response Fingerprint
        +--> Return-to-Life evidence link
        +--> Recovery Trajectory care rail
        +--> Session Prep
        +--> optional Command Center provider
```

## 8. Database schema

```sql
CREATE TABLE intervention_module_definitions (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  clinical_lane TEXT NOT NULL,
  expected_minutes INTEGER NOT NULL,
  required_gates_json TEXT NOT NULL,
  contraindication_rules_json TEXT NOT NULL,
  input_schema_version TEXT NOT NULL,
  response_schema_version TEXT NOT NULL,
  outcome_measure_ids_json TEXT NOT NULL,
  content_owner TEXT NOT NULL,
  clinical_review_id TEXT NOT NULL,
  state TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(id, version)
);

CREATE TABLE intervention_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  module_version TEXT NOT NULL,
  assigned_by_person_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  review_due_at TEXT,
  linked_goal_id TEXT,
  reminder_policy_id TEXT,
  collection_config_json TEXT NOT NULL,
  clinician_instruction_encrypted TEXT,
  state TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE intervention_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  assignment_id TEXT,
  module_id TEXT NOT NULL,
  module_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  gate_snapshot_json TEXT NOT NULL,
  stop_reason_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE intervention_run_responses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  response_schema_version TEXT NOT NULL,
  structured_response_json TEXT NOT NULL,
  encrypted_free_text TEXT,
  recorded_at TEXT NOT NULL
);
```

## 9. ScheduledAction reuse

Assignment reminders use the generic Handoff 02 scheduler:

```text
action_type = assigned_practice
source_object_id = intervention_assignment.id
```

The module feature supplies task title only to the in-app task center. Lock-screen text follows patient notification privacy settings.

## 10. Gating architecture

Do not reimplement safety logic inside module components.

The module run asks the existing gate layer:

```ts
type ModuleGateDecision = {
  allowed: boolean;
  decisionId: string;
  policyVersion: string;
  reasonCodes: string[];
  permittedAlternativeModuleIds: string[];
};
```

The model cannot invoke or override this decision.

## 11. Event contracts

- `intervention.assignment_created.v1`
- `intervention.assignment_updated.v1`
- `intervention.assignment_closed.v1`
- `intervention.started.v1`
- `intervention.completed.v1`
- `intervention.stopped.v1`
- `intervention.hard_stopped.v1`
- `intervention.response_recorded.v1`
- `intervention.goal_evidence_linked.v1`

Each run event references module version and assignment ID.

## 12. Response Fingerprint adapter

This handoff is a major data producer for the Fingerprint.

For every eligible run, create a typed intervention instance:

```ts
type FingerprintInterventionInstance = {
  interventionType: string;
  moduleId: string;
  moduleVersion: string;
  runId: string;
  context: string[];
  preState?: Record<string, number>;
  postState?: Record<string, number>;
  delayedResponse?: Record<string, unknown>;
  usefulness?: "helpful" | "mixed" | "not_helpful" | "unknown";
  evidenceIds: string[];
};
```

Do not equate completion with benefit.

## 13. Return-to-Life linkage

A clinician can link an assignment to a functional goal.

Example:

```text
Goal: Grocery shop independently
Assignment: grounding before entering store
Run: completed 5-minute grounding
Patient reported: entered store for 20 minutes, distress 7 -> 4
```

The module produces goal evidence. It does not automatically advance the goal milestone unless the Return-to-Life rules accept that evidence.

## 14. Session Prep

Suggested section:

```text
BETWEEN-VISIT PRACTICE

Grounding 5-4-3-2-1
Assigned Sep 3
Completed 3 runs
Latest: distress 6 -> 3; patient marked helpful
One run stopped early Sep 5

Linked goal: Grocery shopping
New functional evidence available

[Open runs]
```

## 15. Command Center provider

Possible review items:

- repeated hard stops
- patient says assigned practice made symptoms worse
- clinician-defined review date reached
- new meaningful goal evidence
- repeated attempts with no functional movement where policy says review, not `noncompliance`

No alert for merely not completing homework.

## 16. Content management GUI

Future internal/admin surface:

```text
MODULE CATALOG

Grounding 5-4-3-2-1    v3   Approved
CBT Thought Record      v2   Clinical review due
Exposure Preparation   v4   Approved / clinician assigned only

[View versions]
[Draft new version]
[Retire]
```

Publishing requires human clinical review ID.

## 17. Content version semantics

- Existing assignment remains tied to assigned version.
- New version does not mutate historical runs.
- Retired content can remain readable for historical evidence.
- Severe content defect may block future runs while preserving history.

## 18. AI Gateway role

Potential tasks:

- `module.library.search`
- `module.assignment_instruction.draft`
- `module.response.summarize`
- `module.candidate_suggest`

`candidate_suggest` returns candidates only. Clinician chooses.

Prohibited:

- autonomous assignment of clinician-lane content
- autonomous exposure progression
- generation of production therapeutic content
- bypassing gate
- interpreting completion as treatment success

## 19. API surface

```text
GET  /api/clinician/modules/catalog
GET  /api/clinician/modules/:id/:version/preview
POST /api/clinician/member/:id/assignments
PATCH /api/clinician/member/:id/assignments/:assignmentId
POST /api/member/assignments/:id/start
POST /api/member/runs/:id/respond
POST /api/member/runs/:id/stop
GET  /api/clinician/member/:id/interventions
```

## 20. Accessibility / low-cognitive-load requirements

- large tap targets
- progress indicator with remaining steps
- explicit stop
- plain language
- no forced long-form text
- save/resume only when clinically safe for module type
- screen reader labels
- no countdown pressure unless clinically required and reviewed

## 21. Failure states

- module retired after assignment -> policy decides allow existing vs block; never silently swap version
- reminder failure -> assignment remains valid
- patient loses connection mid-run -> locally preserve state only if mobile design safely supports it
- gate changes during run -> terminal safety policy defines action; do not let stale start decision rule forever
- AI summary fails -> structured response remains available
- free text fails encryption -> response save fails rather than store plaintext

## 22. Security/privacy

- free text encrypted
- module catalog non-PHI
- assignment/run patient-bound and tenant-scoped
- no raw journal content in analytics
- clinician preview permission audited as needed
- patient content not used for model development without separate governance

## 23. Test matrix

- assignment to foreign patient denied
- wrong module version
- retired module
- gate deny
- hard stop
- patient stop
- completion with missing post rating
- multiple runs
- linked Return-to-Life goal
- fingerprint adapter
- notification scheduler reuse
- AI disabled
- historical cutoff

## 24. Implementation phases

### Phase 0 - Catalog reconciliation
Map the then-current Steady modules into the versioned definition contract.

### Phase 1 - Assignment lifecycle
No new content required.

### Phase 2 - Scheduler/task-center reuse
Integrate Handoff 02 primitives.

### Phase 3 - Run engine + gate contract

### Phase 4 - Structured responses

### Phase 5 - Response Fingerprint + Return-to-Life adapters

### Phase 6 - Session Prep and clinician run history

### Phase 7 - Command Center provider

### Phase 8 - AI-assisted library workflow

### Phase 9 - Content expansion
Only through clinical governance.

## 25. Definition of Done before Handoff 04 begins

Handoff 04 does not technically require modules, but the program should not advance until the patient consent/task UX and existing intelligence adapters have proven that new between-visit data can be added without creating dashboard sprawl.

Required:

- no second module catalog
- versioned historical runs
- scheduler reuse
- gates authoritative
- patient stop works
- Fingerprint + Return-to-Life integration works
- Session Prep remains concise
- Command Center provider uses deterministic rules


## 26. Module execution contract

Each module version declares a step graph rather than relying on arbitrary component code for clinical sequence.

```ts
type ModuleStep = {
  id: string;
  kind: "instruction" | "rating" | "choice" | "text" | "timer" | "practice";
  next: string | Record<string, string>;
  canStop: boolean;
  dataSchema?: string;
};
```

Content rendering may vary by platform, but the versioned step graph and response schema define what the run means.

## 27. Run checkpoint rules

Checkpoint only when the module's clinical policy permits resume. Some exercises should restart rather than resume mid-state.

```ts
type ResumePolicy = "restart" | "resume_last_safe_step" | "no_resume";
```

This belongs to module definition/version.

## 28. Clinician assignment modification

Allowed after assignment:

- due/review date
- reminders
- clinician instructions
- goal link

Changing module version after patient has started should normally create a new assignment, not mutate the active run.

## 29. Evidence produced by a run

Keep separate:

- run completion fact
- patient pre/post rating
- patient usefulness report
- free-text reflection
- gate/hard-stop fact
- linked functional action

The Response Fingerprint can use these separately.

## 30. File-level future implementation map

```text
src/lib/modules/catalog.ts                       EXTEND existing
src/lib/modules/assignment.ts                    NEW
src/lib/modules/run-engine.ts                    NEW
src/lib/modules/content-schemas.ts               NEW
src/lib/modules/response.ts                      NEW
src/lib/scheduling/actions.ts                     REUSE H02
src/lib/clinical/evidence-adapters/intervention.ts EXTEND
src/lib/clinical/attention-providers/practice.ts  NEW
src/app/clinician/member/[id]/assign/*            NEW
src/app/member/today/*                            EXTEND H02 task center
src/app/member/practice/[assignmentId]/*          NEW
```

## 31. Module-library search GUI contract

Search filters:

- category
- expected duration
- clinical lane
- gate requirement
- linked treatment goal/domain
- approved/retired state

AI search may rank candidates but deterministic filters define eligibility.

## 32. Audit / provenance

Record:

- who assigned
- module/version
- why it was available under gate policy
- patient start/stop/complete
- hard-stop rule version
- response schema version
- clinician later review/adjustment

## 33. Observability

Allowed:

- assignment counts by module ID/version (not patient text)
- run start/complete/stop/hard-stop counts
- render errors
- gate deny rate
- reminder failures
- schema-validation failures

Do not use completion rate as a patient-performance metric in clinician priority.

## 34. Acceptance scenarios

### Scenario A - helpful practice
Clinician assigns grounding linked to grocery-shopping goal. Patient completes three runs, records lower distress, and later reports successful grocery trip. Fingerprint records intervention responses; Return-to-Life gets separate functional evidence.

### Scenario B - patient stops
Patient presses Stop on step 2. Run is `stopped`, not failed. Session Prep may show it if clinically material. No nonadherence alert.

### Scenario C - gate denies
Patient opens clinician-assigned processing exercise when current deterministic gate disallows it. Run never begins. Existing safe alternative is offered if policy permits. AI cannot override.

## 35. Release acceptance checklist

- [ ] catalog/version migration preserves existing modules
- [ ] clinician preview equals patient version
- [ ] patient can stop from every active step
- [ ] H02 scheduler reused
- [ ] gate snapshot stored
- [ ] free text encrypted
- [ ] Response Fingerprint adapter tested
- [ ] Return-to-Life link tested
- [ ] no completion-as-success logic

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
