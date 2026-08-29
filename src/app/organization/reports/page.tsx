import Link from "next/link";
import { OrgPage } from "@/components/app/OrgPage";
import { Panel } from "@/components/app/surfaces";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports — Steady Intelligence" };

// Reports (§26: "Create review-ready packets — governed exports — download").
//
// The word that stops this shipping as a download button is "governed".
//
// §29.1: "Export must match current filters and write an audit event."
// §31.4's export row: "filter parity; cohort version; suppression; purpose;
// audit event; signed file." §30.4 gives it a POST, not a GET, because an
// export is a write — it creates a disclosure.
//
// None of that exists. A CSV endpoint would be an ungoverned disclosure of a
// covered population with a button next to it, which is a worse outcome than
// no button. So this screen lists what a packet would have to carry, and says
// plainly that the mechanism is not built.

const REQUIREMENTS: { label: string; body: string }[] = [
  {
    label: "Filter parity",
    body: "The file contains exactly the cohort on screen. An export that silently widens the filter is a disclosure nobody authorised.",
  },
  {
    label: "Cohort version",
    body: "The cohort definition is versioned and travels with the file, so the same report can be reproduced after the definition changes.",
  },
  {
    label: "Suppression",
    body: "Small cells are suppressed in the file exactly as on screen. Suppression that only applies to the rendering is not suppression.",
  },
  {
    label: "Stated purpose",
    body: "The requester names a purpose before the file exists, and the purpose is recorded with it.",
  },
  {
    label: "Audit event",
    body: "Who exported what, under which filter hash and for which purpose, appended to the immutable log.",
  },
  {
    label: "Signed file",
    body: "The file carries a signature, so a copy circulating later can be checked against what was actually released.",
  },
];

export default function OrgReportsPage() {
  return (
    <OrgPage
      layer="evidence"
      here="/organization/reports"
      title="Reports"
      lede="Governed export is not built. This is what one has to carry before it can exist."
    >
      <div className="space-y-6">
        <Panel>
          <p className="measure text-ground/90">
            There is no export mechanism here, and a plain download would not be one. An
            export of a covered population is a disclosure: it leaves this system, it is
            copied, and it outlives the screen it came from.
          </p>
          <p className="measure mt-3 text-sm text-olive">
            The six requirements below are not a wish list — they are what separates a
            governed export from a spreadsheet emailed to someone. Until the mechanism
            records all six, the honest control is the absence of a button.
          </p>
        </Panel>

        <Panel title="What a review-ready packet must carry">
          <dl className="divide-y divide-ground/5">
            {REQUIREMENTS.map((r) => (
              <div key={r.label} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                <dt className="text-sm font-medium text-app-ink">{r.label}</dt>
                <dd className="measure text-sm text-ground">{r.body}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="What does work">
          <p className="measure text-sm text-ground">
            Every figure on the{" "}
            <Link href="/organization/overview" className="text-state-info underline">operating overview</Link>,{" "}
            <Link href="/organization/access" className="text-state-info underline">access pipeline</Link> and{" "}
            <Link href="/organization/outcomes" className="text-state-info underline">outcomes</Link>{" "}
            screens carries its denominator, its window and the projection version it was
            computed under, so a packet assembled by hand from them can at least be checked.
          </p>
        </Panel>
      </div>
    </OrgPage>
  );
}
