# Steady Expansion Handoff

**Audience:** senior engineer and Claude Code
**Scope:** patient tool expansion, clinician (enterprise) layer, data platform, predictive model path, aesthetic system
**Location in repo:** `docs/handoff/STEADY_EXPANSION_HANDOFF.md`, alongside the existing `HANDOFF.txt`
**Status:** planning document. Nothing here overrides the existing skills (`emdr-fidelity`, `crisis-safety`, `access-authority`) or the v1 no-BLS constraint.

---

## 0. Read this first: non-negotiables

These rules outrank every feature in this document. If a task conflicts with one, stop and flag it.

1. **v1 remains a no-BLS build.** No new tool may render moving-target eye movement, bilateral tones, or tapping. BLS parameters stay null and fail closed until EMDRIA consultant sign-off flips the flag. Tools in this document are stabilization and measurement tools that surround the future BLS work, not substitutes for it.
2. **Deterministic rules stay authoritative.** The 30 crisis-safety rules and the 14-step access gate decide access, routing, and escalation. No model, clinician setting, or tool can suppress a safety rule. A model may only *add* a flag for human review, never remove one.
3. **No fabricated constants.** Every numeric parameter (durations, cadences, thresholds, breathing paces) must cite a published source and a fail-safe rationale, or be declared null and fail closed. This applies to new tools exactly as it applied to BLS.
4. **Every new tool needs advisor sign-off before it ships.** Tier 2 tools are being signed off by the two psychologists now. Every other tool in Section 3 needs its own row added to the Advisor Sign-Off Worksheet.
5. **Tools cannot write session state.** This is an open audit finding. New tools get read-only access and communicate through events (Section 5).
6. **No clinical labels on member surfaces.** Also an open audit finding. Members see plain-language names. Instrument names, diagnostic terms, and scores stay on clinician surfaces.
7. **Collect data for a stated purpose, not for volume.** See Section 2. This is a legal requirement in both target markets, not a style choice.

---

## 1. Phase 0: close the open audit findings before adding anything

Adding tools on top of known gaps multiplies the gaps. These five items block all other phases:

| Finding | Why it blocks expansion |
|---|---|
| Session termination logic gaps | Every new tool is a new session type that must terminate cleanly |
| Screener retake bypass | Scheduled measurement (Phase 3) depends on retake rules being enforced |
| Member choice offered at high distress | New tools increase the number of choice points; fix the rule once, centrally |
| Clinical labels visible to members | New content multiplies label surfaces; fix via the copy lint before content lands |
| Companion tools with write access to session state | The Tool Runtime (Section 5) is built on read-only access; this must be true first |

**Definition of done for Phase 0:** each finding has a regression test in CI that fails if the gap reopens.

---

## 2. Data strategy: the honest version

The goal of a predictive model is sound. "The more data we have, the better the model" is not, for three reasons the engineer needs to design around:

**A model needs labels, not volume.** Predicting deterioration or dropout requires outcome labels: repeated instrument scores over time, disengagement events, escalation events. Steady currently has zero production users by design, so there is no training data yet. The work now is to make every future data point *model-ready*, not to collect more of it.

**Data minimization is law in both markets.**
- GDPR Art. 9 treats health data as special category data. Art. 5(1)(c) requires collection to be limited to what is necessary for a stated purpose. "Might help a future model" is not a stated purpose. With Steady operating as a Spanish SL, this applies directly.
- GDPR Art. 35 requires a Data Protection Impact Assessment for large-scale processing of special category data. Plan one before Phase 5.
- HIPAA's minimum necessary standard (45 CFR 164.502(b)) applies once Steady handles PHI for covered entities under a BAA.

**A predictive model likely changes Steady's regulatory class.** Software that predicts an individual patient's risk of deterioration is likely medical device software under EU MDR Rule 11, which would make it high-risk under the EU AI Act (Art. 6(1), via Annex I). In the US, the same function needs to be assessed against FDA's Clinical Decision Support guidance. Get regulatory counsel before Phase 6 ships anything user-facing. Building the data layer and running offline research does not trigger this; deploying predictions does.

**What this means for the build:** every event carries a purpose code and a consent basis from day one. Research use is a separate, opt-in consent tier. Section 6 shows the schema.

---

## 3. Tool catalog

Each tool is defined as data in the Tool Registry (Section 5.2). Columns: what it is, the evidence anchor, the signal it produces, and its sign-off state.

