import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { subscriptionActive } from "@/lib/billing";
import { data } from "@/lib/data";
import { hasConsent, screeningComplete } from "@/lib/gating";
import { getInstrument } from "@/lib/instruments";

const TRACKED: { id: "pcl-5" | "itq"; cadenceDays: number }[] = [
  { id: "pcl-5", cadenceDays: 7 },
  { id: "itq", cadenceDays: 7 },
];

export default async function MeasuresPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const user = await requireMember();
  if (!(await subscriptionActive(user.id))) redirect("/subscribe");
  if (!(await hasConsent(user.id))) redirect("/onboarding");
  if (!(await screeningComplete(user.id))) redirect("/screening");
  const { submitted } = await searchParams;

  const c = await data();

  const rows = await Promise.all(
    TRACKED.map(async (t) => {
      // Only WHEN it was taken, never what it said. The score and the raw
      // answers are deliberately not selected: a member surface that holds a
      // score is one edit away from rendering it, and the boundary only holds
      // if the value never arrives (handoff §3).
      const last = (await c.get(
        `SELECT created_at
         FROM screenings WHERE user_id = ? AND instrument = ?
         ORDER BY created_at DESC LIMIT 1`,
        [user.id, t.id]
      )) as { created_at: string } | undefined;
      const instrument = getInstrument(t.id)!;
      // Age in days computed in JS (was SQLite julianday) — dialect-neutral.
      const age = last
        ? Math.floor((Date.now() - new Date(last.created_at.replace(" ", "T") + "Z").getTime()) / 86400000)
        : Infinity;
      return { ...t, instrument, last, age, due: age >= t.cadenceDays };
    })
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard" className="text-sm text-olive underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 type-display text-3xl font-medium">Weekly measures</h1>
      <p className="mt-2 text-sm text-olive">
        These short questionnaires are how you and your care team see whether the program is
        actually helping. Once a week is enough — more often does not make the signal better.
      </p>

      {submitted && (
        <p className="mt-4 rounded-2xl border border-safe/40 bg-safe/15 px-4 py-3 text-sm text-ground">
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
                  <h2 className="font-semibold">{r.instrument.title}</h2>
                  <p className="mt-1 text-sm text-olive">
                    {r.last
                      ? `Last taken ${r.age === 0 ? "today" : `${r.age} day${r.age === 1 ? "" : "s"} ago`}`
                      : "Not taken yet"}
                  </p>
                </div>
                {r.due ? (
                  <Link
                    href={`/measures/${r.id}`}
                    className="rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
                  >
                    Begin
                  </Link>
                ) : (
                  <span className="rounded-full border border-ground/10 bg-sand/40 px-5 py-2.5 text-sm text-olive">
                    Due in {r.cadenceDays - r.age} day{r.cadenceDays - r.age === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
