import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { practiceForMember } from "@/lib/practices";
import { PENDING_REVIEW_CHIP } from "@/lib/content-signoff";
import SkillPlayer from "@/components/SkillPlayer";

// One skill (Handoff 10 1A). The same sign-off and gate as the library, asked
// again here, because a deep link skips the list: an unsigned skill does not
// exist outside demo, and a signed one today's gate does not open says "not
// today" — never a 404, which would say it does not exist at all.
export default async function SkillPage({ params }: { params: Promise<{ skillId: string }> }) {
  const user = await requireMember();
  const { skillId } = await params;
  const found = await practiceForMember(user.id, skillId);
  if (found.state === "absent") notFound();

  if (found.state === "not_today") {
    return (
      <MemberPage layer="actions" title={found.title}>
        <p className="measure text-ground/90">
          Today is set up a little differently, so this one isn&apos;t the right thing to do right
          now. Nothing is wrong — it will be here on another day.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/app/ground" className="rounded-full bg-sage px-6 py-3 text-center font-medium text-ground hover:bg-sage-deep">
            Something grounding instead
          </Link>
          <Link href="/app/activities/skills" className="rounded-full border border-ground/20 px-6 py-3 text-center text-ground/80 hover:bg-moss">
            Back to skills
          </Link>
        </div>
      </MemberPage>
    );
  }

  const skill = found.practice;
  if (skill.type !== "skill" || !skill.steps || skill.steps.length === 0) notFound();

  return (
    <MemberPage layer="actions" title={skill.title} lede={skill.intro}>
      {skill.visibility === "draft" && (
        <p className="mb-4 inline-block rounded-full bg-state-unknown-bg px-3 py-1 text-xs text-state-unknown">{PENDING_REVIEW_CHIP}</p>
      )}
      {skill.skipIf && skill.skipIf.length > 0 && (
        <div className="mb-6 rounded-2xl border border-ground/10 bg-linen p-4 text-sm text-ground/90">
          <p className="font-medium">Skip this one if</p>
          <ul className="mt-1 list-disc pl-5">
            {skill.skipIf.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}
      <SkillPlayer skillId={skill.id} title={skill.title} steps={skill.steps} />
    </MemberPage>
  );
}
