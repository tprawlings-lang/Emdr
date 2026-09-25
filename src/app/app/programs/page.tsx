import Link from "next/link";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { memberPrograms } from "@/lib/programs";
import { joinProgramAction } from "@/lib/program-actions";
import { SubmitButton } from "@/components/experience/SubmitButton";
import { PENDING_REVIEW_CHIP } from "@/lib/content-signoff";

// Programs (Handoff 10 §3.2). Self-paced: nothing here says how long it has
// been, how far behind anyone is, or how many units are left. What a member
// sees is what they can do next.
export default async function ProgramsPage() {
  const user = await requireMember();
  const programs = await memberPrograms(user.id);

  return (
    <MemberPage
      layer="actions"
      title="Programs"
      lede="Short sets of steps you work through at your own pace. Join one, leave any time, and come back when you like."
    >
      {programs.length === 0 ? (
        <p className="measure text-olive">Nothing here right now. The tools and lessons are all open.</p>
      ) : (
        <ul className="space-y-4">
          {programs.map((v) => (
            <li key={v.program.id} className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <h2 className="type-display text-xl font-semibold text-ground">{v.program.title}</h2>
              <p className="measure mt-1 text-olive">{v.program.blurb}</p>
              {v.visibility === "draft" && (
                <span className="mt-2 inline-block rounded-full bg-state-unknown-bg px-3 py-1 text-xs text-state-unknown">{PENDING_REVIEW_CHIP}</span>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {v.enrollment === "active" ? (
                  <Link
                    href={v.next ? `/app/programs/${v.program.id}/${v.next.id}` : `/app/programs/${v.program.id}`}
                    className="rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
                  >
                    {v.finished ? "Look back over it" : "Pick up where you left off"}
                  </Link>
                ) : (
                  <form action={joinProgramAction}>
                    <input type="hidden" name="programId" value={v.program.id} />
                    <SubmitButton
                      pendingLabel="Joining…"
                      className="rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
                    >
                      {v.enrollment === "left" ? "Join again" : "Join"}
                    </SubmitButton>
                  </form>
                )}
                <Link
                  href={`/app/programs/${v.program.id}`}
                  className="rounded-full border border-ground/20 px-5 py-2.5 text-sm text-ground/80 transition-colors hover:bg-moss"
                >
                  See what&apos;s in it
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </MemberPage>
  );
}
