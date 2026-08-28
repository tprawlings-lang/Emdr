import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getFitnessState } from "@/lib/fitness-screener";
import {
  CRISIS_REGIONS,
  FALLBACK_RESOURCE,
  NOT_MONITORED_LINE,
} from "@/lib/crisis-resources";

// Warm hard-stop screen (compliance 4A.1): non-judgmental, resources first,
// payment already refunded automatically, 24h retake cooldown.
export default async function FitPausePage() {
  const user = await requireMember();
  const fitness = await getFitnessState(user.id);
  if (fitness.status !== "cooldown") redirect("/screening");

  const us = CRISIS_REGIONS.find((r) => r.code === "US")!;

  return (
    <main className="mx-auto max-w-xl px-6 py-14">
      <h1 className="type-display text-4xl font-medium">
        This program isn&apos;t the right fit right now
      </h1>
      <p className="mt-4 leading-relaxed text-ground/90">
        That is not a judgment, and it is not a closed door — it means what you&apos;re
        carrying right now deserves more support than a self-guided program can safely give.
        The strongest next step is connecting with a person.
      </p>

      <div className="mt-8 space-y-3">
        {us.resources.map((r) => (
          <a
            key={r.href}
            href={r.href}
            className="block rounded-3xl bg-ground px-6 py-4 text-center text-lg font-semibold text-white transition-colors hover:bg-ground"
          >
            {r.label}
          </a>
        ))}
        <a
          href="tel:911"
          className="block rounded-3xl border-2 border-ground px-6 py-4 text-center font-semibold text-ground transition-colors hover:bg-ground/10"
        >
          {us.emergencyLine}
        </a>
        <a
          href={FALLBACK_RESOURCE.href}
          className="block rounded-3xl border border-ground/15 px-6 py-4 text-center text-ground/85 transition-colors hover:bg-moss"
        >
          {FALLBACK_RESOURCE.label}
        </a>
      </div>

      <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-6 text-sm leading-relaxed text-olive shadow-soft">
        <p>
          A licensed therapist — especially one trained in trauma work — can do everything
          Steady does and be there for the parts Steady can&apos;t. Psychology Today&apos;s
          directory and your insurer&apos;s provider list are good starting points.
        </p>
        <p className="mt-3">
          Your membership has been paused and any recent charge refunded automatically — no
          action needed. You can revisit the fit questions in{" "}
          {fitness.retakeInHours ?? 24} hour{(fitness.retakeInHours ?? 24) === 1 ? "" : "s"}.
          They only work if they&apos;re answered honestly; they exist to keep you safe, not
          to keep you out.
        </p>
      </div>

      <p className="mt-6 text-center text-xs text-olive">{NOT_MONITORED_LINE}</p>

      <Link href="/crisis" className="mt-6 block text-center text-sm font-semibold text-ground underline">
        Open the full crisis page
      </Link>
    </main>
  );
}
