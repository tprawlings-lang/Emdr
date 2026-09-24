import Link from "next/link";
import { MemberPage } from "@/components/member/MemberPage";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import InstrumentForm from "@/components/InstrumentForm";
import { measureWindow, trackedForm } from "@/lib/measures/cadence";
import { requestNow } from "@/lib/request-clock";

export default async function TakeMeasurePage({
  params,
}: {
  params: Promise<{ instrumentId: string }>;
}) {
  const user = await requireMember();

  const { instrumentId } = await params;
  const instrument = trackedForm(instrumentId);
  if (!instrument) redirect("/app/measures");
  // The page checked nothing before: the Begin link was hidden until a measure
  // was due, and typing the address opened it anyway.
  if (!(await measureWindow(user.id, instrument, requestNow())).open) redirect("/app/measures");

  return (
    <MemberPage layer="progress" title={instrument.memberTitle}>
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
        Check-in questionnaire ·{" "}
        <Link href="/crisis" className="font-semibold text-ground underline">
          Need help now?
        </Link>
      </div>

      <p className="measure mt-1 text-olive">{instrument.intro}</p>
      {/* cutoffNote printed here too — the same criteria-label leak as the
          screening page. Removed for the same reason: it is a clinician-facing
          interpretation note, and showing it tells someone how to answer to
          avoid a consequence. */}
      <p className="measure mt-2 text-sm text-olive">
        There are no wrong answers, and no score to see at the end.
      </p>

      <InstrumentForm instrument={instrument} context="weekly" />
    </MemberPage>
  );
}
