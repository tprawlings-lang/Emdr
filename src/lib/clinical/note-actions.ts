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

const KINDS: NoteKind[] = ["session", "contact", "safety", "handover"];
const asKind = (v: string): NoteKind => (KINDS as string[]).includes(v) ? (v as NoteKind) : "session";

export async function saveNoteAction(formData: FormData): Promise<void> {
  const me = await acting();
  const personId = String(formData.get("personId") ?? "");
  const sign = String(formData.get("sign") ?? "") === "1";
  try {
    const id = await saveDraft({
      noteId: String(formData.get("noteId") ?? "") || null,
      personId,
      tenantId: me.tenantId,
      clinicianId: me.id,
      kind: asKind(String(formData.get("kind") ?? "")),
      body: String(formData.get("body") ?? ""),
    });
    if (!sign) back(personId, "saved", "Draft saved. It is not part of the record until you sign it.");
    await signNote({ noteId: id, tenantId: me.tenantId, clinicianId: me.id, clinicianRole: me.role });
  } catch (e) {
    // A NoteError is a refusal with a reason; anything else is a fault and
    // should not be dressed up as one.
    if (e instanceof NoteError) back(personId, "refused", e.message);
    throw e;
  }
  back(personId, "signed", "Signed. This note is now part of the record and cannot be edited.");
}

export async function amendNoteAction(formData: FormData): Promise<void> {
  const me = await acting();
  const personId = String(formData.get("personId") ?? "");
  try {
    const id = await startAmendment({
      noteId: String(formData.get("noteId") ?? ""),
      tenantId: me.tenantId,
      clinicianId: me.id,
      body: String(formData.get("body") ?? ""),
    });
    if (String(formData.get("sign") ?? "") !== "1") {
      back(personId, "saved", "Amendment drafted. The note it corrects is unchanged.");
    }
    await signNote({ noteId: id, tenantId: me.tenantId, clinicianId: me.id, clinicianRole: me.role });
  } catch (e) {
    if (e instanceof NoteError) back(personId, "refused", e.message);
    throw e;
  }
  back(personId, "signed", "Amendment signed. Both it and the note it corrects stay in the record.");
}
