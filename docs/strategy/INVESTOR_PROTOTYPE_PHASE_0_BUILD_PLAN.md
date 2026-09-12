# Steady Investor Prototype, Phase 0 Build Plan

Status: Active  
Owner: Founder and engineering  
Safety posture: Supervised prototype. No public or consumer release.

## 1. Outcome

Build a working demonstration that proves this chain:

Patient relationship -> longitudinal signal -> intervention response -> clinician action -> population insight -> future payer value

The demonstration must use the existing safety system as the deterministic floor. Clinical, privacy, security, and legal review gates remain in force. Autonomous bilateral stimulation and trauma reprocessing remain disabled.

## 2. Prototype audiences

| Audience | What the prototype must prove |
|---|---|
| Investors | The current patient relationship can become a defensible longitudinal platform |
| Clinicians | Patient history can support safe, explainable, supervised workflow |
| Security reviewers | Sensitive data paths, permissions, audit records, and feature flags can be inspected and tested |
| Design partners | The product can support a bounded cohort without requiring full payer infrastructure |
| Future payers | Steady is designing toward population ingestion, outcomes, utilization, and cost linkage |

## 3. Demonstration journey

1. A synthetic adult patient enrolls and grants versioned consent.
2. Screening, readiness, goals, preferences, and safety state are recorded.
3. The patient completes several weeks of simulated check-ins.
4. Steady records typed memories with source and correction history.
5. The patient receives stabilization and regulation activities.
6. Assignment, start, completion, abandonment, immediate response, and delayed response are recorded.
7. Steady proposes an evidence-linked pattern without presenting it as fact.
8. A clinician sees why the patient needs attention and what changed.
9. The clinician reviews evidence, records a decision, assigns an activity, and schedules follow-up.
10. A cohort view shows explainable dimensions across synthetic patients.
11. The system reconstructs the journey from source events.
12. Future payer screens use synthetic data and are labeled as demonstrations.

## 4. Work sequence

### P0.1, Repository baseline

- Keep the production dependency audit at zero high or critical findings.
- Make lint part of CI and bring the existing code to a passing baseline.
- Protect main with required safety, E2E, lint, build, and secret-scanning checks.
- Record the accepted baseline commit.
- Separate staging, demonstration, and future production configuration.

Exit: every pull request receives repeatable automated checks.

### P0.2, Retention map

Classify each current module as:

- retain
- refactor
- migrate
- replace
- retire
- demonstration-only

Start with identity, data access, audit, consent, safety, measures, memory, companion, sessions, clinician workflow, billing, and deployment.

Exit: no foundation work begins without a written disposition for current behavior.

### P0.3, Permanent architecture decisions

Create Architecture Decision Records for:

- person, account, organization, enrollment, and external identity
- tenant scope and access enforcement
- longitudinal event authority and projections
- shared provenance
- fact, observation, pattern, hypothesis, recommendation, and decision types
- consent and data-use purposes
- intervention and intervention-version semantics
- typed memory and correction
- AI gateway authority and structured outputs
- adapter contracts for EHR, FHIR, ADT, claims, eligibility, referrals, outcomes, and cost
- migration from the current schema

Exit: A cannot introduce a choice that blocks B through E without a recorded migration path.

### P0.4, Acceptance pack

Write tests and fixtures for:

- six-month simulated history
- event replay
- duplicate retries
- consent change and withdrawal
- memory correction and supersession
- safety transitions and re-entry
- intervention version history
- immediate and delayed response
- clinician review and override
- tenant isolation
- model and prompt replacement
- provenance completeness
- synthetic population views

Exit: the prototype has measurable completion gates before feature work starts.

## 5. First implementation slices

| Slice | Deliverable | Dependency |
|---|---|---|
| 1 | Clean CI baseline | None |
| 2 | Identity and tenant foundation | Architecture decisions |
| 3 | Longitudinal event envelope and provenance | Identity foundation |
| 4 | Versioned consent and data purposes | Identity and events |
| 5 | Typed memory with correction | Consent and provenance |
| 6 | Versioned intervention and response model | Events and provenance |
| 7 | Patient longitudinal timeline | Slices 2 through 6 |
| 8 | Supervised clinician panel | Patient timeline |
| 9 | Synthetic cohort view | Clinician data contracts |
| 10 | Guided investor demonstration | All prior slices |

Each slice receives its own pull request unless two changes cannot be safely reviewed separately.

## 6. Non-negotiable boundaries

- Generative AI does not clear safety states.
- Generative AI does not diagnose, prescribe, erase history, alter permissions, or authorize gated clinical activity.
- AI does not write directly to permanent records.
- Generated prose is not the durable evidence asset.
- Missing safety input never defaults favorably.
- Economic logic never overrides clinical safety.
- Real patient use requires the designated clinical, security, privacy, legal, and operational gates.
- Material safety changes require renewed clinical review.
- Synthetic payer demonstrations must not be presented as deployed payer capability.
- Outcome and savings language must remain a future hypothesis until measured.

## 7. Founder decision register

The founder must name or decide:

- first investor demonstration date
- guided demo versus investor sandbox
- first clinical design partner
- clinical product owner
- first supervised cohort boundary
- escalation ownership and after-hours language
- retained conversation policy and retention period
- managed authentication provider
- staging and hosting direction
- security review firm
- healthcare counsel
- clinical advisory panel
- budget and team structure

These decisions do not all block Phase 0, but unresolved items must have owners and due dates before supervised testing.

## 8. Definition of Phase 0 complete

Phase 0 is complete when:

- the repository baseline is green
- the current system has a retention map
- the permanent architecture decisions are accepted
- the demonstration journey is represented by fixtures and acceptance tests
- the first foundation slice is ready to implement
- clinical and security review boundaries are written
- no stakeholder must infer what is live, gated, synthetic, or future
