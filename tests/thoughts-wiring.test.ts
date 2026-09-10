// Every Thoughts capability is reachable from a screen.
//
// THIS GUARD EXISTS BECAUSE THE GAP IT CLOSES WAS INVISIBLE. Phases 2 and 3
// shipped an extraction pipeline, an approved-memory projection, a supersession
// rule, a thread model and a matcher — and three of those had no caller. A
// clinician could keep six items and never see them again; nothing anywhere
// could create a thread, so the matcher (which only proposes against threads
// that already exist) could never propose anything. Every unit test passed. The
// build was clean. The feature did not work.
//
// A capability with no route to it is not a half-built feature, it is an absent
// one that reads as present in the tracker — which is worse, because nobody
// goes looking for it.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(p: string): string {
  return fs.readFileSync(path.join(ROOT, p), "utf8");
}

/** Every .tsx under src/app and src/components — the reachable surface. */
function surfaceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(rel);
    }
  };
  walk("src/app");
  walk("src/components");
  return out;
}

/** Whether a symbol is actually USED by the surface, as opposed to merely
 *  mentioned in it.
 *
 *  A plain string match is not enough, and this was established by mutating the
 *  guard rather than by reasoning about it. Replacing the approved-memory read
 *  with an empty array left `import type { approvedMemory }` and
 *  `Awaited<ReturnType<typeof approvedMemory>>` behind — the symbol was still
 *  in the file, in two positions that compile to nothing, and the guard called
 *  that reachable. A guard a dead-code mutation can satisfy will one day pass
 *  while the screen is empty.
 *
 *  So: used means CALLED, or imported as a value (which covers a handler passed
 *  by reference to something that calls it later). Both exclude type positions,
 *  which is the whole point. */
function usedBy(src: string, name: string): boolean {
  const called = new RegExp(`\\b${name}\\s*\\(`).test(src);
  // A value import: `import { a, name, b } from "..."` with no leading `type`.
  const valueImport = new RegExp(
    `import\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from`, "g"
  );
  let m: RegExpExecArray | null;
  while ((m = valueImport.exec(src))) {
    const clause = m[0];
    if (/^import\s+type\s/.test(clause)) continue;
    // `import { type name }` — the specifier itself is type-only.
    if (new RegExp(`\\btype\\s+${name}\\b`).test(clause)) continue;
    return true;
  }
  return called;
}

const SURFACE = surfaceFiles().map(read).join("\n");

/** Server actions a clinician must be able to reach, and what each one is for.
 *  The reason is in the table so a failure says what stopped working rather
 *  than naming a symbol. */
const MUST_BE_REACHABLE: Array<[string, string]> = [
  ["organizeThoughtAction", "a transcript can be organized into candidate items"],
  ["saveThoughtsAction", "the clinician's keep/remove decisions can be saved"],
  ["correctMemoryItemAction", "an approved item can be corrected (§16 supersession)"],
  ["createThreadWithItemAction", "a clinician can create a theme — without this the matcher has nothing to match against and threads never do anything"],
  ["acceptConnectionAction", "a suggested connection can be accepted"],
  ["rejectConnectionAction", "a suggested connection can be refused"],
  ["revisitConnectionAction", "a refusal can be deliberately reopened"],
];

test("every Thoughts command is reachable from a screen", () => {
  const unreachable: string[] = [];
  for (const [fn, why] of MUST_BE_REACHABLE) {
    // Imported and called somewhere under src/app or src/components.
    if (!usedBy(SURFACE, fn)) unreachable.push(`${fn} — so ${why} is not true`);
  }
  assert.deepEqual(unreachable, [],
    `these commands exist and nothing can call them:\n  ${unreachable.join("\n  ")}`);
});

/** Read models whose absence from the surface means the data is invisible. */
const MUST_BE_RENDERED: Array<[string, string]> = [
  ["approvedMemory", "kept items would be written and never shown"],
  ["membershipsForPerson", "thread suggestions and members would never appear"],
  ["buildTimelines", "a thread's evidence would never be rendered"],
];

test("every Thoughts read model reaches a screen", () => {
  const invisible: string[] = [];
  for (const [fn, why] of MUST_BE_RENDERED) {
    if (!usedBy(SURFACE, fn)) invisible.push(`${fn} — ${why}`);
  }
  assert.deepEqual(invisible, [], `these read models are never rendered:\n  ${invisible.join("\n  ")}`);
});

test("the memory panel offers no way to change a statement class", () => {
  // Correcting the wording is §16. Changing what KIND of claim something is, is
  // not a wording fix — it is a different item, and it goes through rejection
  // and re-approval where it is visible. A select on the correction form would
  // let an observation quietly become a hypothesis, or the reverse.
  const panel = read("src/components/clinical/ClinicalMemoryPanel.tsx");
  // It READS the class to render a badge, which is the point. What it must
  // never do is SEND one: the form fields it submits are the fields it can
  // change, and a statement class among them would let an observation quietly
  // become a hypothesis.
  const submitted = [...panel.matchAll(/form\.set\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(submitted.length > 0, "the panel submits something");
  assert.ok(!submitted.includes("statementClass"), `panel submits: ${submitted.join(", ")}`);
  assert.ok(!submitted.includes("itemType"), "nor may it change what type of item this is");
  assert.ok(!panel.includes("<select"), "no dropdown may reclassify an item");
});

test("the correction action cannot rewrite a statement class", () => {
  const store = read("src/lib/clinical/memory-store.ts");
  const fn = store.slice(store.indexOf("export async function supersedeItem"));
  assert.ok(fn.includes("statement_class: prior.statement_class"),
    "a correction carries the prior class forward unchanged");
  assert.ok(!/statement_class:\s*args\./.test(fn), "no caller may supply a new class");
});
