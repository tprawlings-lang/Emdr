import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { PopulationOverviewView } from "@/components/app/PopulationOverviewView";
import { buildPopulationOverview } from "@/lib/intelligence/population";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Population — Steady Intelligence" };

// Population overview, organization side (handoff 07 §4.2, p41).
//
// Scoped to THIS organization's tenant, not to every tenant holding demo
// people. An organization "cannot see payer-wide data or unrelated
// organizations" (p6), and the scope is the enforcement — the projection takes
// a tenant list and reads exactly that.

export default async function OrganizationPopulationPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = await buildPopulationOverview(tenantId ? [tenantId] : []);

  return (
    <OrgPage
      layer="overview"
      here="/organization/population"
      title="Population"
      lede="Who is reached, what changed, and what was not measured — counted from the same events the clinical console reads."
    >
      <EnvelopeView envelope={envelope} audience="operations">
        {(data) => (
          <PopulationOverviewView data={data} meta={envelope.meta} audience="organization" />
        )}
      </EnvelopeView>
    </OrgPage>
  );
}
