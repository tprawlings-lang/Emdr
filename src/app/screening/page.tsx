import { requireMember } from "@/lib/auth";
import { hasConsent } from "@/lib/gating";
import { getDb } from "@/lib/db";
import { INSTRUMENTS } from "@/lib/instruments";
import { redirect } from "next/navigation";
import { subscriptionActive } from "@/lib/billing";
import { FITNESS_ITEMS, getFitnessState } from "@/lib/fitness-screener";
import Link from "next/link";
import InstrumentForm from "@/components/InstrumentForm";
import FitnessScreener from "@/components/FitnessScreener";

export default async function ScreeningPage() {
  const user = await requireMember();
  if (!subscriptionActive(user.id)) redirect("/subscribe");
  if (!hasConsent(user.id)) redirect("/onboarding");

  // Program-fit questions come before any baseline instrument (compliance
  // 4A): mandatory, unskippable, with a 24h cooldown after a hard stop.
  const fitness = getFitnessState(user.id);
  if (fitness.status === "cooldown") redirect("/screening/fit");
  if (fitness.status === "none") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
          Step 3 of 4 — Is this program a safe fit? ·{" "}
          <Link href="/crisis" className="font-semibold text-support underline">
            Need help now?
          </Link>
        </div>
        <h1 className="font-serif text-3xl font-medium">A few questions before we begin</h1>
        <p className="mt-2 leading-relaxed text-olive">
          Self-guided work isn&apos;t the right fit for every situation, and that has nothing
          to do with strength or readiness. Eight yes-or-no questions, no wrong answers.
        </p>
        <FitnessScreener items={FITNESS_ITEMS} />
      </main>
    );
  }

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
        Step 3 of 4 — Baseline screening · Current place: questionnaire {position} of {INSTRUMENTS.length} ·{" "}
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
