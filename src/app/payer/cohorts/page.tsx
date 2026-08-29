import { PayerPage } from "@/components/app/PayerPage";
import { Panel } from "@/components/app/surfaces";
import { num } from "@/components/charts/aggregate";
import { loadContract } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";
import { data } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cohorts — Steady Intelligence" };

// Cohorts (§26: "Reproduce contract populations — versioned definitions —
// Open cohort").
//
// "Reproduce" is the requirement. A number in a contract report is only
// checkable if the population behind it can be rebuilt exactly, and that needs
// a VERSIONED definition — not a description of one. A cohort that drifts
// silently makes every historical report unreproducible without anything
// appearing to change.
//
// What exists here is the current version and its membership rule. What does
// not exist is a version HISTORY: there has only ever been one cohort
// definition in this deployment, so the screen says that rather than implying
// a registry it does not have.

export default async function PayerCohortsPage() {
  const tenantId = await resolvePayerTenant();
  const contract = tenantId ? await loadContract(tenantId) : null;
  const c = await data();
  const pop = tenantId
    ? ((await c.get("SELECT COUNT(*) AS n FROM persons WHERE tenant_id = ?", [tenantId])) as { n: number }).n
    : 0;

  return (
    <PayerPage
      layer="evidence"
      here="/payer/cohorts"
      title="Cohorts"
      lede="The population every measure is computed against, and the version that identifies it."
    >
      {!contract ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel
            title="Current cohort"
            footnote="Every figure on every payer screen is computed against this population. A report quoting a different one is not comparable."
          >
            <dl className="divide-y divide-ground/5">
              {[
                ["Version", contract.cohortVersion],
                ["Contract", contract.name],
                ["Period", `${contract.periodStart} to ${contract.periodEnd}`],
                ["Members", `${num(pop)} eligible`],
                ["Membership rule", "Enrolled in the behavioural-health programme with an eligibility span overlapping the contract period."],
                ["Claims lag expected", `${contract.claimsLagDays} days`],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
                  <dt className="text-sm font-medium text-app-ink">{k}</dt>
                  <dd className="measure text-sm text-ground">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Version history">
            <p className="measure text-ground/90">
              This deployment has only ever had one cohort definition, so there is no history
              to show. That is a fact about this environment rather than a feature that is
              missing from the screen.
            </p>
            <p className="measure mt-3 text-sm text-olive">
              What a history would have to carry: the definition at each version, the date it
              took effect, who approved the change, and which published reports were computed
              under it. Without the last of those, a redefinition silently invalidates every
              report that came before it and nothing on any screen would show that.
            </p>
          </Panel>
        </div>
      )}
    </PayerPage>
  );
}
