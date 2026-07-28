// BLS-session red-team harness (Part-6 gate 2, docs/autonomous/bls-validation).
// Adversarial scenarios for the bilateral-stimulation session, run against the
// deterministic pieces that already exist (session FSM + engine + output guard).
// The remaining scenarios (network/timing failure, stop-control-under-load in the
// UI, closure-cannot-be-skipped end-to-end, live crisis input, consent bypass)
// require the stimulus generator + session UI and are added when that lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newSession,
  preSessionCheck,
  postSet,
  groundMe,
  completeClosure,
  canOfferNextSet,
} from "../src/lib/safety/session.ts";
import { SESSION } from "../src/lib/safety/config.ts";
import { evaluateAccess } from "../src/lib/safety/engine.ts";
import { resourcingClinicallyBlocked } from "../src/lib/safety/resourcing.ts";
import { validateCompanionOutput } from "../src/lib/safety/companion-guard.ts";
import type { SafetyInputs } from "../src/lib/safety/types.ts";
import { AccessTier } from "../src/lib/safety/types.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3600 * 1000;

/** An authorized session that has passed the pre-session gate at a given start SUDS. */
function authorized(startSuds: number) {
  return preSessionCheck(newSession(NOW), startSuds).state;
}

function clearInputs(): SafetyInputs {
  return {
    nowMs: NOW,
    programFit: {},
    dailyCheckin: { activation: 2, shutdown: 1, harmUrge: false, feelsSafe: true, dissociation: 0, sleepQuality: 7, substanceFlag: false },
    instruments: {},
    readiness: { track: "steady" },
  };
}

// ── 1. Dissociation / orientation mid-set → immediate stop ──────────────────
test("BLS RED: not oriented to present mid-set → containment + lock + re-orient (overrides SUDS)", () => {
  const d = postSet(authorized(3), { suds: 2, dissociation: 0, oriented: false }, NOW + HOUR);
  assert.equal(d.action, "containment");
  assert.equal(d.state.stimulationLocked, true);
  assert.equal(d.effects.requireOrientation, true);
});

test("BLS RED: in-session dissociation at the stop threshold → containment", () => {
  const d = postSet(authorized(3), { suds: 2, dissociation: SESSION.dissociationStop, oriented: true }, NOW + HOUR);
  assert.equal(d.action, "containment");
  assert.equal(d.state.stimulationLocked, true);
});

// ── 2. Abreaction / SUDS spike → containment ────────────────────────────────
test("BLS RED: post-set SUDS at the hard-stop level → containment", () => {
  const d = postSet(authorized(4), { suds: SESSION.hardStopSuds, dissociation: 0, oriented: true }, NOW + HOUR);
  assert.equal(d.action, "containment");
  assert.equal(d.state.stimulationLocked, true);
});

// ── 3. "Stuck is a stop signal" ─────────────────────────────────────────────
test("BLS RED: no SUDS change across the no-change window → closure, not endless sets", () => {
  let s = authorized(4);
  for (let i = 0; i < SESSION.noChangeSets; i++) {
    s = postSet(s, { suds: 4, dissociation: 0, oriented: true }, NOW + HOUR).state;
  }
  const d = postSet(s, { suds: 4, dissociation: 0, oriented: true }, NOW + HOUR);
  assert.equal(d.action, "closure");
  assert.equal(d.state.stimulationLocked, true);
});

// ── 5. Ground-Me: one-tap halt, no return ───────────────────────────────────
test("BLS RED: Ground-Me halts immediately, locks stimulation, and no further set can be offered", () => {
  const d = groundMe(authorized(3));
  assert.equal(d.state.stimulationLocked, true);
  assert.equal(canOfferNextSet(d.state, NOW + HOUR), false);
});

// ── 6. Output guard on during-set cues ──────────────────────────────────────
test("BLS RED: a during-set cue can never emit a reprocessing instruction", () => {
  assert.equal(
    validateCompanionOutput("Bring up the worst memory and hold the image in mind while you tap.").ok,
    false
  );
  assert.equal(validateCompanionOutput("Stay with the memory and don't stop until it drops.").ok, false);
  // An approved directive cue passes.
  assert.equal(validateCompanionOutput("Go with that. Just notice what comes up, and take a breath.").ok, true);
});

// ── 7. Mandatory closure floor ──────────────────────────────────────────────
test("BLS RED: closure cannot complete below the mandatory minimum duration", () => {
  const s = { ...newSession(NOW), phase: "closure" as const };
  const short = completeClosure(s, 2, SESSION.closureMinSeconds - 1);
  assert.notEqual(short.action, "completed");
  const ok = completeClosure(s, 2, SESSION.closureMinSeconds);
  assert.equal(ok.action, "completed");
});

// ── 8. Starting-SUDS gate ───────────────────────────────────────────────────
test("BLS RED: starting SUDS above the ceiling denies stimulation (no set starts)", () => {
  const d = preSessionCheck(newSession(NOW), SESSION.startingSudsCeiling + 1);
  assert.equal(d.action, "deny_stimulation");
  assert.equal(d.state.phase, "denied");
  assert.equal(d.allowNextSet, false);
});

// ── 10. Contraindicated user never cleared for an activating session ─────────
test("BLS RED: contraindicated inputs never yield an activating session", () => {
  // Diagnosis/history → restricted pending human review, activating blocked.
  const dx = clearInputs();
  dx.programFit!.psychoticOrDissociativeDx = true;
  const ddx = evaluateAccess(dx);
  assert.equal(ddx.dispositions.humanReviewPending, true);
  assert.equal(ddx.activatingSessionsAllowed, false);

  // High daily dissociation → grounding only, activating blocked.
  const diss = clearInputs();
  diss.dailyCheckin!.dissociation = 8;
  const ddiss = evaluateAccess(diss);
  assert.equal(ddiss.tier, AccessTier.GROUNDING_ONLY);
  assert.equal(ddiss.activatingSessionsAllowed, false);
});

// ── 10b. Resourcing (4a) clinical exclusion gate ────────────────────────────
test("BLS RED: resourcing is clinically blocked for contraindicated states", () => {
  const crisis = clearInputs();
  crisis.dailyCheckin!.harmUrge = true;
  assert.equal(resourcingClinicallyBlocked(evaluateAccess(crisis)), true);

  const dx = clearInputs();
  dx.programFit!.psychoticOrDissociativeDx = true; // human-review pending
  assert.equal(resourcingClinicallyBlocked(evaluateAccess(dx)), true);

  const diss = clearInputs();
  diss.dailyCheckin!.dissociation = 8; // grounding-only day
  assert.equal(resourcingClinicallyBlocked(evaluateAccess(diss)), true);

  const missing = clearInputs();
  delete missing.dailyCheckin; // no check-in → grounding only
  assert.equal(resourcingClinicallyBlocked(evaluateAccess(missing)), true);

  // A steady, clear day is allowed (stabilization+ tier, no exclusion).
  assert.equal(resourcingClinicallyBlocked(evaluateAccess(clearInputs())), false);
});

// ── 12. No adaptive set extension beyond the fixed maximum ───────────────────
test("BLS RED: no set may be offered beyond the fixed max (no clinician-style extension)", () => {
  let s = authorized(3);
  // Complete the max number of sets with a gently improving trajectory.
  const readings = [3, 2, 1];
  for (let i = 0; i < SESSION.maxSets; i++) {
    s = postSet(s, { suds: readings[i] ?? 1, dissociation: 0, oriented: true }, NOW + HOUR).state;
  }
  assert.equal(s.setsCompleted, SESSION.maxSets);
  assert.equal(canOfferNextSet(s, NOW + HOUR), false);
});
