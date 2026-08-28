import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getLesson } from "@/lib/lessons";
import LessonBody from "@/components/LessonBody";
import MarkLessonRead from "@/components/MarkLessonRead";

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  await requireMember();
  const { lessonId } = await params;
  const lesson = getLesson(lessonId);
  if (!lesson) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <MarkLessonRead lessonId={lesson.id} />
      <Link href="/learn" className="text-sm text-olive underline">
        ← All lessons
      </Link>
      <h1 className="mt-4 type-display text-3xl font-medium">{lesson.title}</h1>
      <p className="mt-1 text-sm text-olive">{lesson.readMinutes} min read</p>
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
    </main>
  );
}
