import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newSession,
  preSessionCheck,
  postSet,
  authorizeSet,
  groundMe,
  tick,
  completeClosure,
  canOfferNextSet,
  type SessionState,
} from "../src/lib/safety/session.ts";

const T0 = 1_800_000_000_000;
const MIN = 60_000;

function authorized(startSuds = 3): SessionState {
  const d = preSessionCheck(newSession(T0), startSuds);
  assert.equal(d.action, "authorize_set");
  return d.state;
}

test("starting SUDS above the beta ceiling denies stimulation", () => {
  const d = preSessionCheck(newSession(T0), 6);
  assert.equal(d.action, "deny_stimulation");
  assert.equal(d.state.phase, "denied");
  assert.equal(d.allowNextSet, false);
});

test("starting SUDS within ceiling authorizes and records start", () => {
  const d = preSessionCheck(newSession(T0), 4);
  assert.equal(d.action, "authorize_set");
  assert.equal(d.state.startSuds, 4);
  assert.equal(d.state.lastSuds, 4);
});

test("post-set +2 delta → containment + 48h cooldown + lock", () => {
  const d = postSet(authorized(3), { suds: 5, dissociation: 0, oriented: true }, T0 + MIN);
  assert.equal(d.action, "containment");
  assert.equal(d.state.stimulationLocked, true);
  assert.equal(d.effects.cooldownHours, 48);
  assert.equal(d.effects.lockStimulation, true);
});

test("absolute SUDS ≥8 → containment", () => {
  const d = postSet(authorized(3), { suds: 8, dissociation: 0, oriented: true }, T0 + MIN);
  assert.equal(d.action, "containment");
  assert.equal(d.effects.alert, "suds_absolute");
});

test("SUDS ≥9 → hard-stop containment", () => {
  const d = postSet(authorized(5), { suds: 9, dissociation: 0, oriented: true }, T0 + MIN);
  assert.equal(d.action, "containment");
  assert.equal(d.effects.alert, "suds_hard_stop");
});

test("rise ≥3 over the starting SUDS → containment", () => {
  const d = postSet(authorized(2), { suds: 5, dissociation: 0, oriented: true }, T0 + MIN);
  assert.equal(d.action, "containment");
  assert.equal(d.effects.alert, "suds_rise_over_start");
});

test("dissociation ≥4 stops the exercise (containment)", () => {
  const d = postSet(authorized(3), { suds: 3, dissociation: 4, oriented: true }, T0 + MIN);
  assert.equal(d.action, "containment");
  assert.equal(d.effects.alert, "dissociation_stop");
});

test("loss of orientation → containment + requireOrientation", () => {
  const d = postSet(authorized(3), { suds: 3, dissociation: 0, oriented: false }, T0 + MIN);
  assert.equal(d.action, "containment");
  assert.equal(d.effects.requireOrientation, true);
});

test("single +1 → pause (not containment)", () => {
  const d = postSet(authorized(3), { suds: 4, dissociation: 0, oriented: true }, T0 + MIN);
  assert.equal(d.action, "pause");
});

test("two consecutive +1 rises → containment", () => {
  const s1 = postSet(authorized(2), { suds: 3, dissociation: 0, oriented: true }, T0 + MIN); // +1 pause
  assert.equal(s1.action, "pause");
  const s2 = postSet(s1.state, { suds: 4, dissociation: 0, oriented: true }, T0 + 2 * MIN); // +1 again
  assert.equal(s2.action, "containment");
  assert.equal(s2.effects.alert, "suds_two_rises");
});

test("no change across two sets → closure (stuck is a stop signal)", () => {
  const s1 = postSet(authorized(4), { suds: 4, dissociation: 0, oriented: true }, T0 + MIN);
  assert.equal(s1.action, "offer_next_set");
  const s2 = postSet(s1.state, { suds: 4, dissociation: 0, oriented: true }, T0 + 2 * MIN);
  assert.equal(s2.action, "closure");
});

test("stable/improved offers another set, then closes at the 2-set beta max", () => {
  const s1 = postSet(authorized(5), { suds: 3, dissociation: 0, oriented: true }, T0 + MIN);
  assert.equal(s1.action, "offer_next_set");
  assert.equal(s1.state.setsCompleted, 1);
  const s2 = postSet(s1.state, { suds: 2, dissociation: 0, oriented: true }, T0 + 2 * MIN);
  assert.equal(s2.state.setsCompleted, 2);
  assert.equal(s2.action, "closure"); // max sets reached
  assert.equal(canOfferNextSet(s2.state, T0 + 2 * MIN), false);
});

test("Ground-Me halts immediately, locks stimulation, logs, no return", () => {
  const d = groundMe(authorized(3));
  assert.equal(d.action, "containment");
  assert.equal(d.state.stimulationLocked, true);
  assert.equal(d.effects.alert, "ground_me");
  assert.equal(canOfferNextSet(d.state, T0 + MIN), false);
});

test("wind-down (30 min) stops new sets; hard-stop (40 min) forces closure", () => {
  const s = authorized(3);
  const wind = tick(s, T0 + 31 * MIN);
  assert.equal(wind.allowNextSet, false);
  const hard = tick(s, T0 + 41 * MIN);
  assert.equal(hard.action, "closure");
});

test("closure enforces the mandatory minimum duration", () => {
  const s: SessionState = { ...authorized(3), phase: "closure" };
  const tooShort = completeClosure(s, 3, 90);
  assert.equal(tooShort.action, "closure"); // not yet complete
  const ok = completeClosure(s, 3, 120);
  assert.equal(ok.action, "completed");
  assert.equal(ok.state.phase, "completed");
});

test("never auto-starts: authorizeSet requires an explicit call and respects max/lock", () => {
  const locked = groundMe(authorized(3)).state;
  const d = authorizeSet(locked, T0 + MIN);
  assert.equal(d.action, "closure"); // locked → cannot authorize another set
});
