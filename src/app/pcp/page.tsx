import { requirePcpViewer } from "@/lib/auth";
import { MAIN_ID } from "@/lib/experience/quality";

export const dynamic = "force-dynamic";
export const metadata = { title: "Primary care — Steady" };

// The primary care provider's landing (Handoff 11 §1, W7). Read-only, own
// patients only, a monthly structured status: engaged or not, measure
// direction, whether a consultant recommendation is open. Never free text,
// never an alert, never content details.
//
// The role and this door exist now; the summary does not, because there is no
// caseload to summarise until the evaluation tenant is seeded. So the page
// says that, rather than showing an empty table that reads as "no patients".
export default async function PcpPage() {
  await requirePcpViewer();
  return (
    <main id={MAIN_ID} className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="type-display text-2xl text-ground">Primary care</h1>
      <p className="measure mt-3 text-ground/90">
        The monthly patient summary is not part of this environment yet. When it is, this page
        will list your own patients with whether they are engaged, which way their measures are
        moving, and whether a consultant recommendation is open — and nothing else.
      </p>
    </main>
  );
}
