import { notFound } from "next/navigation";

import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel, Callout } from "@/components/app/surfaces";
import { notesFor, NOTE_KINDS, MIN_BODY, type ClinicalNote } from "@/lib/clinical/notes";
import { saveNoteAction, amendNoteAction } from "@/lib/clinical/note-actions";

// A clinician's notes on one person — written, signed, and amended here.
//
// THE PRINCIPLE THE NOTE BRIDGE STATED IS KEPT. It refused to sign an assembled
// draft because "a signature attests to a clinician's own statement, and Steady
// applying one would be Steady attesting on their behalf." Nothing here is
// assembled and nothing signs itself: a clinician writes their own words and
// presses Sign. What the bridge was missing was the second half of its own
// sentence — "there is no note table to sign into either" — and now there is.
//
// SIGNED IS FINAL, ON THE SCREEN AS WELL AS IN THE TABLE. A signed note renders
// as text with no edit control, and the only thing offered against it is an
// amendment that appears beside it. A reader can always see what was said on
// the day AND what was said about it afterwards, which is the pair a record
// exists to keep.

export const dynamic = "force-dynamic";
export const metadata = { title: "Notes — Steady Clinical" };

function Signed({ note }: { note: ClinicalNote }) {
  return (
    <span className="text-xs text-olive">
      signed {(note.signedAt ?? "").slice(0, 16)} by {note.clinicianName ?? "a clinician"}
    </span>
  );
}

export default async function MemberNotesPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; signed?: string; refused?: string; amend?: string }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const { saved, signed, refused, amend } = await searchParams;
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!header) notFound();
  const notes = await notesFor({ personId: id, tenantId });
  const drafts = notes.filter((n) => n.status === "draft" && n.clinicianId === clinician.id);
  const record = notes.filter((n) => n.status === "signed");
  const amendTarget = amend ? notes.find((n) => n.id === amend && n.status === "signed") ?? null : null;
  const openDraft = drafts[0] ?? null;

  const field =
    "mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm";

  return (
    <PersonShell person={header} active="/notes" title="Notes">
      <div className="space-y-6">
        {refused && (
          <Callout tone="caution" label="Not done">
            <p className="measure">{refused}</p>
          </Callout>
        )}
        {(saved || signed) && (
          <Callout tone="info" label={signed ? "Signed" : "Saved"}>
            <p className="measure">{signed ?? saved}</p>
          </Callout>
        )}

        {amendTarget ? (
          <Panel
            title="Amend a signed note"
            footnote="The note you are correcting does not change. Both stay in the record, and the amendment names what it corrects — so what was believed on the day and what is believed now both keep their answers."
          >
            <blockquote className="measure whitespace-pre-wrap rounded-xl bg-linen px-4 py-3 text-sm text-app-ink">
              {amendTarget.body}
            </blockquote>
            <p className="mt-1"><Signed note={amendTarget} /></p>
            <form action={amendNoteAction} className="mt-4">
              <input type="hidden" name="personId" value={id} />
              <input type="hidden" name="noteId" value={amendTarget.id} />
              <label className="block text-sm">
                <span className="font-medium text-app-ink">The correction</span>
                <textarea name="body" rows={5} required minLength={MIN_BODY} className={field} />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button name="sign" value="1"
                  className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface hover:opacity-90">
                  Sign the amendment
                </button>
                <button name="sign" value="0"
                  className="rounded-full border border-ground/25 px-4 py-2 text-sm text-app-ink hover:bg-linen">
                  Save as a draft
                </button>
              </div>
            </form>
          </Panel>
        ) : (
          <Panel
            title={openDraft ? "Your draft" : "Write a note"}
            footnote="A draft is yours and is not part of the record. Signing is what makes it one, and a signed note cannot be edited afterwards — a correction is an amendment that sits beside it."
          >
            <form action={saveNoteAction}>
              <input type="hidden" name="personId" value={id} />
              {openDraft && <input type="hidden" name="noteId" value={openDraft.id} />}
              <label className="block text-sm">
                <span className="font-medium text-app-ink">Kind</span>
                <select name="kind" defaultValue={openDraft?.kind ?? "session"} className={field}>
                  {NOTE_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>{k.label} — {k.hint}</option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-sm">
                <span className="font-medium text-app-ink">The note</span>
                <span className="mt-0.5 block text-xs text-olive">
                  Your own words. Nothing here is assembled for you, and nothing signs itself.
                </span>
                <textarea
                  name="body" rows={7} required minLength={MIN_BODY}
                  defaultValue={openDraft?.body ?? ""}
                  placeholder="What happened, what you decided, and what follows from it."
                  className={field}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button name="sign" value="1"
                  className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface hover:opacity-90">
                  Sign and file
                </button>
                <button name="sign" value="0"
                  className="rounded-full border border-ground/25 px-4 py-2 text-sm text-app-ink hover:bg-linen">
                  Save as a draft
                </button>
              </div>
            </form>
          </Panel>
        )}

        <Panel
          title={`The record (${record.length})`}
          footnote="Signed notes, newest first. Nothing here can be edited; an amendment appears beneath the note it corrects."
        >
          {record.length === 0 ? (
            <p className="measure text-sm text-olive">
              No signed notes yet. A draft is not part of the record.
            </p>
          ) : (
            <ul className="space-y-4">
              {record.filter((n) => !n.amendsNoteId).map((n) => {
                const amendments = record.filter((a) => a.amendsNoteId === n.id);
                return (
                  <li key={n.id} className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-4">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-sm font-medium text-app-ink">
                        {NOTE_KINDS.find((k) => k.id === n.kind)?.label ?? n.kind}
                      </span>
                      <Signed note={n} />
                    </div>
                    <p className="measure mt-2 whitespace-pre-wrap text-sm text-app-ink">{n.body}</p>
                    {amendments.map((a) => (
                      <div key={a.id} className="mt-3 rounded-xl border-l-2 border-ground/25 bg-linen px-4 py-3">
                        <p className="text-xs font-medium text-app-ink">Amendment</p>
                        <p className="measure mt-1 whitespace-pre-wrap text-sm text-app-ink">{a.body}</p>
                        <p className="mt-1"><Signed note={a} /></p>
                      </div>
                    ))}
                    {n.clinicianId === clinician.id && (
                      <p className="mt-3 text-xs">
                        <a href={`/clinician/member/${id}/notes?amend=${n.id}`} className="text-olive underline">
                          Amend this note
                        </a>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </PersonShell>
  );
}
