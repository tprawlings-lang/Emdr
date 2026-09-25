// No bilateral-stimulation shape in member content outside the BLS system
// (Handoff 10 P0 and standing constraint 1).
//
// THE FINDING. The companion's knowledge base carried `somatic-butterfly-hug`,
// which told the companion to offer "slow alternating taps" with arms crossed:
// the Butterfly Hug as taught in EMDR practice, which is self-administered
// bilateral stimulation. It was open at GROUNDING_ONLY up to activation 8, so a
// highly activated member could be walked through it. v1 has no BLS — its
// parameters are null and fail closed — and the entry's "avoid when" note was
// advisory only. It is now a still self-hold, and this test keeps any content
// from growing that shape back.
//
// Scanned: every string in the knowledge base, the practices, the lessons, and
// any programs or content modules as they arrive. NOT scanned: the BLS system
// itself (the stimulus component, the safety core) and the session modules,
// which are the EMDR sessions and sit behind the BLS gate by design.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { TECHNIQUES } from "../src/lib/therapy-kb/catalog";
import { ALL_PRACTICES } from "../src/lib/practices";
import { LESSONS } from "../src/lib/lessons";

/** The handoff's pattern, verbatim. */
export const BLS_SHAPE =
  /alternat(e|ing)\s+(tap|squeeze|touch|side)|left[\s,-]+(and\s+)?right|side[\s-]to[\s-]side|bilateral|butterfly/i;

/**
 * THE ONE EXCEPTION, and it is a passage, not a file. The lesson on how EMDR
 * works says what bilateral stimulation is: a member should know what the
 * method they signed up for involves. It explains; it does not invite. The
 * product owner kept it on 24 September and had the calm-place lesson's
 * "pair it with slow bilateral stimulation" reworded, because that line read as
 * an instruction in a build with no BLS. The exception names the lesson and the
 * section, and the test below holds the section to explaining only.
 */
const EXPLAINS_ONLY = { lessonId: "why-emdr-works", heading: "## Bilateral stimulation" };

function strings(value: unknown, where: string, out: Array<{ where: string; text: string }>): void {
  if (typeof value === "string") out.push({ where, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${where}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) strings(v, `${where}.${k}`, out);
  }
}

/** A lesson body with the one explanatory section removed. */
function withoutException(lessonId: string, body: string): string {
  if (lessonId !== EXPLAINS_ONLY.lessonId) return body;
  const start = body.indexOf(EXPLAINS_ONLY.heading);
  if (start < 0) return body;
  const next = body.indexOf("\n## ", start + EXPLAINS_ONLY.heading.length);
  return body.slice(0, start) + (next < 0 ? "" : body.slice(next));
}

function scan(): Array<{ where: string; text: string }> {
  const all: Array<{ where: string; text: string }> = [];
  for (const t of TECHNIQUES) strings(t, `kb:${t.id}`, all);
  // Every practice, skills and Handoff 10's content included (src/lib/content
  // is generated into ALL_PRACTICES and LESSONS, so scanning those scans it).
  for (const p of ALL_PRACTICES) strings(p, `practice:${p.id}`, all);
  for (const l of LESSONS) strings({ ...l, body: withoutException(l.id, l.body) }, `lesson:${l.id}`, all);
  return all;
}

test("no knowledge-base entry, practice or lesson carries a bilateral-stimulation shape", () => {
  const hits = scan().filter((s) => BLS_SHAPE.test(s.text)).map((s) => `${s.where}: …${s.text.match(BLS_SHAPE)![0]}…`);
  assert.deepEqual(hits, [], "BLS-shaped content outside the BLS system:\n  " + hits.join("\n  "));
});

test("the butterfly hug is gone, not flagged off", () => {
  assert.ok(!TECHNIQUES.some((t) => t.id === "somatic-butterfly-hug"), "the entry still exists");
  const self = TECHNIQUES.find((t) => t.id === "somatic-self-hold");
  assert.ok(self, "the still self-hold that replaces it is missing");
  assert.match(self.guidance, /no tapping/i);
  assert.equal(self.minTier, 1, "the tier changed — the handoff keeps it");
  assert.equal(self.maxActivation, 8, "the ceiling changed — the handoff keeps it");
});

test("the one exception explains and does not invite", () => {
  const lesson = LESSONS.find((l) => l.id === EXPLAINS_ONLY.lessonId);
  assert.ok(lesson, "the excepted lesson is gone — delete the exception with it");
  const start = lesson.body.indexOf(EXPLAINS_ONLY.heading);
  assert.ok(start >= 0, "the excepted section is gone — delete the exception with it");
  const next = lesson.body.indexOf("\n## ", start + 1);
  const section = lesson.body.slice(start, next < 0 ? undefined : next);
  // An invitation is the line this exception must never cover.
  assert.doesNotMatch(section, /\b(try|you can|you could|practi[cs]e|do this|tap along|start)\b/i,
    "the excepted section now invites the member to do it");
});

test("the programs and content modules are scanned as they arrive", () => {
  // Handoff 10 adds programs.ts and a content directory. When either exists,
  // this fails until it is added to the scan above.
  const lib = path.join(process.cwd(), "src/lib");
  for (const rel of ["programs.ts", "content"]) {
    if (!fs.existsSync(path.join(lib, rel))) continue;
    const self = fs.readFileSync(__filename, "utf8");
    assert.match(self, new RegExp(`src/lib/${rel.replace(".", "\\.")}`), `${rel} exists and is not scanned here`);
  }
});

test("the pattern catches the shapes it is for", () => {
  for (const s of [
    "slow alternating taps", "alternate squeezes", "left and right", "left-right", "side to side",
    "bilateral stimulation", "butterfly hug",
  ]) assert.match(s, BLS_SHAPE, s);
  for (const s of ["a steady hold", "breathe out slowly", "look to your left"]) assert.doesNotMatch(s, BLS_SHAPE, s);
});

test("the finding is listed as closed, with its test, and every listed test exists", async () => {
  const { RESOLVED_FINDINGS } = await import("../src/lib/governance/resolved-findings");
  const f = RESOLVED_FINDINGS.find((r) => r.id === "kb.butterfly-hug-was-self-administered-bls");
  assert.ok(f, "the P0 finding is not listed on the status page");
  assert.equal(f.test, "tests/kb-no-bls-shape.test.ts");
  for (const r of RESOLVED_FINDINGS) {
    assert.ok(fs.existsSync(path.join(process.cwd(), r.test)), `${r.id} names a test that does not exist: ${r.test}`);
    assert.match(r.resolvedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
  const { THERAPY_KB_RULES } = await import("../src/lib/therapy-kb/signoff");
  assert.match(f.confirmedBy ?? "", /CV10_A01/, "the P0 finding should name the review row that confirmed it");
  // The rewordings A01 did not cover stay open on their own row.
  assert.ok(THERAPY_KB_RULES.some((r) => r.id === "KB_SELF_HOLD_REPLACES_BUTTERFLY"));
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/review/status/page.tsx"), "utf8");
  assert.match(page, /RESOLVED_FINDINGS\.map\(/, "the status page does not list them");
});
