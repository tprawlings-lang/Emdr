"use server";

import { redirect } from "next/navigation";

import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import {
  saveDraft, signNote, startAmendment, NoteError, type NoteKind,
} from "./notes";

// The write paths for a clinical note.
//
// THIN, like the handoff and walkthrough actions. Every rule — a signed note
// cannot be edited, a note is signed by its author, an amendment is a new row —
// lives in notes.ts, so it refuses identically whether it is reached from this
// form, a test, or a script somebody writes next year. What is here is the two
// things that are properties of the REQUEST: who is asking, and where the
// answer is rendered.
//
// THE CLINICIAN IS NEVER TAKEN FROM THE FORM. A hidden field would let anybody
// who can post a form write a note under somebody else's name and sign it — and
// the record would carry the impersonation as an attestation.

async function acting(): Promise<{ id: string; role: string; tenantId: string }> {
  const clinician = await requireClinician();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  return { id: clinician.id, role: "clinician", tenantId: row?.tenant_id ?? PLATFORM_TENANT_ID };
}

/** Where the answer goes. A refusal is a sentence the clinician reads, carried
 *  in the query string because a server action's redraw is a redirect. */
function back(personId: string, key: "saved" | "signed" | "refused", text: string): never {
  redirect(`/clinician/member/${personId}/notes?${key}=${encodeURIComponent(text)}`);
}

/** To the confirmation screen for a specific draft. */
function toConfirm(personId: string, noteId: string): never {
  redirect(`/clinician/member/${personId}/notes?confirm=${encodeURIComponent(noteId)}`);
}

/** What a fork is called when the clinician reads about it. */
const FORKED =
  "This draft had changed since you opened it, so your version was saved as a separate draft " +
  "rather than written over the other one. Both are below.";

const KINDS: NoteKind[] = ["session", "contact", "safety", "handover"];
const asKind = (v: string): NoteKind => (KINDS as string[]).includes(v) ? (v as NoteKind) : "session";

export async function saveNoteAction(formData: FormData): Promise<void> {
  const me = await acting();
  const personId = String(formData.get("personId") ?? "");
  const sign = String(formData.get("sign") ?? "") === "1";
  let saved;
  try {
    saved = await saveDraft({
      noteId: String(formData.get("noteId") ?? "") || null,
      expectedVersion: String(formData.get("version") ?? "") || null,
      personId,
      tenantId: me.tenantId,
      clinicianId: me.id,
      kind: asKind(String(formData.get("kind") ?? "")),
      body: String(formData.get("body") ?? ""),
    });
  } catch (e) {
    // A NoteError is a refusal with a reason; anything else is a fault and
    // should not be dressed up as one.
    if (e instanceof NoteError) back(personId, "refused", e.message);
    throw e;
  }
  if (saved.forked) back(personId, "refused", FORKED);
  // SIGNING IS A SECOND ACT, NOT A SECOND EFFECT OF THIS ONE.
  //
  // "Sign and file" used to save and sign in one post. A signature cannot be
  // taken back — a signed note is immutable by trigger, and the only remedy is
  // an amendment that stays in the record for ever — so the one irreversible
  // thing on this screen was the one thing that happened without being
  // confirmed. It now saves the draft (so nothing typed is at risk) and hands
  // the clinician a screen showing exactly what they are about to attest to.
  if (sign) toConfirm(personId, saved.id);
  back(personId, "saved", "Draft saved. It is not part of the record until you sign it.");
}

/**
 * Sign the draft that was just shown on the confirmation screen.
 *
 * The version travels with it: a signature attests to specific words, and if
 * the draft moved between being read and being confirmed, the attestation would
 * be to text the signatory never saw.
 */
export async function confirmSignAction(formData: FormData): Promise<void> {
  const me = await acting();
  const personId = String(formData.get("personId") ?? "");
  const noteId = String(formData.get("noteId") ?? "");
  try {
    const note = await signNote({
      noteId, tenantId: me.tenantId, clinicianId: me.id, clinicianRole: me.role,
      expectedVersion: String(formData.get("version") ?? "") || null,
    });
    back(
      personId, "signed",
      note.amendsNoteId
        ? "Amendment signed. Both it and the note it corrects stay in the record."
        : "Signed. This note is now part of the record and cannot be edited."
    );
  } catch (e) {
    if (e instanceof NoteError) back(personId, "refused", e.message);
    throw e;
  }
}

export async function amendNoteAction(formData: FormData): Promise<void> {
  const me = await acting();
  const personId = String(formData.get("personId") ?? "");
  let saved;
  try {
    saved = await startAmendment({
      noteId: String(formData.get("noteId") ?? ""),
      draftId: String(formData.get("draftId") ?? "") || null,
      expectedVersion: String(formData.get("version") ?? "") || null,
      tenantId: me.tenantId,
      clinicianId: me.id,
      body: String(formData.get("body") ?? ""),
    });
  } catch (e) {
    if (e instanceof NoteError) back(personId, "refused", e.message);
    throw e;
  }
  if (saved.forked) back(personId, "refused", FORKED);
  if (String(formData.get("sign") ?? "") === "1") toConfirm(personId, saved.id);
  back(personId, "saved", "Amendment drafted. The note it corrects is unchanged.");
}
