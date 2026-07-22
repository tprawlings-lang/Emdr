# Clinical implementation specification

**Config:** `beta-clinrev-2026-07` · **Scope:** the deterministic safety core
(`src/lib/safety/`). Ledger §E gate 3.

This spec documents *exactly* how the ratified rules are implemented: the
decision tables, the session state machine, the intersection algorithm, and the
test cases that pin each behavior. Everything here is a pure function — no I/O,
no model call, no clock read (time is an input) — so it is exhaustively testable.

The corpus's one architectural rule holds throughout: **safety decisions are
deterministic; the AI companion is advisory only and is structurally prevented
from making, reversing, or clearing any safety decision.** "Increasing
uncertainty must reduce intervention intensity."

---

## 1. Access-decision table (`rules.ts` → `engine.ts`)

Each rule is pure data `{ id, category, reason, triggers(inputs), effect }`. The
engine evaluates **all** rules and folds them by intersection (most restrictive
wins). Tiers are ordered `CRISIS(0) < GROUNDING_ONLY(1) < STABILIZATION(2) <
CAUTIOUS(3) < STEADY(4)`; the resulting tier is the **minimum** ceiling any
triggered rule imposes.

### 1.1 Access & gating rules

| Rule ID | Trigger | Tier ceiling | Other effects |
|---|---|---|---|
| `FIT_UNDER_18` | programFit.under18 | CRISIS | standing exclusion |
| `FIT_SELFHARM_30D` | self-harm history (30 d) | GROUNDING_ONLY | present-safety clarification, referral |
| `FIT_UNSAFE_SITUATION` | current unsafe situation | CRISIS | crisis, present-safety clarification, jurisdiction-aware resources |
| `FIT_PSYCHOTIC_DISSOCIATIVE_DX` | psychotic/dissociative dx | GROUNDING_ONLY | **human review pending**, referral |
| `FIT_HOSPITALIZATION_12M` | psych hospitalization history | GROUNDING_ONLY | **human review pending**, referral |
| `FIT_SUBSTANCE_DEPENDENCE` | dependence history | GROUNDING_ONLY | **human review pending**, referral |
| `FIT_SEIZURE_PHOTOSENSITIVE` | seizure/photosensitive | — | remove visual stimulation |
| `FIT_ACUTE_MEDICAL` | acute medical | GROUNDING_ONLY | urgent medical referral, remove stimulation |
| `ACUTE_TRAUMA_30D` | days-since-trauma < 30 | GROUNDING_ONLY | remove stimulation, review trigger |
| `DAILY_HARM_URGE` | check-in harm urge | CRISIS | crisis, present-safety clarification, jurisdiction-aware resources |
| `DAILY_NOT_SAFE` | check-in feelsSafe = false | CRISIS | crisis, present-safety clarification, jurisdiction-aware resources |
| `CRISIS_PHQ9_ITEM9` | PHQ-9 item 9 ≥ 1 | STABILIZATION | present-safety clarification, safety question, referral |
| `PCL5_ITEM16_CONTEXT` | PCL-5 item 16 ≥ 3 | — | review trigger only (no lockout) |
| `DAILY_DISSOCIATION_7` | dissociation ≥ 7 | GROUNDING_ONLY | remove stimulation, review trigger |
| `DAILY_ACTIVATION_8` | activation ≥ 8 | GROUNDING_ONLY | remove stimulation, review trigger |
| `DAILY_SHUTDOWN_8` | shutdown ≥ 8 | GROUNDING_ONLY | remove stimulation, review trigger |
| `DAILY_INTOXICATION` | current intoxication | GROUNDING_ONLY | remove stimulation |
| `DAILY_DISSOCIATION_4` | dissociation 4–6 | STABILIZATION | remove stimulation, review trigger |
| `DAILY_SLEEP_LOW` | sleep ≤ 2 | CAUTIOUS | remove stimulation, review trigger |
| `DAILY_SUBSTANCE` | substance flag | STABILIZATION | remove stimulation, review trigger |
| `MISSING_CHECKIN` | no check-in today | GROUNDING_ONLY | remove stimulation |
| `DES2_HIGH` | DES-II ≥ 30 **AND** des2SurfaceEnabled | STABILIZATION | remove stimulation+imagery, referral |
| `DES2_CAUTION` | DES-II 20–29.99 **AND** des2SurfaceEnabled | — | remove imagery |
| `PCL5_WEEKLY_RISE_10` | weekly rise ≥ 10 | — | review trigger, referral |
| `ITQ_COMBINED_RISE_8` | weekly rise ≥ 8 | — | review trigger, referral |
| `READY_RISK_FLAG` | educational-access risk flag | CRISIS | crisis |
| `READY_LESS_THAN_SAFE` | less-than-fully-safe | STABILIZATION | — |
| `READY_PAUSE_CAPACITY_LOW` | low pause/stop capacity | CAUTIOUS | remove stimulation+imagery, review trigger |
| `REENTRY_PENDING` | re-entry after cooldown | GROUNDING_ONLY | remove stimulation |

**Clinical-review invariants encoded above:**
- **No autonomous BLS in beta.** `BETA_CONFIG.autonomousStimulationEnabled = false`
  makes the `stimulation` capability start OFF globally, so
  `activatingSessionsAllowed` is false regardless of tier.
- **History/dx → human review, not permanent ban.** The three history rules set
  `humanReviewPending`, which blocks activating content but is not a standing
  exclusion.
- **DES-II inert.** Both DES rules are guarded by `des2SurfaceEnabled` (false).
- **Scores are review triggers.** Worsening + several daily rules set
  `reviewTriggered` and route to grounding/cautious with a referral, not an
  automatic multi-day lockout.

