// RELEASE DEFINITION EVIDENCE for `records.kinds-cannot-be-confused` — see
// src/lib/review/release-definition.ts. That checklist names this file, and its
// verifier requires this file to name the line back: a test that does not say
// what it is evidence for can be rewritten into something else while the
// checklist keeps its tick.

process.env.EMDR_DATA_DIR = `/tmp/steady-clinnotes-${process.pid}-${Date.now()}`;
// NOT a demo database. These tests need three users and a tenant, and
// nothing about the 240-person seeded population — booting with EMDR_DEMO=1
// rebuilt all twenty thousand of its events on every reset, which took this
// file from two seconds to two minutes.
process.env.EMDR_DEMO = "0";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "clinical-notes-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "clinical-notes-test-secret-not-real";

// A clinician's signed account of contact.
//
// WHAT THE NOTE BRIDGE WAS RIGHT ABOUT, and this keeps: "a signature attests to
// a clinician's own statement, and Steady applying one would be Steady
// attesting on their behalf." Nothing here is assembled and nothing signs
// itself. What it was missing is the rest of its own sentence — "there is no
// note table to sign into either" — which was a gap rather than a principle.
//
// THE PROPERTIES BELOW ARE WHAT MAKE IT A RECORD instead of a text box:
//
//   1. A signed note cannot be changed. Not by the domain, not by SQL.
//   2. A correction is a new note that names the old one; both survive.
//   3. The signatory is the author.
//   4. Only signing reaches the ledger — a draft is not a record.
//   5. Reads are scoped to a tenant as well as a person.
//
// Each is a way the record could quietly stop answering "what did the clinician
// believe on the day", which is the only question a note is kept for.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import {
  notesFor, noteById, saveDraft, signNote, startAmendment, draftVersion,
  draftAmendmentFor, NoteError, MIN_BODY,
} from "../src/lib/clinical/notes";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const T1 = "TENANT0000000000000000001";
const T2 = "TENANT0000000000000000002";
const BODY = "Session note: reviewed the week, sleep improving, no safety concerns raised.";

/** Clear what these tests write. Cheaper and more honest than a full reset:
 *  a reset rebuilds a population none of this reads. */
function clear() {
  const db = getDb();
  db.prepare("DELETE FROM clinical_notes").run();
  // AND THE EVENTS THEY APPENDED. The ledger test counts note events for this
  // person, and without this it counted the previous tests' as well — which is
  // what a full reset used to hide.
  db.prepare("DELETE FROM longitudinal_events WHERE event_type LIKE 'clinical_note.%'").run();
}

