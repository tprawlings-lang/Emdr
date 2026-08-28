import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { subscriptionActive } from "@/lib/billing";
import { hasConsent, screeningComplete } from "@/lib/gating";
import { getInstrument } from "@/lib/instruments";
import InstrumentForm from "@/components/InstrumentForm";

const TRACKED = new Set(["pcl-5", "itq"]);

export default async function TakeMeasurePage({
  params,
}: {
  params: Promise<{ instrumentId: string }>;
}) {
  const user = await requireMember();
  if (!(await subscriptionActive(user.id))) redirect("/subscribe");
  if (!(await hasConsent(user.id))) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");

  const { instrumentId } = await params;
  const instrument = getInstrument(instrumentId);
  if (!instrument || !TRACKED.has(instrument.id)) redirect("/measures");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
        Weekly measure ·{" "}
        <Link href="/crisis" className="font-semibold text-ground underline">
          Need help now?
        </Link>
      </div>

      <h1 className="type-identity text-3xl font-medium">{instrument.title}</h1>
      <p className="mt-2 text-olive">{instrument.intro}</p>
      {/* cutoffNote printed here too — the same criteria-label leak as the
          screening page. Removed for the same reason: it is a clinician-facing
          interpretation note, and showing it tells someone how to answer to
          avoid a consequence. */}
      <p className="measure mt-2 text-sm text-olive">
        There are no wrong answers, and no score to see at the end.
      </p>

      <InstrumentForm instrument={instrument} context="weekly" />
    </main>
  );
}
