import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EVENT_TERMS, displayTermFor, coverageOf } from "../src/lib/clinical/event-vocabulary";
import {
  DISPLAY_VOCABULARY_APPROVAL, vocabularyHash, checkApproval, vocabularyIsApproved,
  type ClinicalApproval,
} from "../src/lib/governance/clinical-approval";

// A clinical approval is only worth recording if it can go WRONG.
//
// The failure this mechanism exists to prevent is the ordinary one: an approval
// recorded once, the thing it approved changes, the sign-off survives, and a
// year later somebody reads "clinically approved" over words no clinician saw.
// So most of what is asserted here is that the check FAILS — on an unsigned
// approval, on a signed one whose words moved, on one that names nobody, and on
// one that does not say what it excludes.

const SIGNED: ClinicalApproval = {
  ...DISPLAY_VOCABULARY_APPROVAL,
  status: "approved",
  reviewers: [{ name: "A Reviewer", role: "Consultant psychologist" }],
  reviewedAt: "2026-09-17",
};

test("the approval is bound to the exact words, notes included", () => {
  // The note is where the clinical boundary lives — "recorded is not
  // delivered", "opened is not reviewed" — so a hash over the terms alone
  // would let the boundary be rewritten under an unchanged sign-off.
  const base = vocabularyHash({ a: { term: "Term", note: "Note." } });

  assert.notEqual(base, vocabularyHash({ a: { term: "Term", note: "Note changed." } }),
    "rewriting a note left the hash alone, so the boundary could move under the approval");
  assert.notEqual(base, vocabularyHash({ a: { term: "Different", note: "Note." } }),
    "rewriting a term left the hash alone");
  assert.notEqual(base, vocabularyHash({ b: { term: "Term", note: "Note." } }),
    "renaming the key left the hash alone");
});

test("the hash describes the content, not the order it was typed in", () => {
  const one = vocabularyHash({ a: { term: "A", note: "." }, b: { term: "B", note: "." } });
  const two = vocabularyHash({ b: { term: "B", note: "." }, a: { term: "A", note: "." } });
  assert.equal(one, two);
});

test("two entries cannot be made to collide by moving a separator into the text", () => {
  // THE FIRST CANONICAL FORM FAILED THIS. It built `key\u0000term\u0000note`
  // and joined with \u0001, so a note containing those characters produced the
  // same string as two entries — one entry could forge a second, and two
  // different vocabularies could hash alike. It is JSON-encoded now, which
  // escapes control characters so no field can restructure the string it sits
  // in.
  const real = vocabularyHash({ a: { term: "X", note: "Y" }, b: { term: "P", note: "Q" } });
  const smuggled = vocabularyHash({ a: { term: "X", note: "Y\u0001b\u0000P\u0000Q" } });
  assert.notEqual(real, smuggled, "an entry forged a second one through its own text");
});

test("an approval with no attestation does not count as approval", () => {
  // The state this repository is in right now: the words exist, nobody has
  // signed them. The check has to say so rather than defaulting to permissive.
  const check = checkApproval(DISPLAY_VOCABULARY_APPROVAL);
  assert.equal(check.ok, false, "an unsigned approval passed");
  assert.match(check.problems.join(" "), /no attestation/);
  assert.equal(vocabularyIsApproved(), false);
});

test("a signed approval stops covering the words the moment they change", () => {
  // THE WHOLE POINT. Same reviewers, same date, one word different.
  assert.equal(checkApproval(SIGNED).ok, true, "a correctly signed approval was refused");

  const moved = checkApproval(SIGNED, vocabularyHash({ x: { term: "Something else", note: "." } }));
  assert.equal(moved.ok, false, "the words changed and the sign-off survived");
  assert.match(moved.problems.join(" "), /does not cover them/);
});

test("a signed approval that names nobody, or no date, is refused", () => {
  const nameless = checkApproval({ ...SIGNED, reviewers: [] });
  assert.equal(nameless.ok, false);
  assert.match(nameless.problems.join(" "), /names no reviewer/);

  const undated = checkApproval({ ...SIGNED, reviewedAt: null });
  assert.equal(undated.ok, false);
  assert.match(undated.problems.join(" "), /records no date/);
});

test("an approval that does not say what it excludes is refused", () => {
  // The dangerous reading of any sign-off is the widest one, so the scope's
  // boundary is required rather than encouraged.
  const open = checkApproval({ ...SIGNED, excludes: [] });
  assert.equal(open.ok, false);
  assert.match(open.problems.join(" "), /does not say what it excludes/);
});

test("the recorded hash matches the words as they stand", () => {
  // If this fails, either the vocabulary changed without a new review, or the
  // hash was regenerated to silence the previous test. Read the diff.
  assert.equal(
    DISPLAY_VOCABULARY_APPROVAL.contentHash,
    vocabularyHash(),
    "the recorded content hash and the current vocabulary disagree"
  );
});

