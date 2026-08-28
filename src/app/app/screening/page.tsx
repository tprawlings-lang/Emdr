import { requireMember } from "@/lib/auth";
import { hasConsent } from "@/lib/gating";
import { data } from "@/lib/data";
import { INSTRUMENTS } from "@/lib/instruments";
import { redirect } from "next/navigation";
import { subscriptionActive } from "@/lib/billing";
import { FITNESS_ITEMS, getFitnessState } from "@/lib/fitness-screener";
import Link from "next/link";
import FitnessScreener from "@/components/FitnessScreener";

export default async function ScreeningPage() {
  const user = await requireMember();
  if (!(await subscriptionActive(user.id))) redirect("/subscribe");
  if (!(await hasConsent(user.id))) redirect("/app/onboarding");

  // Program-fit questions come before any baseline instrument (compliance
  // 4A): mandatory, unskippable, with a 24h cooldown after a hard stop.
  const fitness = await getFitnessState(user.id);
  if (fitness.status === "cooldown") redirect("/app/screening/fit");
  if (fitness.status === "none") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
          Step 3 of 4 — Is this program a safe fit? ·{" "}
          <Link href="/crisis" className="font-semibold text-ground underline">
            Need help now?
          </Link>
        </div>
        <h1 className="type-identity text-3xl font-medium">A few questions before we begin</h1>
        <p className="mt-2 leading-relaxed text-olive">
          Self-guided work isn&apos;t the right fit for every situation, and that has nothing
          to do with strength or readiness. Eight yes-or-no questions, no wrong answers.
        </p>
        <FitnessScreener items={FITNESS_ITEMS} />
      </main>
    );
  }

  const c = await data();
  const done = new Set(
    (
      await c.all("SELECT DISTINCT instrument FROM screenings WHERE user_id = ?", [user.id]) as { instrument: string }[]
    ).map((r) => r.instrument)
  );

  const next = INSTRUMENTS.find((i) => !done.has(i.id));
  if (!next) redirect("/app/today?screening=complete");

  const position = INSTRUMENTS.findIndex((i) => i.id === next.id) + 1;

  // Whether there is progress to resume, so the button says "pick up where you
  // left off" rather than "begin" — which is the difference between a product
  // that remembered and one that did not.
  const { savedAnswers } = await import("@/lib/member/gate");
  const resumable = (await savedAnswers(user.id, next.id)).size > 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
        Step 3 of 4 — Baseline screening · Current place: questionnaire {position} of {INSTRUMENTS.length} ·{" "}
        <Link href="/crisis" className="font-semibold text-ground underline">
          Need help now?
        </Link>
      </div>

      <h1 className="type-identity text-3xl font-medium">{next.title}</h1>
      <p className="mt-2 text-olive">{next.intro}</p>
      <p className="measure mt-2 text-sm text-olive">
        These answers go to your care team. There are no wrong answers, and there is no score
        to see at the end.
      </p>
      {/* `cutoffNote` used to be printed here — text like "10+ suggests moderate
          depression; item 9 above zero always routes to specialist review."
          That is a cutoff and a criteria label, which Vol 2 forbids on a member
          surface, and it also tells someone how to answer to avoid a
          consequence. It belongs to the clinician surface, where it already
          lives. */}

      {/* One question per screen, resumable, nothing lost by leaving (§5). The
          questionnaire used to be one form of every item at once, all required,
          with nothing saved until the final submit. */}
      <div className="mt-8">
        <Link
          href={`/app/screening/${next.id}`}
          className="inline-block rounded-full bg-ground px-6 py-3 font-medium text-ivory"
        >
          {resumable ? "Pick up where you left off" : "Begin"}
        </Link>
        <p className="measure mt-3 text-sm text-olive">
          One question at a time. Your answers save as you go, so you can stop whenever you
          want and come back to the same place.
        </p>
      </div>
    </main>
  );
}
