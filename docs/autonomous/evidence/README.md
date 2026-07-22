# Deployment-evidence package — autonomous safety system

**Config under review:** `beta-clinrev-2026-07`
**Clinical sign-off:** ratified *with conditions* by two independent licensed
psychologists on 2026-07-22 (R. Altschuler PSY-005804, J. Allen PSY-002055) —
see [`../clinician-signoff-SIGNED-2026-07-22.pdf`](../clinician-signoff-SIGNED-2026-07-22.pdf)
and the [sign-off ledger](../01-signoff-ledger.md).

The reviewers approved the clinical configuration but conditioned **real-member
staged activation** on completing and documenting the deployment-evidence gates
below (ledger §E / form Part 4). This folder is that evidence package. It does
**not** flip any flag — `EMDR_AUTONOMOUS_SAFETY` stays off and the engine stays
in shadow mode until the founder acts on a satisfied gate set.

## Gate status

| # | Gate (ledger §E) | Status | Evidence |
|---|---|---|---|
| 1 | Independent review by ≥2 licensed trauma clinicians | ✅ **Done** | Signed PDF; [ledger](../01-signoff-ledger.md) |
| 2 | Evidence matrix (every parameter → supporting/absent evidence) | ✅ **Drafted** | [`02-evidence-matrix.md`](02-evidence-matrix.md) |
| 3 | Clinical implementation spec (decision tables, transitions, pseudocode, tests) | ✅ **Drafted** | [`01-clinical-implementation-spec.md`](01-clinical-implementation-spec.md) |
| 4 | Privacy/security review by qualified professionals | ⏳ **Handoff packet ready — needs external party** | [`08-security-review-handoff-packet.md`](08-security-review-handoff-packet.md) · [plan](07-privacy-security-and-human-factors-plan.md) |
| 5 | Human-factors testing | ⏳ **Scoped — needs external execution** | [`07-privacy-security-and-human-factors-plan.md`](07-privacy-security-and-human-factors-plan.md) |
| 6 | Technical verification (deterministic routing, logging, crash recovery, regression) | ✅ **Drafted** | [`03-technical-verification.md`](03-technical-verification.md) |
| 7 | Staged validation Phases 1→4 with progression/stopping criteria | ✅ **Drafted (protocol)** | [`05-staged-validation-protocol.md`](05-staged-validation-protocol.md) |
| 8 | Claims/communications review (preparation-only scope) | ✅ **Done — F-1 resolved** | [`06-claims-communications-review.md`](06-claims-communications-review.md) · [F-1 (applied)](06a-F1-consent-copy-proposal.md) |
| 9 | Model safety gates + pilot entry: no unresolved critical red-team findings | ✅ **Drafted** | [`04-red-team-closure.md`](04-red-team-closure.md) |

## What "drafted" means here

Gates 2, 3, 6, 8, 9 are grounded in the actual source and test suite and are
ready for the reviewers to accept. Gates 4 and 5 **cannot** be produced from the
codebase — they require an independent security professional and real user
testing, respectively; this folder scopes them so they can be commissioned.
Gate 7 is a protocol (a plan to be executed during pilot), not a completed
result.

## Provenance & caution

These documents were **engineering-drafted** and describe a system authored from
the clinician corpus. They are inputs to the reviewers' judgment, not a
substitute for it. Any material change to `beta-clinrev-2026-07` resets the
clinical sign-off (per the reviewers' condition 3) and requires re-review.

Last updated: 2026-07-22.
