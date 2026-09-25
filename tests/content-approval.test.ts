// The Handoff 10 content review is bound to the exact words it approved.
//
// Two independent psychologists signed approve-all for Lanes A to D on
// 2026-09-24 (docs/approvals/handoff-10-content-SIGNED-2026-09-24.pdf). What
// they read was docs/handoffs/10-content-pack.md. So:
//
//   - the pack, the spec and the signed form must be the files the record
//     names, byte for byte;
//   - every member-facing string that rides on a signed row must appear in the
//     pack word for word — the pack's own instruction is "transcribe text
//     exactly", and a reworded string is an unreviewed one;
//   - every skill's gate must be the one the reviewers approved (row A02), which
//     is also its source entry's gate in the knowledge base;
//   - no modality name reaches member copy (row F02).

import { strict as assert } from "node:assert";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CONTENT_V10_APPROVAL, approvedContentRows } from "../src/lib/content-approval";
import { CONTENT_V10_RULES, isContentLive } from "../src/lib/content-signoff";
import { H10_SKILLS, H10_SLEEP, H10_LESSONS } from "../src/lib/content/h10.generated";
import { TECHNIQUES } from "../src/lib/therapy-kb/catalog";
import { SKILLS, ALL_PRACTICES } from "../src/lib/practices";
import { LESSONS } from "../src/lib/lessons";
import { H10_PROGRAMS } from "../src/lib/content/h10-programs";
import { THOUGHT_RECORD } from "../src/lib/content/h10-thought-record";

const ROOT = process.cwd();
const sha = (rel: string) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
const PACK = fs.readFileSync(path.join(ROOT, CONTENT_V10_APPROVAL.contentPack.path), "utf8");

test("the pack, the spec and the signed form are the files the record names", () => {
  assert.equal(sha(CONTENT_V10_APPROVAL.contentPack.path), CONTENT_V10_APPROVAL.contentPack.sha256,
    "the content pack changed after it was signed — a change to the words is a new review");
  assert.equal(sha(CONTENT_V10_APPROVAL.spec.path), CONTENT_V10_APPROVAL.spec.sha256, "the handoff changed after the review");
  assert.equal(sha(CONTENT_V10_APPROVAL.signedEvidence.path), CONTENT_V10_APPROVAL.signedEvidence.sha256,
    "the signed form is not the one the record names");
});