test("the stored document is the words, current and complete", () => {
  // The document is what a reviewer reads and signs; the module is what the
  // product renders. Maintained separately they drift, and a signature over a
  // list that no longer matches the screen is this mechanism failing one level
  // up. The document is generated; this asserts it was regenerated.
  const doc = fs.readFileSync(
    path.join(process.cwd(), DISPLAY_VOCABULARY_APPROVAL.document), "utf8"
  );

  assert.ok(doc.includes(DISPLAY_VOCABULARY_APPROVAL.contentHash),
    "the document does not carry the hash the approval is bound to");

  for (const [key, t] of Object.entries(EVENT_TERMS)) {
    assert.ok(doc.includes(`\`${key}\``), `${key} is approved in code and absent from the document`);
    assert.ok(doc.includes(t.term), `the words for ${key} are not in the document`);
    assert.ok(doc.includes(t.note.replace(/\|/g, "\\|")), `the note for ${key} is not in the document`);
  }

  assert.ok(doc.includes(`## The approved words (${Object.keys(EVENT_TERMS).length})`),
    "the document's count does not match the vocabulary");

  for (const e of DISPLAY_VOCABULARY_APPROVAL.excludes) {
    assert.ok(doc.includes(e), "an exclusion is recorded in code and missing from the document");
  }

  // And the document says which state it is in, so a reader is not left to
  // infer it from the presence of a name.
  assert.match(doc, /Awaiting attestation|Approved on/);
});

test("every term is distinct, so one concept has one label", () => {
  // UX 009's acceptance condition: "The same concept has one user-facing label
  // across pages." Two keys sharing a term is the same failure in reverse —
  // one label for two concepts.
  const seen = new Map<string, string>();
  for (const [key, t] of Object.entries(EVENT_TERMS)) {
    const clash = seen.get(t.term.toLowerCase());
    assert.equal(clash, undefined, `${key} and ${clash} both display as "${t.term}"`);
    seen.set(t.term.toLowerCase(), key);
  }
});

test("a term that is only the key reworded earns its place with a boundary", () => {
  // THE FIRST VERSION OF THIS TEST WAS WRONG AND CAUGHT SOMETHING ANYWAY. It
  // refused any term equal to the key with its underscores swapped, which
  // punishes a WELL-NAMED key: "Contact attempt recorded" is good clinical
  // English that happens to match `contact_attempt_recorded`. Twenty of eighty
  // terms coincide that way and most are right.
  //
  // What is actually being refused is a term that ADDS NOTHING. Where the
  // words are the key reworded, the value is entirely in the note, so the note
  // has to carry what this module promises: what the event does not mean.
  // Eight entries failed that and were rewritten rather than exempted.
  const boundary = /\b(not|never|no)\b/i;
  for (const [key, t] of Object.entries(EVENT_TERMS)) {
    if (t.term.toLowerCase().replace(/\s+/g, "_") !== key) continue;
    assert.match(
      t.note, boundary,
      `"${t.term}" is ${key} reworded and its note draws no distinction, so the entry adds nothing over the raw key`
    );
  }
});

test("every note is a written sentence, not a placeholder", () => {
  for (const [key, t] of Object.entries(EVENT_TERMS)) {
    assert.ok(t.note.length >= 40, `the note for ${key} is too short to say anything: "${t.note}"`);
    assert.match(t.note, /\.$/, `the note for ${key} is not a complete sentence`);
    assert.ok(t.term.length > 0 && t.term[0] === t.term[0].toUpperCase(),
      `the term for ${key} does not read as a label`);
  }
});

test("an unknown key is marked as raw rather than given invented words", () => {
  const known = displayTermFor("contact_attempt_recorded");
  assert.equal(known.approved, true);
  assert.equal(known.term, "Contact attempt recorded");
  assert.ok(known.note);

  const unknown = displayTermFor("some_future_event_nobody_has_worded");
  assert.equal(unknown.approved, false, "an unknown key was presented as approved");
  assert.equal(unknown.note, null, "an unknown key was given a clinical note");
  assert.equal(unknown.term, "some future event nobody has worded");
});

test("the raw key is retained whether or not there are approved words", () => {
  // "Retain raw values in details." This is a log somebody may have to
  // reconcile against a database.
  for (const key of ["contact_attempt_recorded", "some_future_event"]) {
    assert.equal(displayTermFor(key).key, key);
  }
});

test("coverage is reportable, so the gap is visible rather than discovered", () => {
  const c = coverageOf([
    "contact_attempt_recorded", "contact_attempt_recorded", "not_worded_yet", "also_not_worded",
  ]);
  assert.equal(c.total, 3, "duplicates were counted twice");
  assert.equal(c.approved, 1);
  assert.deepEqual(c.missing, ["also_not_worded", "not_worded_yet"]);
});

test("the surfaces the approval claims to cover are real routes", () => {
  const register = fs.readFileSync(
    path.join(process.cwd(), "src/lib/app/route-register.ts"), "utf8"
  );
  for (const route of DISPLAY_VOCABULARY_APPROVAL.appliesTo) {
    assert.ok(register.includes(`"${route}"`), `${route} is claimed by the approval and is not a registered route`);
  }
});