### 1.2 Input-driven rules (evaluated in the engine, not the table)
- **Active cooldowns** (`activeCooldowns[]` with `untilMs > now`): ceiling
  STABILIZATION + remove stimulation until the max expiry.
- **Cautious ceiling** (`cautiousCeilingUntilMs > now`): ceiling CAUTIOUS.

### 1.3 Derived outputs
- `activatingSessionsAllowed = !crisis && !standingExclusion &&
  !humanReviewPending && !cooldownActive && capabilities.stimulation &&
  tier ≥ CAUTIOUS`. In beta this is **always false** (stimulation off).
- `groundingOnly = tier ≤ GROUNDING_ONLY`.
- `primaryReason` = crisis reason if crisis, else the reason of the rule that set
  the lowest tier.

---

## 2. Intersection algorithm (pseudocode, `engine.ts::evaluateAccess`)

```
tier      ← trackCeiling(readiness.track)          // STEADY unless narrowed
caps      ← { stimulation: BETA_CONFIG.autonomousStimulationEnabled,  // false in beta
              visualStimulation: BETA_CONFIG.visualStimulationEnabled, // false in beta
              imagery: true }
disp      ← all-false / all-null

for each rule in RULES:
    if rule.triggers(inputs):
        if effect.tierCeiling < tier: tier ← effect.tierCeiling     // MIN
        apply capability removals (stimulation / visual / imagery)
        set dispositions (crisis, safetyQuestion, referral, standingExclusion,
                          humanReviewPending, presentSafetyClarification,
                          jurisdictionAwareResources, reviewTriggered,
                          urgentMedicalReferral, autoRefund)
        accumulate timers (forcedStabilization, retake) by MAX
        record hit

apply active cooldowns and cautious ceiling (input-driven)
compute activatingSessionsAllowed, groundingOnly, primaryReason
return decision           // pure data; caller persists audit + enacts dispositions
```

**Key properties:** monotonic tightening (tier only ever decreases); missing
safety input never widens access (absent check-in → `MISSING_CHECKIN` → grounding);
a favorable score can never out-vote a restrictive rule (intersection).

---

## 3. Session runtime state machine (`session.ts`)

> In beta the engine disables autonomous BLS, so this FSM does not run for real
> members. It is retained as the **fail-safe** substrate and the spec for any
> future clinician-supervised protocol. It never auto-starts a set and treats
> every stop as absolute.

### 3.1 States
`created → authorized → set_active → post_set_reassessment → (authorized | containment | closure) → completed`; plus `denied` and `crisis`.

### 3.2 Transition table (`postSet` reassessment — conservative UNION)

Evaluated top-down; the **first** match wins, so the most protective stop fires:

| Condition | Action | Effect |
|---|---|---|
| not oriented to present | containment | lock stimulation, 48 h cooldown, require orientation |
| dissociation ≥ 4 | containment | lock, 48 h cooldown |
| SUDS ≥ 9 | containment (hard stop) | lock, 48 h cooldown |
| SUDS ≥ 8 | containment | lock, 48 h cooldown |
| rise ≥ 3 over start | containment | lock, 48 h cooldown |
| post-set delta ≥ 2 | containment | lock, 48 h cooldown |
| two consecutive +1 rises | containment | lock, 48 h cooldown |
| no change across 2 sets | closure | lock ("stuck is a stop signal") |
| delta = +1 | pause + reassess | — |
| stable/improved & sets remain & < 30 min | offer next set (never auto-start) | — |
| else | closure | — |

### 3.3 Gates & absolutes
- **Pre-session:** starting SUDS > 5 → `deny_stimulation`.
- **Offer-next-set** requires: not locked, sets < 2, elapsed < 30 min, not in
  containment/closure/completed.
- **Ground-Me:** one-tap halt → locks stimulation for the session, no return.
- **Orientation overrides SUDS**; user-initiated stop available at any time.
- **Closure floor:** ≥ 120 s — necessary but *not sufficient* (also requires
  orientation confirmation + member-reported stability + escalation path on
  failure; ledger clinical-review revision).

---

## 4. Companion output guard (`companion-guard.ts`)

Every companion line passes a deterministic validator that blocks the corpus's
"never-say" classes: simulated feelings ("I care about you"), asserted internal
states, diagnosis, cure claims, false monitoring ("someone is watching over
you"), reprocessing instructions ("bring up the worst memory"), and dependency.
On a violation the candidate is replaced with a safe deterministic fallback
(enforced in demo and whenever the master flag is on). The guard is
obfuscation-resistant (see [red-team closure](04-red-team-closure.md)).

---

## 5. Test-case mapping

Each behavior above is pinned by the safety suite (166 tests, all passing):

| Area | Test file | Count |
|---|---|---|
| Access decision / intersection | `tests/safety-core.test.ts` | 23 |
| Session FSM | `tests/safety-session.test.ts` | 16 |
| Scoring (state/trait, caps, item-level) | `tests/safety-scoring.test.ts` | 8 |
| Journey orchestration | `tests/safety-journey.test.ts` | 10 |
| Companion memory + output guard | `tests/safety-companion.test.ts` | 12 |
| Governance / config snapshot | `tests/safety-governance.test.ts` | 5 |
| Regression + adversarial red-team | `tests/safety-redteam.test.ts` | 10 |
| Therapy-KB retrieval guardrails | `tests/therapy-kb.test.ts` | 11 |
| Voice/live experience + consent gate | `tests/experience-voice.test.ts` + `tests/voice-consent-gate.test.ts` | 9 |
| Audit hash chain | `tests/audit-chain.test.ts` | 3 |

Run: `npm run test:safety`. See [technical verification](03-technical-verification.md).
