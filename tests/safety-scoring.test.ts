import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreReadiness } from "../src/lib/safety/readiness.ts";
import {
  mapProgramFit,
  stateHardStopActive,
  traitHardStopActive,
} from "../src/lib/safety/program-fit.ts";

const strong = {
  stability: 9,
  bodySafety: 9,
  presentConnection: 9,
  symptomIntensity: 1,
  sleep: 8,
  support: 8,
  selfReadiness: 9,
  pauseCapacity: 9,
  feelsFullySafe: true,
  riskFlag: false,
};

test("strong readiness lands on the steady track", () => {
  const r = scoreReadiness(strong);
  assert.equal(r.track, "steady");
  assert.ok(r.score >= 61);
  assert.deepEqual(r.caps, { riskFlag: false, lessThanFullySafe: false, pauseCapacityNo: false });
});

test("risk flag forces score 0 and grounding track (caps override formula)", () => {
  const r = scoreReadiness({ ...strong, riskFlag: true });
  assert.equal(r.score, 0);
  assert.equal(r.track, "grounding");
  assert.equal(r.caps.riskFlag, true);
});

test("less-than-fully-safe caps the score at 30 (grounding) even with strong domains", () => {
  const r = scoreReadiness({ ...strong, feelsFullySafe: false });
  assert.ok(r.score <= 30);
  assert.equal(r.track, "grounding");
  assert.equal(r.caps.lessThanFullySafe, true);
});

test("low pause capacity caps at 60 (cautious at best) and flags pauseCapacityNo", () => {
  const r = scoreReadiness({ ...strong, pauseCapacity: 1 });
  assert.ok(r.score <= 60);
  assert.notEqual(r.track, "steady");
  assert.equal(r.caps.pauseCapacityNo, true);
});

test("most-restrictive cap wins when several caps apply", () => {
  const r = scoreReadiness({ ...strong, feelsFullySafe: false, pauseCapacity: 0 });
  assert.ok(r.score <= 30); // the tighter cap
  assert.equal(r.track, "grounding");
});

test("program-fit maps state vs trait vs soft flags", () => {
  const answers = {
    selfharm_30d: true,
    unsafe_situation: false,
    psychotic_dissociative_dx: true,
    hospitalization_12m: false,
    substance_coping: false,
    seizure_disorder: true,
    acute_medical: false,
  };
  const pf = mapProgramFit(answers, { under18: false, stateHardStopAtMs: 1000 });
  assert.equal(pf.selfHarm30d, true); // state
  assert.equal(pf.psychoticOrDissociativeDx, true); // trait
  assert.equal(pf.seizureOrPhotosensitive, true); // soft
  assert.equal(pf.hospitalized12m, false);
  assert.equal(pf.stateHardStopAtMs, 1000);
});

test("state hard-stop active within 14-day retake window, clears after", () => {
  const answers = { selfharm_30d: true };
  const at = 1_000_000_000_000;
  const within = at + 5 * 24 * 3600 * 1000;
  const after = at + 15 * 24 * 3600 * 1000;
  assert.equal(stateHardStopActive(answers, at, within), true);
  assert.equal(stateHardStopActive(answers, at, after), false);
  // Unknown time defaults to active (never favorable).
  assert.equal(stateHardStopActive(answers, null, after), true);
});

test("trait hard-stop is detected regardless of time", () => {
  assert.equal(traitHardStopActive({ hospitalization_12m: true }), true);
  assert.equal(traitHardStopActive({ substance_coping: true }), true);
  assert.equal(traitHardStopActive({ seizure_disorder: true }), false); // soft, not trait
  assert.equal(traitHardStopActive({}), false);
});
