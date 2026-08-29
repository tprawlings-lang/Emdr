import Link from "next/link";
import { PayerPage } from "@/components/app/PayerPage";
import { Panel } from "@/components/app/surfaces";
import { loadContract, buildCostModel } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";
import { data } from "@/lib/data";
import { hasData } from "@/lib/presentation/envelope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Evidence registry — Steady Intelligence" };

// Evidence (§26: "Separate observed and modeled — metric and model registry —
// Open evidence").
//
// The screen whose entire job is a boundary. Every number a payer might quote
// is on one of two lists here, and the lists never merge: a metric is COUNTED
// from a feed, a model is ESTIMATED under assumptions, and the difference is
// not a nuance to be summarised away in a slide.
//
// This matters most where the two look alike. "$8 PMPM" and "8.3 ED visits per
// 1,000" are both numbers with units; only one of them was measured.

export default async function PayerEvidencePage() {
  const tenantId = await resolvePayerTenant();
  const contract = tenantId ? await loadContract(tenantId) : null;
  const modelEnvelope = tenantId ? await buildCostModel(tenantId) : null;
  const model = modelEnvelope && hasData(modelEnvelope) ? modelEnvelope.data : null;
  const c = await data();

  const metrics = contract
    ? ((await c.all(
        "SELECT metric, label, unit FROM contract_measures WHERE contract_id = ?",
        [contract.id],
      )) as { metric: string; label: string; unit: string }[])
    : [];

  return (
    <PayerPage
      layer="evidence"
      here="/payer/evidence"
      title="Evidence registry"
      lede="Two lists that never merge: what was counted, and what was estimated."
    >
      {!contract ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel
            title="Observed metrics — counted from a feed"
            footnote="Each is computed from claims or care events, against the contract cohort, using only months whose claims have arrived."
          >
            <ul className="divide-y divide-ground/5">
              {metrics.map((m) => (
                <li key={m.metric} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <span className="text-sm text-ground">{m.label}</span>
                  <span className="text-xs text-olive">
                    <span className="font-mono">{m.metric}</span> · {m.unit}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Modelled estimates — computed under assumptions"
            footnote="Never quotable as observed savings. Ranges carry their assumptions and their approval, and observed claims replace them as they arrive."
          >
            {model ? (
              <>
                <p className="measure text-sm text-ground">
                  Cost model{" "}
                  <span className="font-mono text-xs">{model.modelVersion}</span>, approved
                  {model.approvedAt ? ` ${model.approvedAt.slice(0, 10)}` : ""}, with{" "}
                  {model.scenarios.length} scenarios and {model.assumptions.length}{" "}
                  stated assumptions.
                </p>
                <Link
                  href="/payer/evidence/cost"
                  className="mt-3 inline-block rounded-full border border-ground/25 px-5 py-2 text-sm font-medium text-ground transition-colors hover:bg-ground/5"
                >
                  Open the cost model
                </Link>
              </>
            ) : (
              <p className="measure text-sm text-ground">
                No approved model version. Drafts are deliberately not listed here — a draft
                shown beside an approved metric is how a working estimate leaves the building
                as a finding.
              </p>
            )}
          </Panel>

          <Panel title="Why these are two lists">
            <p className="measure text-ground/90">
              A metric and a model can look identical on a slide: both are a number with a
              unit. One was counted from a feed with a known lag; the other was computed from
              assumptions that may not hold. Merging them is the single most expensive error
              this product could help someone make, which is why they are never rendered in
              the same register, the same colour, or the same list.
            </p>
          </Panel>
        </div>
      )}
    </PayerPage>
  );
}
