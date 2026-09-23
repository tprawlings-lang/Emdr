// The questions waiting on a person.
//
// NEITHER EXISTING REGISTER COULD SAY THIS. The work register has `proposed`
// and `held`; the failure register has `gap`. All three describe the state of
// the WORK, and none says "this is not moving because nobody has answered a
// question" — so a decision waiting on somebody looked exactly like work
// nobody had got to, and that difference is the only thing telling you whether
// building harder would help.
//
// THE FAILURE MODE OF A LIST OF OPEN QUESTIONS IS THAT IT OUTLIVES THEM. A
// question stays open after it was answered in a meeting; a "blocks" pointer
// keeps naming work that shipped; a decision is taken and its rationale is
// nowhere near the code it explains. Every check below is one of those.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DECISION_REGISTER, OPEN_DECISIONS, decisionSummary, AUDIENCE_LABEL,
} from "../src/lib/governance/decision-register";
import { WORK_REGISTER } from "../src/lib/governance/work-register";
import { FAILURE_REGISTER } from "../src/lib/governance/failure-register";
import { RELEASE_DEFINITION } from "../src/lib/review/release-definition";

const known = new Set<string>([
  ...WORK_REGISTER.map((e) => e.id),
  ...FAILURE_REGISTER.map((e) => e.id),
  ...RELEASE_DEFINITION.map((e) => e.id),
]);

test("everything a decision claims to block exists", () => {
  // A pointer at work that was renamed or never filed is how a list of open
  // questions stops being checkable — and this one is meant to be the record
  // somebody acts on.
  for (const d of DECISION_REGISTER) {
    for (const id of d.blocks) {
      assert.ok(known.has(id), `${d.id} blocks "${id}", which is in no register`);
    }
  }
});

test("an open decision does not block work that is already finished", () => {
  // THE WAY THIS LIST GOES STALE. Somebody answers a question, the work lands,
  // and the question sits here for weeks looking like a blocker — which costs
  // exactly the thing the registers exist to prevent: a reader trusting a
  // paragraph that was true once.
  const finished = new Set(
    WORK_REGISTER.filter((e) => e.state === "reachable" || e.state === "tested").map((e) => e.id)
  );
  for (const d of OPEN_DECISIONS) {
    for (const id of d.blocks) {
      assert.ok(
        !finished.has(id),
        `${d.id} is open and blocks ${id}, which is built — either the question was answered or it never blocked it`,
      );
    }
  }
});

test("an answered decision says what was decided and when", () => {
  // A decision that vanishes when it is taken leaves the code carrying a
  // rationale nobody can find, and the next person re-opens it.
  for (const d of DECISION_REGISTER.filter((x) => x.state === "answered")) {
    assert.ok(d.answer, `${d.id} is answered and records no answer`);
    assert.match(d.answer!.on, /^\d{4}-\d{2}-\d{2}$/, `${d.id}'s answer has no usable date`);
    assert.ok(d.answer!.decided.length > 40, `${d.id}'s answer is too short to act on`);
  }
});

test("every decision says what happens while nobody has answered", () => {
  // An unanswered question ALWAYS has a current behaviour, and leaving it
  // unsaid is how a default becomes a decision nobody took. This is the field
  // most often missing from a list of open questions and the one that tells a
  // reader whether the wait is costing anything.
  for (const d of DECISION_REGISTER) {
    assert.ok(d.meanwhile.length > 40, `${d.id} does not say what happens meanwhile`);
  }
});

test("a question is asked in words somebody outside the codebase can answer", () => {
  // "Should CONTACT_LEDGER_ACTIONS include record_thought" is not a question a
  // clinical lead can answer. The same question, askable, is what makes this a
  // register rather than a backlog.
  for (const d of DECISION_REGISTER) {
    assert.ok(d.question.includes("?"), `${d.id} is not phrased as a question`);
    assert.ok(d.question.length > 60, `${d.id}'s question is too terse to answer cold`);
    // A symbol name with no spaces around it, or a file path, means the
    // question was written for whoever wrote the code.
    assert.ok(
      !/\b\w+\.(ts|tsx)\b/.test(d.question),
      `${d.id} names a source file, so it is a question for the author rather than the decider`,
    );
  }
});

test("ids are unique and every audience has a label", () => {
  const ids = DECISION_REGISTER.map((d) => d.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), "two decisions share an id");
  for (const d of DECISION_REGISTER) {
    assert.ok(AUDIENCE_LABEL[d.audience], `${d.audience} has no label, so the screen shows a key`);
  }
});

