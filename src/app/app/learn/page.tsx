import { MemberPage } from "@/components/member/MemberPage";
import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { LESSONS, readLessonIds } from "@/lib/lessons";

// Psychoeducation library (roadmap F11). Short, trauma-informed lessons with
// read-progress. Content-served; both web + iOS.
export default async function LearnPage() {
  const user = await requireMember();
  const read = new Set(await readLessonIds(user.id));

  return (
    <MemberPage
        layer="evidence"
        title="Learn"
        lede="A few short reads to make sense of what you&apos;re working with — the window of tolerance, why the method works, understanding triggers. Two to four minutes each."
      >
      <p className="mt-2 text-sm text-olive">
        {read.size} of {LESSONS.length} read
      </p>
      <div className="mt-8 space-y-3">
        {LESSONS.map((l) => (
          <Link
            key={l.id}
            href={`/app/learn/${l.id}`}
            className="block rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft transition-colors hover:bg-moss"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-display text-xl text-ground">{l.title}</span>
              <span className="whitespace-nowrap text-xs text-olive">
                {read.has(l.id) ? "✓ read" : `${l.readMinutes} min`}
              </span>
            </div>
            <p className="mt-1 text-sm text-olive">{l.summary}</p>
          </Link>
        ))}
      </div>
    </MemberPage>
  );
}
