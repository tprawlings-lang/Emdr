import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { subscriptionActive } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { hasConsent, screeningComplete } from "@/lib/gating";
import { getInstrument, scoreItq } from "@/lib/instruments";
import { decryptField } from "@/lib/crypto";

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
  if (!hasConsent(user.id)) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");
  const { submitted } = await searchParams;

  const db = getDb();

  const rows = TRACKED.map((t) => {
    const last = db
      .prepare(
        `SELECT total_score, answers_json, created_at,
           CAST(julianday('now') - julianday(created_at) AS INTEGER) AS age
         FROM screenings WHERE user_id = ? AND instrument = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(user.id, t.id) as
      | { total_score: number; answers_json: string; created_at: string; age: number }
      | undefined;
    const instrument = getInstrument(t.id)!;
    const age = last ? last.age : Infinity;
    return { ...t, instrument, last, age, due: age >= t.cadenceDays };
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard" className="text-sm text-olive underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 font-serif text-3xl font-medium">Weekly measures</h1>
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
          const itq =
            r.id === "itq" && r.last ? scoreItq(JSON.parse(decryptField(r.last.answers_json))) : null;
          return (
            <div key={r.id} className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{r.instrument.title}</h2>
                  <p className="mt-1 text-sm text-olive">
                    {r.last ? (
                      <>
                        Last taken {r.age === 0 ? "today" : `${r.age} day${r.age === 1 ? "" : "s"} ago`} ·{" "}
                        {itq
                          ? `PTSD ${itq.ptsdSum}/24 · DSO ${itq.dsoSum}/24`
                          : `score ${r.last.total_score}`}
                      </>
                    ) : (
                      "Not taken yet"
                    )}
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
