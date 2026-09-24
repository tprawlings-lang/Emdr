import Link from "next/link";
import { MemberPage } from "@/components/member/MemberPage";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { memberLesson } from "@/lib/lessons";
import { PENDING_REVIEW_CHIP } from "@/lib/content-signoff";
import LessonBody from "@/components/LessonBody";
import MarkLessonRead from "@/components/MarkLessonRead";

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  await requireMember();
  const { lessonId } = await params;
  // An unsigned lesson does not exist outside the demonstration.
  const lesson = await memberLesson(lessonId);
  if (!lesson) notFound();

  return (
    <MemberPage layer="evidence" title={lesson.title}>
      <MarkLessonRead lessonId={lesson.id} />
      <Link href="/app/learn" className="text-sm text-olive underline">
        ← All lessons
      </Link>
      <p className="mt-1 text-sm text-olive">{lesson.readMinutes} min read</p>
      {lesson.visibility === "draft" && (
        <p className="mt-2 inline-block rounded-full bg-state-unknown-bg px-3 py-1 text-xs text-state-unknown">{PENDING_REVIEW_CHIP}</p>
      )}
      <div className="mt-6">
        <LessonBody markdown={lesson.body} />
      </div>
      <p className="mt-10 text-xs text-olive">
        Educational information, not medical advice or a diagnosis. If you&apos;re in crisis, the{" "}
        <Link href="/crisis" className="underline">
          crisis page
        </Link>{" "}
        has support that can help now.
      </p>
    </MemberPage>
  );
}