function seed() {
  const db = getDb();
  // The tenants first. `persons.tenant_id` references them, and `kind` is a
  // closed set — an INSERT OR IGNORE here would swallow a CHECK violation and
  // leave the failure to surface as a foreign-key error three calls later,
  // which is exactly how this test failed the first time.
  for (const t of [T1, T2]) {
    db.prepare(
      "INSERT INTO tenants (id, kind, name) VALUES (?, 'program', ?) ON CONFLICT(id) DO NOTHING"
    ).run(t, `Test tenant ${t.slice(-1)}`);
  }
  for (const [id, role, tenant] of [
    ["n-person", "member", T1], ["n-clin", "clinician", T1], ["n-other", "clinician", T1],
  ] as const) {
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
       VALUES (?, ?, ?, ?, 'x', 'active', ?) ON CONFLICT(id) DO NOTHING`
    ).run(id, `${id}@example.test`, id, role, tenant);
    db.prepare(
      "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated') ON CONFLICT(id) DO NOTHING"
    ).run(id, tenant, id);
  }
}

async function signed(body = BODY): Promise<string> {
  const { id } = await saveDraft({
    personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session", body,
  });
  await signNote({ noteId: id, tenantId: T1, clinicianId: "n-clin", clinicianRole: "clinician" });
  return id;
}

// ---------------------------------------------------------------------------
// 1. A signed note cannot be changed
// ---------------------------------------------------------------------------

test("the domain refuses to edit a signed note, and says why", async () => {
  clear(); seed();
  const id = await signed();
  await assert.rejects(
    () => saveDraft({ noteId: id, personId: "n-person", tenantId: T1, clinicianId: "n-clin",
                      kind: "session", body: "Rewritten after the fact, quietly." }),
    (e: Error) => e instanceof NoteError && /signed and cannot be edited/i.test(e.message),
  );
  const after = await noteById(id, T1);
  assert.equal(after!.body, BODY, "the body changed despite the refusal");
});

test("SQL cannot change it either — the trigger is the real guarantee", async () => {
  // The domain check is a message; this is the promise. A script, a migration
  // or a future writer that never read notes.ts is exactly who this stops.
  const db = getDb(); clear(); seed();
  const id = await signed();
  assert.throws(
    () => db.prepare("UPDATE clinical_notes SET body = ? WHERE id = ?").run("rewritten by hand", id),
    /cannot be changed|amendment/i,
    "a signed note was rewritten with plain SQL",
  );
  // And un-signing is a change too — the obvious way round the rule.
  assert.throws(
    () => db.prepare("UPDATE clinical_notes SET status = 'draft' WHERE id = ?").run(id),
    /cannot be changed|amendment/i,
    "a signed note was returned to draft, which makes it editable again",
  );
  assert.equal((await noteById(id, T1))!.body, BODY);
});

// ---------------------------------------------------------------------------
// 2. A correction is a new note, and both survive
// ---------------------------------------------------------------------------

test("an amendment is its own note, names what it corrects, and leaves it intact", async () => {
  clear(); seed();
  const original = await signed();
  const { id: amendId } = await startAmendment({
    noteId: original, tenantId: T1, clinicianId: "n-clin",
    body: "Amendment: the session ran forty minutes, not thirty.",
  });
  await signNote({ noteId: amendId, tenantId: T1, clinicianId: "n-clin", clinicianRole: "clinician" });

  assert.notEqual(amendId, original, "the amendment replaced the note instead of joining it");
  const both = await notesFor({ personId: "n-person", tenantId: T1 });
  assert.equal(both.length, 2, "both the note and its amendment should be readable");
  const amendment = both.find((n) => n.id === amendId)!;
  assert.equal(amendment.amendsNoteId, original, "the amendment does not say what it corrects");
  assert.equal(both.find((n) => n.id === original)!.body, BODY, "the original was altered");
});

test("an unsigned note is edited directly, not amended", async () => {
  clear(); seed();
  const { id: draft } = await saveDraft({
    personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session", body: BODY,
  });
  await assert.rejects(
    () => startAmendment({ noteId: draft, tenantId: T1, clinicianId: "n-clin", body: "correction" }),
    (e: Error) => e instanceof NoteError && /unsigned note is edited directly/i.test(e.message),
  );
  // Editing it works, because it is still the clinician's own working text.
  await saveDraft({ noteId: draft, personId: "n-person", tenantId: T1, clinicianId: "n-clin",
                    kind: "session", body: "Second thoughts, written before signing." });
  assert.match((await noteById(draft, T1))!.body, /Second thoughts/);
});

// ---------------------------------------------------------------------------
// 3. The signatory is the author
// ---------------------------------------------------------------------------

test("nobody signs somebody else's note, and nobody edits their draft", async () => {
  clear(); seed();
  const { id: draft } = await saveDraft({
    personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session", body: BODY,
  });
  await assert.rejects(
    () => signNote({ noteId: draft, tenantId: T1, clinicianId: "n-other", clinicianRole: "clinician" }),
    (e: Error) => e instanceof NoteError && /signed by the person who wrote it/i.test(e.message),
  );
  await assert.rejects(
    () => saveDraft({ noteId: draft, personId: "n-person", tenantId: T1, clinicianId: "n-other",
                      kind: "session", body: "Put words in their mouth." }),
    (e: Error) => e instanceof NoteError && /somebody else's draft/i.test(e.message),
  );
  assert.equal((await noteById(draft, T1))!.status, "draft");

  // And the actor is never taken from the form.
  const actions = code("src/lib/clinical/note-actions.ts");
  assert.match(actions, /await requireClinician\(\)/, "the action does not resolve the clinician from the session");
  assert.doesNotMatch(actions, /get\("clinicianId"\)|get\("signedBy"\)/,
    "the action reads the signing clinician from the submitted form");
});

// ---------------------------------------------------------------------------
// 4. Only signing reaches the ledger
// ---------------------------------------------------------------------------

test("a draft appends nothing; signing appends once, and an amendment says so", async () => {
  const db = getDb(); clear(); seed();
  const count = () => (db.prepare(
    "SELECT COUNT(*) AS n FROM longitudinal_events WHERE person_id = 'n-person' AND event_type LIKE 'clinical_note.%'"
  ).get() as { n: number }).n;

  const { id: draft } = await saveDraft({
    personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session", body: BODY,
  });
  assert.equal(count(), 0, "a draft put 'the clinician said' into permanent history");

  await signNote({ noteId: draft, tenantId: T1, clinicianId: "n-clin", clinicianRole: "clinician" });
  assert.equal(count(), 1);
  const ev = db.prepare(
    "SELECT event_type, payload, tenant_id FROM longitudinal_events WHERE person_id = 'n-person' ORDER BY rowid DESC LIMIT 1"
  ).get() as { event_type: string; payload: string; tenant_id: string };
  assert.equal(ev.event_type, "clinical_note.signed");
  assert.equal(ev.tenant_id, T1, "the note event landed in another tenant");
  const payload = JSON.parse(ev.payload) as Record<string, unknown>;
  assert.equal(payload.projectionId, draft, "the event does not point at the row it describes");
  // THE BODY IS NOT IN THE LEDGER. Duplicating clinical free text into the
  // event log would put it somewhere the note's own access rules do not reach.
  assert.ok(!JSON.stringify(payload).includes(BODY.slice(0, 20)),
    "the note's text was copied into the event payload");

  const { id: amendId } = await startAmendment({
    noteId: draft, tenantId: T1, clinicianId: "n-clin", body: "Amendment: forty minutes.",
  });
  await signNote({ noteId: amendId, tenantId: T1, clinicianId: "n-clin", clinicianRole: "clinician" });
  const last = db.prepare(
    "SELECT event_type FROM longitudinal_events WHERE person_id = 'n-person' ORDER BY rowid DESC LIMIT 1"
  ).get() as { event_type: string };
  assert.equal(last.event_type, "clinical_note.amended",
    "an amendment is recorded as an ordinary signature, so a replay cannot tell a correction from a new note");
});

// ---------------------------------------------------------------------------
// 5. Scope, and the floor on what can be signed
// ---------------------------------------------------------------------------

test("a note is not readable from another tenant", async () => {
  clear(); seed();
  const id = await signed();
  assert.equal(await noteById(id, T2), null, "a clinical note was readable from another tenant");
  assert.equal((await notesFor({ personId: "n-person", tenantId: T2 })).length, 0);
  assert.equal((await notesFor({ personId: "n-person", tenantId: T1 })).length, 1);
});

test("an empty gesture cannot be signed", async () => {
  clear(); seed();
  await assert.rejects(
    () => saveDraft({ personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session", body: "   ok  " }),
    (e: Error) => e instanceof NoteError && /needs something in it/i.test(e.message),
  );
  assert.ok(MIN_BODY >= 10, "the floor is low enough to be a slip filter rather than a word count policy");
});

test("the screen keeps the note bridge's rule: nothing is assembled, nothing self-signs", () => {
  const page = code("src/app/clinician/member/[id]/notes/page.tsx");
  assert.match(page, /Your own words/i, "the screen does not say the words are the clinician's own");
  assert.match(page, /nothing signs itself/i, "the screen does not say it never signs for them");
  // Signing is always an explicit press, never a side effect of saving.
  assert.match(page, /name="sign" value="1"/, "there is no explicit sign control");
  assert.match(page, /name="sign" value="0"/, "there is no way to save without signing");
  // A signed note is rendered as text — no editor is offered against it.
  assert.match(page, /record\.filter\(\(n\) => !n\.amendsNoteId\)/,
    "the record does not separate originals from their amendments");
});


// ---------------------------------------------------------------------------
// 6. No silent overwrite, and signing is confirmed (17 September handoff, P4)
// ---------------------------------------------------------------------------
//
//   "Signed notes — clarify draft, signing, and amendment. No silent overwrite;
//   signing has explicit confirmation."
//
// `saveDraft` updated the row unconditionally, so a second tab — or the same
// clinician returning to a form they had left open — replaced whatever had been
// written in the meantime with no trace that anything was lost. And "Sign and
// file" saved and signed in one post, so the only irreversible act on the
// screen was the only one that happened without being confirmed.

test("a save against a stale draft forks instead of overwriting", async () => {
  clear(); seed();
  const { id } = await saveDraft({
    personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session",
    body: "First version, written in the room.",
  });
  const stale = draftVersion((await noteById(id, T1))!);

  // Somebody else's tab — or another window of this one — saves first.
  await saveDraft({
    noteId: id, personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session",
    body: "Second version, written after the call.",
    expectedVersion: stale,
  });

  const second = await saveDraft({
    noteId: id, personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session",
    body: "Third version, typed in the window that was already open.",
    expectedVersion: stale,
  });

  assert.equal(second.forked, true, "the stale save was written over the newer one");
  assert.notEqual(second.id, id);
  // NEITHER VERSION IS LOST. A refusal would have cost the clinician what they
  // typed, which is the same harm in the other direction.
  assert.match((await noteById(id, T1))!.body, /Second version/);
  assert.match((await noteById(second.id, T1))!.body, /Third version/);
});

test("a save that knows the current version updates in place", async () => {
  clear(); seed();
  const { id } = await saveDraft({
    personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session", body: BODY,
  });
  const current = draftVersion((await noteById(id, T1))!);
  const again = await saveDraft({
    noteId: id, personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session",
    body: "Edited before anybody else touched it.", expectedVersion: current,
  });
  assert.equal(again.forked, false);
  assert.equal(again.id, id, "an ordinary edit created a second draft");
  const mine = (await notesFor({ personId: "n-person", tenantId: T1 }))
    .filter((n) => n.status === "draft");
  assert.equal(mine.length, 1);
});

test("a forked amendment is still an amendment", async () => {
  // The fork inherits what it corrects. A stale amendment that quietly became
  // an ordinary note would be a correction nobody could find from the note it
  // corrects.
  clear(); seed();
  const original = await signed();
  const { id } = await startAmendment({
    noteId: original, tenantId: T1, clinicianId: "n-clin", body: "First correction.",
  });
  const stale = draftVersion((await noteById(id, T1))!);
  await startAmendment({
    noteId: original, tenantId: T1, clinicianId: "n-clin", draftId: id,
    body: "Correction, second pass.", expectedVersion: stale,
  });
  const forked = await startAmendment({
    noteId: original, tenantId: T1, clinicianId: "n-clin", draftId: id,
    body: "Correction, typed in the stale window.", expectedVersion: stale,
  });
  assert.equal(forked.forked, true);
  assert.equal((await noteById(forked.id, T1))!.amendsNoteId, original);
});

test("an amendment resumes its draft rather than starting another", async () => {
  clear(); seed();
  const original = await signed();
  const first = await startAmendment({
    noteId: original, tenantId: T1, clinicianId: "n-clin", body: "A correction in progress.",
  });
  const found = await draftAmendmentFor({
    noteId: original, tenantId: T1, clinicianId: "n-clin",
  });
  assert.equal(found?.id, first.id, "the screen cannot find the amendment already drafted");

  const resumed = await startAmendment({
    noteId: original, tenantId: T1, clinicianId: "n-clin",
    draftId: found!.id, expectedVersion: draftVersion(found!),
    body: "The same correction, finished.",
  });
  assert.equal(resumed.id, first.id);
  const drafts = (await notesFor({ personId: "n-person", tenantId: T1 }))
    .filter((n) => n.status === "draft");
  assert.equal(drafts.length, 1, "opening the amendment twice left two drafts against one note");
});

test("a signature is refused when the words moved after they were read", async () => {
  // A signature attests to specific words. If the draft changed between the
  // confirmation screen and the click, the attestation would be to text the
  // signatory never saw.
  clear(); seed();
  const { id } = await saveDraft({
    personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session", body: BODY,
  });
  const read = draftVersion((await noteById(id, T1))!);
  await saveDraft({
    noteId: id, personId: "n-person", tenantId: T1, clinicianId: "n-clin", kind: "session",
    body: "Something else entirely, added after the confirmation was opened.",
    expectedVersion: read,
  });
  await assert.rejects(
    () => signNote({
      noteId: id, tenantId: T1, clinicianId: "n-clin", clinicianRole: "clinician",
      expectedVersion: read,
    }),
    (e: Error) => e instanceof NoteError && /changed after you opened the confirmation/i.test(e.message),
  );
  assert.equal((await noteById(id, T1))!.status, "draft", "it was signed anyway");
});

test("signing goes through a confirmation screen rather than a single post", async () => {
  const actions = code("src/lib/clinical/note-actions.ts");
  assert.match(actions, /export async function confirmSignAction/,
    "there is no separate action for the confirmed signature");
  // The save action must not sign. It hands over to the confirmation instead.
  const save = actions.slice(
    actions.indexOf("export async function saveNoteAction"),
    actions.indexOf("export async function confirmSignAction"),
  );
  assert.doesNotMatch(save, /signNote\(/,
    "saving a note still signs it in the same post, so the signature is unconfirmed");
  assert.match(save, /toConfirm\(personId, saved\.id\)/);

  const page = code("src/app/clinician/member/[id]/notes/page.tsx");
  assert.match(page, /data-testid="sign-confirmation-body"/,
    "the confirmation does not show the words that will be signed");
  assert.match(page, /Yes, sign it/);
  assert.match(page, /Back to editing/);
});

test("the note editor never opens an amendment as an ordinary draft", async () => {
  // It was `drafts[0]` — whichever is newest, including a drafted amendment. A
  // clinician who saved an amendment and then wrote an ordinary note found the
  // amendment's text in the box, and saving replaced it: an unrelated note that
  // still pointed at the signed one it claimed to correct.
  const page = code("src/app/clinician/member/[id]/notes/page.tsx");
  assert.match(page, /plainDrafts = drafts\.filter\(\(n\) => n\.amendsNoteId === null\)/);
  assert.doesNotMatch(page, /openDraft = drafts\[0\]/);
  assert.match(page, /data-testid="draft-row"/,
    "the other drafts are unreachable, so a fork lands somewhere nobody can see");
});
