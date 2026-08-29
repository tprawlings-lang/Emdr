import { PayerPage } from "@/components/app/PayerPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { PopulationOverviewView } from "@/components/app/PopulationOverviewView";
import { MetricPanel } from "@/components/app/MetricPanel";
import { buildMetricPanel, buildPopulationOverview, populationTenants } from "@/lib/intelligence/population";
import { resolvePayerTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Population — Steady Intelligence" };

// Population overview, payer side (handoff 07 §4.2, p41).
//
// The SAME component and the same projection as the organization's, because
// p41 gives them one contract. What differs is the scope: a payer reports on
// its contracted population, which spans the provider organizations it covers
// rather than sitting inside one of them.
//
// This is the honest shape of the difference, and it is why the two consoles
// can show different numbers without either being wrong: an organization sees
// the people enrolled with it, a payer sees the people it covers.

export default async function PayerPopulationPage() {
  const payerTenant = await resolvePayerTenant();
  // A payer's covered population spans the demo provider organizations. When
  // the account is not in payer scope the projection renders `partial` and
  // says so, rather than reporting on a population it has no claim to.
  const tenants = payerTenant ? await populationTenants() : [];
  const envelope = await buildPopulationOverview(tenants);
  // The dictionary, computed over the same scope. Read as typed results — the
  // screen divides nothing.
  const metrics = await buildMetricPanel(tenants);

  return (
    <PayerPage
      layer="overview"
      here="/payer/population"
      title="Population"
      lede="Who is reached across the covered organizations, what changed, and what was not measured."
    >
      <EnvelopeView envelope={envelope} audience="operations">
        {(data) => (
          <PopulationOverviewView data={data} meta={envelope.meta} audience="payer" />
        )}
      </EnvelopeView>

      <div className="mt-6">
        <MetricPanel results={metrics} />
      </div>
    </PayerPage>
  );
}
