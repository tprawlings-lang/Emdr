// A clinician's own account of contact with a person.
//
// WHY THIS EXISTS NOW. The note bridge at /clinician/member/[id]/note assembles
// a draft from approved companion-memory items and deliberately never signs,
// and its reasoning is right: "a signature attests to a clinician's own
// statement in the record system of truth, and Steady applying one would be
// Steady attesting on their behalf." That is an argument against Steady signing
// an assembled draft. It is not an argument against a clinician writing
// something themselves and attesting to it, and until now there was nowhere to
// do that — the second half of its own sentence, "there is no note table to
// sign into either", was the gap rather than the principle.
//
// THE RULES ARE THE ONES A RECORD HAS, not a testing convenience:
//
//   A SIGNED NOTE IS IMMUTABLE. Not "should not be edited" — cannot be. A
//   record that can be silently rewritten stops being able to answer "what did
//   the clinician believe on the day", which is the only question a note is
//   kept for. A correction is a NEW note pointing at the one it amends, and
//   both stay readable. Enforced by a trigger as well as here, because the
//   guarantee is worth having against a script that never read this file.
//
//   ONLY A SIGNATURE APPENDS TO THE LEDGER. A draft is working text. Appending
//   an event for it would put "the clinician said" into permanent history for
//   something they had not yet stood behind.
//
//   THE SIGNATORY IS THE AUTHOR. Nobody signs somebody else's note. It is one
//   line of code and it is the whole difference between a record and a rumour.
//
//   A NOTE BELONGS TO A TENANT AND A PERSON, and reads are scoped to both. A
//   note queried across tenants is a clinical record leaving the care
//   relationship it was written inside.

import { data } from "../data";
import { newId } from "../db";
import { audit } from "../audit";
import { appendEventSafe } from "../events";
import { nowStamp } from "../spine";

export type NoteKind = "session" | "contact" | "safety" | "handover";
export type NoteStatus = "draft" | "signed";

export const NOTE_KINDS: { id: NoteKind; label: string; hint: string }[] = [
  { id: "session", label: "Session note", hint: "What happened in a session and what follows from it." },
  { id: "contact", label: "Contact note", hint: "A call, a message, an attempt to reach somebody." },
  { id: "safety", label: "Safety note", hint: "A safety decision and the reasoning behind it." },
  { id: "handover", label: "Handover note", hint: "What the next clinician needs to know." },
];

/** Short enough to refuse an empty gesture, long enough not to be a word count
 *  policy. A note of two characters is a slip, not a record. */
export const MIN_BODY = 10;

