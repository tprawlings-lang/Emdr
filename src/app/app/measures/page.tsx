import { MemberPage } from "@/components/member/MemberPage";
import { requestNow } from "@/lib/request-clock";
import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { TRACKED_MEASURES, measureWindow, trackedForm } from "@/lib/measures/cadence";

export default async function MeasuresPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const user = await requireMember();
  // The page's clock, read once. Every "how long ago" and every gate below
  // uses this reading, so nothing on the screen can disagree with anything
  // else about what time it is.
  const now = requestNow();
  const { submitted } = await searchParams;

  const rows = await Promise.all(
    TRACKED_MEASURES.map(async (t) => {
      // The same window the save enforces (measures/cadence.ts), so the page
      // cannot offer what the server would refuse. Only WHEN it was taken is
      // read, never what it said: a member surface that holds a score is one
      // edit away from rendering it (handoff §3).
      const w = await measureWindow(user.id, trackedForm(t.id)!, now);
      const age = w.lastAt === null ? null : Math.floor((now - w.lastAt) / 86400000);
      return { id: t.id, title: w.form.memberTitle, age, due: w.open, daysUntilOpen: w.daysUntilOpen };
    })
  );

  return (
    <MemberPage
        layer="progress"
        title="Check-in questionnaires"
        lede="These short questionnaires are how you and your care team see whether the program is actually helping. Each one asks about a set stretch of time, so it opens again once that stretch has passed — sooner would only repeat the last answer."
      >

      {submitted && (
        <p className="mt-4 rounded-2xl border border-state-safe/40 bg-state-safe-bg/60 px-4 py-3 text-sm text-ground">
          Measure recorded. Your care team can see the updated trend.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {rows.map((r) => {
          // No score is computed or shown here. Vol 2 forbids scores and
          // diagnostic bands on member surfaces, and a measures page is the
          // most tempting place to break that — "you scored 52" is the most
          // natural sentence to write and the one that does the damage.
          // What a member needs is whether it is due, not how they did.
          return (
            <div key={r.id} className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{r.title}</h2>
                  <p className="mt-1 text-sm text-olive">
                    {r.age !== null
                      ? `Last taken ${r.age === 0 ? "today" : `${r.age} day${r.age === 1 ? "" : "s"} ago`}`
                      : "Not taken yet"}
                  </p>
                </div>
                {r.due ? (
                  <Link
                    href={`/app/measures/${r.id}`}
                    className="rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
                  >
                    Begin
                  </Link>
                ) : (
                  <span className="rounded-full border border-ground/10 bg-state-unknown-bg px-5 py-2.5 text-sm text-state-unknown">
                    Opens in {r.daysUntilOpen} day{r.daysUntilOpen === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </MemberPage>
  );
}
