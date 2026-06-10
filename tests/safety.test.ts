// @safety — CI-blocking test suite (compliance packet 4D). Covers the
// deterministic safety rules: fitness-screener hard stops, SUDs thresholds,
// check-in crisis routing, and the crisis keyword pre-filter. Run with
// `npm run test:safety`; this suite must pass on every release that touches
// session or screening code.

import { strict as assert } from "node:assert";
import test from "node:test";
import { sudsDecision } from "../src/lib/session-safety";
import { classifyFitness, FITNESS_ITEMS } from "../src/lib/fitness-screener";
import { evaluateCheckin } from "../src/lib/gating";
import { detectRisk } from "../src/lib/companion";

function allNo(): Record<string, boolean> {
  return Object.fromEntries(FITNESS_ITEMS.map((i) => [i.id, false]));
}

test("fitness screener: all-no passes", () => {
  assert.equal(classifyFitness(allNo()).outcome, "pass");
});

test("fitness screener: every hard-stop item stops alone", () => {
  for (const item of FITNESS_ITEMS.filter((i) => i.onYes === "hard_stop")) {
    const answers = { ...allNo(), [item.id]: true };
    const { outcome, flags } = classifyFitness(answers);
    assert.equal(outcome, "hard_stop", `expected hard stop for ${item.id}`);
    assert.ok(flags.includes(`hard_stop:${item.id}`));
  }
});

test("fitness screener: soft flags do not stop, and never mask a hard stop", () => {
  const soft = FITNESS_ITEMS.find((i) => i.id === "seizure_disorder")!;
  assert.equal(classifyFitness({ ...allNo(), [soft.id]: true }).outcome, "soft_flag");
  const both = { ...allNo(), [soft.id]: true, selfharm_30d: true };
  assert.equal(classifyFitness(both).outcome, "hard_stop");
});

test("suds: 9+ ends the session", () => {
  assert.equal(sudsDecision([4, 9]), "hard_stop");
  assert.equal(sudsDecision([10]), "hard_stop");
});

test("suds: 8 pauses for grounding and a choice", () => {
  assert.equal(sudsDecision([4, 8]), "pause");
  assert.equal(sudsDecision([8]), "pause");
});

test("suds: a rise of 3+ from session start pauses even below 8", () => {
  assert.equal(sudsDecision([2, 5]), "pause");
  assert.equal(sudsDecision([2, 4]), "continue");
});

test("suds: settling distress continues", () => {
  assert.equal(sudsDecision([6, 4, 3]), "continue");
});

test("check-in: harm urge or feeling unsafe routes to crisis", () => {
  const base = {
    activation: 2,
    shutdown: 2,
    harm_urge: false,
    feels_safe: true,
    dissociation: 1,
    sleep_quality: 7,
    substance_flag: false,
  };
  assert.equal(evaluateCheckin({ ...base, harm_urge: true }), "crisis");
  assert.equal(evaluateCheckin({ ...base, feels_safe: false }), "crisis");
  assert.equal(evaluateCheckin({ ...base, dissociation: 8 }), "grounding_only");
  assert.equal(evaluateCheckin(base), "processing_ok");
});

test("companion crisis pre-filter catches risk phrasing", () => {
  const phrases = [
    "I want to kill myself",
    "i've been thinking about suicide",
    "I might hurt myself tonight",
    "I don't want to be here anymore... I want to end it all",
    "I am not safe at home",
    "i keep cutting myself",
  ];
  for (const p of phrases) assert.ok(detectRisk(p), `should flag: ${p}`);
  assert.equal(detectRisk("today was a calm day, I walked the dog"), false);
});
