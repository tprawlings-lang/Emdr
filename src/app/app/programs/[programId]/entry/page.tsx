import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { programView } from "@/lib/programs";
import { joinProgramAction } from "@/lib/program-actions";
import { SubmitButton } from "@/components/experience/SubmitButton";

// A program's entry screen (Handoff 10 1C: Steadier Sleep's sleep-entry-v1,
// row CV10_C04). Asked on joining, and again on joining after leaving. The
// words are the signed pack's; the answers become a code (withheld or not),
// and any yes leaves out only the part it is for.
export default async function EntryScreenPage({
  params, searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireMember();
  const { programId } = await params;
  const { error } = await searchParams;
  const view = await programView(user.id, programId);
  if (!view) notFound();
  const screen = view.program.entryScreen;
  if (!screen) redirect(`/app/programs/${programId}`);
  if (view.enrollment === "active" && view.entry?.answered) redirect(`/app/programs/${programId}`);

  return (
    <MemberPage layer="actions" title={view.program.title} lede={screen.intro}>
      {error && (
        <p role="alert" className="rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-sm text-ground">
          Please answer each question.
        </p>
      )}
      <form action={joinProgramAction} className="mt-6">
        <input type="hidden" name="programId" value={view.program.id} />
        <input type="hidden" name="screen" value={screen.id} />
        <ol className="space-y-6">
          {screen.questions.map((q, i) => (
            <li key={q}>
              <fieldset>
                <legend className="measure text-ground">
                  <span className="text-olive">{i + 1}. </span>{q}
                </legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([["yes", screen.yes], ["no", screen.no]] as const).map(([value, label]) => (
                    <label key={value} className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-ground/15 bg-linen px-6 text-sm hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
                      <input type="radio" name={`q${i}`} value={value} className="sr-only" required />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          ))}
        </ol>
        <SubmitButton pendingLabel="Joining…" className="mt-8 rounded-full bg-sage px-6 py-3 font-medium text-ground transition-colors hover:bg-sage-deep">
          {view.enrollment === "left" ? "Join again" : "Join"}
        </SubmitButton>
      </form>
      <Link href={`/app/programs/${view.program.id}`} className="mt-8 inline-flex min-h-11 items-center text-sm text-olive underline">← Back to the program</Link>
    </MemberPage>
  );
}