export interface ClinicalNote {
  id: string;
  tenantId: string;
  personId: string;
  clinicianId: string;
  clinicianName: string | null;
  kind: NoteKind;
  body: string;
  status: NoteStatus;
  amendsNoteId: string | null;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class NoteError extends Error {}

interface Row {
  id: string; tenant_id: string; person_id: string; clinician_id: string;
  clinician_name: string | null; kind: NoteKind; body: string; status: NoteStatus;
  amends_note_id: string | null; signed_at: string | null;
  created_at: string; updated_at: string;
}

const shape = (r: Row): ClinicalNote => ({
  id: r.id, tenantId: r.tenant_id, personId: r.person_id, clinicianId: r.clinician_id,
  clinicianName: r.clinician_name, kind: r.kind, body: r.body, status: r.status,
  amendsNoteId: r.amends_note_id, signedAt: r.signed_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

/**
 * Every note about one person, newest first.
 *
 * TENANT AND PERSON BOTH. Filtering on the person alone would return a note
 * written inside a different care relationship to whoever asked.
 */
export async function notesFor(args: {
  personId: string; tenantId: string;
}): Promise<ClinicalNote[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT n.*, u.name AS clinician_name
       FROM clinical_notes n
       LEFT JOIN users u ON u.id = n.clinician_id
      WHERE n.person_id = ? AND n.tenant_id = ?
      ORDER BY n.created_at DESC, n.rowid DESC`,
    [args.personId, args.tenantId],
  )) as Row[];
  return rows.map(shape);
}

export async function noteById(id: string, tenantId: string): Promise<ClinicalNote | null> {
  const c = await data();
  const row = (await c.get(
    `SELECT n.*, u.name AS clinician_name FROM clinical_notes n
       LEFT JOIN users u ON u.id = n.clinician_id
      WHERE n.id = ? AND n.tenant_id = ?`,
    [id, tenantId],
  )) as Row | undefined;
  return row ? shape(row) : null;
}

/** Start a note, or replace the text of one that is still a draft. */
export async function saveDraft(args: {
  noteId?: string | null;
  personId: string;
  tenantId: string;
  clinicianId: string;
  kind: NoteKind;
  body: string;
  amendsNoteId?: string | null;
}): Promise<string> {
  const body = args.body.trim();
  if (body.length < MIN_BODY) {
    throw new NoteError("A note needs something in it. Write what happened and what follows from it.");
  }
  const c = await data();
  const at = nowStamp();

  if (args.noteId) {
    const existing = await noteById(args.noteId, args.tenantId);
    if (!existing) throw new NoteError("That note is not in this record.");
    // BOTH CHECKS, and neither is redundant. The trigger stops a signed note
    // changing; this says WHY in words the clinician can act on, before they
    // lose what they typed to a database error.
    if (existing.status === "signed") {
      throw new NoteError("This note is signed and cannot be edited. Write an amendment instead.");
    }
    if (existing.clinicianId !== args.clinicianId) {
      throw new NoteError("This is somebody else's draft.");
    }
    await c.run(
      "UPDATE clinical_notes SET body = ?, kind = ?, updated_at = ? WHERE id = ?",
      [body, args.kind, at, args.noteId],
    );
    return args.noteId;
  }

  const id = newId();
  await c.run(
    `INSERT INTO clinical_notes
       (id, tenant_id, person_id, clinician_id, kind, body, status, amends_note_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    [id, args.tenantId, args.personId, args.clinicianId, args.kind, body,
     args.amendsNoteId ?? null, at, at],
  );
  return id;
}

/**
 * Sign a note. The clinician's own attestation, and the only thing that makes a
 * note part of the record.
 */
export async function signNote(args: {
  noteId: string; tenantId: string; clinicianId: string; clinicianRole: string;
}): Promise<ClinicalNote> {
  const note = await noteById(args.noteId, args.tenantId);
  if (!note) throw new NoteError("That note is not in this record.");
  if (note.status === "signed") throw new NoteError("That note is already signed.");
  // THE SIGNATORY IS THE AUTHOR. One line, and the whole difference between a
  // record and a rumour.
  if (note.clinicianId !== args.clinicianId) {
    throw new NoteError("A note is signed by the person who wrote it.");
  }
  if (note.body.trim().length < MIN_BODY) {
    throw new NoteError("There is not enough here to sign.");
  }

  const c = await data();
  const at = nowStamp();
  await c.run(
    "UPDATE clinical_notes SET status = 'signed', signed_at = ?, signed_by = ?, updated_at = ? WHERE id = ?",
    [at, args.clinicianId, at, args.noteId],
  );

  // ONLY NOW does the ledger hear about it. The event carries the note's id as
  // its projectionId so a replay can find the row it describes, and the BODY is
  // not in the payload — the ledger says a note was signed and points at it;
  // duplicating clinical free text into the event log would put it somewhere
  // the note's own access rules do not reach.
  await appendEventSafe({
    personId: note.personId,
    tenantId: args.tenantId,
    type: note.amendsNoteId ? "clinical_note.amended" : "clinical_note.signed",
    actorType: "clinician",
    actorId: args.clinicianId,
    occurredAt: at,
    payload: {
      projectionId: args.noteId,
      kind: note.kind,
      amendsNoteId: note.amendsNoteId,
    },
  });
  await audit({
    actorId: args.clinicianId, actorRole: args.clinicianRole,
    family: "specialist_action",
    type: note.amendsNoteId ? "clinical_note_amended" : "clinical_note_signed",
    target: `${note.personId}:${args.noteId}`,
    detail: { kind: note.kind, amends: note.amendsNoteId },
  });
  return (await noteById(args.noteId, args.tenantId))!;
}

/**
 * Begin a correction to a signed note.
 *
 * A NEW ROW, never an edit. The original stays exactly as it was signed, and
 * the amendment names it — so "what did the clinician believe on the day" and
 * "what do they believe now" both keep their answers.
 */
export async function startAmendment(args: {
  noteId: string; tenantId: string; clinicianId: string; body: string;
}): Promise<string> {
  const original = await noteById(args.noteId, args.tenantId);
  if (!original) throw new NoteError("That note is not in this record.");
  if (original.status !== "signed") {
    throw new NoteError("An unsigned note is edited directly — an amendment corrects a signed one.");
  }
  return saveDraft({
    personId: original.personId,
    tenantId: args.tenantId,
    clinicianId: args.clinicianId,
    kind: original.kind,
    body: args.body,
    amendsNoteId: original.id,
  });
}
