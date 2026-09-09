process.env.EMDR_DATA_DIR = `/tmp/steady-delivery-${process.pid}-${Date.now()}`;

// The delivery sequence's own rules (handoff 09 §10.1).
//
// §10 is not a feature — it is the order the work happens in and the rules that
// keep the order honest. Three of its six bullets are machine-checkable, and
// two of those three were being broken.
//
//   "THERAPEUTIC LOAD AND READINESS MAY PLUG INTO THE CLINICIAN TASK-PROVIDER
//   CONTRACT AFTER ITS OWN CLINICAL REVIEW." It was plugged in. The provider
//   was registered with no gate, so `therapeutic_load.stabilize` and
//   `therapeutic_load.consider_progression` reached a clinician's attention
//   queue as work while the ratifying review that establishes they are safe to
//   act on had not happened. Nothing was wrong with the states; what was wrong
//   was handing them to a clinician as a reason to act.
//
//   "TREAT STALE TRACKERS, LINT DEBT, AND RUNTIME TEST RESTRICTIONS AS
//   DISTINCT ITEMS." Lint debt was 42 warnings, and inside them was a React
//   Compiler error that was a real defect — a `useCallback` missing
//   `sourceSession`, so a note recorded after moving between sessions would be
//   stamped with the session before it. Forty-one unused-variable warnings are
//   what let it sit there. The guard below keeps the count at zero so the next
//   real finding is the only thing in the output.
//
//   "KEEP NEW WORK BEHIND ROLE-LEVEL FLAGS AND PROVE THE CURRENT EXPERIENCE IS
//   UNCHANGED WITH EACH FLAG OFF." Each package proved its own; nothing proved
//   it across all of them, which is where a fourth branch site gets added
//   without one.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  AWAITING_CLINICAL_REVIEW, THERAPEUTIC_LOAD_REVIEW, mayEnterTaskQueue,
} from "../src/lib/clinical/clinical-review-gate";
import { selectLoadSignals } from "../src/lib/clinical/attention-providers/therapeutic-load";
import {
  ALL_EXPERIENCE_FLAGS, EXPERIENCE_FLAGS, experienceFlagEnabled,
} from "../src/lib/experience/flags";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (p: string) => fs.readFileSync(path.join(SRC, p), "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// §10.1 — a feature awaiting clinical review does not produce clinician work
// ---------------------------------------------------------------------------

test("Therapeutic Load does not enter the clinician queue before its review", () => {
  // The rule, and the state it is in. Both asserted: a guard that only checked
  // the mechanism would pass on the day somebody flips the constant without a
  // review, which is the thing the mechanism exists to stop.
  assert.equal(THERAPEUTIC_LOAD_REVIEW.reviewed, false,
    "the review is recorded as done — if that is true, this test needs updating with it");
  assert.equal(mayEnterTaskQueue(THERAPEUTIC_LOAD_REVIEW), false);

  const src = code("lib/clinical/attention-providers/therapeutic-load.ts");
  const body = src.slice(src.indexOf("async evaluate("));
  const gate = body.indexOf("mayEnterTaskQueue(THERAPEUTIC_LOAD_REVIEW)");
  const compute = body.indexOf("computeTherapeuticLoad(");
  assert.ok(gate > 0, "the provider evaluates with no clinical-review gate");
  assert.ok(gate < compute,
    "the gate runs after the snapshot, so there is a path that produces a candidate and filters it");
});

test("a review claiming to be done without an author does not lift the hold", () => {
  // The alternative is a boolean somebody sets to unblock a demonstration.
  assert.equal(mayEnterTaskQueue({ ...THERAPEUTIC_LOAD_REVIEW, reviewed: true }), false);
  assert.equal(
    mayEnterTaskQueue({ ...THERAPEUTIC_LOAD_REVIEW, reviewed: true, authority: "Dr X" }),
    false, "a review with an author but no evidence lifted the hold"
  );
  assert.equal(
    mayEnterTaskQueue({
      ...THERAPEUTIC_LOAD_REVIEW, reviewed: true, authority: "Dr X", evidence: "docs/…",
    }),
    true, "a fully recorded review does not lift the hold"
  );
});

test("the narrowing rule still works, so the hold is a gate and not a deletion", () => {
  // `selectLoadSignals` is the pure rule the provider calls once cleared. It
  // must keep working — the hold is upstream of it, and a hold implemented by
  // breaking the thing it holds is a hold nobody can lift.
  const stabilize = selectLoadSignals({
    id: "snap-1",
    personId: "p1",
    unavailable: [],
    state: "stabilize",
    stateLabel: "Stabilize",
    safetyConstraint: null,
    load: [{
      key: "recovery_time", reading: "high",
      label: "Recovery time", detail: "Two of three sessions ran long.",
      evidenceIds: ["e1"], evidenceType: "session_recovery",
    }],
    capacity: [],
    explanation: [],
    limitations: ["Rests on what was recorded."],
    progressionBlockers: [],
    policyVersion: "therapeutic-load.1.0.0",
    evidenceCutoff: "2026-09-09",
  });
  assert.equal(stabilize.length, 1);
  assert.equal(stabilize[0].dedupeKey, "therapeutic_load");
});

test("what is withheld is stated on a surface, not only in code", () => {
  // §9's coverage model exists so an empty queue can be told apart from a
  // broken one. A feature that quietly returns nothing defeats it.
  assert.ok(AWAITING_CLINICAL_REVIEW.length > 0);
  for (const f of AWAITING_CLINICAL_REVIEW) {
    assert.ok(f.review.withholds.trim().length > 0, `${f.feature} does not say what it withholds`);
  }
  const status = code("app/review/status/page.tsx");
  assert.match(status, /AWAITING_CLINICAL_REVIEW/);
  assert.match(status, /Held until a clinical review/);
});

test("the hold gates the queue, not the screen", () => {
  // §10.1 names the TASK-PROVIDER CONTRACT. The Load screen stays: it is the
  // difference between a clinician choosing to look and being told to.
  const page = fs.readFileSync(
    path.join(SRC, "app", "clinician", "member", "[id]", "load", "page.tsx"), "utf8"
  );
  assert.ok(
    !/mayEnterTaskQueue|THERAPEUTIC_LOAD_REVIEW/.test(page),
    "the Load screen is gated on a rule that governs the queue"
  );
});

// ---------------------------------------------------------------------------
// §10.1 — lint debt is a distinct item, and it is zero
// ---------------------------------------------------------------------------

test("lint is clean, so the next real finding is the only thing in the output", () => {
  // NOT STYLE POLICING. Forty-one unused-variable warnings are what let a
  // React Compiler error — a `useCallback` missing `sourceSession`, which
  // would stamp a note with the wrong session after a soft navigation — sit
  // unread. A warning stream nobody reads is a warning stream that hides the
  // one that matters.
  let output = "";
  try {
    output = execFileSync("npm", ["run", "--silent", "lint"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  const problems = output.match(/✖ (\d+) problems?/);
  assert.ok(
    !problems || problems[1] === "0",
    `lint reports ${problems?.[1]} problems:\n${output.split("\n").slice(-25).join("\n")}`
  );
});

// ---------------------------------------------------------------------------
// §10.1 — every flag, off, leaves the current experience unchanged
// ---------------------------------------------------------------------------

/** The body of the flag branch, from its opening brace to its matching close. */
function branchBody(src: string, at: number): string {
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open);
}

/** Every route that branches on an experience flag. Derived rather than
 *  listed, so a fourth branch site is covered the day it is added. */
function branchSites(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name)) {
        const src = fs.readFileSync(p, "utf8");
        if (/(clinicianShellEnabled|memberShellEnabled|experienceFlagEnabled)\(/.test(src)) {
          out.push(path.relative(SRC, p));
        }
      }
    }
  };
  walk(path.join(SRC, "app"));
  return out.sort();
}

