"use server";

import { redirect } from "next/navigation";
import { requireIntelligence } from "@/lib/auth";
import { data } from "@/lib/data";
import { createExport, ExportRefused } from "@/lib/intelligence/export";
import { resolveOrgTenant, resolvePayerTenant } from "@/lib/intelligence/scope";
import { buildOrgLocations } from "@/lib/intelligence/organization";
import { buildContractReport, loadContract } from "@/lib/intelligence/payer";
import { hasData } from "@/lib/presentation/envelope";

// The one write path for exports (§30.4: POST, not GET).
//
// A GET download is idempotent and cacheable and can be triggered by a link
// somebody pastes into a chat. This is a disclosure, so it is a form submission
// with a stated purpose, and the redirect afterwards carries only the job id —
// the file itself is fetched separately and checked against its signature.

export async function requestOrgExport(formData: FormData) {
  const user = await requireIntelligence();
  const tenantId = await resolveOrgTenant();
  if (!tenantId) redirect("/organization/reports?error=scope");

  const envelope = await buildOrgLocations(tenantId);
  if (!hasData(envelope)) redirect("/organization/reports?error=nodata");

  const c = await data();
  const org = (await c.get("SELECT name FROM tenants WHERE id = ?", [tenantId])) as
    | { name: string } | undefined;

  try {
    const result = await createExport({
      tenantId,
      requestedBy: user.id,
      requestedByRole: user.role,
      surface: "organization/locations",
      // No cohort registry exists for a provider network, so the cohort is the
      // network itself at the version the projection ran under. Stated rather
      // than omitted: a file with no cohort identity cannot be reproduced.
      cohortVersion: `network:${org?.name ?? tenantId}`,
      filter: { scope: "all-sites", measure: "access-and-start" },
      countColumns: ["referred", "contacted", "started"],
      rows: envelope.data.rows.map((r) => ({
        site: r.label,
        referred: r.population,
        contacted: r.contacted.n,
        started: r.started.n,
        median_wait_days: r.medianWaitDays,
      })),
      purpose: String(formData.get("purpose") ?? ""),
    });
    redirect(`/organization/reports?export=${result.id}`);
  } catch (e) {
    if (e instanceof ExportRefused) {
      redirect(`/organization/reports?refused=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
}

export async function requestPayerExport(formData: FormData) {
  const user = await requireIntelligence();
  const tenantId = await resolvePayerTenant();
  if (!tenantId) redirect("/payer/contract?error=scope");

  const envelope = await buildContractReport(tenantId);
  const contract = await loadContract(tenantId);
  if (!hasData(envelope) || !contract) redirect("/payer/contract?error=nodata");

  try {
    const result = await createExport({
      tenantId,
      requestedBy: user.id,
      requestedByRole: user.role,
      surface: "payer/contract",
      cohortVersion: contract.cohortVersion,
      filter: {
        contract: contract.name,
        periodStart: contract.periodStart,
        periodEnd: contract.periodEnd,
        completeMonthsOnly: true,
      },
      // No column here is a count of people — these are rates and targets — so
      // suppression has nothing to bite on. Declaring the empty list is the
      // point: a caller that has not thought about which columns are counts
      // cannot pass this by accident.
      countColumns: [],
      rows: envelope.data.measures.map((m) => ({
        measure: m.label,
        unit: m.unit,
        observed: m.observed,
        target: m.target,
        better: m.better,
        result: m.met === null ? "not computed" : m.met ? "met" : "not met",
        note: m.withheld ?? "",
      })),
      purpose: String(formData.get("purpose") ?? ""),
    });
    redirect(`/payer/contract?export=${result.id}`);
  } catch (e) {
    if (e instanceof ExportRefused) {
      redirect(`/payer/contract?refused=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
}
