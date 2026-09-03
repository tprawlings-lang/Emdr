import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { BarList, Figure, RateBars, cell, num } from "@/components/charts/aggregate";
import { buildOrgLocations } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Locations — Steady Intelligence" };

// Locations (§26: "Compare sites with context — volume, wait, access,
// capacity — open location").
//
// "With context" is the load-bearing half of that sentence. A site comparison
// without denominators is a league table: the biggest site looks worst on
// every absolute count and best on none, and someone acts on it. So every
// column here is either a raw volume clearly labelled as one, or a share with
// its own denominator — and the wait column reports nothing at all for a site
// with too few completed contacts to have a meaningful median.

export default async function OrgLocationsPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId ? await buildOrgLocations(tenantId) : null;

  return (
    <OrgPage
      layer="actions"
      here="/organization/locations"
      title="Locations"
      lede="Each site against its own population, so a large site and a small one can actually be compared."
    >
      {!envelope ? (
        <Panel title="No organization in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one organization.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Locations" audience="operations">
          {(l) => (
            <WithNote
              note={
                <Note
                  tone="info"
                  title="Reading these figures"
                  owner="Not assigned — no owner record exists for a site comparison"
                  boundary="Site differences are not explained here. Case mix, referral source and staffing all differ between sites and none of them is in these figures."
                >
                  <p>
                    Shares are against each site&apos;s own referred population, and every bar
                    states that denominator. A site with no wait shown had too few completed
                    contacts to report a median.
                  </p>
                </Note>
              }
            >
              <Panel
                footnote="All referrals on record. Median wait suppressed below 11 completed contacts per site."
              >
                {/* §26 p42's location comparison, drawn. It was a five-column
                    table, which is a fine record and a poor comparison: the
                    reader has to hold four percentages in their head to see
                    which site is behind.

                    THREE FIGURES, NOT ONE. The two rates share a fixed 0–100%
                    axis so sites of different sizes are comparable, and the
                    wait is a count of days on its own scale — §29.1 forbids
                    overlaying different scales, and a rate and a duration are
                    exactly that. Each rate keeps its own denominator beside
                    it, because these sites are not the same size. */}
                <div className="space-y-8">
                  <Figure
                    title="Contacted, as a share of each site's referrals"
                    summary={`Contact rate for ${l.rows.length} sites, each against its own referred population.`}
                    footnote="Fixed 0–100% axis, so a small spread reads as a small spread. Each row states its own numerator and denominator."
                  >
                    <RateBars rates={l.rows.map((r) => ({ label: r.label, count: r.contacted }))} />
                  </Figure>

                  <Figure
                    title="Started care, as a share of each site's referrals"
                    summary={`Care-start rate for ${l.rows.length} sites, each against its own referred population.`}
                    footnote="Same denominator as the row above — referrals, not contacts — so the two figures are read together rather than as a funnel."
                  >
                    <RateBars rates={l.rows.map((r) => ({ label: r.label, count: r.started }))} />
                  </Figure>

                  {l.rows.some((r) => r.medianWaitDays !== null) && (
                    <Figure
                      title="Median wait to care start"
                      summary="Days from referral to care start, per site."
                      footnote={(() => {
                        const missing = l.rows.filter((r) => r.medianWaitDays === null);
                        return `Days, on their own scale. A wait and a share are different measures, so they are not drawn on one axis.${
                          missing.length > 0
                            ? ` ${missing.length} site(s) not shown: too few completed contacts to report a median — ${missing
                                .map((r) => r.label)
                                .join(", ")}.`
                            : ""
                        }`;
                      })()}
                    >
                      <BarList
                        unit="days"
                        bars={l.rows
                          .filter((r) => r.medianWaitDays !== null)
                          .map((r) => ({ label: r.label, value: r.medianWaitDays as number }))}
                      />
                    </Figure>
                  )}
                </div>

                <details className="mt-8 border-t border-ground/10 pt-5">
                  <summary className="cursor-pointer text-sm font-medium text-app-ink">
                    The same rows as a table
                  </summary>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">
                        Sites compared by referred population, contact rate, care start rate and median wait
                      </caption>
                      <thead>
                        <tr className="border-b border-ground/10 text-left">
                          <th scope="col" className="py-2 pr-4 font-semibold text-app-ink">Site</th>
                          <th scope="col" className="py-2 pr-4 font-semibold text-app-ink">Referred</th>
                          <th scope="col" className="py-2 pr-4 font-semibold text-app-ink">Contacted</th>
                          <th scope="col" className="py-2 pr-4 font-semibold text-app-ink">Started care</th>
                          <th scope="col" className="py-2 font-semibold text-app-ink">Median wait</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.rows.map((r) => (
                          <tr key={r.label} className="border-b border-ground/5 last:border-0">
                            <th scope="row" className="py-2.5 pr-4 text-left font-medium text-ground">{r.label}</th>
                            <td className="py-2.5 pr-4 text-ground">{num(r.population)}</td>
                            <td className="py-2.5 pr-4 text-ground">{cell(r.contacted)}</td>
                            <td className="py-2.5 pr-4 text-ground">{cell(r.started)}</td>
                            <td className="py-2.5 text-ground">
                              {r.medianWaitDays === null
                                ? <span className="text-olive">not reported</span>
                                : `${r.medianWaitDays} days`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Panel>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </OrgPage>
  );
}
