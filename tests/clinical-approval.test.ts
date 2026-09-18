import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
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
  reviewers: [{
    name: "A Reviewer", role: "Consultant psychologist",
    license: "Psychologist — XX-000000", signedAt: "2026-09-17",
  }],
  reviewedAt: "2026-09-17",
  signedEvidence: {
    path: "docs/approvals/clinical-display-vocabulary-v1-SIGNED.pdf",
    sha256: "sha-of-some-other-file",
    determination: "Approved as written.",
    conditions: [],
  },
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
  // THE STATE THIS RECORD WAS IN UNTIL THE SIGNED FORM CAME BACK, written as a
  // value rather than read from the live record. The earlier version asserted
  // on DISPLAY_VOCABULARY_APPROVAL itself, which made it a test of what day it
  // was: it passed while nobody had signed and failed the moment somebody did.
  // What has to hold forever is that an unsigned approval is refused.
  const unsigned = {
    ...DISPLAY_VOCABULARY_APPROVAL,
    status: "awaiting_attestation" as const,
    reviewers: [], reviewedAt: null, signedEvidence: null,
  };
  const check = checkApproval(unsigned);
  assert.equal(check.ok, false, "an unsigned approval passed");
  assert.match(check.problems.join(" "), /no attestation/);
});

test("the recorded attestation is one a reader could check", () => {
  // The live record, now that it is signed. Every field here is something
  // somebody outside this repository could verify — a licence number, a date,
  // a file — because "a psychologist agreed" is not a checkable statement.
  const a = DISPLAY_VOCABULARY_APPROVAL;
  assert.equal(a.status, "approved");
  assert.equal(checkApproval(a).ok, true, checkApproval(a).problems.join(" "));
  assert.equal(vocabularyIsApproved(), true);

  assert.ok(a.reviewers.length >= 2, "one reviewer signed a two-reviewer attestation");
  for (const r of a.reviewers) {
    assert.match(r.license, /[A-Z]{2}\s?PSY-\d{6}/, `${r.name} has no licence number on the record`);
    assert.match(r.signedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(a.reviewedAt, a.reviewers[0].signedAt,
    "the approval's date is not the date the signatures carry");
});

test("the signed form on disk is the one the approval was recorded from", () => {
  // A transcription needs the thing it was transcribed from. Hashing the file
  // means the record names one exact document: replace it and this fails,
  // rather than the approval quietly pointing at whatever now sits there.
  const ev = DISPLAY_VOCABULARY_APPROVAL.signedEvidence;
  assert.ok(ev, "an approved record with no signed document");
  const file = path.join(process.cwd(), ev.path);
  assert.ok(fs.existsSync(file), `${ev.path} is recorded as the evidence and is not in the repository`);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(actual, ev.sha256,
    `${ev.path} is not the file this approval was recorded from`);
  assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), "%PDF-",
    "the recorded evidence is not a document");
});

test("the superseded signature is kept, and is a different document", () => {
  // An earlier copy of this same form was signed 9/17/26 — one day before the
  // form was prepared. The reviewers re-signed it, and the misdated copy stays
  // in the repository: deleting it would erase the evidence that a wrong date
  // was ever written, and the correction is part of the record rather than a
  // tidy-up of it.
  const superseded = path.join(
    process.cwd(),
    "docs/approvals/clinical-display-vocabulary-v1-SIGNED-2026-09-17-superseded.pdf",
  );
  assert.ok(fs.existsSync(superseded),
    "the superseded signature was removed, so nothing records that one was misdated");
  const hash = crypto.createHash("sha256").update(fs.readFileSync(superseded)).digest("hex");
  assert.equal(hash, "92abb3548e8f8d3fa1803d9e912cbf87945536aa2a97d8206fcf62607619bc92",
    "the superseded file is not the one that was signed on 9/17");
  assert.notEqual(hash, DISPLAY_VOCABULARY_APPROVAL.signedEvidence?.sha256,
    "the current approval points at the superseded copy");
  // And the correction changed only the date: the words reviewed are the same,
  // which is what makes re-signing a correction rather than a fresh review.
  const doc = fs.readFileSync(
    path.join(process.cwd(), DISPLAY_VOCABULARY_APPROVAL.document), "utf8",
  );
  assert.ok(doc.includes(DISPLAY_VOCABULARY_APPROVAL.contentHash),
    "the regenerated document does not carry the hash the signature is bound to");
});

test("the record says why there are two signed copies", () => {
  // Without this, a reader finds two signed PDFs, one named "superseded", and
  // no statement anywhere of what was wrong with the first.
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/governance/clinical-approval.ts"), "utf8",
  );
  assert.match(src, /SUPERSEDED COPY IS KEPT/);
  assert.match(src, /one day before the\s*\n\s*\/\/ form existed/,
    "the reason the first signature was replaced is not written down");
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
  assert.match(doc.replace(/\*\*/g, ""), /Awaiting attestation|Approved on \d{4}-\d{2}-\d{2} by/,
    "the document does not say which state the approval is in");
});

