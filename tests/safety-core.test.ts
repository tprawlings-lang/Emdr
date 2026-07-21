import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAccess, buildRoutingAuditDetail } from "../src/lib/safety/engine.ts";
import { AccessTier } from "../src/lib/safety/types.ts";
import type { SafetyInputs } from "../src/lib/safety/types.ts";

const NOW = 1_800_000_000_000; // fixed for determinism
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// A fully-clear member: fresh safe check-in, steady track, nothing flagged.
function clearInputs(): SafetyInputs {
  return {
    nowMs: NOW,
    programFit: {},
    dailyCheckin: {
      activation: 2,
      shutdown: 1,
      harmUrge: false,
      feelsSafe: true,
      dissociation: 0,
      sleepQuality: 7,
      substanceFlag: false,
    },
    instruments: {},
    readiness: { track: "steady" },
  };
}

test("clear member on steady track may start an activating session", () => {
  const d = evaluateAccess(clearInputs());
  assert.equal(d.tier, AccessTier.STEADY);
  assert.equal(d.activatingSessionsAllowed, true);
  assert.equal(d.groundingOnly, false);
  assert.equal(d.capabilities.stimulation, true);
  // Visual BLS is off globally in beta regardless.
  assert.equal(d.capabilities.visualStimulation, false);
  assert.equal(d.hits.length, 0);
});

test("harm urge forces CRISIS and blocks activating sessions", () => {
  const i = clearInputs();
  i.dailyCheckin!.harmUrge = true;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.CRISIS);
  assert.equal(d.dispositions.crisis, true);
  assert.equal(d.activatingSessionsAllowed, false);
  assert.equal(d.groundingOnly, true);
  assert.match(d.primaryReason ?? "", /harm/i);
});

test("cannot-keep-safe forces CRISIS", () => {
  const i = clearInputs();
  i.dailyCheckin!.feelsSafe = false;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.CRISIS);
  assert.equal(d.dispositions.crisis, true);
});

test("under-18 is a standing exclusion at CRISIS tier", () => {
  const i = clearInputs();
  i.programFit!.under18 = true;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.CRISIS);
  assert.equal(d.dispositions.standingExclusion, true);
  assert.equal(d.activatingSessionsAllowed, false);
});

test("state hard-stop (recent self-harm) → crisis, auto-refund, 14-day retake", () => {
  const i = clearInputs();
  i.programFit!.selfHarm30d = true;
  i.programFit!.stateHardStopAtMs = NOW;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.CRISIS);
  assert.equal(d.dispositions.autoRefund, true);
  assert.equal(d.dispositions.retakeAllowedAt, NOW + 14 * DAY);
});

test("trait hard-stop (hospitalization) → standing exclusion + referral, no auto-refund", () => {
  const i = clearInputs();
  i.programFit!.hospitalized12m = true;
  const d = evaluateAccess(i);
  assert.equal(d.dispositions.standingExclusion, true);
  assert.equal(d.dispositions.referralSurfaced, true);
  assert.equal(d.dispositions.autoRefund, false);
});

test("missing check-in never defaults favorably (grounding only)", () => {
  const i = clearInputs();
  delete i.dailyCheckin;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.GROUNDING_ONLY);
  assert.equal(d.activatingSessionsAllowed, false);
  assert.equal(d.capabilities.stimulation, false);
  assert.ok(d.hits.some((h) => h.id === "MISSING_CHECKIN"));
});

test("daily dissociation ≥7 → grounding only; 4–6 → stabilization", () => {
  const a = clearInputs();
  a.dailyCheckin!.dissociation = 7;
  assert.equal(evaluateAccess(a).tier, AccessTier.GROUNDING_ONLY);

  const b = clearInputs();
  b.dailyCheckin!.dissociation = 5;
  const db = evaluateAccess(b);
  assert.equal(db.tier, AccessTier.STABILIZATION);
  assert.equal(db.activatingSessionsAllowed, false);
});

test("activation ≥8 and shutdown ≥8 → grounding only", () => {
  const a = clearInputs();
  a.dailyCheckin!.activation = 8;
  assert.equal(evaluateAccess(a).tier, AccessTier.GROUNDING_ONLY);
  const b = clearInputs();
  b.dailyCheckin!.shutdown = 9;
  assert.equal(evaluateAccess(b).tier, AccessTier.GROUNDING_ONLY);
});

test("low sleep and substance flag → stabilization", () => {
  const a = clearInputs();
  a.dailyCheckin!.sleepQuality = 2;
  assert.equal(evaluateAccess(a).tier, AccessTier.STABILIZATION);
  const b = clearInputs();
  b.dailyCheckin!.substanceFlag = true;
  assert.equal(evaluateAccess(b).tier, AccessTier.STABILIZATION);
});

test("most restrictive wins when several rules fire", () => {
  const i = clearInputs();
  i.dailyCheckin!.sleepQuality = 2; // stabilization
  i.dailyCheckin!.dissociation = 8; // grounding only (lower)
  i.instruments!.pcl5WeeklyRise = 12; // cautious (higher)
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.GROUNDING_ONLY); // the minimum
  assert.ok(d.hits.length >= 3);
});

