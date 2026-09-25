import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { openUnit, programView } from "@/lib/programs";
import { memberEntries } from "@/lib/program-activities";
import { memberLesson } from "@/lib/lessons";
import { practiceForMember } from "@/lib/practices";
import { deleteActivityAction, joinProgramAction } from "@/lib/program-actions";
import { SubmitButton } from "@/components/experience/SubmitButton";

// One unit (Handoff 10 §3.2). Its gate is asked again here, because a link can
// be followed on a different day from the one it was offered on.
export default async function UnitPage({
  params, searchParams,
}: {
  params: Promise<{ programId: string; unitId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireMember();
  const { programId, unitId } = await params;
  const { saved } = await searchParams;
  const opened = await openUnit(user.id, programId, unitId);
  const back = <Link href={`/app/programs/${programId}`} className="mt-8 inline-flex min-h-11 items-center text-sm text-olive underline">← Back to the program</Link>;

  if (!opened.ok) {
    if (opened.reason === "absent") notFound();
    const view = await programView(user.id, programId);
    const title = view?.units.find((u) => u.unit.id === unitId)?.unit.title ?? view?.program.title ?? "Programs";
    return (
      <MemberPage layer="actions" title={title}>
        {opened.reason === "not_joined" && (
          <form action={joinProgramAction} className="measure">
            <p className="text-ground/90">Join the program to start this part.</p>
            <input type="hidden" name="programId" value={programId} />
            <SubmitButton pendingLabel="Joining…" className="mt-4 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground hover:bg-sage-deep">
              Join
            </SubmitButton>
          </form>
        )}
        {opened.reason === "after_previous" && (
          <p className="measure text-ground/90">This part opens after the one before it.</p>
        )}
        {opened.reason === "not_today" && (
          <>
            <p className="measure text-ground/90">
              Today is set up a little differently, so this part isn&apos;t the right thing to do right
              now. Nothing is lost — it will be here on another day.
            </p>
            <Link href="/app/ground" className="mt-5 inline-block rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
              Something grounding instead
            </Link>
          </>
        )}
        {back}
      </MemberPage>
    );
  }

  const { unit, view } = opened;
  const u = unit.unit;
  const lesson = u.lessonId ? await memberLesson(u.lessonId) : undefined;
  const practices = (await Promise.all(u.practiceIds.map((id) => practiceForMember(user.id, id))))
    .flatMap((p) => (p.state === "open" ? [p.practice] : []));
  const entries = (await memberEntries(user.id, programId)).filter((e) => e.unitId === u.id);

  return (
    <MemberPage layer="actions" title={u.title} lede={u.purpose}>
      <p className="text-sm text-olive">{view.program.title}</p>

      {saved && u.copy?.completion && (
        <p role="status" className="mt-4 rounded-2xl border border-state-safe/40 bg-state-safe-bg px-4 py-3 text-sm text-ground">
          {u.copy.completion}
        </p>
      )}

      {u.text?.map((t) => <p key={t} className="measure mt-4 text-ground/90">{t}</p>)}

      {(lesson || practices.length > 0) && (
        <ul className="mt-6 space-y-3">
          {lesson && (
            <li>
              <Link href={`/app/learn/${lesson.id}`} className="block rounded-3xl border border-ground/10 bg-linen p-4 hover:bg-moss">
                <span className="text-sm text-olive">Read</span>
                <span className="block font-medium text-ground">{lesson.title}</span>
              </Link>
            </li>
          )}
          {practices.map((p) => (
            <li key={p.id}>
              <Link
                href={p.type === "skill" ? `/app/activities/skills/${p.id}` : "/app/activities"}
                className="block rounded-3xl border border-ground/10 bg-linen p-4 hover:bg-moss"
              >
                <span className="text-sm text-olive">Try</span>
                <span className="block font-medium text-ground">{p.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {u.activity !== "none" && (
        <Link
          href={`/app/programs/${programId}/${u.id}/activity`}
          className="mt-6 inline-block rounded-full bg-sage px-6 py-3 font-medium text-ground transition-colors hover:bg-sage-deep"
        >
          {entries.length > 0 ? "Do it again" : "Start"}
        </Link>
      )}

      {entries.length > 0 && (
        <section aria-labelledby="yours" className="mt-8">
          <h2 id="yours" className="text-sm font-semibold text-ground">What you&apos;ve put here</h2>
          <ul className="mt-3 space-y-3">
            {entries.map((e) => (
              <li key={e.id} className="rounded-2xl border border-ground/10 bg-app-surface p-4">
                <ul className="list-disc pl-5 text-sm text-ground/90">
                  {e.summary.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
                {/* Two taps, because this one cannot be undone: the words are
                    overwritten, not hidden. A native disclosure rather than a
                    dialog — no script, and nothing moves unless tapped. */}
                <details className="mt-2">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-olive underline">Delete this</summary>
                  <form action={deleteActivityAction} className="mt-1 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="unitId" value={u.id} />
                    <input type="hidden" name="entryId" value={e.id} />
                    <span className="text-sm text-ground/90">This can&apos;t be undone.</span>
                    <SubmitButton pendingLabel="Deleting…" className="rounded-full border border-ground/20 px-4 py-2 text-sm text-ground hover:bg-moss">
                      Delete for good
                    </SubmitButton>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
      {back}
    </MemberPage>
  );
}
