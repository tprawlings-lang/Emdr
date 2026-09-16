process.env.EMDR_DATA_DIR = `/tmp/steady-concepts-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "concepts-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "concepts-test-secret-not-real";

// Concepts a clinical screen must never merge.
//
// The September handoff names six, and three sentences under them:
//
//   "No action suggested does not mean clinically well.
//    Waiting does not mean low risk.
//    A recorded contact attempt does not mean a message was delivered."
//
// Each pair below is two facts that look interchangeable in a row of small
// grey text and are not. Collapsing any of them does not produce a broken
// screen — it produces a screen that reads confidently and says the wrong
// thing, which is the failure mode this whole codebase is built against.
//
// ONE OF THEM WAS ALREADY COLLAPSED when these were written, and it is why
// this file exists rather than being a formality: `lastContactDays` was
// computed from the MEMBER'S OWN CHECK-INS and rendered as "Contacted today".
// Contact runs from the team to the person; a check-in runs from the person to
// the system. A clinician scanning for who needs outreach was shown the people
// who use the app most as the people most recently spoken to.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments stripped, so a comment mentioning a concept is not
 *  read as the code doing it. */
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
// 1. Contact is not activity
// ---------------------------------------------------------------------------

test("contact is read from a contact record, never from the member's own check-ins", () => {
  const src = code("src/lib/clinical/caseload.ts");

  // The contact column comes from a signed contact note and nothing else.
  assert.match(src, /clinical_notes[\s\S]{0,200}kind = 'contact'[\s\S]{0,200}AS last_contact/,
    "the contact value no longer comes from a signed contact note");
  assert.match(src, /kind = 'contact'[\s\S]{0,120}status = 'signed'/,
    "an unsigned draft counts as contact, so intending to call somebody reads as having called them");

  // And the two are carried as separate fields all the way out of the domain.
  const caseload = read("src/lib/clinical/caseload.ts");
  assert.match(caseload, /daysSinceActivity: number \| null;/);
  assert.match(caseload, /daysSinceContact: number \| null;/);
  assert.notEqual(
    /daysSinceContact = daysBetween\(r\.last_activity/.test(src), true,
    "contact is being computed from the member's own activity again",
  );
});

test("the row shows both, and does not say 'contact' about activity", () => {
  const row = read("src/components/clinical/WorkQueueRow.tsx");
  assert.match(row, /lastContactDays/, "the row stopped showing contact at all");
  assert.match(row, /lastActivityDays/,
    "the engagement signal was dropped rather than relabelled — one absence traded for another");

  // The sentence that was false. It must be rendered from the contact field.
  //
  // COMMENTS STRIPPED FIRST. The note above that clause quotes "Contacted
  // today" while explaining the bug, so reading the raw file finds the comment
  // rather than the code — which is the same class of mistake as the defect
  // this guards.
  const bare = code("src/components/clinical/WorkQueueRow.tsx").replace(/\s+/g, " ");
  const idx = bare.indexOf("Contacted today");
  assert.ok(idx > 0, "the contact wording is gone entirely");
  assert.ok(
    bare.slice(Math.max(0, idx - 200), idx).includes("lastContactDays"),
    "\"Contacted today\" is rendered from something other than the contact field",
  );
  // And the activity clause must not borrow the word.
  const aIdx = bare.indexOf("Used Steady today");
  assert.ok(aIdx > 0, "the activity clause is gone");
  assert.ok(
    bare.slice(Math.max(0, aIdx - 200), aIdx).includes("lastActivityDays"),
    "the activity clause is rendered from the contact field",
  );
});

test("a work item carries contact and activity as separate values", async () => {
  const { } = await import("../src/lib/clinical/work-queue");
  const src = read("src/lib/clinical/work-queue.ts");
  assert.match(src, /lastContactDays: number \| null;/);
  assert.match(src, /lastActivityDays: number \| null;/);
  // Never assigned from each other at any construction site.
  assert.doesNotMatch(src, /lastContactDays: *\w*\.?daysSinceActivity/,
    "contact is populated from activity");
  assert.doesNotMatch(src, /lastActivityDays: *\w*\.?daysSinceContact/,
    "activity is populated from contact");
});

// ---------------------------------------------------------------------------
// 2. Waiting is not low risk
// ---------------------------------------------------------------------------

test("the waiting group carries no band of its own", async () => {
  // "Waiting does not mean low risk." A person can be waiting on somebody else
  // and be the most urgent person on the list; the grouping says who the next
  // move belongs to, not how serious it is.
  const { uiGroupFor } = await import("../src/lib/clinical/work-queue");
  const src = code("src/lib/clinical/work-queue.ts");

  assert.equal(typeof uiGroupFor, "function");
  // ONE DIRECTION IS FINE AND THE OTHER IS NOT. The group is a presentation
  // bucket over the band — `uiGroupFor` reads a band and returns a group, which
  // is the queue deciding how to lay itself out. The reverse would mean a row's
  // seriousness came from which column it landed in, so "waiting" would
  // literally make somebody lower risk.
  //
  // Line-scoped, because a multi-line window catches two adjacent pass-through
  // assignments and calls them a derivation.
  for (const line of src.split("\n")) {
    assert.doesNotMatch(line, /\bband\b *[:=][^=][^\n]*\b(waiting|review_today|needs_attention)\b/,
      `a band is derived from which group a row sits in: ${line.trim()}`);
  }
});

test("safety authority is carried, never inferred from priority", () => {
  // A non-safety row in the top band must not become a safety row by being
  // urgent, and a safety row must not stop being one by being calm.
  const home = code("src/lib/experience/clinician-home.ts");
  assert.match(home, /safetyAuthority: item\.safetyAuthority/,
    "the safety flag is no longer carried straight through");
  // Line-scoped for the same reason: `safetyAuthority: item.safetyAuthority`
  // followed by `band: item.band` is two facts travelling side by side, and a
  // window spanning both reads it as one deriving the other.
  for (const line of home.split("\n")) {
    assert.doesNotMatch(line, /safetyAuthority *[:=][^\n]*\bband\b/,
      `safety is computed from the priority band: ${line.trim()}`);
    assert.doesNotMatch(line, /\bband\b *[:=][^\n]*safetyAuthority/,
      `the priority band is computed from the safety flag: ${line.trim()}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Nothing to do is not "well"
