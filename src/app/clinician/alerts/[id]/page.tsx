import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { alertTrail, scopeNote } from "@/lib/clinical/audit-history";
import { ChainBanner, AuditTable } from "@/components/clinical/AuditView";

export const dynamic = "force-dynamic";

// One alert, from creation to closure (Phase 4).
//
// This exists because it is the specific thing a security reviewer is asked to
// follow end to end, and following it by scrolling a global log is not the same
// as being able to follow it. Entries are oldest-first here — an alert trail is
// a sequence, and reading it backwards loses the thing that makes it a trail.
export default async function AlertTrailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const clinician = await requireClinician();
  const { id } = await params;

  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const trail = await alertTrail({ alertId: id, tenantId });

  if (!trail.alert) {
    // A foreign-tenant alert reads as absent rather than forbidden. "Not
    // permitted" would confirm the id exists.
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-serif text-2xl font-medium">Not found</h1>
        <p className="mt-2 text-sm text-olive">No such alert in your organization.</p>
        <Link href="/clinician/clinical" className="mt-4 inline-block text-sm text-olive underline">
          ← Caseload
        </Link>
      </main>
    );
  }

  const a = trail.alert;
  const closed = a.status !== "open";

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-medium">Alert trail</h1>
          <p className="text-sm text-olive">
            {a.alert_type.replace(/_/g, " ")} · severity {a.severity}
          </p>
        </div>
        <Link href="/clinician/clinical" className="text-sm text-olive underline">
          ← Caseload
        </Link>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        {[
          ["Raised", a.created_at],
          ["Status", closed ? "closed" : "open"],
          ["Closed", a.reviewed_at ?? "—"],
          ["Member record", null],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-2xl border border-ground/10 bg-linen/40 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-olive">{k}</dt>
            <dd className="mt-0.5 text-sm">
              {k === "Member record" ? (
                <Link href={`/clinician/clinical/${a.user_id}`} className="underline">
                  Open clinical record
                </Link>
              ) : (
                (v as string)
              )}
            </dd>
          </div>
        ))}
      </dl>

      {!closed && (
        <p className="mt-4 rounded-2xl border border-pause/50 bg-pause-soft px-4 py-3 text-sm text-ground">
          This alert is still open. Immediate and high bands close with a documented action,
          never an acknowledgement and never by the passage of time.
        </p>
      )}

      <ChainBanner chain={trail.chain} />

      <p className="mt-3 rounded-2xl border border-ground/15 bg-linen px-4 py-3 text-xs text-ground/80">
        {scopeNote()} The closure text a clinician wrote is part of the record and is
        withheld from this view.
      </p>

      <h2 className="mt-8 font-serif text-2xl font-medium">Sequence</h2>
      <p className="mt-1 text-sm text-olive">Oldest first.</p>
      <AuditTable entries={trail.entries} showTarget />
    </main>
  );
}
