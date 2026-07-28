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

test("clear member reaches steady tier but activating sessions are OFF in beta (no autonomous BLS)", () => {
  const d = evaluateAccess(clearInputs());
  assert.equal(d.tier, AccessTier.STEADY);
  assert.equal(d.groundingOnly, false);
  // Clinical-review revision: beta runs no autonomous BLS/reprocessing, so the
  // stimulation capability is off globally and no activating session may start.
  assert.equal(d.capabilities.stimulation, false);
  assert.equal(d.activatingSessionsAllowed, false);
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

test("recent self-harm HISTORY → grounding + present-safety clarification (not automatic crisis)", () => {
  // Clinical-review revision: a 30-day history flag alone is not present crisis.
  const i = clearInputs();
  i.programFit!.selfHarm30d = true;
  i.programFit!.stateHardStopAtMs = NOW;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.GROUNDING_ONLY);
  assert.equal(d.dispositions.presentSafetyClarificationRequired, true);
  assert.equal(d.dispositions.referralSurfaced, true);
  assert.equal(d.dispositions.crisis, false);
  assert.equal(d.dispositions.autoRefund, false);
});

test("hospitalization HISTORY → restricted pending human review + referral, no standing exclusion", () => {
  // Clinical-review revision: diagnosis/history → human review, not an indefinite ban.
  const i = clearInputs();
  i.programFit!.hospitalized12m = true;
  const d = evaluateAccess(i);
  assert.equal(d.dispositions.humanReviewPending, true);
  assert.equal(d.dispositions.standingExclusion, false);
  assert.equal(d.dispositions.referralSurfaced, true);
  assert.equal(d.activatingSessionsAllowed, false);
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

test("low sleep → cautious (review trigger); substance flag → stabilization", () => {
  // Clinical-review revision: low sleep reduces demand + prompts a check, rather
  // than imposing a universal stabilization restriction.
  const a = clearInputs();
  a.dailyCheckin!.sleepQuality = 2;
  const da = evaluateAccess(a);
  assert.equal(da.tier, AccessTier.CAUTIOUS);
  assert.equal(da.dispositions.reviewTriggered, true);
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

test("PHQ-9 item 9 nonzero → stabilization + present-safety clarification (no fixed 72h lockout)", () => {
  // Clinical-review revision: nonzero item 9 → present-risk clarification, not a
  // standalone fixed 72-hour lockout. Response depends on present intent/means/action.
  const i = clearInputs();
  i.instruments!.phq9Item9 = 1;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.STABILIZATION);
  assert.equal(d.dispositions.presentSafetyClarificationRequired, true);
  assert.equal(d.dispositions.safetyQuestionRequired, true);
  assert.equal(d.dispositions.referralSurfaced, true);
  assert.equal(d.dispositions.forcedStabilizationUntil, null);
});

test("PCL-5 item 16 ≥3 is a context prompt only, NOT a suicide-routing safety item", () => {
  // Clinical-review revision: item 16 = risk-taking behavior, not suicidal
  // ideation. De-scoped from safety routing → review trigger only, no lockout.
  const i = clearInputs();
  i.instruments!.pcl5Item16 = 3;
  const d = evaluateAccess(i);
  assert.equal(d.dispositions.safetyQuestionRequired, false);
  assert.equal(d.dispositions.forcedStabilizationUntil, null);
  assert.equal(d.dispositions.reviewTriggered, true);
  assert.equal(d.tier, AccessTier.STEADY); // no tier change
  assert.ok(d.hits.some((h) => h.id === "PCL5_ITEM16_CONTEXT"));
});

test("DES-II is inert in beta (omitted until licensed + validated)", () => {
  // Clinical-review revision (ledger A9): DES-II not surfaced/scored in beta.
  const hi = clearInputs();
  hi.instruments!.des2Mean = 35;
  const dh = evaluateAccess(hi);
  assert.equal(dh.tier, AccessTier.STEADY); // no DES-forced stabilization
  assert.equal(dh.capabilities.imagery, true); // DES no longer removes imagery
  assert.ok(!dh.hits.some((h) => h.id.startsWith("DES2_")));

  const lo = clearInputs();
  lo.instruments!.des2Mean = 25;
  const dl = evaluateAccess(lo);
  assert.equal(dl.capabilities.imagery, true);
  assert.equal(dl.tier, AccessTier.STEADY);
});

test("photosensitivity removes visual stimulation", () => {
  const i = clearInputs();
  i.programFit!.seizureOrPhotosensitive = true;
  const d = evaluateAccess(i);
  assert.equal(d.capabilities.visualStimulation, false);
});

test("weekly worsening → review trigger + referral, not an automatic ceiling", () => {
  // Clinical-review revision: a sharp rise triggers fresh check-in + human
  // review, not an automatic 14-day cautious ceiling.
  const i = clearInputs();
  i.instruments!.pcl5WeeklyRise = 10;
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.STEADY); // no automatic tier drop
  assert.equal(d.dispositions.reviewTriggered, true);
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

test("expired cooldown does not restrict the tier", () => {
  const i = clearInputs();
  i.activeCooldowns = [{ id: "cd1", kind: "mild", untilMs: NOW - HOUR }];
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.STEADY);
  // Activating remains off in beta (no autonomous BLS), but the expired cooldown
  // adds no further restriction and stabilization/grounding stay open.
  assert.equal(d.dispositions.cooldownUntil, null);
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
