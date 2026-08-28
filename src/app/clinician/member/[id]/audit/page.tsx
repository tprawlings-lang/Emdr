import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { memberAuditHistory, scopeNote } from "@/lib/clinical/audit-history";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { ChainBanner, AuditTable } from "@/components/clinical/AuditView";

export const dynamic = "force-dynamic";

// Patient audit (§26: "Trace access and decisions — immutable filtered events
// — Open evidence").
//
// Scoped to one person, which is the difference from /review/audit. A clinician
// asking "who touched this record, and what did they change" should not have to
// filter a tenant-wide feed to find out, and a tenant-wide feed is more access
// than the question needs (§30.6's minimum-necessary step).
//
// The chain banner is the point of the screen rather than decoration: an audit
// trail nobody can verify is a list of claims. Showing the verification result
// makes the difference visible without anyone having to ask for it.

export default async function PersonAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clinician = await requireClinician();
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? "";

  const person = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!person) notFound();

  const history = await memberAuditHistory({ personId: id, tenantId });

  return (
    <PersonShell person={person} active="/audit">
      <h2 className="type-display text-xl font-medium text-ground">Access and decisions</h2>
      <p className="mt-1 text-sm text-olive">{scopeNote()}</p>

      <div className="mt-4">
        <ChainBanner chain={history.chain} />
      </div>
      <div className="mt-4">
        <AuditTable entries={history.entries} />
      </div>

      {/* §14 again, in the place it matters most: "nothing happened" and "you
          cannot see what happened" are different, and an audit view that
          conflates them tells a reviewer the record is clean when it is merely
          filtered. */}
      {history.outOfScope > 0 && (
        <p className="mt-3 text-xs text-state-caution">
          {history.outOfScope} event(s) exist outside your tenant scope and are not shown.
          This is a filtered view, not the whole log.
        </p>
      )}
    </PersonShell>
  );
}
