import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JourneyStage,
  STAGE_OWNER,
  resolveJourneyStage,
  type JourneySignals,
} from "../src/lib/safety/journey.ts";
import { orchestrateNext } from "../src/lib/safety/orchestrate.ts";
import { AccessTier, type AccessDecision } from "../src/lib/safety/types.ts";

function signals(over: Partial<JourneySignals> = {}): JourneySignals {
  return {
    hasAccount: true,
    eligibilityPassed: true,
    subscribed: true,
    consented: true,
    baselineComplete: true,
    profileComplete: true,
    checkedInToday: true,
    inActiveSession: false,
    elevatedRisk: false,
    reentryPending: false,
    hasProviderConnection: false,
    disengaged: false,
    accountClosing: false,
    ...over,
  };
}

function access(over: Partial<AccessDecision> = {}): AccessDecision {
  return {
    tier: AccessTier.STEADY,
    tierLabel: "steady",
    capabilities: { stimulation: true, visualStimulation: false, imagery: true },
    activatingSessionsAllowed: true,
    groundingOnly: false,
    dispositions: {
      crisis: false, safetyQuestionRequired: false, referralSurfaced: false,
      standingExclusion: false, autoRefund: false, cooldownUntil: null,
      forcedStabilizationUntil: null, retakeAllowedAt: null,
    },
    hits: [],
    primaryReason: null,
    ...over,
  };
}

// ── Journey resolution ───────────────────────────────────────────────────────
test("elevated risk and account closure override ordinary progression", () => {
  assert.equal(resolveJourneyStage(signals({ elevatedRisk: true })), JourneyStage.ElevatedRisk);
  assert.equal(resolveJourneyStage(signals({ accountClosing: true, elevatedRisk: true })), JourneyStage.AccountClosure);
});

test("pipeline gates resolve in order", () => {
  assert.equal(resolveJourneyStage(signals({ hasAccount: false })), JourneyStage.Discovery);
  assert.equal(resolveJourneyStage(signals({ eligibilityPassed: false })), JourneyStage.Eligibility);
  assert.equal(resolveJourneyStage(signals({ subscribed: false })), JourneyStage.AccountCreation);
  assert.equal(resolveJourneyStage(signals({ consented: false })), JourneyStage.Orientation);
  assert.equal(resolveJourneyStage(signals({ baselineComplete: false })), JourneyStage.BaselinePreparation);
  assert.equal(resolveJourneyStage(signals({ profileComplete: false })), JourneyStage.GoalFormation);
});

test("in-loop stages resolve", () => {
  assert.equal(resolveJourneyStage(signals({ reentryPending: true })), JourneyStage.Return);
  assert.equal(resolveJourneyStage(signals({ inActiveSession: true })), JourneyStage.ModuleParticipation);
  assert.equal(resolveJourneyStage(signals({ checkedInToday: false })), JourneyStage.ModuleSelection);
  assert.equal(resolveJourneyStage(signals()), JourneyStage.LongitudinalUse);
});

test("safety-relevant stages are owned by the deterministic safety layer", () => {
  assert.equal(STAGE_OWNER[JourneyStage.Eligibility], "deterministic_safety");
  assert.equal(STAGE_OWNER[JourneyStage.ElevatedRisk], "deterministic_safety");
  assert.equal(STAGE_OWNER[JourneyStage.Return], "deterministic_safety");
  assert.equal(STAGE_OWNER[JourneyStage.ProviderReview], "clinician");
});

// ── Orchestration ────────────────────────────────────────────────────────────
test("crisis access routes to the safety pathway from any stage", () => {
  const d = orchestrateNext(
    JourneyStage.LongitudinalUse,
    access({ tier: AccessTier.CRISIS, dispositions: { ...access().dispositions, crisis: true }, activatingSessionsAllowed: false })
  );
  assert.equal(d.category, "safety_pathway");
  assert.equal(d.route, "/crisis");
});

test("elevated-risk stage routes to safety pathway even if access looks clear", () => {
  const d = orchestrateNext(JourneyStage.ElevatedRisk, access());
  assert.equal(d.category, "safety_pathway");
});

test("orchestrator never invents escalation: clear access in the loop offers a session", () => {
  const d = orchestrateNext(JourneyStage.LongitudinalUse, access());
  assert.equal(d.category, "offer_session");
});

test("pre-dashboard stages route to their gate", () => {
  assert.equal(orchestrateNext(JourneyStage.Orientation, access()).route, "/onboarding");
  assert.equal(orchestrateNext(JourneyStage.BaselinePreparation, access()).category, "route_to_gate");
});

test("tier personalizes the loop offer", () => {
  const grounding = orchestrateNext(
    JourneyStage.LongitudinalUse,
    access({ tier: AccessTier.GROUNDING_ONLY, groundingOnly: true, activatingSessionsAllowed: false })
  );
  assert.equal(grounding.category, "offer_grounding");
  const stab = orchestrateNext(
    JourneyStage.LongitudinalUse,
    access({ tier: AccessTier.STABILIZATION, groundingOnly: false, activatingSessionsAllowed: false })
  );
  assert.equal(stab.category, "offer_stabilization");
});

test("account closure resolves to closed", () => {
  const d = orchestrateNext(JourneyStage.AccountClosure, access());
  assert.equal(d.category, "closed");
});
