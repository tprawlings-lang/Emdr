import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { programView, type UnitState } from "@/lib/programs";
import { joinProgramAction, leaveProgramAction } from "@/lib/program-actions";
import { SubmitButton } from "@/components/experience/SubmitButton";

// One program's units, each with a word for where it stands. Words, not a
// tally: "Done" and "Open" say what to do; "3 of 4" would be a count (§2).
const STATE_WORD: Record<UnitState, string> = {
  done: "Done",
  open: "Open",
  after_previous: "Opens after the one before",
  not_today: "Not today",
};

export default async function ProgramPage({ params }: { params: Promise<{ programId: string }> }) {
  const user = await requireMember();
  const { programId } = await params;
  const view = await programView(user.id, programId);
  if (!view) notFound();
  // Joined and, where the program asks its entry questions, answered them.
  const joined = view.enrollment === "active" && !(view.entry && !view.entry.answered);
  const lines = view.entry?.answered ? view.entry.lines : [];
  const joinLabel = view.enrollment === "left" ? "Join again" : "Join";

  return (
    <MemberPage layer="actions" title={view.program.title} lede={view.program.blurb}>
      {joined && lines.length > 0 && (
        // The entry screen's own words (CV10_C04), for as long as a part is
        // left out, so the gap in the list is explained where it shows.
        <div className="measure mb-6 rounded-3xl border border-ground/10 bg-linen p-5">
          {lines.map((l) => <p key={l} className="text-ground/90 [&+p]:mt-2">{l}</p>)}
        </div>
      )}
      <ol className="space-y-3">
        {view.units.map((u, i) => {
          const reachable = joined && (u.state === "open" || u.state === "done");
          const inner = (
            <>
              <span className="text-sm text-olive">Part {i + 1}</span>
              <span className="mt-0.5 block font-semibold text-ground">{u.unit.title}</span>
              {u.unit.purpose && <span className="measure mt-1 block text-sm text-olive">{u.unit.purpose}</span>}
              <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs ${
                u.state === "done" ? "bg-state-safe-bg text-state-safe"
                  : u.state === "open" ? "bg-moss text-ground"
                  : "bg-state-unknown-bg text-state-unknown"}`}>
                {STATE_WORD[u.state]}
              </span>
            </>
          );
          return (
            <li key={u.unit.id}>
              {reachable ? (
                <Link href={`/app/programs/${view.program.id}/${u.unit.id}`} className="block rounded-3xl border border-ground/10 bg-linen p-5 transition-colors hover:bg-moss">
                  {inner}
                </Link>
              ) : (
                <div className="rounded-3xl border border-ground/10 bg-linen/60 p-5">{inner}</div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {joined ? (
          <form action={leaveProgramAction}>
            <input type="hidden" name="programId" value={view.program.id} />
            <SubmitButton pendingLabel="Leaving…" className="rounded-full border border-ground/20 px-5 py-2.5 text-sm text-ground/80 transition-colors hover:bg-moss">
              Leave this program
            </SubmitButton>
          </form>
        ) : view.program.entryScreen ? (
          <Link href={`/app/programs/${view.program.id}/entry`} className="inline-flex min-h-11 items-center rounded-full bg-sage px-5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep">
            {joinLabel}
          </Link>
        ) : (
          <form action={joinProgramAction}>
            <input type="hidden" name="programId" value={view.program.id} />
            <SubmitButton pendingLabel="Joining…" className="rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep">
              {joinLabel}
            </SubmitButton>
          </form>
        )}
        <Link href="/app/programs" className="inline-flex min-h-11 items-center text-sm text-olive underline">← All programs</Link>
      </div>
      {joined && (
        <p className="measure mt-3 text-sm text-olive">Leaving keeps everything you&apos;ve done. You can join again any time.</p>
      )}
    </MemberPage>
  );
}