test("PHQ-9 item 9 nonzero → stabilization + safety question + referral + 72h forced stabilization", () => {
  const i = clearInputs();
  i.instruments!.phq9Item9 = 1;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.STABILIZATION);
  assert.equal(d.dispositions.safetyQuestionRequired, true);
  assert.equal(d.dispositions.referralSurfaced, true);
  assert.equal(d.dispositions.forcedStabilizationUntil, NOW + 72 * HOUR);
  assert.equal(d.activatingSessionsAllowed, false); // forced stabilization active
});

test("PCL-5 item 16 ≥3 behaves like a safety item", () => {
  const i = clearInputs();
  i.instruments!.pcl5Item16 = 3;
  const d = evaluateAccess(i);
  assert.equal(d.dispositions.safetyQuestionRequired, true);
  assert.equal(d.dispositions.forcedStabilizationUntil, NOW + 72 * HOUR);
});

test("DES-II ≥30 → stabilization, imagery + stimulation removed, referral", () => {
  const i = clearInputs();
  i.instruments!.des2Mean = 35;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.STABILIZATION);
  assert.equal(d.capabilities.imagery, false);
  assert.equal(d.capabilities.stimulation, false);
  assert.equal(d.dispositions.referralSurfaced, true);
});

test("DES-II 20–29.99 → imagery removed but tier unaffected", () => {
  const i = clearInputs();
  i.instruments!.des2Mean = 25;
  const d = evaluateAccess(i);
  assert.equal(d.capabilities.imagery, false);
  assert.equal(d.tier, AccessTier.STEADY);
});

test("photosensitivity removes visual stimulation", () => {
  const i = clearInputs();
  i.programFit!.seizureOrPhotosensitive = true;
  const d = evaluateAccess(i);
  assert.equal(d.capabilities.visualStimulation, false);
});

test("weekly worsening → 14-day cautious ceiling + referral", () => {
  const i = clearInputs();
  i.instruments!.pcl5WeeklyRise = 10;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.CAUTIOUS);
  assert.equal(d.dispositions.referralSurfaced, true);
});

test("active cooldown blocks activating content and sets cooldownUntil", () => {
  const i = clearInputs();
  const until = NOW + 48 * HOUR;
  i.activeCooldowns = [{ id: "cd1", kind: "containment", untilMs: until }];
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.STABILIZATION);
  assert.equal(d.activatingSessionsAllowed, false);
  assert.equal(d.dispositions.cooldownUntil, until);
});

test("expired cooldown does not restrict", () => {
  const i = clearInputs();
  i.activeCooldowns = [{ id: "cd1", kind: "mild", untilMs: NOW - HOUR }];
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.STEADY);
  assert.equal(d.activatingSessionsAllowed, true);
});

test("acute trauma <30 days → grounding only, no stimulation", () => {
  const i = clearInputs();
  i.daysSinceAcuteTrauma = 10;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.GROUNDING_ONLY);
  assert.equal(d.capabilities.stimulation, false);
});

test("readiness caps: riskFlag → crisis; lessThanSafe → stabilization; pauseCapacityNo → cautious no-stim", () => {
  const risk = clearInputs();
  risk.readiness = { track: "steady", riskFlag: true };
  assert.equal(evaluateAccess(risk).tier, AccessTier.CRISIS);

  const unsafe = clearInputs();
  unsafe.readiness = { track: "steady", lessThanFullySafe: true };
  assert.equal(evaluateAccess(unsafe).tier, AccessTier.STABILIZATION);

  const pause = clearInputs();
  pause.readiness = { track: "steady", pauseCapacityNo: true };
  const dp = evaluateAccess(pause);
  assert.equal(dp.tier, AccessTier.CAUTIOUS);
  assert.equal(dp.capabilities.stimulation, false);
});

test("readiness track caps the ceiling (grounding track cannot activate)", () => {
  const i = clearInputs();
  i.readiness = { track: "grounding" };
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.GROUNDING_ONLY);
  assert.equal(d.activatingSessionsAllowed, false);
});

test("evaluation is deterministic (same inputs → identical output)", () => {
  const i = clearInputs();
  i.dailyCheckin!.dissociation = 5;
  assert.deepEqual(evaluateAccess(i), evaluateAccess(i));
});

test("audit detail is content-free: only ids, coded scores, rule ids", () => {
  const i = clearInputs();
  i.programFit!.hospitalized12m = true;
  i.instruments!.phq9Item9 = 2;
  const d = evaluateAccess(i);
  const detail = buildRoutingAuditDetail(i, d);
  assert.ok(Array.isArray(detail.rules));
  assert.ok(detail.rules.includes("FIT_HOSPITALIZATION_12M"));
  assert.ok(detail.rules.includes("CRISIS_PHQ9_ITEM9"));
  assert.equal(detail.inputs.phq9Item9, 2);
  assert.ok(detail.inputs.programFitFlags.includes("hospitalized12m"));
  // No free-text fields anywhere.
  const json = JSON.stringify(detail);
  assert.ok(!json.includes("undefined"));
});
