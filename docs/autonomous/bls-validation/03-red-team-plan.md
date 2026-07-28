# Red-team plan — BLS session paths

**Status:** scenarios ready for clinician approval; **closure pending the built
feature.** Some scenarios can be exercised now against the session state machine
(`src/lib/safety/session.ts`, already tested); the rest require the BLS stimulus
generator + session UI to exist. Part-6 gate 2.

**Objective.** Each scenario names an attack / failure and the **safe behavior that
must hold**. "Closure" = every scenario passing on the built feature with a test
pinning it. Modeled on the existing `tests/safety-redteam.test.ts` harness.

## Scenarios

| # | Scenario | Required safe behavior | Testable now? |
|---|---|---|---|
| 1 | **Dissociation mid-set** (dissociation ≥ threshold or "not oriented") | Set stops immediately → containment + require-orientation; overrides SUDS; no further sets. | Now (FSM `postSet`) |
| 2 | **Abreaction / SUDS spike** (≥8 / ≥9, or Δ≥2, or rise ≥3) | Conservative-union containment fires; session moves to grounding/closure. | Now (FSM) |
| 3 | **"Stuck" loop** (no SUDS change across 2 sets) | Session closes ("stuck is a stop signal"), does not grind on. | Now (FSM) |
| 4 | **Network / timing failure mid-set** | Set stops; never catches up or resumes; routes to grounding + closure. | Partial now (rule); full needs UI |
| 5 | **Stop-control reachability under load** | One-tap Ground-Me halts immediately, locks stimulation, no return — even under rapid input / high distress. | Needs UI |
| 6 | **Output-guard on the cue bank** | No during-set cue can emit a reprocessing instruction / simulated feeling / monitoring claim; deterministic fallback on any violation. | Now (companion-guard) |
| 7 | **Closure cannot be skipped** | No path (abort, timeout, crash, network drop) ends a session without the mandatory ≥120 s closure + orientation + stability check. | Needs UI + FSM wiring |
| 8 | **Starting-SUDS gate bypass** | Cannot start a set with starting SUDS > 5, by any input ordering. | Now (FSM `preSessionCheck`) |
| 9 | **Crisis input during a session** | Scripted present-safety + jurisdiction-aware resources; never AI-generated; never implies live monitoring. | Now (rules) + UI |
| 10 | **Contraindicated user reaches a set** | Excluded users (dissociation, acute-trauma window, standing restrictions, not-safe-today) never get a BLS set offered. | Now (engine gate) |
| 11 | **Consent bypass** | No BLS set without an unrevoked processing-session consent at the current version. | After consent wiring |
| 12 | **Set-extension pressure** | The system never extends a set based on inferred processing (no clinician reading the client); length is fixed/conservative. | By design (verify) |

## Status — 2026-07-22 (updated after the 4a build)
**Now covered by passing tests** (`tests/bls-redteam.test.ts` +
`tests/bls-resourcing-session.test.ts`; suite 190/190):
- dissociation/orientation stop, SUDS-spike containment, "stuck"→closure,
  Ground-Me lock, output-guard on cues, closure floor, starting-SUDS gate,
  no-set-extension (engine/FSM);
- **resourcing clinical-exclusion gate** — crisis / human-review / grounding-only /
  missing-checkin all blocked, steady day allowed (`resourcingClinicallyBlocked`);
- **closure-cannot-be-skipped** — `completed` is reachable ONLY through the enforced
  ≥120 s closure; no other reducer transition yields it;
- **timing/failure-stops** — `BlsStimulus.onFailure` routes to Ground-Me → closure
  (wired in `ResourcingSession`; reducer path tested).

- **consent bypass** — CLOSED. `tests/bls-consent-gate.test.ts` (hermetic temp DB):
  no unrevoked processing consent → resourcing unavailable even with the flag on;
  grant → available; revoke → unavailable; BLS kill switch overrides a granted consent.

**Remaining — verified in human-factors testing (browser), not node-testable:**
- **stop-control salience under load** — the one-tap stop is always rendered during
  set/prep/between; "reachable under stress" is a UX property for the human-factors
  pass.
- **live crisis input during a set** — N/A to 4a: resourcing takes no voice/free-text
  input during a set (directive cues only). This is a 4b/live-session scenario.

**Net:** every BLS red-team scenario that can be closed in code is closed
(`tests/bls-redteam.test.ts`, `bls-resourcing-session.test.ts`, `bls-consent-gate.test.ts`);
the only open items are the UX-salience check (human-factors) and the N/A live-input
scenario.

## Pass / closure criteria
- Every scenario has a passing automated test on the built feature.
- **No unresolved critical/high finding.** Any found → fix + re-test before Phase-4.
- Scenarios 1–3, 6, 8, 10 can be run now against the FSM/engine and added to the
  suite immediately (before the stimulus generator exists) — recommended, so the
  safety core is red-teamed independently of the UI.

## Deliverable
A red-team closure record (like [`../evidence/04-red-team-closure.md`](../evidence/04-red-team-closure.md))
listing each scenario, its test, and its verdict. Clinician reviews the scenario
set for completeness (are there failure modes we haven't listed?).
