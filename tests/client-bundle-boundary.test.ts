import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

// What a browser bundle is allowed to reach.
//
// FOUND BY A BUILD, WHICH IS WHY THIS EXISTS. A client component imported two
// values — a label map and a one-line helper — from the module that decides
// gates. That module needs the database, so `next build` failed with a
// module-not-found naming `pg`, `src/lib/data.ts`, and the component. The
// import had been a TYPE import, erased at compile time; turning it into a
// value import is a one-word change with no type error, no lint error, and no
// failing unit test. Only a real build catches it, and a real build is the
// slowest thing in this repository.
//
// So the rule is checked here instead: follow every client component's value
// imports through the source and fail if the graph reaches a module that opens
// a connection. The fix is always the same shape — put the values a browser
// needs in a module that holds no connection, and keep the type import.

const SRC = path.join(process.cwd(), "src");

/** Modules a browser bundle must not reach, and what each one drags in. */
const SERVER_ONLY: Record<string, string> = {
  "src/lib/db.ts": "better-sqlite3 and the schema",
  "src/lib/data.ts": "pg and the database connection",
  "src/lib/auth.ts": "the session secret and the cookie store",
  "src/lib/audit.ts": "the audit chain's write path",
  "src/lib/repository.ts": "the tenant-scoped query builder",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
const source = new Map(FILES.map((f) => [f, fs.readFileSync(f, "utf8")]));
const rel = (f: string) => path.relative(process.cwd(), f);

/**
 * The specifiers a module pulls in at RUNTIME.
 *
 * `import type { X }` and `import { type X }` are erased by the compiler, so
 * they cost a bundle nothing — counting them would condemn every component that
 * names a server-side shape, which is most of them and is not the defect.
 */
function valueImports(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const out: string[] = [];
  const re = /(?:^|\n)\s*import\s+([\s\S]*?)from\s+["']([^"']+)["']/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const clause = m[1];
    if (/^\s*type\s/.test(clause)) continue;
    // A brace clause whose every named binding is `type X` is also erased.
    const braces = /\{([\s\S]*)\}/.exec(clause);
    if (braces && !/^\s*\w[\w$]*\s*,/.test(clause)) {
      const names = braces[1].split(",").map((n) => n.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => /^type\s/.test(n))) continue;
    }
    out.push(m[2]);
  }
  // A dynamic import is a runtime edge too, and a lazy one still ships.
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package, not our source
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (source.has(cand)) return cand;
  }
  return null;
}

/**
 * A module that declares itself a server action.
 *
 * THE GRAPH STOPS HERE, and the distinction is the whole reason this guard can
 * be written at all. A client component importing a `"use server"` module does
 * not bundle it: the compiler replaces the import with a call stub, and the
 * database stays on the server. Eight components reach `src/lib/db.ts` that way
 * and every one of them is correct — a guard that flagged them would be
 * reporting the framework's normal shape as a defect, and would be turned off
 * within a week.
 */
const isServerAction = (file: string) =>
  /^\s*["']use server["']/.test(source.get(file) ?? "");

/** The first path from a client component to a server-only module, or null. */
function reaches(entry: string): string[] | null {
  const seen = new Set<string>();
  const queue: Array<{ file: string; trail: string[] }> = [{ file: entry, trail: [entry] }];
  while (queue.length) {
    const { file, trail } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file !== entry && isServerAction(file)) continue;
    if (file !== entry && SERVER_ONLY[rel(file)]) return trail;
    for (const spec of valueImports(source.get(file) ?? "")) {
      const next = resolve(file, spec);
      if (next && !seen.has(next)) queue.push({ file: next, trail: [...trail, next] });
    }
  }
  return null;
}

const CLIENT = FILES.filter((f) => /^\s*["']use client["']/.test(source.get(f) ?? ""));

test("there are client components to check", () => {
  assert.ok(CLIENT.length > 5, `only ${CLIENT.length} client components found — the walk is wrong`);
});

test("no client component reaches the database through its value imports", () => {
  const offenders: string[] = [];
  for (const f of CLIENT) {
    const trail = reaches(f);
    if (!trail) continue;
    const target = rel(trail[trail.length - 1]);
    offenders.push(
      `${rel(f)} reaches ${target} (${SERVER_ONLY[target]})\n      via ${trail.map(rel).join("\n       → ")}`
    );
  }
  assert.deepEqual(offenders, [],
    "a browser bundle would carry server-only code:\n  " + offenders.join("\n  ") +
    "\n  Put the values the component needs in a module that holds no connection, " +
    "and keep the type import.");
});

test("the erasure rule is the one the compiler uses", () => {
  // The check rests on knowing which imports survive compilation, so the parser
  // is tested rather than trusted: a wrong answer here makes the guard above
  // either useless or impossible to satisfy.
  const erased = [
    'import type { A } from "./x";',
    'import { type A, type B } from "./x";',
  ];
  const kept = [
    'import { A } from "./x";',
    'import { type A, B } from "./x";',
    'import A from "./x";',
    'import A, { type B } from "./x";',
    'const m = await import("./x");',
  ];
  for (const s of erased) assert.deepEqual(valueImports(s), [], `counted an erased import: ${s}`);
  for (const s of kept) assert.deepEqual(valueImports(s), ["./x"], `missed a real import: ${s}`);
});

test("the guard catches the import that broke the build", () => {
  // The exact regression: GateReviewDrawer took `GATE_STATE_LABEL` and
  // `gateCause` as VALUES from gate-review, which imports src/lib/data.ts.
  // Reconstructed here rather than left as a comment, so the guard is shown
  // failing on the thing it was written for.
  const drawer = path.join(SRC, "components/clinical/GateReviewDrawer.tsx");
  const original = source.get(drawer)!;
  try {
    source.set(drawer, original.replace(
      /import \{ GATE_STATE_LABEL, gateCause, type GateState \} from "@\/lib\/clinical\/gate-states";/,
      'import { GATE_STATE_LABEL, gateCause, type GateState } from "@/lib/clinical/gate-review";'
    ));
    assert.notEqual(source.get(drawer), original, "the regression could not be reconstructed");
    const trail = reaches(drawer);
    assert.ok(trail, "the guard does not catch a client component importing the gate decider");
    assert.equal(rel(trail[trail.length - 1]), "src/lib/data.ts");
  } finally {
    source.set(drawer, original);
  }
});

test("a server action is a boundary, not an edge", () => {
  // The rule above is load-bearing and easy to get wrong in the other
  // direction, so it is stated as a test rather than left in a comment: a
  // client component that calls a server action is the framework's ordinary
  // shape, and the action itself may reach whatever it needs.
  const caller = path.join(SRC, "components/SosButton.tsx");
  assert.ok(CLIENT.includes(caller), "the example is not a client component any more");
  assert.match(source.get(caller) ?? "", /from "@\/lib\/actions"/,
    "the example no longer calls a server action");
  assert.equal(reaches(caller), null, "calling a server action is reported as bundling it");

  const action = path.join(SRC, "lib/actions.ts");
  assert.ok(isServerAction(action), "the module the example calls is not declared a server action");
});
