import { notFound } from "next/navigation";

import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel, Callout } from "@/components/app/surfaces";
import {
  notesFor, draftVersion, NOTE_KINDS, MIN_BODY, type ClinicalNote,
} from "@/lib/clinical/notes";
import {
  saveNoteAction, amendNoteAction, confirmSignAction,
} from "@/lib/clinical/note-actions";

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
  searchParams: Promise<{
    saved?: string; signed?: string; refused?: string; amend?: string;
    draft?: string; confirm?: string;
  }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const { saved, signed, refused, amend, draft, confirm } = await searchParams;
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

  // AN AMENDMENT DRAFT IS NOT "YOUR DRAFT".
  //
  // This was `drafts[0]`, which is whichever draft is newest — including a
  // drafted amendment. So a clinician who saved an amendment and then went to
  // write an ordinary note found the amendment's text in the box, and saving
  // wrote over it: the amendment was silently replaced by an unrelated note
  // that still pointed at the signed one it claimed to correct.
  const plainDrafts = drafts.filter((n) => n.amendsNoteId === null);
  const amendDrafts = drafts.filter((n) => n.amendsNoteId !== null);
  const openDraft =
    (draft ? plainDrafts.find((n) => n.id === draft) : null) ?? plainDrafts[0] ?? null;
  // Resuming rather than starting a second one.
  const amendDraft = amendTarget
    ? amendDrafts.find((n) => n.amendsNoteId === amendTarget.id) ?? null
    : null;
  const confirming = confirm ? drafts.find((n) => n.id === confirm) ?? null : null;
  const kindLabel = (k: string) => NOTE_KINDS.find((n) => n.id === k)?.label ?? k;

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

        {confirming ? (
          <Panel
            title={confirming.amendsNoteId ? "Sign this amendment?" : "Sign this note?"}
            footnote="Signing is the irreversible step on this screen. A signed note cannot be edited, by you or by anyone — the only correction is an amendment, which stays in the record beside it for ever."
          >
            {/* WHAT IS ABOUT TO BE ATTESTED TO, in full, on the screen where the
                attesting happens. "Sign and file" used to save and sign in one
                post, so the one thing here that cannot be undone was the one
                thing that happened without being confirmed. */}
            <p className="text-sm text-olive">
              {kindLabel(confirming.kind)} · about {header.name} · signed by you,{" "}
              {clinician.name ?? "the clinician who wrote it"}
            </p>
            <blockquote
              data-testid="sign-confirmation-body"
              className="measure mt-3 whitespace-pre-wrap rounded-xl bg-linen px-4 py-3 text-sm text-app-ink"
            >
              {confirming.body}
            </blockquote>
            <form action={confirmSignAction} className="mt-4 flex flex-wrap gap-2">
              <input type="hidden" name="personId" value={id} />
              <input type="hidden" name="noteId" value={confirming.id} />
              {/* The words that were read are the words that get signed. */}
              <input type="hidden" name="version" value={draftVersion(confirming)} />
              <button
                className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface hover:opacity-90"
              >
                Yes, sign it
              </button>
              <a
                href={
                  confirming.amendsNoteId
                    ? `/clinician/member/${id}/notes?amend=${confirming.amendsNoteId}`
                    : `/clinician/member/${id}/notes?draft=${confirming.id}`
                }
                className="rounded-full border border-ground/25 px-4 py-2 text-sm text-app-ink hover:bg-linen"
              >
                Back to editing
              </a>
            </form>
          </Panel>
        ) : amendTarget ? (
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
              {/* Resume the amendment already drafted against this note rather
                  than opening a second one beside it. */}
              {amendDraft && <input type="hidden" name="draftId" value={amendDraft.id} />}
              {amendDraft && <input type="hidden" name="version" value={draftVersion(amendDraft)} />}
              <label className="block text-sm">
                <span className="font-medium text-app-ink">The correction</span>
                <textarea
                  name="body" rows={5} required minLength={MIN_BODY} className={field}
                  defaultValue={amendDraft?.body ?? ""}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button name="sign" value="1"
                  className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface hover:opacity-90">
                  Review and sign the amendment
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
              {/* What the draft looked like when this form was rendered. A save
                  against a stale version forks rather than overwriting. */}
              {openDraft && <input type="hidden" name="version" value={draftVersion(openDraft)} />}
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
                  Review and sign
                </button>
                <button name="sign" value="0"
                  className="rounded-full border border-ground/25 px-4 py-2 text-sm text-app-ink hover:bg-linen">
                  Save as a draft
                </button>
              </div>
            </form>
          </Panel>
        )}

        {/* EVERY DRAFT, REACHABLE. The editor shows one at a time, and before
            this there was no way to reach any of the others — a second draft,
            a drafted amendment, or a fork left by a save against a stale
            version all existed in the table and on no screen. A record cannot
            have text about a person that the person's own clinician cannot
            find. */}
        {drafts.length > (openDraft ? 1 : 0) && (
          <Panel
            title={`Your drafts (${drafts.length})`}
            footnote="Drafts are yours and are not part of the record. Nothing here has been signed."
          >
            <ul className="space-y-2">
              {drafts.map((n) => {
                const amends = n.amendsNoteId
                  ? record.find((r) => r.id === n.amendsNoteId) ?? null
                  : null;
                const href = n.amendsNoteId
                  ? `/clinician/member/${id}/notes?amend=${n.amendsNoteId}`
                  : `/clinician/member/${id}/notes?draft=${n.id}`;
                return (
                  <li
                    key={n.id}
                    data-testid="draft-row"
                    className="rounded-xl border border-ground/10 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm text-app-ink">{kindLabel(n.kind)}</span>
                      {amends && (
                        <span className="text-xs text-olive">
                          amends the {kindLabel(amends.kind).toLowerCase()} signed{" "}
                          {(amends.signedAt ?? "").slice(0, 10)}
                        </span>
                      )}
                      <span className="text-xs text-olive">last saved {n.updatedAt.slice(0, 16)}</span>
                      {n.id === openDraft?.id && <span className="text-xs text-olive">open above</span>}
                    </div>
                    <p className="measure mt-0.5 line-clamp-2 text-xs text-olive">{n.body}</p>
                    {n.id !== openDraft?.id && (
                      <p className="mt-1 text-xs">
                        <a href={href} className="text-olive underline">Open this draft</a>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
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
