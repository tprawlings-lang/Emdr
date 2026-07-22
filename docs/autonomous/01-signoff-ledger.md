# Steady Autonomous System — Clinician Sign-Off Ledger

**Every item here must be reviewed/decided by an independent licensed trauma clinician
(Vol I requires ≥2) before it governs anything for a real user.** Until then: demo/beta
only, flag-gated, using the conservative beta config. This is the checklist the clinician
walks. Nothing is "final" without a named, credentialed, signed reviewer (Vol I App. C).

Legend: 🔴 blocks real-user use · 🟡 resolve before pilot · ⚪ track.

## Changelog — config `beta-clinrev-2026-07` (supersedes `beta-provisional-2026-07`)

A clinical-review change set has been **applied to the deterministic core** and
is pending ratification by the two named reviewers (see the form). The engine
remains in shadow mode (governs nothing). Bumping the config version reset all
prior per-rule sign-offs. Summary of what changed in code:

- **No autonomous BLS / trauma-memory reprocessing in beta**
  (`BETA_CONFIG.autonomousStimulationEnabled = false`): the engine removes the
  `stimulation` capability globally; session/BLS rules remain as fail-safe stops
  and upper bounds only. Self-tapping is grounding-only (A3/A5/A7).
- **Diagnosis / hospitalization / substance *history* → `humanReviewPending`**
  (restricted access pending human review) instead of standing exclusions (A6;
  rules `FIT_PSYCHOTIC_DISSOCIATIVE_DX` / `FIT_HOSPITALIZATION_12M` /
  `FIT_SUBSTANCE_DEPENDENCE`; §C trait hard-stop item).
- **Numeric daily/worsening scores → review triggers** (`reviewTriggered`) +
  fresh check-in, not automatic lockouts; present-state crisis inputs
  (harm urge / not-safe today) keep their crisis floor with a present-safety
  clarification + jurisdiction-aware resources.
- **`CRISIS_PHQ9_ITEM9`**: present-risk clarification (no standalone fixed 72 h
  lockout). **`CRISIS_PCL5_ITEM16` → `PCL5_ITEM16_CONTEXT`**: de-scoped as a
  suicide proxy (context prompt / review trigger only).
- **DES-II omitted** in beta (`des2SurfaceEnabled = false`; rules inert).
- **"Readiness" → "Educational Access State"** (category + reasons; domain gates,
  not a composite readiness score). Finalized program-fit wording
  (`PROGRAM_FIT_GATE_WORDING`, `fit-v2-clinrev`).
- New dispositions surfaced in the console + audit detail: `humanReviewPending`,
  `presentSafetyClarificationRequired`, `jurisdictionAwareResources`,
  `reviewTriggered`, `urgentMedicalReferral`.

Verification: `npx tsc --noEmit` clean; `npm run test:safety` 166/166.
Tracked follow-ups (larger, non-safety-layer): full member-facing "readiness"
copy rename across pages; a persisted current-state vs trait/history datastore
split (A10); branch-by-type inputs for unsafe-situation / present-risk
clarification flows.

**Printable form:** the fillable Word form for the reviewers is at
[`clinician-signoff-form.docx`](clinician-signoff-form.docx), generated against
config `beta-clinrev-2026-07` and **pre-filled with the two named reviewers**
(R. Altschuler, PSY-005804; J. Allen, PSY-002055). It shows each applied
clinical-review decision for confirm/revise, per-rule Agree/Needs-change for all
deterministic rules (mapping 1:1 to the console CSV), the Section-E evidence
checklist, and the attestation/signature block. Regenerate with
`scripts/gen-signoff-form.js` (`npm i docx` then
`node scripts/gen-signoff-form.js out.docx`). The in-app console at
`/clinician/autonomous` remains the system-of-record for the per-rule verdicts;
the form captures what the app does not (credentials, the ≥2-reviewer
attestation, the numeric-conflict confirmations, and the out-of-app evidence).

---

## A. Unresolved numeric conflicts in the spec (Volume II) — MUST resolve

The spec's main body, Appendix A, and advisor worksheet give **different numbers** for these.
Beta uses the safe/conservative value; the clinician must pick the authoritative one.

| # | Parameter | Conflicting values | Beta uses |
|---|---|---|---|
| A1 🔴 | **Readiness formula** | Weighted 0–100 (main) vs multiplier-based (App A) — different caps, track names & boundaries | Multiplier + **caps** (caps are the real safety mechanism); tracks grounding/cautious/steady |
| A2 🔴 | **In-session SUDS rule** | Delta-based (+1 pause / +2 containment, main + crosswalk) vs absolute (≥8/≥9 + rise-of-3, App A) | Delta-based (crosswalk) **and** absolute ≥8 → containment (union = most conservative) |
| A3 🟡 | **Session duration** | 30/40 min (main) vs 35/45 min (App A + advisor R4) | 30 wind-down / 40 hard-stop (shorter) |
| A4 🟡 | **Containment-ending cooldown** | 48 h (main + crosswalk) vs 24 h (advisor R21) | 48 h (longer) |
| A5 🟡 | **Max stimulation sets** | 3 (main) vs 2–3 (advisor) vs 2 (beta) | **2** |
| A6 🟡 | **Hospitalization exclusion window** | 0–90 d / 91–365 review (main) vs 12 mo standing (screener) | 12-mo standing (more conservative) |
| A7 🔴 | **BLS speed & closure minimum** | Main body lists 1.25 Hz / 120 s; advisor worksheet marks both **"none in codebase — nothing ships without this row"** | Beta 1.0/1.25 Hz, 120 s closure — **placeholders pending sign-off** |
| A8 🔴 | **Program-fit item wording** | Placeholder pending advisor R15 | Placeholder; not final |
| A9 🟡 | **DES-II inclusion & licensing** | Not yet selected (advisor R22); commercial licensing unverified (R10) | Omitted from beta until adopted + licensed |
| A10 🟡 | **State vs trait split** on screener items | Advisor R18 | Beta split per digest; confirm |

