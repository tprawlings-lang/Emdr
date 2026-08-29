import Link from "next/link";
import { PayerPage } from "@/components/app/PayerPage";
import { Panel } from "@/components/app/surfaces";

export const dynamic = "force-dynamic";
export const metadata = { title: "Population access — Steady Intelligence" };

// Population access (§26: "Find access gaps — approved groups and suppression
// — Open method").
//
// This screen asks who is NOT getting care, which means comparing subgroups —
// by geography, by language, by age band, by race or ethnicity where a plan is
// permitted to hold it. None of that exists here. The contracted population
// has an id, an eligibility span and claims, and nothing else.
//
// The temptation is to ship it with the one dimension that does exist and call
// it a start. That would be worse than a blank, and specifically worse:
//
//   - An equity screen showing only the subgroup that happened to be
//     available implies the others were examined and found unremarkable.
//   - Access gaps between groups are exactly where small-cell suppression
//     bites hardest, so a version without an approved grouping and a
//     suppression rule would either leak small groups or silently hide them —
//     and hiding them is indistinguishable, on screen, from there being no gap.
//
// §26's own wording is "approved groups and suppression", which names both
// halves as prerequisites rather than refinements.

const NEEDS: { label: string; body: string }[] = [
  {
    label: "Approved groupings",
    body: "Which subgroups this plan is permitted to report on, approved rather than assumed, with the legal basis attached. A grouping a plan may hold for eligibility is not automatically one it may report outcomes by.",
  },
  {
    label: "A suppression rule for comparisons",
    body: "Small-cell suppression applied to every cell AND to the differences between them, because a difference between two suppressed groups can re-identify both.",
  },
  {
    label: "A denominator per group",
    body: "Every gap is a comparison of rates, and a rate needs its own denominator per subgroup. Comparing counts across groups of different sizes produces a ranking of group size.",
  },
  {
    label: "A stated method",
    body: "Which comparison, against which reference group, over which period — fixed before the numbers are looked at, so the screen cannot become a search for a finding.",
  },
];

export default function PayerPopulationAccessPage() {
  return (
    <PayerPage
      layer="actions"
      here="/payer/population-access"
      title="Population access"
      lede="Access gaps between subgroups are not reported here, because the data to do it responsibly does not exist in this deployment."
    >
      <div className="space-y-6">
        <Panel>
          <p className="measure text-ground/90">
            This screen asks who is not getting care. Answering it means comparing subgroups —
            geography, language, age band, and the demographic attributes a plan may lawfully
            hold. The contracted population here has an identifier, an eligibility span and
            claims. There is nothing to compare.
          </p>
          <p className="measure mt-3 text-sm text-olive">
            Shipping it with the one dimension that does exist would be worse than a blank
            screen: an equity report showing a single subgroup implies the others were looked
            at and found unremarkable. And gaps between groups are where small-cell
            suppression bites hardest — without an approved grouping and a suppression rule,
            a version of this screen would either expose small groups or hide them, and
            hiding them looks identical to there being no gap.
          </p>
        </Panel>

        <Panel title="What this screen needs before it can exist">
          <dl className="divide-y divide-ground/5">
            {NEEDS.map((n) => (
              <div key={n.label} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="text-sm font-medium text-app-ink">{n.label}</dt>
                <dd className="measure text-sm text-ground">{n.body}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="What does work">
          <p className="measure text-sm text-ground">
            <Link href="/payer/access" className="text-state-info underline">Access</Link>{" "}
            reports time to care and where members stop across the whole contracted
            population, with the denominator on every stage. It says nothing about who,
            which is exactly the gap this screen would fill.
          </p>
        </Panel>
      </div>
    </PayerPage>
  );
}
