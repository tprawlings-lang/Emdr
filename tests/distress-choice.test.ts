// "Continue" is never offered at the distress that paused the session
// (Expansion Handoff Phase 0, "member choice offered at high distress").
//
// Written to fail against the session screen as it stood: after a distress
// pause the grounding steps were followed by "I'm steadier — continue gently",
// with no rating asked for, so continuing was on offer at an 8.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  choicesAfterGrounding, sudsDecision, SUDS_HARD_STOP_AT, SUDS_PAUSE_AT, SUDS_RISE_PAUSE,
} from "../src/lib/session-safety";

const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const PLAYER = code(fs.readFileSync(path.join(process.cwd(), "src/components/SessionPlayer.tsx"), "utf8"));

test("before a fresh rating, continuing is not on offer — stopping and help always are", () => {
  const r = choicesAfterGrounding([4, SUDS_PAUSE_AT], null);
  assert.deepEqual(r.choices, ["rate_now", "stop", "get_help"]);
  assert.equal(r.endSession, false);
});

test("a fresh rating still in the pause band offers more grounding, not continue", () => {
  const r = choicesAfterGrounding([4, SUDS_PAUSE_AT], SUDS_PAUSE_AT);
  assert.ok(!r.choices.includes("continue"));
  assert.ok(r.choices.includes("ground_more"));
});

test("a rise since the start holds too, even below the pause line", () => {
  // Started at 2, paused on a rise; a recheck at 5 is still 3 above the start.
  const r = choicesAfterGrounding([2, 2 + SUDS_RISE_PAUSE], 2 + SUDS_RISE_PAUSE);
  assert.ok(!r.choices.includes("continue"), "continue offered on a rise the in-exercise rule pauses on");
});

test("a fresh rating in the hard-stop band ends the session", () => {
  const r = choicesAfterGrounding([4, SUDS_PAUSE_AT], SUDS_HARD_STOP_AT);
  assert.equal(r.endSession, true);
  assert.ok(!r.choices.includes("continue"));
});

test("a fresh rating that has come down offers continue", () => {
  const r = choicesAfterGrounding([4, SUDS_PAUSE_AT], 5);
  assert.deepEqual(r.choices, ["continue", "stop", "get_help"]);
});

test("the return rule is the in-exercise rule — every rating, every trail", () => {
  // One rule, reached two ways, cannot disagree: whatever sudsDecision would
  // let through is exactly what offers continue.
  for (const trail of [[], [0], [3], [2, 8], [5, 7]]) {
    for (let v = 0; v <= 10; v++) {
      const r = choicesAfterGrounding(trail, v);
      assert.equal(r.choices.includes("continue"), sudsDecision([...trail, v]) === "continue", `${JSON.stringify(trail)} + ${v}`);
      assert.ok(r.choices.includes("stop") && r.choices.includes("get_help"), "stopping must always be offered");
    }
  }
});

test("the session screen only shows continue when the rule offers it", () => {
  assert.match(PLAYER, /choicesAfterGrounding\(/, "the session screen does not use the rule");
  const at = PLAYER.indexOf("continue gently");
  assert.ok(at > 0, "the continue button is gone — update this test with where it went");
  const before = PLAYER.slice(Math.max(0, at - 900), at);
  assert.match(before, /returnChoices\?\.includes\("continue"\)\s*&&/, "continue is rendered without the rule's say-so");
  // The rating joins the trail the session is closed on.
  assert.match(PLAYER, /const trail = \[\.\.\.sudsTrail, recheckSuds\];/);
});