/**
 * The text of a .docx, read out of the file rather than out of the generator.
 *
 * A .docx is a zip, and the words are in `word/document.xml`. This walks the
 * central directory rather than the local headers because a streamed entry
 * writes its sizes into a trailing descriptor and leaves the local header's
 * copies zero — which is exactly the shape the `docx` package produces.
 *
 * Deliberately NOT asking the generator what it wrote. The point of the guard
 * below is that the file on disk carries the current words; a check that reads
 * the same variables the writer read would pass over a stale file.
 */
function docxText(file: string): string {
  const zip = fs.readFileSync(file);

  // The end-of-central-directory record, found from the back: it is the last
  // thing in the file, and only a trailing comment can sit after it.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && eocd === -1; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) eocd = i;
  }
  assert.notEqual(eocd, -1, `${file} is not a zip`);

  let at = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  for (let n = 0; n < count; n++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, "central directory entry expected");
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString("utf8");

    if (name === "word/document.xml") {
      const local = zip.readUInt32LE(at + 42);
      const body = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(body, body + compressed);
      const xml = (method === 0 ? raw : zlib.inflateRawSync(raw)).toString("utf8");
      // Paragraph and run boundaries become spaces, so two runs that happen to
      // abut do not read as one word; then the entities come back, because the
      // apostrophe in "the person's own words" is stored as `&apos;` and a
      // comparison against the source would otherwise fail on punctuation
      // rather than on the words. `&amp;` is undone last, so an escaped
      // `&amp;apos;` in a note stays the five characters it is.
      return xml
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/&(?:apos|#39);/g, "'")
        .replace(/&(?:quot|#34);/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim();
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  assert.fail(`${file} contains no word/document.xml`);
}

test("the printable form carries the same words, and the hash they are bound to", () => {
  // THE DOCUMENT AND THE FORM ARE THE SAME FAILURE ONE LEVEL APART. The .md is
  // what the repository reads; the .docx is what two clinicians put a pen to.
  // A vocabulary change that regenerates one and not the other sends a reviewer
  // a list of words the product no longer shows, and the signature that comes
  // back is over the wrong thing — while every hash in the codebase agrees.
  const form = path.join(process.cwd(), DISPLAY_VOCABULARY_APPROVAL.signoffForm);
  assert.ok(fs.existsSync(form),
    "the approval document points reviewers at a form that is not in the repository");

  const body = docxText(form);

  assert.ok(body.includes(DISPLAY_VOCABULARY_APPROVAL.contentHash),
    "the form does not carry the hash the approval is bound to");

  for (const [key, t] of Object.entries(EVENT_TERMS)) {
    assert.ok(body.includes(t.term), `the form does not offer "${t.term}" (${key}) for signature`);
    assert.ok(body.includes(t.note), `the form omits the boundary note for ${key}`);
  }

  // And it says what it is not, in the reviewers' hands as well as in the repo.
  for (const e of DISPLAY_VOCABULARY_APPROVAL.excludes) {
    assert.ok(body.includes(e), "an exclusion is recorded in code and missing from the signed form");
  }
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

test("the screen stops calling the words unapproved once they are approved", () => {
  // The notice was written to disappear when an attestation is recorded — "then
  // the claim is simply true" — and that is the half of a warning nobody tests
  // until it is wrong. A banner that survives its own condition teaches
  // clinicians to read past banners.
  const view = fs.readFileSync(
    path.join(process.cwd(), "src/components/clinical/AuditView.tsx"), "utf8"
  );
  assert.match(view, /if \(approval\.ok && coverage\.missing\.length === 0\) return null;/,
    "the vocabulary notice no longer stands down when the words are approved");
  assert.match(view, /\{!approval\.ok && \(/,
    "the 'not clinically approved' sentence is rendered unconditionally");

  // And the condition it stands down on is actually met now.
  assert.equal(checkApproval().ok, true, checkApproval().problems.join(" "));
});

test("a signature does not survive the words changing under it", () => {
  // THE POINT OF THE WHOLE MECHANISM, now that there is a real signature to
  // lose. Two named psychologists signed a hash; one reworded note and the
  // approval stops covering the vocabulary rather than following it.
  const moved = checkApproval(
    DISPLAY_VOCABULARY_APPROVAL,
    vocabularyHash({ ...EVENT_TERMS, alert_closed: { term: "Safety alert closed", note: "Changed." } })
  );
  assert.equal(moved.ok, false, "the words moved and the signature came with them");
  assert.match(moved.problems.join(" "), /does not cover them/);
});