// ---------------------------------------------------------------------------

test("an empty queue never reads as a clinical statement about anybody", () => {
  // "No action suggested does not mean clinically well." The empty state may
  // say the queue is empty; it may not say people are fine.
  const page = read("src/app/clinician/today/page.tsx");
  const around = page.replace(/\s+/g, " ");
  for (const claim of [
    /every(one|body)[^.]{0,40}(well|fine|stable|good)/i,
    /nobody needs (help|attention|care)/i,
    /all clear/i,
    /no (concerns|risk)\b/i,
  ]) {
    assert.doesNotMatch(around, claim,
      `the empty queue makes a clinical claim: ${claim}`);
  }
});

test("a row with no action explains itself", () => {
  const home = read("src/lib/experience/clinician-home.ts");
  assert.match(home, /blockedReason/,
    "a row can offer no action and no reason, which is a row that cannot explain itself");
});

// ---------------------------------------------------------------------------
// 4. Proposed is not delivered
// ---------------------------------------------------------------------------

test("a transfer proposal never claims the recipient was told", () => {
  // "A recorded contact attempt does not mean a message was delivered." There
  // is no delivery path in this deployment, so the only honest thing a handoff
  // can say is that nobody has been notified — and it says it.
  const src = read("src/lib/clinical/handoff.ts");
  assert.match(src, /[Nn]obody has been notified/,
    "the handoff stopped saying that nobody was notified, while still not notifying anybody");
  assert.doesNotMatch(code("src/lib/clinical/handoff.ts"), /\bnotifyRecipient\b|\bsendNotification\b/,
    "something claims to notify a recipient; if a delivery path now exists, the copy above is wrong");
});
