import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
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
  if (!hasConsent(user.id)) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");

  const { instrumentId } = await params;
  const instrument = getInstrument(instrumentId);
  if (!instrument || !TRACKED.has(instrument.id)) redirect("/measures");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-stone-200 bg-stone-50/95 px-6 py-3 text-sm font-medium text-stone-700">
        Weekly measure ·{" "}
        <Link href="/crisis" className="font-semibold text-red-700 underline">
          Need help now?
        </Link>
      </div>

      <h1 className="text-2xl font-bold">{instrument.title}</h1>
      <p className="mt-2 text-stone-600">{instrument.intro}</p>
      <p className="mt-2 text-sm text-stone-500">{instrument.cutoffNote}</p>

      <InstrumentForm instrument={instrument} context="weekly" />
    </main>
  );
}
