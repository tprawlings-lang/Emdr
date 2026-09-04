// Does the code we wrote reach a screen?
//
// THIS EXISTS BECAUSE THE GUARD BEFORE IT WAS A HAND-MAINTAINED LIST. There is
// a wiring test for Clinician Thoughts naming seven commands and three read
// models, and it passes. Four phases of Return-to-Life Goals then shipped with
// 1177 tests green, nineteen mutations caught, and not one screen — because the
// list did not mention goals and nobody remembered to add them. A guard that
// only checks the things somebody thought to enumerate protects yesterday's
// work and nothing else.
//
// So this derives the question from the import graph instead: every module
// under src/lib must be reachable from a page or a component, transitively,
// or be named below with a reason. Adding a module is enough to be checked;
// remembering is not required.
//
// WHAT IT CANNOT SEE, stated so nobody trusts it too far. Reachability is not
// usefulness. A module can be imported by a page that renders nothing from it,
// and a domain can be readable while none of its commands are — which is
// exactly the shape goals shipped in: Session Prep read them, so the module
// graph called them reachable, and no goal could ever be created. The
// companion check below covers that for the domains that have commands.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const ALL = walk("src");
const BY_PATH = new Map(ALL.map((f) => [f.replace(/\.(tsx|ts)$/, ""), f]));

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) base = path.normalize(path.join(path.dirname(from), spec));
  else return null;
  base = base.replace(/\\/g, "/");
  for (const cand of [base, `${base}/index`]) {
    const hit = BY_PATH.get(cand);
    if (hit) return hit;
  }
  return null;
}

// Static, dynamic and require forms. This codebase uses all three — the lazy
// ones deliberately, to break initialization cycles — and a graph that missed
// them would report live code as dead.
const IMPORT_RE =
  /(?:from\s*["']([^"']+)["'])|(?:import\s*\(\s*["']([^"']+)["']\s*\))|(?:require\(\s*["']([^"']+)["']\s*\))/g;

function importsOf(file: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const r = resolveSpec(m[1] || m[2] || m[3], file);
    if (r) out.push(r);
  }
  return out;
}

/** Where a user's request can actually begin. */
const ENTRY_POINTS = (f: string) =>
  f.startsWith("src/app/") ||
  f.startsWith("src/components/") ||
  // Next.js boot hook: runs on every start, and what it imports is live code
  // even though no page renders it.
  f === "src/instrumentation.ts" ||
  f === "src/middleware.ts";

function reachable(): Set<string> {
  const seeds = ALL.filter(ENTRY_POINTS);
  const seen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const f = queue.pop() as string;
    for (const dep of importsOf(f)) {
      if (!seen.has(dep)) { seen.add(dep); queue.push(dep); }
    }
  }
  return seen;
}

/**
 * Modules that legitimately never reach a screen. Every entry carries a reason,
 * because "it is on the list" is not one — the list is where a genuine gap goes
 * to be forgotten, and a reason is what makes adding an entry a decision
 * somebody has to defend.
 */
const OFF_SURFACE: Record<string, string> = {
  "src/lib/analysis/power.ts":
    "A statistical power harness run from scripts/testing and its own test. It answers 'is this dataset big enough to detect that', which is a question asked before a study, not during a session.",
  "src/lib/presentation/action.ts":
    "PRE-EXISTING GAP, not a decision. The action-response contract from handoff 06 §30.4 is defined and no surface imports it — the components build their own responses. Recorded here so it is visible rather than silently dead; closing it means routing the mutation surfaces through it.",
  "src/lib/presentation/contract.ts":
    "PRE-EXISTING GAP, same shape as action.ts above: the shared presentation contract from §8.2 is defined and unconsumed.",
};

test("every lib module reaches a screen, or says why not", () => {
  const seen = reachable();
  const libs = ALL.filter((f) => f.startsWith("src/lib/"));
  const dead = libs.filter((f) => !seen.has(f) && !(f in OFF_SURFACE)).sort();

  assert.deepEqual(dead, [],
    "these modules cannot be reached from any page or component:\n  " + dead.join("\n  ") +
    "\nEither wire them to a surface, or add them to OFF_SURFACE with a reason.");
});

test("the off-surface list has not gone stale", () => {
  const seen = reachable();
  const wired = Object.keys(OFF_SURFACE).filter((f) => seen.has(f));
  // A module that has since been wired should leave the list, or the list stops
  // describing the codebase and starts excusing it.
  assert.deepEqual(wired, [],
    `these are listed as off-surface but are now reachable: ${wired.join(", ")}`);
  for (const [file, reason] of Object.entries(OFF_SURFACE)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is listed but does not exist`);
    assert.ok(reason.length > 40, `${file} needs a real reason, not a label`);
  }
});

/**
 * Domains whose COMMANDS must be reachable, not merely their reads.
 *
 * The module graph cannot see this distinction and it is where goals went
 * wrong: Session Prep imported the goal domain, so the graph called it
 * reachable, while nothing in the product could create a goal. A domain that
 * can be read and not written is a screen that is always empty.
 */
const COMMAND_DOMAINS: Array<{ name: string; commands: string[] }> = [
  {
    name: "Return-to-Life goals",
    commands: ["createGoal", "confirmGoal", "recordGoalCheckin", "recordClinicianObservation", "decideObservation"],
  },
  {
    name: "Clinician Thoughts",
    commands: ["organizeThoughtAction", "saveThoughtsAction", "correctMemoryItemAction", "createThreadWithItemAction"],
  },
  {
    name: "Review console",
    commands: ["recordGateSignoff", "recordClinicalReview", "decideAccessRequest", "requestResearchExport"],
  },
];

/**
 * Is this command CALLED from code the surface can reach?
 *
 * Transitive on purpose. A page does not call `createGoal`; it calls
 * `createGoalAction`, which calls `createGoal`. Checking only files under
 * src/app and src/components would say the domain command is stranded when it
 * has a perfectly good route through a server action — and the first version of
 * this test did exactly that, reporting five false positives the moment the
 * actions layer existed.
 *
 * The chain must START at the surface, though. A command called only from
 * another unreachable module is still unreachable, and the reachable set below
 * is seeded from pages and components precisely so that stays true.
 */
function calledFromReachable(name: string, reachableFiles: Set<string>, definedIn?: string): boolean {
  const call = new RegExp(`\\b${name}\\s*\\(`);
  for (const f of reachableFiles) {
    if (definedIn && f === definedIn) continue;
    const src = fs.readFileSync(path.join(ROOT, f), "utf8")
      // Prose about a call is not a call.
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    if (call.test(src)) return true;
  }
  return false;
}

test("every domain that can be read can also be written", () => {
  const seen = reachable();
  const stranded: string[] = [];
  for (const domain of COMMAND_DOMAINS) {
    const missing = domain.commands.filter((c) => !calledFromReachable(c, seen));
    if (missing.length > 0) stranded.push(`${domain.name}: ${missing.join(", ")}`);
  }
  assert.deepEqual(stranded, [],
    "these domains have no route to their own commands, so their screens can only ever be empty:\n  " +
    stranded.join("\n  "));
});
