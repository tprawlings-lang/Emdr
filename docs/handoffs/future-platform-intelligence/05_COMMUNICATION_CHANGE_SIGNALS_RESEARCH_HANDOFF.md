# 05 - Communication Change Signals
## Future Research and Engineering Handoff


> **STATUS: PARKED / DO NOT IMPLEMENT.** This document is a future implementation contract. It is intentionally detailed enough for later execution, but it does not authorize production data collection, clinical use, model deployment, or patient monitoring. Before coding, complete the activation gates in this document and reconcile the spec with the then-current Steady repository.


**Consumes:** Handoff 01 source/quality/baseline contracts where applicable, Handoff 04 granular consent/retention/transparency patterns, ADR 0012 AI Gateway, Session Prep evidence rules, Command Center non-safety distinction.  
**Default release posture:** research-only.  
**This handoff deliberately does NOT specify a production diagnostic vocal biomarker.**

## 1. Product hypothesis

Patient-authorized text or deliberate voice samples may contain measurable communication features whose change over time can provide useful context to a clinician when compared with the same patient's prior samples.

The feature is about **change in communication**, not mind-reading.

## 2. Why the source research is narrowed

The research proposed sentiment analysis and depression/anxiety vocal scores. Those ideas carry substantial validation, bias and overinterpretation risk.

Steady's future design should not present a model-generated `depression score 0.82` or `anxiety score 0.61` as clinical evidence.

Instead:

- measure constrained features
- use personal baseline
- surface quality and limitations
- require explicit consent
- keep outputs model-derived
- use clinician review

## 3. Hard prohibitions

- depression score from voice
- anxiety score from voice
- emotion label as clinical fact
- personality inference
- deception detection
- facial emotion recognition
- covert recording
- background microphone
- session recording without explicit workflow and legal approval
- safety escalation from acoustic features alone
- demographic inference from voice

## 4. Candidate source types

### Text

- patient journal text submitted inside Steady
- patient reflections
- authorized Companion messages according to existing visibility rules
- response to standardized patient prompt

### Voice

- deliberate voice journal
- deliberate voice response to a prompt

Not in scope:

- clinician Thoughts audio as a signal about patient state
- passive ambient capture

## 5. Separate consent scopes

A patient may:

- record voice with transcription but no feature analysis
- allow feature analysis but not raw audio retention
- allow text use for Session Prep but not model-based communication change analysis

Consent must support those distinctions.

## 6. Patient UX

### 6.1 Voice reflection

```text
OPTIONAL VOICE REFLECTION

You can record a short reflection instead of typing.

Voice processing options
(o) Transcribe only
( ) Transcribe + compare communication features over time

If you allow change analysis, Steady may compare features such as
speaking rate and pauses with your own previous recordings.

Steady will not diagnose you from your voice.

[Record]
[Cancel]
```

### 6.2 Review collected data

```text
VOICE REFLECTION - SEP 3

Transcript stored: Yes
Raw audio retained: No - deleted after processing
Change analysis: Enabled

Features stored
- speaking rate
- pause frequency
- recording quality

[See how these are used]
[Delete eligible data]
```

## 7. Clinician UX - Session Prep only at first

```text
COMMUNICATION CHANGE - RESEARCH PILOT

Voice reflections: 4 available samples
Recording quality: adequate

Speaking rate
Lower than this person's prior available samples

Pause frequency
Higher than prior available samples

Patient report
Also described low energy this week

Steady Noticed
These changes occurred during the same period.
They do not establish mood state or diagnosis.

[View method]
[View authorized source]
```

A clinician should be able to dismiss the entire card if it is unhelpful.

## 8. No independent Command Center authority at initial release

At research/read-only stage:

- communication change may be supporting evidence on an existing patient review
- it may not independently create `Needs Attention`
- it may not change safety state
- it may not change Therapeutic Load recommendation

A later independent provider requires a separate clinical validation decision and a new ADR or equivalent governance artifact.

## 9. Workflow

```text
PATIENT SUBMITS DELIBERATE SAMPLE
      |
      v
CONSENT SCOPE CHECK
      |
      v
RAW SOURCE GOVERNANCE
      |
      +--> transcript only
      +--> permitted feature extraction
      |
      v
QUALITY CHECK
      |
      +--> inadequate -> no change analysis
      |
      v
FEATURE EXTRACTION
      |
      v
personal baseline / prior-sample comparison
      |
      v
model-derived CommunicationChange
      |
      v
Session Prep read-only card
      |
      v
clinician usefulness feedback
```

## 10. Architecture boundaries

```text
source capture
   -> encrypted source / temporary object store
   -> transcription task
   -> feature extractor
   -> quality gate
   -> baseline comparator
   -> presentation summarizer
```