### 3.1 Tier 2 (psychologist sign-off in progress)

| Tool | What the member does | Evidence anchor | Signal produced |
|---|---|---|---|
| Grounding | Guided orienting and 5-4-3-2-1 sensory grounding | Standard stabilization practice in phase-based trauma treatment | Pre/post distress rating (0 to 10), completion |
| Container | Imagines placing distressing material in a container to set it aside | EMDR resource development (Shapiro, 2018, *EMDR Therapy*, 3rd ed.) | Pre/post distress, completion |
| Calm place | Builds and revisits an imagined calm place | Same as above | Pre/post distress, completion |
| Self-compassion | Short practices addressing shame and self-criticism | Neff (2003); Gilbert, Compassion Focused Therapy (2009) | Pre/post rating, completion |
| Behavioral activation | Picks small valued activities, schedules them, logs completion | Wysa mediation study (JMIR, PMC10692879) identified behavioral activation as a candidate mechanism | Activities planned vs completed |
| Sleep support | Sleep routine guidance and a sleep diary | Sleep quality was a candidate mechanism in the same study | Diary entries: bedtime, wake, subjective quality |

### 3.2 Expanded patient tools (need sign-off rows)

Organized by the three ICD-11 Complex PTSD "disturbances in self-organization" domains (ICD-11 6B41), which gives clinicians a clear map of what Steady covers.

| Tool | Domain | What the member does | Evidence anchor | Signal produced |
|---|---|---|---|---|
| Daily check-in | Affect dysregulation | Places themselves on a window-of-tolerance band (too activated / settled / shut down) plus a 0 to 10 distress rating | Window of tolerance (Siegel, 1999); SUDS (Wolpe, 1969) | Daily state, the core longitudinal signal |
| Trigger log | Affect dysregulation | Logs what happened, body response, what helped | Ecological momentary assessment literature | Trigger categories, coping used, time of day |
| Early warning plan | Affect dysregulation | Lists personal warning signs and what to do at each level | Relapse prevention planning | Plan exists, last updated |
| Safety plan | Crosses all domains | Structured personal safety plan | Stanley and Brown Safety Planning Intervention (2012) | Plan exists, last reviewed. **Integrates with `crisis-safety`; plan contents never feed a model** |
| Shame and inner critic | Negative self-concept | Extends self-compassion into longer lessons | CFT (Gilbert) | Pre/post rating |
| Values compass | Negative self-concept | Identifies personal values, links to activation planner | ACT values work (Hayes et al.) | Values selected, linked activities |
| Relationships and boundaries | Relationship disturbance | Psychoeducation and practice scripts for boundaries and trust | Skills training component of STAIR (Cloitre et al.) | Completion, self-rating |
| Irritability and anger | Affect dysregulation | Recognize escalation, cool-down practices | CBT for anger | Pre/post rating |
| Understanding my reactions | All three | Psychoeducation lessons in plain language, no diagnostic labels | ICD-11 6B41 description | Lesson completion |
| Progress view | All three | Member sees their own check-in trends in plain language | Measurement-based care | View events only |

### 3.3 Supervised-mode only (never self-guided)

| Tool | Why supervised only |
|---|---|
| Nightmare rescripting (Imagery Rehearsal Therapy, Krakow et al., 2001) | Requires engaging with nightmare content, which is trauma-memory adjacent |
| Written exposure or trauma narrative work | Direct trauma-memory processing |

### 3.4 Deferred

| Item | Reason |
|---|---|
| BLS / eye movement tools | Gated on EMDRIA consultant sign-off |
| Passive wearable data (HRV, sleep from HealthKit / Health Connect) | Large privacy and regulatory surface; revisit after Phase 5 with a DPIA |
| Free-text journal as model input | Journals may be offered for the member's own use, stored encrypted, excluded from research tier by default |
| Human coaching layer | Clinical partners provide the human layer |

---

## 4. Clinician layer (Tier 1, enterprise)

Sold to collaborative-care providers, risk-bearing primary care, payers, and employers. Clinician features observe and assign. They never override access authority or safety rules.

