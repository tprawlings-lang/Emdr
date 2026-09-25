// CI vocabulary coverage (Handoff 10 §8; row CV10_F03):
//
//   1. the banned-vocabulary grep covers the content files in src/lib;
//   2. modality names never reach member copy (also CV10_F02);
//   3. the audio mono check runs.
//
// The workflow is read here so that dropping a path or a step fails the
// @safety suite rather than quietly narrowing what CI checks.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { copyHits, MODALITY_NAME, modalityHits } from "../src/lib/governance/member-copy";
import { STEADIER_SLEEP } from "../src/lib/content/h10-programs";

const WORKFLOW = fs.readFileSync(path.join(process.cwd(), ".github/workflows/safety.yml"), "utf8");

/** The banned-vocabulary step's run block. */
function vocabularyStep(): string {
  const start = WORKFLOW.indexOf("- name: Banned vocabulary check");
  assert.ok(start >= 0, "the banned-vocabulary step is gone");
  const next = WORKFLOW.indexOf("\n      - name:", start + 1);
  return WORKFLOW.slice(start, next < 0 ? undefined : next);
}

/** The step's grep command itself — comments dropped, continuations joined,
 *  up to the first pipe — as its pattern and its arguments. */
function vocabularyGrep(): { pattern: string; args: string[] } {
  const command = vocabularyStep().split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("- name:") && !l.startsWith("run:"))
    .join(" ")
    .replace(/\\ /g, " ");
  const m = command.match(/grep -rniE "([^"]+)"([^|]*)\|/);
  assert.ok(m, "the grep command could not be read from the workflow");
  return { pattern: m[1], args: m[2].trim().split(/\s+/).map((a) => a.replace(/^--include="(.*)"$/, "--include=$1")) };
}

test("the banned-vocabulary grep covers the content files in src/lib", () => {
  const { args } = vocabularyGrep();
  for (const p of ["src/app", "src/components", "src/lib/practices.ts", "src/lib/lessons.ts", "src/lib/programs.ts", "src/lib/content"]) {
    assert.ok(args.includes(p), `${p} is not in the grep command`);
  }
  assert.ok(args.includes("--include=*.ts"), "the .ts content files are filtered out");
});

test("the grep, run exactly as CI runs it, finds nothing today", () => {
  const { pattern, args } = vocabularyGrep();
  let out = "";
  try {
    out = execFileSync("grep", ["-rniE", pattern, ...args], { encoding: "utf8" });
  } catch (e) {
    if ((e as { status?: number }).status !== 1) throw e; // 1 = no match
  }
  const hits = out.split("\n").filter((l) => l && !/does not diagnose|diagnosis remains/.test(l));
  assert.deepEqual(hits, []);
});

test("the pattern catches the claims it is for, and not 'secure'", () => {
  const re = new RegExp(vocabularyGrep().pattern, "i");
  for (const s of ["this can cure you", "heal your past", "treats PTSD", "an AI therapist", "clinically proven"]) assert.match(s, re, s);
  assert.doesNotMatch("a secure connection", re);
});

test("the modality and audio checks are CI steps", () => {
  assert.match(WORKFLOW, /run: npx tsx scripts\/check-member-copy\.ts/);
  assert.match(WORKFLOW, /run: npx tsx scripts\/check-audio-mono\.ts/);
});

test("no member copy names a modality", () => {
  assert.deepEqual(modalityHits(), []);
});

test("the check reads member copy, not ids or sign-off rows, and is case-sensitive", () => {
  for (const s of ["a DBT skill", "ACT says", "the STAIR approach", "CBT-I works", "an EMDRIA member", "CBT", "IPT"]) {
    assert.match(s, MODALITY_NAME, s);
  }
  for (const s of ["act on it", "the stairs", "EMDR"]) assert.doesNotMatch(s, MODALITY_NAME, s);
  // A hit in a nested program string is found; the same name in a sign-off
  // id or a source id is not.
  const planted = { ...STEADIER_SLEEP, units: [{ ...STEADIER_SLEEP.units[0], text: ["A DBT idea"] }] };
  assert.deepEqual(copyHits(planted, "p").map((h) => h.where), ["p.units[0].text[0]"]);
  assert.deepEqual(copyHits({ signoffRowIds: ["DBT"], sourceTechniqueId: "ACT-values", title: "Fine" }, "x"), []);
});