Do not use one unconstrained LLM prompt to perform the entire chain.

## 11. Data model

Reuse ExternalSource/PersonalBaseline concepts where they fit, but voice/text source retention needs its own governed tables.

```sql
CREATE TABLE communication_samples (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  sample_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  consent_scope_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  encrypted_text TEXT,
  encrypted_audio_ref TEXT,
  raw_audio_retention_state TEXT NOT NULL,
  quality_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE communication_features (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  sample_id TEXT NOT NULL,
  feature_type TEXT NOT NULL,
  numeric_value REAL,
  unit TEXT,
  quality_state TEXT NOT NULL,
  extractor_name TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE communication_change_results (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  feature_type TEXT NOT NULL,
  baseline_ref TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  change_state TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 12. Candidate acoustic features

Only after validation of measurement reliability:

- speaking rate
- pause frequency
- pause duration
- response latency to standardized prompt
- pitch variability
- amplitude variability

These are acoustic features, not psychiatric states.

## 13. Candidate text features

Safer first candidates:

- explicit patient-reported statements already visible to clinician
- topic recurrence
- self-described sleep/energy change
- change in word count/response length under standardized prompts
- linguistic features validated for within-person comparison

Avoid generic positive/negative sentiment meter as the clinical product.

## 14. Quality gate

No feature comparison when:

- background noise too high
- sample too short
- microphone clipping
- different language from baseline without validated policy
- source format incompatible
- speaking task not comparable

Quality failures are shown as `insufficient`, not a neutral score.

## 15. Bias and fairness evaluation

Before clinician-facing pilot, evaluate at minimum:

- accents
- primary language
- age groups
- speech disability
- stutter/dysfluency
- neurodivergent communication
- recording hardware
- environment noise
- illness affecting voice

The evaluation question is not merely accuracy. It is whether feature measurement is stable enough across groups and contexts to make a within-person change display trustworthy.

## 16. AI Gateway tasks

Potential tasks:

```text
communication.transcribe
communication.text_features.extract
communication.change.summarize
```

Acoustic feature extraction may use a non-LLM model/service but still needs version/provenance registration and PHI governance.

Every task stores:

- model/extractor version
- task/prompt version
- source evidence IDs
- output schema version
- quality state
- limitations

## 17. Safety separation

Explicit patient text such as a direct self-harm statement can route through Steady's existing deterministic/text safety system because of the statement itself.

Acoustic pattern such as slower speech cannot independently trigger crisis routing.

The two pathways must remain structurally separate.

## 18. Retention design

Preferred voice path:

```text
record -> encrypted temporary object -> transcribe/extract -> verify -> delete raw audio
```

Raw audio retention should be opt-in or specifically clinically justified, not the default.

Store deletion receipt/state.

If transcript is retained, it follows its own patient-content retention policy.

## 19. Patient deletion / correction

Patient may be allowed to delete optional voice source according to policy. Derived features linked only to deleted source must follow the approved derived-data retention/deletion policy; do not leave an orphaned inference with no inspectable source unless governance explicitly permits it.

## 20. Clinician usefulness feedback

Research pilot should collect:

```text
Was this card useful for preparing this session?
[Useful] [Not useful] [Misleading]
Optional comment
```

This is evaluation feedback, not acceptance of clinical truth.

## 21. Research metrics

Measure:

- source opt-in rate
- sample completion rate
- quality pass rate
- clinician useful/not-useful/misleading labels
- rate of card dismissal
- false narrative reports
- group/device quality disparities
- percentage of summaries with fully resolving evidence

Do not optimize for how many alerts are generated.

## 22. API surface

Research-stage examples:

```text
POST /api/member/communication/voice
POST /api/member/communication/text-reflection
GET  /api/member/communication/samples
DELETE /api/member/communication/samples/:id   (if policy permits)
GET  /api/clinician/member/:id/communication-change
POST /api/clinician/member/:id/communication-change/:id/feedback
```

## 23. Failure states

- transcription failure
- extractor failure
- poor audio
- unsupported language
- patient revokes analysis consent
- raw object deletion fails
- model summary uncitable
- feature drift after extractor update
- microphone change causes false shift

Each must have explicit product behavior.

## 24. Version migration

Never compare an old extractor's numeric value to a new extractor's value as though the scale were unchanged unless validated.

On extractor version change:

- start a new comparison lineage, or
- backprocess historical source if policy allows and record that it was reprocessed

## 25. Test corpus

Use synthetic/de-identified/public research corpora for engineering tests. Production patient samples are not test fixtures.

Required cases:

- identical voice, different microphone
- noise change
- speaking-rate change with same content
- very short sample
- multilingual switch
- stutter/dysfluency
- consent revoked before processing finishes
- raw audio deletion
- historical cutoff
- uncited summary suppression

## 26. Future phases

### Phase 0 - External evidence review and clinical research protocol
No product code required beyond prototypes isolated from production.

### Phase 1 - Text-only research
No patient-facing clinical claim.

### Phase 2 - Voice capture/transcription without change analysis
Prove consent, retention, deletion, quality.

### Phase 3 - Offline feature extraction evaluation
No clinician surface.

### Phase 4 - Research-tenant Session Prep card
Read-only, no Command Center authority.

### Phase 5 - Prospective clinician usefulness and bias review

### Phase 6 - Decision gate
Options: stop, continue research, or write a new production-readiness ADR.

## 27. Production-readiness gate

This handoff alone is insufficient to authorize full production. Before any independent clinical workflow authority, require:

- validated measurement reliability
- acceptable bias/quality performance
- patient acceptability evidence
- clinician usefulness evidence
- privacy/security review
- legal/regulatory review appropriate to intended claim
- clearly defined allowed wording
- new Command Center provider policy if needed

## 28. Definition of Done for this deferred handoff

The future engineering team can build a safe research pilot without inventing architecture, but the document explicitly blocks diagnostic scoring and independent safety/urgency authority until separate validation approves it.


## 29. Research architecture separation

Keep research models isolated from production clinical authority.

Suggested environment boundary:

```text
production source capture (only if approved)
        |
        +--> clinically required transcript path
        |
        +--> research copy only under explicit research/feature consent
                 |
                 v
           research evaluator
                 |
                 v
        offline metrics / clinician study
