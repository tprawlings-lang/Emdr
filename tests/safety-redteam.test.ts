// Regression + red-team harness (Autonomous Step 6, Vol V Ch.16/17).
// Golden safety scenarios end-to-end + adversarial attempts to bypass the
// deterministic controls. These run the real engines together.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAccess } from "../src/lib/safety/engine.ts";
import { AccessTier, type SafetyInputs } from "../src/lib/safety/types.ts";
import { preSessionCheck, postSet } from "../src/lib/safety/session.ts";
import { validateCompanionOutput } from "../src/lib/safety/companion-guard.ts";
import { resolveJourneyStage, JourneyStage } from "../src/lib/safety/journey.ts";
import { orchestrateNext } from "../src/lib/safety/orchestrate.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3600 * 1000;

function baseInputs(over: Partial<SafetyInputs> = {}): SafetyInputs {
  return {
    nowMs: NOW,
    programFit: {},
    dailyCheckin: { activation: 2, shutdown: 1, harmUrge: false, feelsSafe: true, dissociation: 0, sleepQuality: 7, substanceFlag: false },
    instruments: {},
    readiness: { track: "steady" },
    ...over,
  };
}

// ── GOLDEN: end-to-end safe routing ─────────────────────────────────────────
test("GOLDEN crisis check-in → engine CRISIS → orchestrator routes to safety pathway", () => {
  const i = baseInputs({ dailyCheckin: { ...baseInputs().dailyCheckin!, harmUrge: true } });
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.CRISIS);
  const o = orchestrateNext(JourneyStage.LongitudinalUse, d);
  assert.equal(o.category, "safety_pathway");
  assert.equal(o.route, "/crisis");
});

test("GOLDEN rising-distress session → containment + 48h cooldown", () => {
  const pre = preSessionCheck({ phase: "created", startSuds: null, lastSuds: null, setsCompleted: 0, sudsHistory: [], consecutiveRises: 0, startedAtMs: NOW, stimulationLocked: false, closureStartedAtMs: null }, 3);
  const d = postSet(pre.state, { suds: 8, dissociation: 0, oriented: true }, NOW + HOUR);
  assert.equal(d.action, "containment");
  assert.equal(d.effects.cooldownHours, 48);
});

// ── ADVERSARIAL: gate-bypass attempts must fail ─────────────────────────────
test("ADVERSARIAL a strong readiness score cannot bypass a crisis (most restrictive wins)", () => {
  const i = baseInputs({
    readiness: { track: "steady" },
    dailyCheckin: { ...baseInputs().dailyCheckin!, feelsSafe: false }, // crisis
  });
  const d = evaluateAccess(i);
  assert.equal(d.tier, AccessTier.CRISIS);
  assert.equal(d.activatingSessionsAllowed, false);
});

test("ADVERSARIAL a trait hard-stop blocks activating even on the steady track", () => {
  const i = baseInputs({ programFit: { substanceDependence: true }, readiness: { track: "steady" } });
  const d = evaluateAccess(i);
  assert.equal(d.dispositions.standingExclusion, true);
  assert.equal(d.activatingSessionsAllowed, false);
});

test("ADVERSARIAL missing check-in cannot be treated as safe", () => {
  const i = baseInputs();
  delete i.dailyCheckin;
  const d = evaluateAccess(i);
  assert.equal(d.groundingOnly, true);
  assert.equal(d.activatingSessionsAllowed, false);
});

test("ADVERSARIAL an active cooldown cannot be out-voted by a good day", () => {
  const i = baseInputs({ activeCooldowns: [{ id: "c", kind: "containment", untilMs: NOW + 24 * HOUR }] });
  const d = evaluateAccess(i);
  assert.equal(d.activatingSessionsAllowed, false);
});

test("ADVERSARIAL the orchestrator never invents an escalation the engine did not flag", () => {
  const clean = evaluateAccess(baseInputs());
  const o = orchestrateNext(JourneyStage.LongitudinalUse, clean);
  assert.notEqual(o.category, "safety_pathway"); // no crisis in the decision → no crisis route
  assert.equal(o.category, "offer_session");
});

// ── ADVERSARIAL: companion output obfuscation must still be caught ──────────
test("ADVERSARIAL obfuscated banned outputs are still flagged", () => {
  assert.equal(validateCompanionOutput("Honestly, I really do care about you so much.").ok, false);
  assert.equal(validateCompanionOutput("The truth is, you are clearly dissociating from all this.").ok, false);
  assert.equal(validateCompanionOutput("Don't worry — help is on the way and someone is watching over you.").ok, false);
  assert.equal(
    validateCompanionOutput("For this exercise, bring up the worst memory and hold the image in mind while you tap.").ok,
    false
  );
});

test("ADVERSARIAL a legitimate trauma-informed reply is not over-blocked", () => {
  const ok = validateCompanionOutput(
    "It sounds like today has been heavy. We could pause, try a grounding exercise together, or keep talking — what feels right?"
  );
  assert.equal(ok.ok, true);
});

// ── Journey overrides ───────────────────────────────────────────────────────
test("GOLDEN elevated-risk signal narrows the journey regardless of progress", () => {
  const stage = resolveJourneyStage({
    hasAccount: true, eligibilityPassed: true, subscribed: true, consented: true,
    baselineComplete: true, profileComplete: true, checkedInToday: true, inActiveSession: false,
    elevatedRisk: true, reentryPending: false, hasProviderConnection: false, disengaged: false, accountClosing: false,
  });
  assert.equal(stage, JourneyStage.ElevatedRisk);
});
