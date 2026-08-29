import Link from "next/link";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import {
  listNotes, summarise, PRIORITY_LABEL, STATUS_LABEL, toMarkdown,
  type NotePriority, type NoteStatus,
} from "@/lib/clinical/review-notes";
import { setNoteStatusAction } from "@/lib/clinical/actions";
import { NoteForm } from "@/components/clinical/NoteForm";
import { exerciseMatrix, postureNote } from "@/lib/clinical/demo-posture";
import { activePolicy, policyBanner } from "@/lib/clinical-policy";

export const dynamic = "force-dynamic";

// The clinician testing console (Phase 4 testing cycle).
//
// Two jobs. It tells a reviewer what they can exercise and how to reach it, so
// nobody concludes a feature is missing when it is two clicks away. And it
// collects what they would change, so an hour of review produces a list rather
// than a conversation.
//
// The exercise matrix reads live configuration. A page that described what
// *should* be reachable would be wrong the first time a flag changed.

const PRIORITY_STYLE: Record<NotePriority, string> = {
  blocker: "border-state-support/40 bg-state-support-bg/60",
  change: "border-state-caution/40 bg-state-caution-bg",
  question: "border-state-info/40 bg-state-info-bg/60",
  idea: "border-ground/15 bg-linen/40",
};

const NEXT_STATUS: NoteStatus[] = ["acknowledged", "actioned", "declined"];

export default async function TestingConsole({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string; show?: string }>;
}) {
  const clinician = await requireClinician();
  const { error, done, show } = await searchParams;
  const policy = activePolicy();

  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const notes = await listNotes({ tenantId });
  const stats = summarise(notes);
  const matrix = exerciseMatrix();

  return (
    <ReviewPage title="Testing console" lede="What can be exercised in this environment, and where a change request goes.">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-olive">
            What you can exercise, and what you would change · {clinician.name}
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-2xl border border-state-support/40 bg-state-support-bg/60 px-4 py-3 text-sm text-state-support">
          {error}
        </p>
      )}
      {done === "note" && (
        <p className="mt-4 rounded-2xl border border-state-safe/40 bg-state-safe-bg/60 px-4 py-3 text-sm text-ground">
          Change request filed with the active policy and safety-config versions attached.
        </p>
      )}
      {done === "status" && (
        <p className="mt-4 rounded-2xl border border-state-safe/40 bg-state-safe-bg/60 px-4 py-3 text-sm text-ground">
          Status updated.
        </p>
      )}

      <p className="mt-4 rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-xs text-ground">
        <strong>Provisional configuration.</strong> {policyBanner(policy)}. Every default here
        is a demonstration assumption waiting for exactly the kind of judgement this page
        collects — nothing on it has been ratified.
      </p>

      {/* ---------------- What you can exercise ---------------- */}
      <section className="mt-10">
        <h2 className="type-display text-2xl font-medium">What you can exercise right now</h2>
        <p className="mt-1 text-sm text-olive">{postureNote()}</p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">Capabilities available in this environment</caption>
            <thead>
              <tr className="border-b border-ground/15 text-left">
                <th scope="col" className="py-2 pr-4 font-medium">Capability</th>
                <th scope="col" className="py-2 pr-4 font-medium">Available</th>
                <th scope="col" className="py-2 pr-4 font-medium">Where</th>
                <th scope="col" className="py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-ground/80">
              {matrix.map((m) => (
                <tr key={m.id} data-testid="exercise-row" className="border-b border-ground/10 align-top">
                  <td className="py-2 pr-4 font-medium text-ground">{m.name}</td>
                  <td className="py-2 pr-4">
                    <span
                      data-testid="exercise-state"
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        m.available
                          ? "border-state-safe/40 bg-state-safe-bg/60"
                          : "border-ground/20 bg-linen"
                      }`}
                    >
                      {m.available ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {m.href ? (
                      <Link href={m.href} className="underline">{m.href}</Link>
                    ) : (
                      <span className="text-olive">—</span>
                    )}
                  </td>
                  <td className="py-2 text-xs">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- File a note ---------------- */}
      <section className="mt-10">
        <h2 className="type-display text-2xl font-medium">File a change request</h2>
        <p className="mt-1 text-sm text-olive">
          The same form is on every clinical screen, so you can file from wherever you noticed
          it. Nothing here is settled — a default you disagree with is a finding, not a
          misunderstanding.
        </p>
        <NoteForm surface="Other" returnTo="/review/testing" />
      </section>

      {/* ---------------- The list ---------------- */}
      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium">
          Change requests{" "}
          <span className="ml-1 rounded-full bg-ground px-2.5 py-0.5 text-sm text-ivory">
            {stats.total}
          </span>
          {stats.openBlockers > 0 && (
            <span className="ml-2 rounded-full bg-state-support px-2.5 py-0.5 text-sm text-ivory">
              {stats.openBlockers} open blocker{stats.openBlockers === 1 ? "" : "s"}
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm text-olive">
          Blockers first, then changes, questions, and ideas. Priority is the reviewer&rsquo;s
          judgement and is recorded as given.
        </p>

        {notes.length === 0 ? (
          <p className="mt-4 text-sm text-olive">
            Nothing filed yet. The environment has not been reviewed until this list has
            something in it.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {notes.map((n) => (
              <li
                key={n.id}
                data-testid="note-row"
                className={`rounded-2xl border px-4 py-3 ${PRIORITY_STYLE[n.priority]}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-ground/10 px-2 py-0.5 font-medium uppercase tracking-wide">
                    {n.priority}
                  </span>
                  <span className="font-medium text-ground">{n.surface}</span>
                  <span className="text-olive">· {n.category}</span>
                  <span className="ml-auto rounded bg-ground/10 px-1.5 py-0.5">
                    {STATUS_LABEL[n.status]}
                  </span>
                </div>
                <p className="mt-2 text-sm">
                  <span className="text-olive">Observed:</span> {n.observed}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-olive">Requested:</span> {n.requested}
                </p>
                <p className="mt-1 text-[11px] text-olive">
                  {n.reviewerName} ({n.reviewerRole}) · {n.createdAt} · policy{" "}
                  <code className="text-[10px]">{n.policyVersion ?? "—"}</code> · safety config{" "}
                  <code className="text-[10px]">{n.configVersion ?? "—"}</code>
                </p>

                <form action={setNoteStatusAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="noteId" value={n.id} />
                  <select name="status" defaultValue="acknowledged"
                    className="rounded border border-ground/20 bg-ivory px-2 py-1 text-xs">
                    {NEXT_STATUS.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  <button className="rounded-full border border-ground/25 px-3 py-1 text-xs">
                    Update status
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- Export ---------------- */}
      {notes.length > 0 && (
        <section className="mt-12">
          <h2 className="type-display text-2xl font-medium">Export</h2>
          <p className="mt-1 text-sm text-olive">
            A review session should end with something that can be pasted into a plan, not a
            screen someone has to transcribe.
          </p>
          <Link
            href="/review/testing?show=markdown"
            className="mt-3 inline-block rounded-full border border-ground/25 px-4 py-1.5 text-sm font-medium"
          >
            {show === "markdown" ? "Hide" : "Show"} as Markdown
          </Link>
          {show === "markdown" && (
            <pre
              data-testid="notes-markdown"
              className="mt-3 max-h-96 overflow-auto rounded-2xl border border-ground/15 bg-ivory p-4 text-[11px]"
            >
              {toMarkdown(notes)}
            </pre>
          )}
        </section>
      )}
    </ReviewPage>
  );
}