| Feature | Behavior | Guardrail |
|---|---|---|
| Assign practices | Clinician assigns specific tools to a member; member sees them as "suggested by your care team" | Assignment cannot bypass the access gate. If the gate blocks a tool, the assignment shows as unavailable with the reason on the clinician side only |
| Scheduled measurement | Clinician picks a cadence for the validated instruments already in Steady | Cadence can never be shorter than each instrument's published recall window (for example, two weeks for PHQ-9 and GAD-7, one month for PCL-5 and ITQ). This is also the fix pattern for the retake bypass |
| Trend view | Instrument scores over time with reliable change marked | Use the Reliable Change Index (Jacobson and Truax, 1991) with published reliability values per instrument; null if no published value |
| Flag review queue | Every safety-rule event appears in a queue for the care team | Queue is additive. Crisis routing to the member still happens immediately and deterministically, independent of whether anyone reviews the queue |
| Care summary export | Structured summary for the EHR or care-team notes | Export respects consent tier; no free text unless member consented to care-team sharing |
| Multi-tenant organizations | Each buyer is a tenant with its own clinicians and members | Strict tenant isolation at the data layer, per-tenant encryption keys, full audit log of clinician access |

Billing: Wysa integrates with CCM, RTM, and RPM workflows. Before claiming any billing code in sales material, confirm eligibility with a billing specialist. Build the data needed to support these workflows (measurement timestamps, engagement minutes, care-team review events), but make no billing claims in the product.

---

## 5. Architecture

The engineer should detect the current stack from the repo and keep it. This section defines components and boundaries, not frameworks.

### 5.1 Component map

```
 Member app                         Clinician portal
     |                                     |
     v                                     v
 +--------------------+        +----------------------+
 | Tool Runtime       |        | Care Team Service    |
 | (read-only state)  |        | (assign, review,     |
 +---------+----------+        |  cadence, export)    |
           | emits events      +----------+-----------+
           v                              |
 +--------------------------------------------------+
 | Event Gateway: validate schema, purpose, consent |
 +------------------------+-------------------------+
                          |
            +-------------+--------------+
            v                            v
 +--------------------+       +----------------------+
 | Safety Pipeline    |       | Append-only          |
 | (crisis-safety     |------>| Event Store          |
 |  rules run FIRST)  |       | (encrypted)          |
 +---------+----------+       +----------+-----------+
           |                             |
           v                             v
 +--------------------+       +----------------------+
 | Session State      |       | Measurement Service  |
 | Machine (sole      |       | (scheduling, recall  |
 | writer; owned by   |       |  windows, scoring)   |
 | access-authority)  |       +----------------------+
 +--------------------+                  |
                                         v
                              +----------------------+
                              | Research Pipeline    |
                              | (consented subset,   |
                              |  pseudonymized,      |
                              |  separate store)     |
                              +----------+-----------+
                                         v
                              +----------------------+
                              | Model Service        |
                              | (offline, then       |
                              |  shadow, then        |
                              |  advisory)           |
                              +----------------------+
```

### 5.2 Tool Registry (content as data)

Every tool is a versioned definition file validated in CI. Engineers do not hardcode tool content in components.

```yaml
id: grounding-54321
version: 1.0.0
display_name: "Notice what's around you"   # member-facing, plain language
clinical_name: "5-4-3-2-1 grounding"         # clinician surfaces only
domain: affect_dysregulation
tier: 2
mode: self_guided                            # self_guided | supervised_only
signoff:
  worksheet_row: T2-01
  status: pending                            # pending | approved | revoked
  approved_by: []                            # credential lanes
access_gate: standard                        # references access-authority rules
contraindications: []                        # references crisis-safety rules
parameters:
  step_count:
    value: 5
    source: "Standard 5-4-3-2-1 protocol"
  pause_between_steps_seconds:
    value: null                              # null = fail closed until sourced
    source: null
    fail_safe: "No auto-advance; member taps to continue"
emits:
  - pre_distress_rating
  - post_distress_rating
  - tool_completed
  - tool_exited_early
content_warning: none
motion: minimal
```

CI rules for the registry:
- Schema validation on every definition.
- Any tool with `signoff.status != approved` cannot be enabled outside development builds.
- Every numeric parameter has either a `source` or `value: null` with a `fail_safe`.
- `display_name` passes the banned-vocabulary and clinical-label lint.
- `mode: supervised_only` tools are unreachable from self-guided navigation (tested).

### 5.3 Tool Runtime

- Renders tools from registry definitions.
- Receives a **read-only snapshot** of session state. It has no import path to the state writer; enforce with a lint rule and a dependency test.
- Communicates only by emitting events to the Event Gateway.
- Always shows a visible "pause" and "leave" control. Leaving early is a normal outcome, logged as `tool_exited_early`, never framed as failure.

### 5.4 Safety Pipeline

