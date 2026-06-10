import { requireMember } from "@/lib/auth";
import { hasConsent } from "@/lib/gating";
import { getDb } from "@/lib/db";
import { INSTRUMENTS } from "@/lib/instruments";
import { submitScreening } from "@/lib/actions";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function ScreeningPage() {
  const user = await requireMember();
  if (!hasConsent(user.id)) redirect("/onboarding");

  const db = getDb();
  const done = new Set(
    (
      db
        .prepare("SELECT DISTINCT instrument FROM screenings WHERE user_id = ?")
        .all(user.id) as { instrument: string }[]
    ).map((r) => r.instrument)
  );

  const next = INSTRUMENTS.find((i) => !done.has(i.id));
  if (!next) redirect("/dashboard?screening=complete");

  const position = INSTRUMENTS.findIndex((i) => i.id === next.id) + 1;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-stone-200 bg-stone-50/95 px-6 py-3 text-sm font-medium text-stone-700">
        Baseline screening · Questionnaire {position} of {INSTRUMENTS.length} ·{" "}
        <Link href="/crisis" className="font-semibold text-red-700 underline">
          Need help now?
        </Link>
      </div>

      <h1 className="text-2xl font-bold">{next.title}</h1>
      <p className="mt-2 text-stone-600">{next.intro}</p>
      <p className="mt-2 text-sm text-stone-500">
        These answers go to your care team. There are no wrong answers — honest answers keep the
        program safe for you. {next.cutoffNote}
      </p>

      <form action={submitScreening} className="mt-8 space-y-6">
        <input type="hidden" name="instrument" value={next.id} />
        {next.items.map((item, i) => (
          <fieldset key={i} className="rounded-lg border border-stone-200 bg-white p-4">
            <legend className="px-1 text-sm font-medium text-stone-800">
              {i + 1}. {item}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {next.options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 has-checked:border-stone-900 has-checked:bg-stone-900 has-checked:text-white"
                >
                  <input
                    type="radio"
                    name={`item-${i}`}
                    value={opt.value}
                    required
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button
          type="submit"
          className="w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
        >
          Submit and continue
        </button>
      </form>
    </main>
  );
}