```

Do not quietly turn a research model into a production attention provider.

## 30. Evaluation dataset registry

Create a registry for every extractor/model evaluation:

```ts
type EvaluationDataset = {
  id: string;
  version: string;
  source: string;
  consentOrLicense: string;
  languages: string[];
  demographicCoverage: Record<string, string>;
  recordingConditions: string[];
  knownLimitations: string[];
};
```

No claimed performance without naming the dataset/version and intended population.

## 31. Model card requirements

For each acoustic/text extractor document:

- intended use
- prohibited use
- input requirements
- languages
- recording quality requirements
- training/evaluation source
- performance by relevant subgroup where available
- failure modes
- calibration limitations
- version
- rollback version

## 32. Clinician pilot GUI feedback

```text
Was this communication-change card useful?
[Useful]
[Not useful]
[Misleading]

Why? Optional
[Change was already obvious]
[Source quality looked poor]
[Interpretation felt too strong]
[Other]
```

`Misleading` is a first-class evaluation outcome and should be monitored.

## 33. File-level future implementation map

```text
src/lib/communication/source.ts                  NEW
src/lib/communication/retention.ts               NEW
src/lib/communication/features.ts                NEW
src/lib/communication/quality.ts                 NEW
src/lib/communication/change.ts                  NEW
src/lib/ai-gateway/tasks/communication/*          NEW
src/lib/clinical/evidence-adapters/communication.ts NEW
src/app/member/reflections/voice/*                FUTURE
src/app/clinician/member/[id]/*                   RESEARCH CARD
research/communication/evaluations/*              NEW artifacts
```

## 34. Observability and research metrics

Keep operational and evaluation telemetry separate.

Operational:
- upload/transcription failure
- deletion job failure
- processing latency
- quality rejection rate

Evaluation:
- clinician useful/not useful/misleading
- subgroup quality-pass rate
- extractor disagreement
- version drift

Never send raw audio/text to ordinary analytics.

## 35. Acceptance scenarios

### Scenario A - poor microphone
Patient records in loud room. Quality gate fails. No speaking-rate change card is shown.

### Scenario B - valid within-person change
Four standardized voice reflections meet quality rules. Speaking rate changes relative to the same-person baseline. Session Prep research card describes the measured change and limitations, no diagnosis.

### Scenario C - explicit risk language
Transcript contains a direct safety statement. Existing safety pathway responds based on the statement. Acoustic features remain irrelevant to the crisis decision.

### Scenario D - extractor upgrade
Version 2 produces different scale. Historical v1 values are not mixed until validated/reprocessed under explicit version lineage.

## 36. Stop criteria

Research should be stopped or redesigned if:

- clinician misleading rate is unacceptably high
- quality pass rate differs materially by subgroup/device without remediation
- patient acceptability is poor
- feature adds little information beyond explicit self-report
- privacy burden outweighs utility
- reliable within-person comparison cannot be demonstrated

A future feature is allowed to die. The existence of this handoff does not create an obligation to ship it.

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