test("every experience flag is read at call time, never captured at module load", () => {
  // A flag read into a module constant cannot be turned off without a
  // redeploy, and this codebase has shipped that bug once already.
  const src = code("lib/experience/flags.ts");
  assert.match(src, /export function experienceFlagEnabled/);
  assert.ok(
    !/^const \w+ = process\.env/m.test(src),
    "a flag value is captured at module load"
  );
  assert.match(src, /process\.env\[`EMDR_\$\{flag\}`\]/);
});

test("every flag branch is a whole-page branch that returns before the old path", () => {
  // §10.1's "prove the current experience is unchanged with each flag off" is
  // a property of the control flow, not a claim about a diff: with the flag
  // off, not one line of the new branch runs.
  const sites = branchSites();
  assert.ok(sites.length >= 3, `only ${sites.length} branch sites found; the walk is wrong`);
  for (const rel of sites) {
    const src = code(rel);
    const branch = src.search(/if \((?:clinicianShellEnabled|memberShellEnabled|experienceFlagEnabled)\(/);
    assert.ok(branch > 0, `${rel} calls a flag but does not branch on it`);

    // THE BRANCH RETURNS. Not "its first statement is a return" — a branch may
    // legitimately resolve its own tenant and context first, and the Today
    // page does. What makes the old experience provably unchanged is that the
    // branch cannot fall through: it ends in a return, so with the flag off
    // nothing in it runs and with the flag on nothing after it does.
    const body = branchBody(src, branch);
    assert.ok(
      /(^|\n)\s{0,6}return[\s(]/.test(body),
      `${rel}'s flag branch can fall through into the old path`
    );
  }
});

test("with every flag off, no route reaches a new shell", () => {
  // The cross-cutting proof. Each package tested its own flag; nothing tested
  // that turning them ALL off leaves the old experience, which is where a
  // fourth branch site gets added without one.
  const prev: Record<string, string | undefined> = {};
  for (const f of ALL_EXPERIENCE_FLAGS) {
    prev[f] = process.env[`EMDR_${f}`];
    process.env[`EMDR_${f}`] = "0";
  }
  const prevDemo = process.env.EMDR_DEMO;
  process.env.EMDR_DEMO = "1"; // the setting that would otherwise turn them on
  try {
    for (const f of ALL_EXPERIENCE_FLAGS) {
      assert.equal(experienceFlagEnabled(f), false, `${f} is on with its variable set to 0`);
    }
  } finally {
    for (const f of ALL_EXPERIENCE_FLAGS) {
      if (prev[f] === undefined) delete process.env[`EMDR_${f}`];
      else process.env[`EMDR_${f}`] = prev[f]!;
    }
    if (prevDemo === undefined) delete process.env.EMDR_DEMO;
    else process.env.EMDR_DEMO = prevDemo;
  }
});

test("the unbuilt shells are off even in a demonstration", () => {
  // A flag over an unbuilt shell reads as "this is broken" rather than "this
  // is not finished yet", which is the worse of the two messages to send a
  // clinical reviewer.
  const prevDemo = process.env.EMDR_DEMO;
  const saved: Record<string, string | undefined> = {};
  for (const f of ALL_EXPERIENCE_FLAGS) {
    saved[f] = process.env[`EMDR_${f}`];
    delete process.env[`EMDR_${f}`];
  }
  process.env.EMDR_DEMO = "1";
  try {
    assert.equal(experienceFlagEnabled("EXPERIENCE_AGGREGATE_SHELL"), false);
    assert.equal(experienceFlagEnabled("EXPERIENCE_REVIEWER_SHELL"), false);
    // And the built ones are on, or the demonstration shows work that landed
    // as though it had not.
    assert.equal(experienceFlagEnabled("EXPERIENCE_CLINICIAN_SHELL"), true);
    assert.equal(experienceFlagEnabled("EXPERIENCE_MEMBER_SHELL"), true);
  } finally {
    for (const f of ALL_EXPERIENCE_FLAGS) {
      if (saved[f] === undefined) delete process.env[`EMDR_${f}`];
      else process.env[`EMDR_${f}`] = saved[f]!;
    }
    if (prevDemo === undefined) delete process.env.EMDR_DEMO;
    else process.env.EMDR_DEMO = prevDemo;
  }
  assert.equal(Object.keys(EXPERIENCE_FLAGS).length, ALL_EXPERIENCE_FLAGS.length);
});

// ---------------------------------------------------------------------------
// §10.1 — the cutover stays a separate program
// ---------------------------------------------------------------------------

test("the Postgres cutover is not combined with the navigation rollout", () => {
  // §10.1 calls this "the highest-consequence sequencing rule in the
  // document". The check is narrow on purpose: no experience module reaches
  // for the database backend, so no package in this series can have quietly
  // taken a dependency on the cutover.
  const dir = path.join(SRC, "lib", "experience");
  for (const f of fs.readdirSync(dir)) {
    if (!/\.ts$/.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(
      !/EMDR_DB|postgres|DATABASE_URL/i.test(src),
      `src/lib/experience/${f} reaches for the database backend`
    );
  }
});