- Every event passes through the existing `crisis-safety` rules before storage or any other consumer sees it.
- Rule outcomes are events themselves, so the clinician flag queue and future model labels come from the same source of truth.
- Nothing downstream can mutate or suppress a safety outcome.

### 5.5 Security and residency

- Keep AES-256-GCM. Add field-level encryption for any free text and for safety plan contents.
- Per-tenant keys for enterprise customers.
- Data residency: EU members in an EU region, US members in a US region. No cross-region replication of identifiable data.
- Audit log of every clinician read, every export, every consent change.

---

## 6. Event schema

Every data point Steady will ever use for a model starts here. Getting this right now is the single highest-leverage task for the predictive goal.

```json
{
  "event_id": "uuid",
  "event_type": "check_in_submitted",
  "schema_version": "1.0.0",
  "occurred_at": "ISO 8601 with offset",
  "member_pseudo_id": "stable pseudonymous id, never the account id",
  "tenant_id": "nullable for direct-to-consumer",
  "tool_id": "daily-check-in",
  "tool_version": "1.0.0",
  "purpose_codes": ["care_delivery", "member_progress_view"],
  "consent": {
    "care_team_sharing": true,
    "research": false,
    "consent_version": "2026-10"
  },
  "payload": {
    "window_state": "settled",
    "distress_0_10": 4
  },
  "safety_rule_outcomes": []
}
```

Rules:
- `purpose_codes` is required and drawn from a fixed enum. An event without a purpose is rejected at the gateway.
- `research` consent defaults to false and is asked for separately from service consent, with a plain-language explanation.
- Withdrawal of research consent removes the member's data from the research store within a defined window and excludes them from future training runs.
- Safety plan contents and free-text journal entries never enter the research store.
- Instrument responses store item-level answers plus instrument version, so scoring can be recomputed if a scoring rule changes.

### Labels a future model will need

| Label | Source event |
|---|---|
| Reliable deterioration or improvement | Consecutive instrument scores with RCI |
| Disengagement | No events across a window (window length must be defined with a biostatistician, not guessed) |
| Escalation | Safety rule outcomes |
| Tool helpfulness | Pre/post distress deltas per tool |

---

## 7. Predictive model roadmap

Each stage has an exit gate. Do not skip stages.

| Stage | What happens | Exit gate |
|---|---|---|
| A. Instrumentation | Event schema, consent tiers, purpose codes live | Every tool emits schema-valid events; DPIA drafted |
| B. Descriptive analytics | Cohort dashboards for enterprise buyers (aggregate only) | Small-cell suppression enforced: no cell with fewer than 11 members, following the CMS cell-size suppression policy |
| C. Offline research | Models trained on consented, pseudonymized data in a separate environment | Minimum sample size and evaluation plan set by a biostatistician; fairness audit across available demographic groups |
| D. Shadow mode | Model runs in production, predictions logged, shown to no one | Predictions evaluated against real outcomes for a pre-registered period; calibration and false-negative rate reviewed by advisors |
| E. Advisory to clinicians | Model adds items to the clinician flag queue with an explanation | Regulatory determination complete (MDR / AI Act / FDA CDS). Model output never shown to members, never gates access, never overrides a rule |

First candidate targets, in order: disengagement risk (lowest harm if wrong, highest value to buyers), then reliable deterioration.

---

## 8. Aesthetic system

Trauma-informed design is predictability, control, and calm. The member should never be surprised by what the app does next.

### 8.1 Principles

1. **Nothing moves unless the member caused it or it helps them understand what changed.** No ambient animation, no auto-advancing steps.
2. **The exit is always visible.** Pause and leave controls on every tool screen, in the same place every time.
3. **No shame mechanics.** No streaks, no "you missed a day," no red badges. Returning after a gap is welcomed, not counted.
4. **Plain language, no clinical labels** on member surfaces.
5. **Content notes before heavier material,** with a clear "not right now" option.
6. **One signature element:** the window-of-tolerance check-in band. It is the most repeated interaction in the app and the core data signal, so it gets the design investment. Everything else stays quiet.

### 8.2 Proposed tokens (designer to confirm; verify WCAG 2.2 AA contrast in CI)