test("the record says who signed what, and what it does not cover", () => {
  assert.equal(CONTENT_V10_APPROVAL.reviewers.length, 2);
  for (const r of CONTENT_V10_APPROVAL.reviewers) {
    assert.match(r.license, /^AZ PSY-\d{6}$/);
    assert.match(r.signedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(CONTENT_V10_APPROVAL.approvedRows.length, 32, "approve-all covers A01 to D05, 32 rows");
  assert.ok(CONTENT_V10_APPROVAL.excludes.length > 0);
  const known = new Set(CONTENT_V10_RULES.map((r) => r.id));
  for (const r of [...CONTENT_V10_APPROVAL.approvedRows, ...CONTENT_V10_APPROVAL.founderRows, ...CONTENT_V10_APPROVAL.notSigned.rows]) {
    assert.ok(known.has(r), `${r} is in the record but not a row`);
  }
  for (const r of CONTENT_V10_APPROVAL.notSigned.rows) {
    assert.ok(!approvedContentRows().has(r), `${r} was not signed and must not be live`);
    assert.equal(isContentLive({ signoffRowIds: [r] }, new Map()), false);
  }
});

/** Every member-facing string an item carries. */
function memberStrings(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ["title", "intro", "whenToUse", "note", "summary"]) {
    if (typeof item[k] === "string") out.push(item[k] as string);
  }
  for (const s of (item.skipIf as string[] | undefined) ?? []) out.push(s);
  for (const s of (item.steps as Array<{ text: string }> | undefined) ?? []) out.push(s.text);
  for (const s of (item.segments as Array<{ text: string }> | undefined) ?? []) out.push(s.text);
  return out;
}

/** The two new sleep practices' titles come from the worksheet's row A14
 *  ("New practices: After a bad dream, Back to rest") — the pack names them
 *  by id only. The only strings allowed from outside the pack. */
const TITLED_BY_WORKSHEET = new Set(["After a bad dream", "Back to rest"]);

/** Every WHOLE string the pack gives: a line's value after its label, a
 *  numbered step, a quoted segment. Matching whole atoms rather than
 *  substrings, because a truncated step is a substring of the real one and
 *  would pass — the first version of this test let exactly that through. */
function packAtoms(): Set<string> {
  const atoms = new Set<string>();
  for (const line of PACK.split("\n")) {
    const labelled = line.match(/^(?:Title|Intro|When to use|Skip if|Note|Summary|Purpose): (.*)$/);
    if (labelled) atoms.add(labelled[1]);
    const step = line.match(/^\d+\. (.*)$/);
    if (step) atoms.add(step[1]);
    const seg = line.match(/^- "(.*)" \(\d+s\)$/);
    if (seg) atoms.add(seg[1]);
    const lesson = line.match(/^### L\d `[\w-]+` · (.+?) · \d+ min$/);
    if (lesson) atoms.add(lesson[1]);
    // Program sections: bold fields, unit headings, quoted screen copy with
    // [button] labels and "·" lists, category bullets, completion copy.
    const bold = line.match(/^\*\*(?:Title|Blurb):\*\* (.*)$/);
    if (bold) atoms.add(bold[1]);
    const unit = line.match(/^### Unit \d+: (.*?)(?: \([^)]*\))?$/);
    if (unit) atoms.add(unit[1]);
    const done = line.match(/^Completion copy: "(.*)"$/);
    if (done) atoms.add(done[1]);
    // Steadier Sleep: the unit text, the entry screen's any-yes line (with
    // its "(Unit 2 withheld.)" annotation outside the quotes), and the
    // per-question line.
    const quoted = line.match(/^(?:Text|Any Yes|If question \d+ is Yes, add): "(.*)"(?: \([^)]*\))?$/);
    if (quoted) atoms.add(quoted[1]);
    // Phase 2 programs: table rows (unit, purpose, and any quoted prompt or
    // opening text in any cell), and the shared opening line.
    const row = line.match(/^\| \d+ \| (.*) \|$/);
    if (row) {
      const cells = row[1].split(" | ");
      atoms.add(cells[0]);
      if (cells.length === 4) atoms.add(cells[1]); // 2A: # | Unit | Purpose | Practices | Activity
      for (const cell of cells) for (const q of cell.matchAll(/"([^"]+)"/g)) atoms.add(q[1]);
    }
    const opening = line.match(/^Unit opening line for units [\d to]+: "(.*)"$/);
    if (opening) atoms.add(opening[1]);
    // "If the feeling is 8 or higher at step 2: "…" [Find the room] [Keep going]"
    // "Each unit ends: "…" [Add] [Not now] (writes to …)"
    const conditional = line.match(/^(?:If [^"]+|Each unit ends): "(.*?)"((?: \[[^\]]+\])*)(?: \(.*\)\.?)?$/);
    if (conditional) {
      atoms.add(conditional[1]);
      for (const b of conditional[2].matchAll(/\[([^\]]+)\]/g)) atoms.add(b[1]);
    }
    const bullet = line.match(/^- ([^:"]+): (.*)$/);
    if (bullet) { atoms.add(bullet[1]); for (const i of bullet[2].split(" · ")) atoms.add(i); }
    const quote = line.match(/^>\s*(.*)$/);
    if (quote && !quote[1].startsWith("(")) {
      let rest = quote[1];
      for (const b of rest.matchAll(/\[([^\]]+)\]/g)) atoms.add(b[1]);
      rest = rest.replace(/\[[^\]]+\]/g, "").replace(/^If [^:]+:\s*/, "").trim();
      rest = rest.replace(/\s+0 to 10 \(optional\)$/, "").replace(/\s+\(optional(?: text)?\)$/, "").trim();
      rest = rest.replace(/^"(.*)"$/, "$1");
      // A list bullet or a numbered question inside a quote, or a bold title.
      rest = rest.replace(/^- /, "").replace(/^\d+\. /, "").replace(/^\*\*(.*)\*\*$/, "$1");
      // The thought record's lines carry two things each: split, never reworded.
      //   "What happened? (a sentence or two)" -> question, hint
      //   "What did you feel? [feeling words] How strong? 0 to 10" -> each side of the field
      for (const seg of quote[1].replace(/^\d+\. /, "").split(/\[[^\]]+\]/)) {
        const t = seg.trim().replace(/\s+0 to 10$/, "");
        if (!t) continue;
        atoms.add(t);
        const hinted = t.match(/^(.*?) \((.*)\)$/);
        if (hinted) { atoms.add(hinted[1]); atoms.add(hinted[2]); }
      }
      // A trailing build note, e.g. "(multi-select from units 1 to 3 items)".
      rest = rest.replace(/\s+\((?:multi-select|optional)[^)]*\)$/, "").trim();
      if (rest) atoms.add(rest);
      if (rest.includes(" · ")) for (const i of rest.split(" · ")) atoms.add(i);
    }
  }
  return atoms;
}

test("every member-facing string on a signed item is in the pack, whole and word for word", () => {
  const atoms = packAtoms();
  const missing: string[] = [];
  for (const item of [...H10_SKILLS, ...H10_SLEEP] as unknown as Array<Record<string, unknown>>) {
    for (const s of memberStrings(item)) {
      if (TITLED_BY_WORKSHEET.has(s) && item.title === s) continue;
      if (!atoms.has(s)) missing.push(`${item.id}: ${s}`);
    }
  }
  for (const l of H10_LESSONS) {
    if (!atoms.has(l.title)) missing.push(`${l.id}: title`);
    // The whole body, bounded by its summary before and a blank line after.
    if (!PACK.includes(`Summary: ${l.summary}\n\n${l.body}\n\n`)) missing.push(`${l.id}: summary or body`);
  }
  assert.deepEqual(missing, [], "strings that are not in the signed pack:\n  " + missing.join("\n  "));
});

test("the content is all there: 18 skills, 2 sleep practices, 8 lessons, each on its row", () => {
  assert.equal(H10_SKILLS.length, 18);
  assert.equal(H10_SLEEP.length, 2);
  assert.equal(H10_LESSONS.length, 8);
  assert.equal(SKILLS, H10_SKILLS);
  for (const p of [...H10_SKILLS, ...H10_SLEEP]) assert.ok(ALL_PRACTICES.includes(p), `${p.id} is not reachable`);
  for (const l of H10_LESSONS) assert.ok(LESSONS.includes(l), `${l.id} is not reachable`);
  H10_LESSONS.forEach((l, i) => assert.deepEqual(l.signoffRowIds, [`CV10_A${String(i + 6).padStart(2, "0")}`]));
  for (const s of H10_SKILLS) {
    assert.ok(s.signoffRowIds?.includes("CV10_A02") && s.signoffRowIds.includes("CV10_A03"), `${s.id}: needs selection and wording rows`);
    assert.equal(Boolean(s.skipIf), Boolean(s.signoffRowIds?.includes("CV10_A05")), `${s.id}: a skip-if note rides on A05`);
    assert.ok(isContentLive(s, new Map()), `${s.id} is signed and should be live`);
  }
});

test("each skill's gate is the approved one, which is its knowledge-base source's", () => {
  for (const s of H10_SKILLS) {
    const src = TECHNIQUES.find((t) => t.id === s.sourceTechniqueId);
    assert.ok(src, `${s.id}: source ${s.sourceTechniqueId} is not in the knowledge base`);
    assert.equal(s.minTier, src.minTier, `${s.id}: tier differs from its source`);
    assert.equal(s.maxActivation, src.maxActivation, `${s.id}: ceiling differs from its source`);
    assert.equal(s.imagery, false);
  }
  const bySkillCode = Object.fromEntries(H10_SLEEP.map((p) => [p.id, p]));
  assert.equal(bySkillCode["after-a-bad-dream"].minTier, 1);
  assert.equal(bySkillCode["after-a-bad-dream"].maxActivation, 10);
  assert.equal(bySkillCode["back-to-rest"].minTier, 2);
  assert.equal(bySkillCode["back-to-rest"].maxActivation, 7);
});

test("the cold-water skill stays out of the member library (A04)", () => {
  assert.ok(!ALL_PRACTICES.some((p) => p.sourceTechniqueId === "dbt-temperature"));
});

test("no modality name reaches member copy (F02)", () => {
  const MODALITY = /\b(DBT|ACT|STAIR|CBT-I|CBT|EMDRIA|IPT)\b/;
  const hits: string[] = [];
  for (const item of [...H10_SKILLS, ...H10_SLEEP] as unknown as Array<Record<string, unknown>>) {
    for (const s of memberStrings(item)) if (MODALITY.test(s)) hits.push(`${item.id}: ${s}`);
  }
  for (const l of H10_LESSONS) for (const s of [l.title, l.summary, l.body]) if (MODALITY.test(s)) hits.push(`${l.id}`);
  assert.deepEqual(hits, []);
});

test("every member-facing string in a program is in the pack, whole", () => {
  const atoms = packAtoms();
  const missing: string[] = [];
  const check = (where: string, v: string | undefined) => { if (v !== undefined && !atoms.has(v)) missing.push(`${where}: ${v}`); };
  for (const p of H10_PROGRAMS) {
    check(`${p.id} title`, p.title);
    check(`${p.id} blurb`, p.blurb);
    const e = p.entryScreen;
    if (e) {
      for (const v of [e.intro, ...e.questions, e.yes, e.no, e.anyYes, ...Object.values(e.ifYes)]) check(`${e.id}`, v);
    }
    for (const u of p.units) {
      check(`${u.id} title`, u.title);
      check(`${u.id} purpose`, u.purpose);
      for (const t of [...(u.text ?? []), ...(u.list ?? []), ...(u.textAfter ?? [])]) check(`${u.id} text`, t);
      const c = u.copy;
      if (!c) continue;
      for (const k of ["prompt", "dayPrompt", "save", "mastery", "enjoyment", "noticed", "notThisTime", "remember", "completion", "note", "keepDoing", "skip"] as const) {
        check(`${u.id} ${k}`, c[k]);
      }
      for (const v of [...(c.options ?? []), ...(c.outcomes ?? []), ...(c.notThisTimeChoices ?? [])]) check(`${u.id} choice`, v);
      for (const cat of c.categories ?? []) {
        check(`${u.id} category`, cat.name);
        for (const i of cat.items) check(`${u.id} menu`, i);
      }
    }
  }
  assert.deepEqual(missing, [], "program strings not in the signed pack:\n  " + missing.join("\n  "));
});

test("Moving Toward's gate is the approved proposal (CV10_B02)", () => {
  const mt = H10_PROGRAMS.find((p) => p.id === "moving-toward")!;
  assert.deepEqual(mt.units.map((u) => [u.minTier, u.maxActivation]), [[2, 6], [2, 6], [3, 6], [3, 6]]);
  assert.ok(mt.signoffRowIds.includes("CV10_F02"), "the program name rides on the founder's F02");
  const gentle = mt.units[1].copy!.categories!.filter((c) => c.gentle).map((c) => c.name);
  assert.deepEqual(gentle, ["Gentle"]);
});

test("every member-facing string in the thought record is in the pack, whole (CV10_D04)", () => {
  const atoms = packAtoms();
  const t = THOUGHT_RECORD;
  const strings = [
    t.title, t.intro, t.strengthQuestion, t.feelingWordsLabel, t.save, t.stop, t.privacy, t.strong, t.strongGround, t.strongContinue,
    ...t.steps.flatMap((s) => ("hint" in s && s.hint ? [s.question, s.hint] : [s.question])),
  ];
  const missing = strings.filter((x) => !atoms.has(x));
  assert.deepEqual(missing, [], "thought record strings not in the signed pack:\n  " + missing.join("\n  "));
  // The grounding offer's threshold and target are the pack's.
  assert.equal(t.strongAt, 8);
  assert.ok(PACK.includes("If the feeling is 8 or higher at step 2:"));
  assert.ok(PACK.includes(`[${t.strongGround}] [${t.strongContinue}]`));
});
