import Link from "next/link";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { scopedAuditFeed, scopeNote } from "@/lib/clinical/audit-history";
import { ChainBanner, AuditTable } from "@/components/clinical/AuditView";

export const dynamic = "force-dynamic";

// Audit console.
//
// Two things changed here in Phase 4, both of which were defects rather than
// missing features:
//
//   The feed was unscoped. Every clinician read every organization's audit
//   trail, which contradicts the isolation the platform states publicly.
//
//   The feed rendered `detail_json` raw. A failed sign-in records the attempted
//   address verbatim, and correction rationales, alert resolutions, and review
//   notes are all free text a member never expected a list view to surface.
export default async function AuditConsolePage() {
  const clinician = await requireClinician();

  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const feed = await scopedAuditFeed({ tenantId, limit: 300 });

  return (
    <ReviewPage
      layer="audit"
      here="/review/audit"
      title="Audit and lineage"
      lede="Who did what, in order, with the hash chain verified rather than asserted."
    >
      <p className="mt-1 text-sm text-olive">
        Append-only ledger of identity, consent, clinical, module-runtime, specialist, and
        security events. Most recent first.
      </p>

      <ChainBanner chain={feed.chain} />

      <p className="mt-3 rounded-2xl border border-ground/15 bg-linen px-4 py-3 text-xs text-ground/80">
        {scopeNote()}
        {feed.outOfScope > 0 && (
          <>
            {" "}
            <strong>{feed.outOfScope}</strong> entr{feed.outOfScope === 1 ? "y" : "ies"} in this
            window were outside your organization and are not shown.
          </>
        )}
      </p>

      <AuditTable entries={feed.entries} showTarget />
    </ReviewPage>
  );
}