| Token | Light | Dark | Use |
|---|---|---|---|
| `ground` | `#E9EEEC` | `#162023` | App background, a pale mist green-grey |
| `surface` | `#F7F9F8` | `#1E2A2E` | Cards and sheets |
| `ink` | `#1C2A2F` | `#E4ECEA` | Primary text, deep slate |
| `ink-muted` | `#55676C` | `#9DB0B2` | Secondary text |
| `steady` | `#2F6468` | `#7FB7B5` | Primary actions, focus, the settled zone of the check-in band |
| `sand` | `#C9B48E` | `#8C7A58` | Resource tools (calm place, container), fills only, never text |
| `help` | `#7D3F52` | `#D99AAE` | Crisis and help surfaces. Distinct without alarm red |

### 8.3 Type

- **Atkinson Hyperlegible Next** for everything. Designed by the Braille Institute for legibility, which fits a population that may be reading while dysregulated. One family, weights 400 and 700.
- Base size no smaller than 17pt on mobile. Line length under 70 characters. Sentence case everywhere.

### 8.4 Motion

- Short ease-out transitions that answer member actions only.
- Honor Reduce Motion (iOS), Remove animations (Android), and `prefers-reduced-motion` (web). With these on, all transitions become instant cross-fades or cuts.
- Nothing flashes more than three times per second (WCAG 2.3.1). Treat this as a hard CI check for any animated asset.
- Haptics: optional, off by default, gentle.

### 8.5 Signature element: the check-in band

```
  too activated
  +------------------------------------------+
  |                                          |
  |            settled   [ o ]               |   member drags the marker
  |                                          |
  +------------------------------------------+
  shut down

  How intense is it right now?   0 . . . . . 10
```

- Vertical band, three soft zones blending into each other, no hard borders between zones.
- The marker moves only under the member's finger.
- After submitting, suggest one or two tools matched to the zone. Suggestions come from registry rules, not a model.

### 8.6 Claude Code skills to load for UI work

`emil-design-eng`, `apple-design`, `mobile-native`, `review-animations`, plus `animate-expo` if the app is React Native / Expo, or `animate` if it is web. If `apple-design` and `emil-design-eng` conflict on motion, this document's motion rules win, then `emil-design-eng`.

---

## 9. Build plan

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Five audit findings closed with regression tests | Nothing |
| 1 | Tool Registry, Tool Runtime (read-only), Event Gateway, Event Store, consent tiers, purpose codes | Phase 0 |
| 2 | Tier 2 tools shipped behind flags, enabled per tool as sign-off lands | Phase 1, psychologist sign-off |
| 3 | Daily check-in band, measurement service with recall-window enforcement, progress view, expanded patient tools | Phase 1, sign-off rows per tool |
| 4 | Clinician portal: assignment, cadence, trend view with RCI, flag queue, export, multi-tenancy, audit log | Phase 3 |
| 5 | Research pipeline, pseudonymization, cohort dashboards with small-cell suppression, DPIA complete | Phase 4 |
| 6 | Model stages C through E | Phase 5, biostatistician, regulatory counsel |

Suggested new Claude Code skill: `data-governance`, holding the purpose-code enum, consent tier definitions, retention rules, and research-store exclusions, so every future session enforces them the way `crisis-safety` enforces safety rules.

---

## 10. Workflow per tool

1. Content spec written (member copy, clinician copy, parameters with sources).
2. Row added to the Advisor Sign-Off Worksheet.
3. Registry definition committed with `signoff.status: pending`.
4. Build behind a flag. Tests: schema, safety pipeline pass-through, early exit, reduced motion, screen reader, contrast, copy lint.
5. Advisor approval recorded; status flipped to `approved` in a separate, reviewed PR.
6. Enable per environment.

### Definition of done (every PR)

- Tests pass, including safety regression tests.
- No new numeric constant without a source or a null fail-closed declaration.
- No clinical label on a member surface.
- Events emitted are schema-valid with purpose codes.
- Reduced-motion and screen-reader paths verified.
- `review-animations` run on any new motion.

---

## 11. Open decisions for Travis

| Decision | Options | Needed by |
|---|---|---|
| Research consent model | Opt-in per member (recommended) vs organization-level for enterprise tenants | Phase 1 |
| Who owns the research data for enterprise tenants | Steady vs tenant vs joint | Phase 5, contract language |
| Biostatistician engagement | Contract vs academic partner | Before Phase 6 stage C |
| Regulatory counsel scope | EU (MDR, AI Act) and US (FDA CDS) | Before Phase 6 stage E |
| Reconcile with existing `HANDOFF.txt` and clinician collaboration documents | Merge or reference | Before Phase 1 |
