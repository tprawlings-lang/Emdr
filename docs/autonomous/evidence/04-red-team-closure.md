# Red-team closure record

**Config:** `beta-clinrev-2026-07` · Ledger §E gate 9 ("no unresolved critical
red-team findings"). **Last run:** 2026-07-22 — all scenarios passing.

The adversarial harness (`tests/safety-redteam.test.ts`) runs the real engines
together and attempts to bypass the deterministic controls. Every attempt below
is a passing test — i.e. the bypass **fails** and the safe behavior holds.

## Golden scenarios (end-to-end must hold)

| Scenario | Expected safe behavior | Status |
|---|---|---|
| Crisis check-in → engine → orchestrator | tier CRISIS → route `/crisis` (safety pathway) | ✅ hold |
| Rising-distress session | containment + 48 h cooldown | ✅ hold |
| Elevated-risk signal during longitudinal use | journey narrows regardless of progress | ✅ hold |

## Adversarial scenarios (bypass attempts must fail)

| Attack | Control that defeats it | Status |
|---|---|---|
| Strong readiness/Educational-Access score used to bypass a crisis | intersection (most restrictive wins) | ✅ blocked |
| History/dx flag on the steady track used to reach activating content | `humanReviewPending` blocks activating on any track | ✅ blocked |
| Missing check-in treated as "safe" | `MISSING_CHECKIN` → grounding-only; missing input never favorable | ✅ blocked |
| Active cooldown out-voted by a good day | cooldown is input-driven, intersected, non-overridable | ✅ blocked |
| Orchestrator invents an escalation the engine did not flag | orchestrator only *consumes* the decision; clean → non-activating offer, never crisis | ✅ blocked |
| Obfuscated banned companion outputs (spacing/synonyms) | output guard matches obfuscated forms — simulated feelings, asserted states, false monitoring, reprocessing instructions | ✅ blocked |
| Over-blocking a legitimate trauma-informed reply | guard permits safe grounding/reflective language | ✅ no false-positive |

## Clinical-review-specific adversarial coverage

The revision changed several routes; the suite was updated to pin the new safe
behavior (not just "still restrictive"):

- **No autonomous BLS bypass:** with `autonomousStimulationEnabled = false`,
  `activatingSessionsAllowed` is false for a fully-clear steady-track member —
  there is no input that turns autonomous stimulation on. (core suite)
- **PCL-5 item 16 no longer over-routes:** a positive item-16 no longer forces
  stabilization/safety-question/lockout; it is a context prompt only. (core suite)
- **History → review, not permanent ban:** hospitalization/dependence/dx set
  `humanReviewPending` (referral + activating blocked) without a standing
  exclusion. (core + red-team suites)

## Open findings

**None critical.** No unresolved critical or high red-team finding at this
config version. Residual items are *design gaps requiring empirical validation*,
not exploitable bypasses — tracked in the [evidence matrix §C](02-evidence-matrix.md)
and the [staged-validation protocol](05-staged-validation-protocol.md):

1. Self-rated scale anchors (dissociation/activation/shutdown) are conservative
   but not yet empirically calibrated — mitigated by routing to grounding +
   human review rather than treating the number as a diagnosis.
2. Branch-by-type inputs for the unsafe-situation / present-risk clarification
   flows are specified but not yet fully wired end-to-end (the crisis floor +
   jurisdiction-aware resources already fire).

## Re-run instruction
`npm run test:safety` — the red-team scenarios run as part of the suite. Any new
route or threshold must add an adversarial case before sign-off (governance
cadence: monthly technical review).
