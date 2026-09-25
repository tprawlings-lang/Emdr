import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { thoughtRecordStanding } from "@/lib/thought-records";
import { THOUGHT_RECORD } from "@/lib/content/h10-thought-record";
import ThoughtRecordForm from "@/components/ThoughtRecordForm";
import { PENDING_REVIEW_CHIP } from "@/lib/content-signoff";

// A new thought record (Handoff 10 2B). Today's gate is asked here, not only
// on the list, because a link can be followed on a different day.
export default async function NewThoughtRecordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireMember();
  const { error } = await searchParams;
  const standing = await thoughtRecordStanding(user.id);
  if (standing.state === "absent") notFound();
  const back = <Link href="/app/activities/thoughts" className="mt-8 inline-flex min-h-11 items-center text-sm text-olive underline">← Back</Link>;

  if (standing.state === "not_today") {
    return (
      <MemberPage layer="actions" title={THOUGHT_RECORD.title}>
        <p className="measure text-ground/90">
          Today is set up a little differently, so this isn&apos;t the right thing to do right
          now. Nothing is lost — it will be here on another day.
        </p>
        <Link href="/app/ground" className="mt-5 inline-block rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
          Something grounding instead
        </Link>
        {back}
      </MemberPage>
    );
  }

  return (
    <MemberPage layer="actions" title={THOUGHT_RECORD.title} lede={THOUGHT_RECORD.intro}>
      {standing.visibility === "draft" && (
        <p className="inline-block rounded-full bg-state-unknown-bg px-3 py-1 text-xs text-state-unknown">{PENDING_REVIEW_CHIP}</p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-sm text-ground">
          Write a few words, or go back — this part can wait.
        </p>
      )}
      <ThoughtRecordForm
        stopHref="/app/activities/thoughts"
        copy={{
          intro: THOUGHT_RECORD.intro, steps: THOUGHT_RECORD.steps, strengthQuestion: THOUGHT_RECORD.strengthQuestion,
          feelingWordsLabel: THOUGHT_RECORD.feelingWordsLabel, save: THOUGHT_RECORD.save, stop: THOUGHT_RECORD.stop,
          privacy: THOUGHT_RECORD.privacy, strongAt: THOUGHT_RECORD.strongAt, strong: THOUGHT_RECORD.strong,
          strongGround: THOUGHT_RECORD.strongGround, strongContinue: THOUGHT_RECORD.strongContinue,
          groundHref: `/app/activities/skills/${THOUGHT_RECORD.groundSkillId}`,
        }}
      />
    </MemberPage>
  );
}
