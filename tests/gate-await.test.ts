// A gate that is never awaited is a gate that never fires.
//
// THE BUG THIS EXISTS FOR. Five of these shipped, on three member screens
// including the daily check-in:
//
//   if (!screeningComplete(user.id)) redirect("/app/screening");
//
// `screeningComplete` is async. The expression is `!Promise`, which is always
// `false`, so the redirect was unreachable and the gate had never once fired.
// It reads exactly like the two lines above it, which do await, and TypeScript
// is content because negating a Promise is legal.
//
// The failure mode is the one this codebase keeps meeting from a different
// direction: a guard that cannot fail is worse than no guard, because it is
// counted. Nothing here was unsafe — those pages still require an
// authenticated, consented, subscribed member — but four onboarding gates
// were three.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Strip comments, so a rule can be DISCUSSED in prose without tripping the
 *  check that enforces it. The convention here already — and needed
 *  immediately: the comment recording the fix quotes the broken line, and the
 *  scanner flagged its own explanation. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

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

/** Every exported async function whose name reads as a question. These are the
 *  ones a caller is most likely to use as a plain boolean, because that is
 *  exactly what the name promises. */
function asyncPredicates(): string[] {
  const names = new Set<string>();
  for (const f of walk(path.join(ROOT, "src", "lib"))) {
    const src = code(fs.readFileSync(f, "utf8"));
    for (const m of src.matchAll(
      /export\s+async\s+function\s+(\w+)\s*\([^)]*\)\s*:\s*Promise<\s*boolean\s*>/g,
    )) names.add(m[1]);
  }
  return [...names];
}

test("there are async predicates to check, and they are found by their signature", () => {
  const names = asyncPredicates();
  assert.ok(names.length >= 4,
    `only ${names.length} async boolean predicates found — the scan is not seeing the code`);
  for (const expected of ["screeningComplete", "profileComplete", "hasConsent"]) {
    assert.ok(names.includes(expected), `${expected} is not being scanned`);
  }
});

test("no async predicate is used as a plain boolean", () => {
  // `!thing(...)` where `thing` returns a Promise is always false. `if
  // (thing(...))` is always true. Both are legal TypeScript and neither does
  // anything.
  const names = asyncPredicates();
  const offenders: string[] = [];

  for (const f of [...walk(path.join(ROOT, "src", "app")), ...walk(path.join(ROOT, "src", "lib"))]) {
    const src = code(fs.readFileSync(f, "utf8"));
    for (const name of names) {
      // Its own definition and any `await`ed call are fine.
      const bare = new RegExp(`(?<!await\\s)(?<!\\.)\\b${name}\\s*\\(`, "g");
      for (const m of src.matchAll(bare)) {
        const before = src.slice(Math.max(0, m.index! - 40), m.index!);
        if (/export\s+async\s+function\s*$/.test(before)) continue;
        if (/await\s*\(?\s*$/.test(before)) continue;
        // A reference passed as a value (`.map(fn)`, `= fn`) is not a call.
        if (/[=,(]\s*$/.test(before) && !/if\s*\(\s*!?\s*$/.test(before)) continue;
        // Only flag it where the result is being used as a condition.
        if (!/(if\s*\(\s*!?|&&\s*!?|\|\|\s*!?|\?\s*)$/.test(before.trimEnd() + " ".repeat(0))
            && !/if\s*\(\s*!/.test(before)) continue;
        offenders.push(`${path.relative(ROOT, f)} — ${name}() without await`);
      }
    }
  }

  assert.deepEqual([...new Set(offenders)], [],
    "these conditions test a Promise, so the branch never runs:\n  " +
    [...new Set(offenders)].join("\n  "));
});
