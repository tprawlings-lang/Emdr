// A measure this project invented, and the boundary that keeps it honest.
//
// `instruments.ts` holds validated, public-domain instruments: PHQ-9, GAD-7,
// PCL-5, PC-PTSD-5, the ITQ. They are published, studied, normed and cited.
// The Everyday Function check is none of those things — it was written for
// this product and no study anywhere says what its numbers mean.
//
// That difference cannot be a comment. These guards make it structural: a
// house measure cannot be reached through the validated accessor, cannot carry
// a cutoff, cannot decide anything, and cannot be shown without saying what it
// is.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  EVERYDAY_FUNCTION, HOUSE_MEASURES, HOUSE_DISCLOSURE,
  getHouseMeasure, isHouseMeasure, scoreHouseMeasure,
} from "../src/lib/measures/house";
import { INSTRUMENTS, getInstrument } from "../src/lib/instruments";

const ROOT = process.cwd();
const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

test("a house measure is not in the validated instrument list, by either route", () => {
  // The structural half of the boundary. A caller that believes it holds a
  // validated instrument must not be able to receive this one.
  for (const m of HOUSE_MEASURES) {
    assert.equal(getInstrument(m.id), undefined,
      `${m.id} is reachable through getInstrument — the two registries have merged`);
    assert.equal(INSTRUMENTS.some((i) => i.id === (m.id as never)), false,
      `${m.id} is listed among the validated instruments`);
  }
  // And the reverse: the house accessor does not answer for a real instrument.
  assert.equal(getHouseMeasure("phq-9"), undefined,
    "a validated instrument is being served as a house measure");
  assert.equal(isHouseMeasure("phq-9"), false);
});

test("a house measure has no cutoff, and cannot grow one", () => {
  // THE LOAD-BEARING PROHIBITION. A number with a threshold beside it is a
  // claim about what the number MEANS, and there is nothing behind this one to
  // support such a claim. Typed as `null` so it cannot become a number.
  for (const m of HOUSE_MEASURES) {
    assert.equal(m.cutoff, null, `${m.id} has acquired a cutoff`);
    assert.equal(m.validated, false);
  }
  const src = read(path.join(ROOT, "src", "lib", "measures", "house.ts"));
  assert.match(src, /cutoff:\s*null/,
    "the type no longer pins cutoff to null");
  assert.doesNotMatch(code(src), /\bcutoffNote\b|\bseverity\b|\bband\b|\bnorm(al)?Range\b/i,
    "a house measure has grown a band, a severity label or a normal range");
});

test("nothing decides anything from a house measure", () => {
  // It may be answered, stored, and drawn. It may not gate, unlock, route,
  // screen for eligibility or contribute to a safety decision. Checked across
  // the code that makes those decisions rather than by reading the measure.
  const DECIDERS = [
    path.join(ROOT, "src", "lib", "gating.ts"),
    path.join(ROOT, "src", "lib", "safety"),
    path.join(ROOT, "src", "lib", "planning"),
    path.join(ROOT, "src", "lib", "fitness-screener.ts"),
    path.join(ROOT, "src", "lib", "autopilot.ts"),
  ];
  const offenders: string[] = [];
  for (const target of DECIDERS) {
    const files = fs.existsSync(target) && fs.statSync(target).isDirectory()
      ? walk(target) : [target];
    for (const f of files) {
      if (code(read(f)).includes(EVERYDAY_FUNCTION.id)) offenders.push(path.relative(ROOT, f));
    }
  }
  assert.deepEqual(offenders, [],
    "a measure with no evidence behind it is deciding something: " + offenders.join(", "));
});

test("the disclosure travels with the measure", () => {
  // It says the three things a reader needs and none of them is reassuring:
  // who wrote it, that there is no research, and that there is no cutoff.
  assert.match(HOUSE_DISCLOSURE, /not a validated instrument/i);
  assert.match(HOUSE_DISCLOSURE, /no research/i);
  assert.match(HOUSE_DISCLOSURE, /no cutoff/i);
  for (const m of HOUSE_MEASURES) {
    assert.equal(m.disclosure, HOUSE_DISCLOSURE,
      `${m.id} carries its own wording, which is a second thing to keep true`);
  }
});

test("its name cannot be mistaken for a citation", () => {
  // An acronym on a rating scale reads as a reference to a literature. There
  // is no literature. So the title says what it is, in words.
  for (const m of HOUSE_MEASURES) {
    assert.match(m.title, /house measure/i, `${m.title} does not say what it is`);
    assert.doesNotMatch(m.title, /\b[A-Z]{2,}-?\d*\b/,
      `${m.title} reads as an instrument acronym`);
    assert.match(m.version, /unapproved/,
      `${m.id}'s version does not record that it carries no sign-off`);
  }
});

test("it asks what someone could do, not how they felt", () => {
  // The reason it exists beside PHQ-9 rather than duplicating it. A function
  // measure that asks about mood is a symptom measure with a different name.
  for (const item of EVERYDAY_FUNCTION.items) {
    assert.doesNotMatch(item, /\bfeel|felt|mood|sad|anxious|hopeless|worried\b/i,
      `"${item}" asks about feeling, which is what the validated instruments do`);
  }
  assert.equal(EVERYDAY_FUNCTION.higherIsBetter, true);
  assert.equal(
    EVERYDAY_FUNCTION.max,
    EVERYDAY_FUNCTION.items.length * (EVERYDAY_FUNCTION.options.length - 1),
    "the stated maximum does not match the items and the scale");
});

test("scoring sums answers and says nothing about them", () => {
  const m = EVERYDAY_FUNCTION;
  assert.equal(scoreHouseMeasure(m, [4, 4, 4, 4]), 16);
  assert.equal(scoreHouseMeasure(m, [0, 0, 0, 0]), 0);
  assert.equal(scoreHouseMeasure(m, [2, 3, 1, 0]), 6);
  // Out-of-range answers are clamped rather than trusted, and extra answers
  // are ignored rather than silently widening the scale.
  assert.equal(scoreHouseMeasure(m, [9, 0, 0, 0]), 4);
  assert.equal(scoreHouseMeasure(m, [-3, 0, 0, 0]), 0);
  assert.equal(scoreHouseMeasure(m, [1, 1, 1, 1, 4, 4]), 4);
});
