# Phase-4 staged rollout — autonomous BLS

**Status:** protocol ready for clinician approval. Part-6 gate 4. Extends the
overall [staged-validation protocol](../evidence/05-staged-validation-protocol.md)
(this is the detail for its Phase 4). `autonomousStimulationEnabled` stays `false`
until 4b entry criteria are met.

**Design principle (from the research).** The evidence base supports **resourcing**
BLS (Calm/Safe Place — some benefit, low risk) far more than self-administered
**desensitization** (governing-body policy forbids it; re-dissociation risk). So the
rollout does **resourcing-BLS first** and gates desensitization behind the tightest
criteria — or omits it, per the counsel/clinician decision on the EMDRIA question.

## Sub-stages

### 4a — Resourcing BLS only (Calm/Safe Place installation)
- **Scope:** short, slow BLS paired with a *positive* resource + cue word. **No
  trauma-memory targeting.** This is the low-risk, evidence-supported use.
- **Entry:** all other Part-6 gates (human-factors, red-team, consent, this plan)
  complete; kill switch live; monitored cohort defined.
- **Success metrics (numbers set with clinicians before entry):** members report
  increased calm/accessibility; zero dissociation-stop bypasses; 100% mandatory
  closure; no symptom-worsening signal.
- **Stopping criteria (→ disable):** any dissociation-stop bypass, any skipped
  closure, any symptom-worsening threshold breach, any output-guard failure.

### 4b — Supervised internal pilot of desensitization *(only if approved)*
- **Gate:** the EMDRIA-policy question resolved in counsel review **in favor** of
  offering self-administered processing; 4a stable for the predefined window.
- **Scope:** desensitization to the approved parameters, **internal/supervised
  cohort only**, tight monitoring, low volume.
- **Stopping criteria:** any of 4a's, plus any abreaction without safe recovery, any
  incomplete-session without container/closure, any re-experiencing/worsening above
  the pre-registered threshold.

### 4c — Limited real-member desensitization *(only after 4b)*
- **Gate:** 4b clean for the predefined window; complaint/adverse-event rate within
  target; counsel + clinician re-affirmation.
- Small, consented, monitored cohort; kill switch; explicit off-ramp to clinician
  referral.

## Cross-stage controls
- **Kill switch:** a dedicated env flag disables BLS globally without a deploy
  (extend the `EMDR_KILL_*` pattern, e.g. `EMDR_KILL_BLS`).
- **Rollback:** unset `autonomousStimulationEnabled` → BLS off instantly, back to
  the prior stage's behavior.
- **Any parameter change** voids the BLS sign-off (per the signed protocol) and
  requires renewed clinician review before proceeding.
- **Cadence:** monthly technical review, adverse-event review each stage, clinician
  re-affirmation between stages.

## Hard stopping criteria (any stage → immediate disable)
1. A dissociation- or orientation-stop bypass.
2. A session that ends without mandatory closure.
3. An AI-generated crisis or during-set clinical instruction.
4. A symptom-worsening / adverse-event rate above the pre-registered threshold.
5. Any unresolved critical red-team finding.

Numeric thresholds (cohort sizes, worsening rate, window lengths) are left for the
clinicians + founder to **pre-register before 4a entry** — set them, don't fit them.

## Pre-registered thresholds (clinician-set, 2026-07-22)

Recorded on the signed Part-6 package ([`Part6-SIGNED-2026-07-22.pdf`](Part6-SIGNED-2026-07-22.pdf)):

- **4a monitored cohort:** 12 · **window before 4b:** 14 days + review.
- **Symptom-worsening stop trigger:** **any** protocol-related clinically meaningful
  worsening (**> 0%**) — i.e. a single such case stops the stage.
- **4b / 4c cohorts:** 6 / 12.
- **Adverse-event ceiling:** **0 serious**; **any SAE pauses the rollout**.
