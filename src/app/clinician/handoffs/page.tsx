import Link from "next/link";
import { requireClinician } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Handoffs — Steady Clinical" };

// Handoffs (§26: "Keep accountability through transfer").
//
// The capability does not exist, so the screen says so and renders nothing that
// implies otherwise. §14: "Explain what is absent and whether that is expected."
//
// The alternative — an empty list with the right columns and a filter bar — is
// worse than no screen. It reads as "no items today" rather than "this does not
// work yet", and a clinician who believes the first will stop checking.

export default async function HandoffsPage() {
  await requireClinician();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="type-display text-3xl font-medium text-ground">Handoffs</h1>
      <p className="measure mt-2 text-olive">Transfer of accountability is not yet recorded as its own event.</p>

      <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-6">
        <p className="measure text-ground/90">Ownership exists on a work item, but a handoff — from, to, reason, due, accepted — is not modelled, so there is nothing to list.</p>
        <p className="measure mt-3 text-sm text-olive">A handoff needs its own recorded event — created, then accepted — before it can be listed. Until then this screen would be inferring accountability from ownership, and that inference is exactly how people get lost between clinicians.</p>
      </div>

      <section aria-labelledby="instead" className="mt-6">
        <h2 id="instead" className="text-xs font-semibold uppercase tracking-wide text-olive">
          What does work
        </h2>
        <ul className="mt-3 space-y-3">
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/clinician/today" className="font-medium text-ground underline">Work queue</Link>
            <p className="measure mt-1 text-sm text-olive">Every item carries a current owner, and an unowned one says so rather than showing blank.</p>
          </li>
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/clinician/caseload" className="font-medium text-ground underline">Person audit</Link>
            <p className="measure mt-1 text-sm text-olive">Who accessed and changed a record, with the chain verified.</p>
          </li>
        </ul>
      </section>
    </main>
  );
}
