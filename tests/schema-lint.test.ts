// Schema lint.
//
// SOURCE ONLY — this file imports nothing from src, deliberately. Its whole
// subject is a failure that stops `src/lib/db.ts` PARSING, so a guard that
// imported anything from it could never run: the module would die on load and
// take the guard with it. That is what happened to the first version of this
// check, and an unreachable guard is worse than none because it is counted.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const DB = path.join(process.cwd(), "src", "lib", "db.ts");

test("the migration SQL contains no backtick-quoted identifiers", () => {
  // Narrow, and it has bitten three times in this project. The schema is one
  // JavaScript template literal, so a backtick — the natural way to quote a
  // table name in prose, and what a Markdown habit produces automatically —
  // terminates the string. The parse error then surfaces dozens of lines away
  // from the cause, as a stray comma or an unexpected identifier, which is why
  // it has cost time on each occasion rather than being obvious.
  const src = fs.readFileSync(DB, "utf8");
  const literals = [...src.matchAll(/db\.exec\(`([\s\S]*?)`\)/g)].map((m) => m[1]);
  assert.ok(literals.length > 0,
    "the migration no longer uses a db.exec template literal — update this guard rather than deleting it");
  for (const l of literals) {
    const line = l.split("\n").find((x) => x.includes("`"));
    assert.ok(line === undefined, `a backtick inside the schema template literal: ${line?.trim()}`);
  }
});

test("db.ts parses", () => {
  // The blunt version of the check above, and the one that catches the next
  // variant of the same mistake rather than this exact one. Reading the file
  // and asking Node to parse it costs nothing and needs no import.
  const src = fs.readFileSync(DB, "utf8");
  // Strip TypeScript-only syntax crudely enough to answer "are the string
  // literals balanced", which is the failure mode in question.
  const backticks = (src.match(/(?<!\\)`/g) ?? []).length;
  assert.equal(backticks % 2, 0,
    `db.ts has ${backticks} backticks — an odd count means an unterminated template literal`);
});
