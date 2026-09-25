import Link from "next/link";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { listPractices } from "@/lib/practices";
import { PENDING_REVIEW_CHIP } from "@/lib/content-signoff";

// Skills library (Handoff 10 1A). The list is already filtered when it
// arrives — by sign-off, then by today's gate — so what renders here is what
// may be offered. Nothing about why something is absent is shown: a member is
// not told that a skill was withheld for their tier.
export default async function SkillsPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const user = await requireMember();
  const { done } = await searchParams;
  const skills = await listPractices(user.id, "skill");

  return (
    <MemberPage
      layer="actions"
      title="Skills"
      lede="Short, step-by-step things to try when you need something to do with a feeling. Stop whenever you like."
    >
      {done && (
        <p role="status" className="mb-6 rounded-2xl border border-state-safe/40 bg-state-safe-bg px-4 py-3 text-sm text-ground">
          Done. Come back to it any time.
        </p>
      )}
      {skills.length === 0 ? (
        <p className="measure text-olive">
          Nothing here fits today. The breathing and grounding practices are open, and the
          skills will be back on another day.
        </p>
      ) : (
        <ul className="space-y-3">
          {skills.map((s) => (
            <li key={s.id}>
              <Link
                href={`/app/activities/skills/${s.id}`}
                className="block rounded-3xl border border-ground/10 bg-linen p-5 transition-colors hover:bg-moss"
              >
                <span className="font-semibold text-ground">{s.title}</span>
                {s.whenToUse && <span className="measure mt-1 block text-sm text-olive">{s.whenToUse}</span>}
                {s.visibility === "draft" && (
                  <span className="mt-2 inline-block rounded-full bg-state-unknown-bg px-3 py-1 text-xs text-state-unknown">
                    {PENDING_REVIEW_CHIP}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/app/activities" className="mt-8 inline-flex min-h-11 items-center text-sm text-olive underline">← All activities</Link>
    </MemberPage>
  );
}
