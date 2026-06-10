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
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
        Baseline screening · Current place: questionnaire {position} of {INSTRUMENTS.length} ·{" "}
        <Link href="/crisis" className="font-semibold text-support underline">
          Need help now?
        </Link>
      </div>

      <h1 className="font-serif text-3xl font-medium">{next.title}</h1>
      <p className="mt-2 text-olive">{next.intro}</p>
      <p className="mt-2 text-sm text-olive">
        These answers go to your care team. There are no wrong answers — honest answers keep the
        program safe for you. {next.cutoffNote}
      </p>

      <InstrumentForm instrument={next} context="baseline" />
    </main>
  );
}
