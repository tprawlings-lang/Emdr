import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { memberThoughtRecords, thoughtRecordStanding } from "@/lib/thought-records";
import { deleteThoughtRecordAction } from "@/lib/thought-record-actions";
import { THOUGHT_RECORD } from "@/lib/content/h10-thought-record";
import { SubmitButton } from "@/components/experience/SubmitButton";

// The member's thought records (Handoff 10 2B; CV10_D04). Their own words,
// newest first, with no strength shown back and no count. Only the member
// reaches this; nothing on a clinician screen reads the table.
export default async function ThoughtRecordsPage() {
  const user = await requireMember();
  const standing = await thoughtRecordStanding(user.id);
  if (standing.state === "absent") notFound();
  const records = await memberThoughtRecords(user.id);

  return (
    <MemberPage layer="actions" title={THOUGHT_RECORD.title} lede={THOUGHT_RECORD.intro}>
      {standing.state === "open" ? (
        <Link href="/app/activities/thoughts/new" className="inline-block rounded-full bg-sage px-6 py-3 font-medium text-ground transition-colors hover:bg-sage-deep">
          Start
        </Link>
      ) : (
        <>
          <p className="measure text-ground/90">
            Today is set up a little differently, so this isn&apos;t the right thing to do right
            now. Nothing is lost — it will be here on another day.
          </p>
          <Link href="/app/ground" className="mt-5 inline-block rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
            Something grounding instead
          </Link>
        </>
      )}
      <p className="mt-4 text-sm text-olive">{THOUGHT_RECORD.privacy}</p>

      {records.length > 0 && (
        <ul className="mt-8 space-y-3">
          {records.map((r) => (
            <li key={r.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
              <dl className="space-y-2">
                {r.answers.map((a) => (
                  <div key={a.question}>
                    <dt className="text-sm text-olive">{a.question}</dt>
                    <dd className="text-ground">{a.answer}</dd>
                  </div>
                ))}
              </dl>
              {/* Two taps: the words are overwritten, not hidden. */}
              <details className="mt-2">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-olive underline">Delete this</summary>
                <form action={deleteThoughtRecordAction} className="mt-1 flex flex-wrap items-center gap-3">
                  <input type="hidden" name="id" value={r.id} />
                  <span className="text-sm text-ground/90">This can&apos;t be undone.</span>
                  <SubmitButton pendingLabel="Deleting…" className="rounded-full border border-ground/20 px-4 py-2 text-sm text-ground hover:bg-moss">
                    Delete for good
                  </SubmitButton>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
      <Link href="/app/activities" className="mt-8 inline-flex min-h-11 items-center text-sm text-olive underline">← All practices</Link>
    </MemberPage>
  );
}
