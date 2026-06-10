import { requireMember } from "@/lib/auth";
import { hasConsent } from "@/lib/gating";
import { getDb } from "@/lib/db";
import { INSTRUMENTS } from "@/lib/instruments";
import { redirect } from "next/navigation";
import Link from "next/link";
import InstrumentForm from "@/components/InstrumentForm";

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

      <InstrumentForm instrument={next} context="baseline" />
    </main>
  );
}
