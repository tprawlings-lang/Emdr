// engineModuleVerdict — the engine's per-module allow used by the shadow-vs-live
// divergence report. Pure function; exercised with synthetic AccessDecisions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engineModuleVerdict } from "../src/lib/autonomous/divergence.ts";
import { testOpenGated } from "../src/lib/gating.ts";
import { getModule } from "../src/lib/modules.ts";
import { AccessTier, type AccessDecision } from "../src/lib/safety/types.ts";

const NOW = 1_700_000_000_000;
const calmPlace = getModule("calm-place")!; // autonomous, grounding
const triggerMap = getModule("trigger-map")!; // autonomous, non-grounding
const gated = getModule("recent-trigger")!; // gated / processing

// Minimal decision builder — engineModuleVerdict only reads these fields.
function decision(over: Partial<AccessDecision> & { disp?: Partial<AccessDecision["dispositions"]> } = {}): AccessDecision {
  const { disp, ...rest } = over;
  return {
    tier: AccessTier.STEADY,
    tierLabel: "steady",
    capabilities: {} as never,
    activatingSessionsAllowed: true,
    groundingOnly: false,
    dispositions: {
      crisis: false, safetyQuestionRequired: false, referralSurfaced: false, standingExclusion: false,
      autoRefund: false, cooldownUntil: null, forcedStabilizationUntil: null, retakeAllowedAt: null,
      humanReviewPending: false, presentSafetyClarificationRequired: false, jurisdictionAwareResources: false,
      reviewTriggered: false, urgentMedicalReferral: false,
      ...(disp ?? {}),
    } as AccessDecision["dispositions"],
    hits: [],
    primaryReason: null,
    ...rest,
  };
}

test("crisis blocks every module", () => {
  const d = decision({ disp: { crisis: true } });
  assert.equal(engineModuleVerdict(d, calmPlace, NOW), false);
  assert.equal(engineModuleVerdict(d, gated, NOW), false);
});

test("grounding-only allows only grounding modules", () => {
  const d = decision({ tier: AccessTier.GROUNDING_ONLY, groundingOnly: true, activatingSessionsAllowed: false });
  assert.equal(engineModuleVerdict(d, calmPlace, NOW), true);
  assert.equal(engineModuleVerdict(d, triggerMap, NOW), false);
  assert.equal(engineModuleVerdict(d, gated, NOW), false);
});

test("stabilization tier opens autonomous content but not gated", () => {
  const d = decision({ tier: AccessTier.STABILIZATION, activatingSessionsAllowed: false });
  assert.equal(engineModuleVerdict(d, triggerMap, NOW), true);
  assert.equal(engineModuleVerdict(d, gated, NOW), false);
});

test("steady + activating opens gated processing", () => {
  const d = decision({ tier: AccessTier.STEADY, activatingSessionsAllowed: true });
  assert.equal(engineModuleVerdict(d, gated, NOW), true);
});

test("human-review-pending blocks gated even at steady", () => {
  const d = decision({ tier: AccessTier.STEADY, disp: { humanReviewPending: true } });
  assert.equal(engineModuleVerdict(d, gated, NOW), false);
  assert.equal(engineModuleVerdict(d, calmPlace, NOW), true); // grounding still ok
});

test("active cooldown blocks gated", () => {
  const d = decision({ tier: AccessTier.STEADY, disp: { cooldownUntil: NOW + 3_600_000 } });
  assert.equal(engineModuleVerdict(d, gated, NOW), false);
});

test("cautious tier is the floor for gated", () => {
  assert.equal(engineModuleVerdict(decision({ tier: AccessTier.CAUTIOUS }), gated, NOW), true);
  assert.equal(engineModuleVerdict(decision({ tier: AccessTier.STABILIZATION }), gated, NOW), false);
});

test("testOpenGated is inert unless BOTH EMDR_OPEN_GATED=1 and EMDR_DEMO=1", () => {
  const prevOpen = process.env.EMDR_OPEN_GATED;
  const prevDemo = process.env.EMDR_DEMO;
  try {
    delete process.env.EMDR_OPEN_GATED; delete process.env.EMDR_DEMO;
    assert.equal(testOpenGated(), false);
    process.env.EMDR_OPEN_GATED = "1"; // flag on but not a demo build → still inert
    assert.equal(testOpenGated(), false);
    process.env.EMDR_DEMO = "1";
    assert.equal(testOpenGated(), true);
    delete process.env.EMDR_OPEN_GATED; // demo but flag off
    assert.equal(testOpenGated(), false);
  } finally {
    if (prevOpen === undefined) delete process.env.EMDR_OPEN_GATED; else process.env.EMDR_OPEN_GATED = prevOpen;
    if (prevDemo === undefined) delete process.env.EMDR_DEMO; else process.env.EMDR_DEMO = prevDemo;
  }
});
