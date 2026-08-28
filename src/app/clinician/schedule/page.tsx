import Link from "next/link";
import { requireClinician } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule — Steady Clinical" };

// Schedule (§26: "See visits and reviews").
//
// The capability does not exist, so the screen says so and renders nothing that
// implies otherwise. §14: "Explain what is absent and whether that is expected."
//
// The alternative — an empty list with the right columns and a filter bar — is
// worse than no screen. It reads as "no items today" rather than "this does not
// work yet", and a clinician who believes the first will stop checking.

export default async function SchedulePage() {
  await requireClinician();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="type-display text-3xl font-medium text-ground">Schedule</h1>
      <p className="measure mt-2 text-olive">There is no calendar in this environment.</p>

      <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-6">
        <p className="measure text-ground/90">No appointments, no visits and no scheduled reviews are recorded. The due dates that do exist belong to work items and are shown on the queue.</p>
        <p className="measure mt-3 text-sm text-olive">A schedule is meant to pair a calendar with overdue actions. The overdue half already works on the queue; the calendar half needs a scheduling model that does not exist.</p>
      </div>

      <section aria-labelledby="instead" className="mt-6">
        <h2 id="instead" className="text-xs font-semibold uppercase tracking-wide text-olive">
          What does work
        </h2>
        <ul className="mt-3 space-y-3">
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/clinician/today" className="font-medium text-ground underline">Work queue</Link>
            <p className="measure mt-1 text-sm text-olive">Ordered by response deadline, with overdue items first.</p>
          </li>
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/clinician/reports" className="font-medium text-ground underline">Reports</Link>
            <p className="measure mt-1 text-sm text-olive">Where the work is sitting across the caseload.</p>
          </li>
        </ul>
      </section>
    </main>
  );
}
