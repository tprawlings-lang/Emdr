import Link from "next/link";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { requireClinician } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — Steady Clinical" };

// Messages (§26: "Communicate with context").
//
// The capability does not exist, so the screen says so and renders nothing that
// implies otherwise. §14: "Explain what is absent and whether that is expected."
//
// The alternative — an empty list with the right columns and a filter bar — is
// worse than no screen. It reads as "no items today" rather than "this does not
// work yet", and a clinician who believes the first will stop checking.

export default async function MessagesPage() {
  await requireClinician();
  return (
    <ClinicianPage
      layer="actions"
      here="/clinician/messages"
      title="Messages"
      lede="Secure clinician–member messaging is not part of this environment."
    >

      <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-6">
        <p className="measure text-ground/90">There is no message store, no thread and no delivery path. A clinician inbox rendered here would be an empty list implying a working channel.</p>
        <p className="measure mt-3 text-sm text-olive">When messaging exists it will show the thread, who can read it, the consent scope it sits under, and — per the notification contract — when a message was DELIVERED rather than when it was sent.</p>
      </div>

      <section aria-labelledby="instead" className="mt-6">
        <h2 id="instead" className="text-xs font-semibold uppercase tracking-wide text-olive">
          What does work
        </h2>
        <ul className="mt-3 space-y-3">
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/clinician/caseload" className="font-medium text-ground underline">The person record</Link>
            <p className="measure mt-1 text-sm text-olive">Everything recorded about a member, including what the safety rules decided and when.</p>
          </li>
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/clinician/today" className="font-medium text-ground underline">Document a safety response</Link>
            <p className="measure mt-1 text-sm text-olive">Where a gate event is answered — that response is recorded and attributed, which a message would not be.</p>
          </li>
        </ul>
      </section>
    </ClinicianPage>
  );
}
