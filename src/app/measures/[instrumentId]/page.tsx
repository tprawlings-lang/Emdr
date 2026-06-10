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
  if (!subscriptionActive(user.id)) redirect("/subscribe");
  if (!hasConsent(user.id)) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");

  const { instrumentId } = await params;
  const instrument = getInstrument(instrumentId);
  if (!instrument || !TRACKED.has(instrument.id)) redirect("/measures");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
        Weekly measure ·{" "}
        <Link href="/crisis" className="font-semibold text-support underline">
          Need help now?
        </Link>
      </div>

      <h1 className="font-serif text-3xl font-medium">{instrument.title}</h1>
      <p className="mt-2 text-olive">{instrument.intro}</p>
      <p className="mt-2 text-sm text-olive">{instrument.cutoffNote}</p>

      <InstrumentForm instrument={instrument} context="weekly" />
    </main>
  );
}
