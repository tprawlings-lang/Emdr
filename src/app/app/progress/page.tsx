import { requireMember } from "@/lib/auth";
import { data } from "@/lib/data";
import Link from "next/link";
import { MemberNav } from "@/components/member/MemberNav";
import { buildMemberProgress } from "@/lib/member/progress";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { ProgressView } from "@/components/member/ProgressView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your progress — Steady" };

// Member Progress (Web GUI handoff §26, §10.2, schema member_progress.v6).
//
// The screen that carries the score reversal. Everywhere else on a member
// surface a score is structurally impossible; here it is permitted as a
// PATTERN and never as a verdict, under §10.2's own acceptance line: "pattern
// language only; no diagnosis or readiness conclusion."
//
// §3.6 described what this replaces — a chart with "no dates, baseline, goal or
// expected range, event annotations, confidence or missing-data handling, and
// no plain-language interpretation. 'Lower is calmer' explains direction, but
// not meaning."

export default async function ProgressPage({
  searchParams,
}: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireMember();
  const { days } = await searchParams;
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [user.id])) as
    | { tenant_id: string } | undefined;

  // §10.2's allowed action "change range", as a URL rather than client state:
  // the projection is recomputed for the window, so the comparison period moves
  // with it instead of the chart being re-cropped in the browser.
  const requested = Number(days);
  const windowDays = [30, 90].includes(requested) ? requested : 30;

  const envelope = await buildMemberProgress({
    userId: user.id,
    tenantId: row?.tenant_id ?? "",
    days: windowDays,
  });

  return (
    <>
      <MemberNav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="type-identity text-3xl text-ground">Your progress</h1>
        <p className="measure mt-2 text-olive">
          Patterns over time, with the periods they are drawn from. This is not a score, a
          grade, or a judgement about how you are doing.
        </p>

        <nav aria-label="Comparison window" className="mt-5 flex gap-2">
          {[30, 90].map((d) => (
            <Link
              key={d}
              href={`/app/progress?days=${d}`}
              aria-current={d === windowDays ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                d === windowDays ? "bg-ground text-ivory" : "border border-ground/20 text-ground hover:bg-ground/5"
              }`}
            >
              Last {d} days
            </Link>
          ))}
        </nav>

        <div className="mt-6">
          <EnvelopeView envelope={envelope} title="Your progress">
            {(progress) => <ProgressView progress={progress} />}
          </EnvelopeView>
        </div>

        <p className="measure mt-10 text-sm text-olive">
          If any of this is worth talking through, your care team can see the same
          information. Grounding and support stay open whatever the pattern shows.
        </p>
      </main>
    </>
  );
}