## B. Deterministic safety rules to ratify (Volume I & II) — confirm each is correct

Each is implemented as an immutable rule; clinician confirms the threshold/behavior:
- 🔴 Crisis = **one** indicator → immediate, non-clearable (suicidal/homicidal intent,
  psychosis, mania, severe intoxication, medical emergency).
- 🔴 PHQ-9 item 9 **≥1** and PCL-5 item 16 **≥3** → 72 h stabilization + one binary safety
  question. (Deliberately **no** in-product suicide assessment — confirm this stance.)
- 🔴 Daily route first-match, **narrow-only** same-day; thresholds (dissociation ≥7 / ≥4,
  activation ≥8, shutdown ≥8, sleep ≤2, harm-urge, not-safe).
- 🔴 Permission intersection: most restrictive active rule wins; a good score never widens.
- 🔴 Acute-trauma **30-day** exclusion from BLS (grounding/orientation only).
- 🔴 Dissociation **DES-II ≥30** → grounding-first + imagery restriction + referral.
- 🟡 Weekly worsening: PCL-5 rise ≥10 / ITQ combined rise ≥8 → 14-day cautious ceiling.
- 🟡 Cooldown ladder 24/48/72 h and post-cooldown ceilings (1/3/7/14/30 d).
- 🔴 Missing safety input never defaults favorably; incomplete → grounding only.
- 🔴 Closure mandatory (≥120 s) regardless of score; local Ground-Me stop without network.

## C. Human-in-the-loop checkpoints — confirm none is silently removed

The corpus keeps humans in the loop by design. Beta must NOT remove any without explicit
clinician approval. Flagged points:
- 🔴 **AI never** determines crisis status, dissociation, readiness, emergency routing, stim
  parameters, or eligibility. (Vol I B-3.) — enforced structurally.
- 🔴 **No autonomous emergency-services dispatch** unless the whole system is specifically
  authorized + validated for it (Vol V) — **out of scope for beta**.
- 🔴 **Escalation must not promise more human oversight than actually staffed** (Vol V Ch.13).
  Beta uses "resource-only" or protocol-defined human oversight; never imply monitoring.
- 🟡 Manual-review backlog must **degrade/pause** the feature rather than silently drop the
  human.
- 🟡 Acute-trauma clinician override is **not** available in the autonomous version (only a
  future supervised version).
- 🔴 DES-II ≥30 / DSO-predominant / repeated re-entry failures → **clinician pathway**.
- 🔴 Trait hard-stops (psychotic/dissociative dx, recent hospitalization, substance
  dependence) reversible **only by support contact**, never by re-answering.

## D. Companion behavior guardrails to ratify (Volume III & IV)

- 🔴 No asserted internal states; no simulated feelings ("I care about you" banned → the
  approved well-being framing); calibrated uncertainty; no diagnosis; proportionate response.
- 🔴 Never interpret a falling distress score as improvement when dissociation possible.
- 🔴 Never instruct worst-memory recall / sustained imagery / repeat-until-distress-drops;
  never interpret spontaneous material as "processing."
- 🔴 Anti-dependency: no exclusivity, no discouraging human care, no scarcity/guilt/streaks.
- 🔴 Optimization hierarchy safety > autonomy > comprehension > continuity > engagement,
  enforced in architecture (the "engagement over flourishing" feature is auto-rejected).
- 🟡 Memory: 6-class taxonomy, provenance, graceful decay, member controls; no psychological
  labels exposed to providers as fact.

## E. Validation gates before any pilot (Volume I & V) — the deployment checklist

- 🔴 Independent review by **≥2 licensed trauma clinicians** of scope/thresholds/stop-rules/
  dissociation/crisis-routing/user-language (Vol I App. A #1).
- 🔴 Evidence matrix mapping every parameter to supporting/absent evidence.
- 🔴 Clinical implementation spec (decision tables, state transitions, pseudocode, test cases).
- 🔴 Privacy/security review by qualified professionals (not inferred from clinical design).
- 🟡 Human-factors testing (comprehension, interruption recovery, behavior under stress).
- 🟡 Technical verification (deterministic routing, logging, crash recovery, regression).
- 🔴 Staged validation Phases 1→4 with predefined progression/stopping criteria.
- 🔴 Claims/communications review — preparation-only scope consistent across all channels.
- 🔴 Model safety gates + pilot entry: "no unresolved critical red-team findings."
- ⚪ Governance cadence: monthly technical / quarterly clinical / annual architecture review.

## F. Scope guardrails (do-not-cross, Volume I & III)

- 🔴 **Preparation-phase only; no trauma reprocessing.** Hard behavior-level boundary, not a
  disclaimer — enforced in module logic, copy, analytics, and marketing alike.
- 🔴 No claims to diagnose, treat, deliver EMDR, replace clinicians, or guarantee relief.
- 🔴 Not an emergency service; cannot monitor continuously; must say so.
- 🔴 Regulatory: education/preparation stays organizationally + technically separate from any
  future regulated clinical function ("one app must not drift across regulatory categories").