test("the summary counts what it says it counts", () => {
  const s = decisionSummary();
  assert.equal(s.open, OPEN_DECISIONS.length);
  assert.equal(s.open + s.answered, DECISION_REGISTER.length);
  // A decision blocking nothing is still worth asking and is counted
  // separately rather than hidden — what it must not do is pad a count of
  // things that are stuck.
  assert.equal(s.blocking, OPEN_DECISIONS.filter((d) => d.blocks.length > 0).length);
  assert.ok(s.blocking <= s.open);
  assert.equal(
    Object.values(s.byAudience).reduce((a, b) => a + b, 0), s.open,
    "an open decision belongs to no audience, so nobody is asked",
  );
});

// ---------------------------------------------------------------------------
// The sign-off sheets
// ---------------------------------------------------------------------------

test("every open question offers at least two ways to answer it", () => {
  // A question with one option is a notification. An answered one keeps its
  // options too, so a later reader can see what was on the table rather than
  // only what was picked.
  for (const d of DECISION_REGISTER) {
    assert.ok(d.options.length >= 2, `${d.id} offers ${d.options.length} option(s)`);
  }
});

test("at most one option is marked as suggested", () => {
  // Saying which way the evidence points is more useful than pretending to be
  // neutral. Two recommendations is not a recommendation.
  for (const d of DECISION_REGISTER) {
    const n = d.options.filter((o) => o.recommended).length;
    assert.ok(n <= 1, `${d.id} suggests ${n} of its options`);
  }
});

test("an option is written for the person deciding, not the person building", () => {
  // THE WHOLE POINT OF THE SHEETS. "Use the MINUTES map everywhere" cannot be
  // weighed by a clinical lead, and a sheet they cannot weigh comes back
  // unsigned or — worse — signed without being read. A file name, a symbol in
  // backticks or a table name is the tell that an option was written by
  // whoever wrote the code.
  const jargon = [
    /\b\w+\.(ts|tsx|sql|json)\b/,      // a file
    /`[A-Za-z_]+`/,                     // a symbol in backticks
    /\b[a-z]+_[a-z]+(_[a-z]+)*\b/,      // a snake_case table or column
    /\b[a-z]+[A-Z]\w*\(/,               // a function call
  ];
  for (const d of DECISION_REGISTER) {
    for (const o of d.options) {
      const text = `${o.label} ${o.plainly} ${o.then}`;
      for (const pattern of jargon) {
        assert.ok(
          !pattern.test(text),
          `${d.id} option "${o.label}" is written in code terms (${pattern}): ${text.slice(0, 120)}`,
        );
      }
      assert.ok(o.plainly.length > 40, `${d.id} option "${o.label}" is not explained`);
      assert.ok(o.then.length > 15, `${d.id} option "${o.label}" does not say what would change`);
    }
  }
});

test("the committed sheets match the register", async () => {
  // A SHEET SOMEBODY HAND-EDITS DRIFTS FROM THE REGISTER the moment either
  // moves, and then there are two accounts of what is open — which is the drift
  // this whole family of registers exists to end, reproduced on paper, where
  // there is no test.
  const { sheets } = await import("../scripts/gen-decision-signoffs");

  const dir = path.join(__dirname, "..", "docs", "decisions");
  const built = sheets();
  const onDisk = new Set(
    fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : []
  );

  for (const [name, body] of built) {
    const full = path.join(dir, name);
    assert.ok(fs.existsSync(full), `${name} is missing — run: npx tsx scripts/gen-decision-signoffs.ts`);
    assert.equal(
      fs.readFileSync(full, "utf8"), body,
      `docs/decisions/${name} is stale — run: npx tsx scripts/gen-decision-signoffs.ts`,
    );
    onDisk.delete(name);
  }
  // AND A SHEET FOR A QUESTION THAT HAS BEEN ANSWERED IS THE SAME LIE as a
  // register entry nobody re-read, so it must not survive.
  assert.deepEqual(
    [...onDisk], [],
    "a sheet exists for a question that is no longer open — run: npx tsx scripts/gen-decision-signoffs.ts",
  );
});

test("every sheet has somewhere to write a name, a signature and a date", () => {
  // A tick with no name is an anonymous decision, and one with no date cannot
  // be checked against what the product did afterwards.
  for (const d of OPEN_DECISIONS) {
    const body = fs.readFileSync(
      path.join(__dirname, "..", "docs", "decisions", `${d.id}.md`), "utf8"
    );
    for (const field of ["**Name**", "**Signature**", "**Date**"]) {
      assert.ok(body.includes(field), `${d.id}'s sheet has no ${field} field`);
    }
    // And every option is tickable, not just described.
    for (const o of d.options) {
      assert.ok(body.includes(`— ${o.label}`), `${d.id}'s sheet describes "${o.label}" with no box`);
    }
  }
});
