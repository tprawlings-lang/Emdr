# Staged-validation protocol (Phases 1→4)

**Config:** `beta-clinrev-2026-07` · Ledger §E gate 7.

A **protocol** — a plan to be executed, with predefined progression and stopping
criteria — not a completed result. It governs how the autonomous engine may move
from shadow mode toward (at most) supervised beta, one capability at a time,
behind its own flag. It never contemplates enabling autonomous BLS/reprocessing
in beta (a reviewer condition and a hard scope boundary).

**Governing principles (from the corpus):** each capability goes live singly;
increasing uncertainty reduces intervention intensity; any material config change
resets clinician sign-off; a stopping criterion trips → immediate rollback to the
prior phase.

## Phase 1 — Shadow (current)
- **State:** engine computes and audit-logs every decision; governs nothing a
  member sees. `EMDR_AUTONOMOUS_SAFETY=0`.
- **Entry:** already met.
- **Progression → Phase 2 requires ALL of:** clinician sign-off complete ✅;
  evidence gates 2/3/6/8/9 accepted; independent privacy/security review (gate 4)
  and human-factors testing (gate 5) complete; outside accounts provisioned;
  founder go decision.
- **Metrics collected in shadow:** shadow-vs-current-copy divergence rate, rule
  fire distribution, crisis-route precision on real check-ins, audit-chain
  integrity.
- **Stopping criteria:** any audit-chain break; any shadow decision that would
  have *widened* access beyond the current human-in-loop system; any
  crisis-route miss.

## Phase 2 — Governing (safety engine only), copy flipped, re-consent
- **Scope:** `EMDR_AUTONOMOUS_SAFETY=1` — the engine governs access decisions;
  autonomous consent/ToS/privacy copy serves; existing members re-consent. **No**
  autonomous BLS (stays disabled). Voice/live stay flag-off.
- **Entry criteria:** Phase-1 progression met; a monitored cohort defined; rollback
  tested (`EMDR_AUTONOMOUS_SAFETY=0` returns to shadow instantly).
- **Success metrics (predefined thresholds set with the clinicians before entry):**
  zero missed crisis routes; human-review queue latency within target; no
  member reaches activating content while `humanReviewPending`; referral surfaced
  on 100% of qualifying flags.
- **Stopping criteria (→ rollback to Phase 1):** any missed crisis route; any
  `humanReviewPending` bypass; human-review backlog exceeds the degrade
  threshold (feature pauses rather than dropping the human); any critical
  red-team finding; complaint-rate threshold breach.

## Phase 3 — Voice input (typed-reflection dictation)
- **Scope:** `EMDR_VOICE_INPUT=1`, consent-gated; free-text reflection only,
  never safety-gate inputs.
- **Entry:** Phase 2 stable for the predefined window; voice/biometric consent
  live; on-device recognition confirmed for the shipped build.
- **Stopping criteria:** any voice path reaching a SUDS/fit/safety input; consent
  withdrawal not honored immediately; transcript entering the record without
  confirmation.

## Phase 4 — Live spoken sessions (hands-free + dynamic responder)
- **Scope:** `EMDR_LIVE_SESSION=1`, consent-gated; deterministic engine still owns
  every clinical decision; crisis replies scripted + jurisdiction-aware.
- **Entry:** Phase 3 stable; live-session rows re-affirmed; output-guard false-
  negative rate at target.
- **Stopping criteria:** any AI-generated crisis reply; any responder output that
  moves a set / ends closure / overrides a stop; output-guard bypass.

## Cross-phase governance
- **Cadence:** monthly technical review, quarterly clinical review, annual
  architecture review.
- **Kill switches** (`EMDR_KILL_*`) available per capability at every phase.
- **Rollback is always one env var** and returns to the prior phase's copy +
  behavior atomically.
- **Any config change** (threshold, rule, wording) → sign-off resets → return to
  Phase 1 for that change.

## Predefined stopping-criteria summary (hard stops, any phase)
1. Audit-chain integrity failure.
2. A missed or mis-routed crisis.
3. A bypass of `humanReviewPending`, a cooldown, or a crisis floor.
4. Any autonomous BLS/reprocessing occurring in beta.
5. An unresolved **critical** red-team finding.
6. Human-review capacity exceeded without the feature degrading/pausing.

Thresholds (latency targets, complaint rates, cohort sizes) are intentionally
left for the clinicians + founder to set numerically **before** Phase 2 entry, so
they are pre-registered rather than fit after the fact.
