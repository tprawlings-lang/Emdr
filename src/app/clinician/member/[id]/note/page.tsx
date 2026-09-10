import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/repository";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel, Callout } from "@/components/app/surfaces";
import { thoughtsSurfaceAvailable } from "@/lib/clinical/thoughts-flags";
import { approvedMemory } from "@/lib/clinical/memory-store";
import {
  assembleDraft, draftText, SIGNING_IS_ELSEWHERE,
} from "@/lib/clinical/note-bridge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Note draft — Steady Clinical" };

// The formal note bridge (Clinician Thoughts spec §21, Phase 6).
//
// Approved memory items, chosen by the clinician, assembled into a draft with
// every source id preserved. Three things Phase 6 forbids, and how each is
// answered here rather than promised:
//
//   A DRAFT THAT SIGNS ITSELF. Nothing here signs, and the reason is not that
//   the button is missing: a signature attests to a clinician's own statement
//   in the record system of truth, and Steady applying one would be Steady
//   attesting on their behalf. There is no note table to sign into either.
//
//   A PRIVATE THOUGHT BECOMING A FORMAL NOTE WITHOUT THE CLINICIAN ACTING.
//   Nothing is preselected. The selection arrives in the URL, so what is in the
//   draft is exactly what was ticked, and an item that was never approved comes
//   back as a refusal with its reason rather than silently missing.
//
//   A PILOT THAT CANNOT BE SWITCHED OFF WITHOUT LOSING DATA. There is nothing
//   to lose: the draft is assembled on the way to this page and stored nowhere.
//   Turning the flag off removes a screen.
//
// SELECTION IS SERVER-DRIVEN, through a GET form. It needs no client state, the
// draft is always a function of the URL, and a clinician can send somebody the
// address of exactly the draft they were looking at.

export default async function MemberNoteDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const { item } = await searchParams;
  const c = await data();

  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!header) notFound();

  const available = thoughtsSurfaceAvailable("CLINICIAN_NOTE_BRIDGE");
  const ctx: TenantContext = { tenantId, personId: clinician.id };
  const approved = available ? await approvedMemory(ctx, id) : [];

  const selectedIds = item === undefined ? [] : Array.isArray(item) ? item : [item];
  const draft = assembleDraft({
    personId: id,
    assembledBy: clinician.id,
    assembledAt: new Date().toISOString(),
    available: approved,
    selectedIds,
  });

  // Assembling a draft is a read of a person's record for a purpose that leaves
  // this product, so it is recorded. Ids only — never the text.
  if (draft.lines.length > 0) {
    await audit({
      actorId: clinician.id, actorRole: "clinician", family: "clinical",
      type: "note_draft_assembled", target: id,
      detail: { itemCount: draft.lines.length, sourceItemIds: draft.lines.map((l) => l.sourceItemId) },
    });
  }

  return (
    <PersonShell person={header} active="/thoughts" title="Note draft">
      {!available ? (
        <Callout tone="info" label="Not enabled here">
          <p className="measure">
            The note bridge is switched off in this environment. Nothing is lost by that —
            a draft is assembled on the way to this page and stored nowhere, so there has
            never been anything here to delete.
          </p>
        </Callout>
      ) : (
        <>
          <Callout tone="caution" label="This is a draft, and Steady cannot sign it">
            <p className="measure">{SIGNING_IS_ELSEWHERE}</p>
          </Callout>

          <Panel
            title="Choose what goes in"
            footnote="Approved items only. An item is approved when a clinician confirmed the extraction was right, and nothing that has not been through that reaches a note."
          >
            {approved.length === 0 ? (
              <p className="measure text-sm text-olive">
                Nothing has been approved for this person yet. Approve items on{" "}
                <Link href={`/clinician/member/${id}/thoughts`} className="underline">Notes</Link>{" "}
                and they will be selectable here.
              </p>
            ) : (
              <form method="GET" className="space-y-3">
                <ul className="space-y-2">
                  {approved.map((m) => (
                    <li key={m.id} className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-3">
                      <label className="flex items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          name="item"
                          value={m.id}
                          defaultChecked={selectedIds.includes(m.id)}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="block text-app-ink">{m.displayText}</span>
                          <span className="mt-0.5 block text-xs text-olive">
                            {m.itemType} · {m.statementClass}
                            {m.span ? " · cited" : " · uncited"}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  type="submit"
                  className="rounded-full bg-ground px-4 py-2 text-sm font-medium text-ivory"
                >
                  Build the draft
                </button>
              </form>
            )}
          </Panel>

          <Panel
            title="The draft"
            footnote="Every line carries the id of the item it came from, so a reader can get back to the thought and the transcript behind it after this text has left Steady."
          >
            {draft.lines.length === 0 ? (
              <p className="measure text-sm text-olive">
                Nothing selected yet, so there is no draft. This is empty because you have
                not chosen anything — not because there was nothing to choose.
              </p>
            ) : (
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-app-surface p-4 text-sm text-app-ink">
                {draftText(draft)}
              </pre>
            )}
          </Panel>

          {draft.refusedIds.length > 0 && (
            <Panel
              title="Not included"
              footnote="A silent omission from a clinical note is the failure this section exists to prevent."
            >
              <ul className="space-y-2 text-sm">
                {draft.refusedIds.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-3">
                    <code className="text-xs">{r.id}</code>
                    <span className="measure mt-1 block text-olive">{r.because}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </PersonShell>
  );
}
