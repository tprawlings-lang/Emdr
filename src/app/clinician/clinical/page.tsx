import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { buildCaseload, isCoverageAction, type PriorityBand } from "@/lib/clinical/caseload";
import { alertQueue, overdueAlerts, type AlertBand } from "@/lib/clinical/alerts";
import { activePolicy, policyBanner } from "@/lib/clinical-policy";
import { closeAlertAction } from "@/lib/clinical/actions";

export const dynamic = "force-dynamic";

const BAND_STYLE: Record<PriorityBand | AlertBand, string> = {
  immediate: "bg-support/15 text-support-deep border-support/50",
  high: "bg-pause-soft text-ground border-pause/60",
  standard: "bg-moss/40 text-ground border-sage/60",
  watch: "bg-linen text-ground/80 border-ground/15",
  none: "bg-linen text-olive border-ground/10",
};

export default async function ClinicalConsole({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const clinician = await requireClinician();
  const { error } = await searchParams;
  const policy = activePolicy();

  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const caseload = await buildCaseload({ clinicianId: clinician.id, tenantId, policy });
  const alerts = await alertQueue({ tenantId, policy });
  const overdue = overdueAlerts(alerts);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-medium">Steady Clinical</h1>
          <p className="text-sm text-olive">
            Caseload for {clinician.name} · ordered by clinical need
          </p>
        </div>
        <Link href="/clinician" className="text-sm text-olive underline">
          ← Specialist dashboard
        </Link>
      </div>

      {/* Handoff §2: a screen resembling a live service must never imply approval. */}
      <p className="mt-4 rounded-2xl border border-pause/50 bg-pause-soft px-4 py-3 text-xs text-ground">
        <strong>Provisional configuration.</strong> {policyBanner(policy)}. These are
        demonstration assumptions, not clinical approval — the packet seeking ratification is{" "}
        <code className="text-[11px]">clinical-pilot-2026-09</code>, which is unsubmitted.
      </p>

      {error && (
        <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
          {error}
        </p>
      )}

      {/* ---------------- Alerts ---------------- */}
      <section className="mt-8">
        <h2 className="font-serif text-2xl font-medium">
          Alerts{" "}
          <span className="ml-1 rounded-full bg-ground px-2.5 py-0.5 text-sm text-ivory">
            {alerts.length}
          </span>
          {overdue.length > 0 && (
            <span className="ml-2 rounded-full bg-support px-2.5 py-0.5 text-sm text-ivory">
              {overdue.length} overdue
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm text-olive">
          Deadlines follow the configured coverage schedule ({policy.coverage.replace("_", " ")}).
          Immediate and high bands close with a documented action, never an acknowledgement.
        </p>

        {alerts.length === 0 ? (
          <p className="mt-3 text-sm text-olive">No open alerts.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {alerts.map((a) => (
              <li
                key={a.id}
                data-testid="alert-row"
                className={`rounded-2xl border px-4 py-3 ${BAND_STYLE[a.band]} ${
                  a.overdue ? "ring-2 ring-support/60" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-ground/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
                    {a.band}
                  </span>
                  <Link href={`/clinician/clinical/${a.personId}`} className="font-medium underline">
                    {a.personName}
                  </Link>
                  <span className="text-xs opacity-80">{a.type.replace(/_/g, " ")}</span>
                  {a.overdue && (
                    <span className="rounded bg-support px-1.5 py-0.5 text-[10px] font-medium text-ivory">
                      OVERDUE
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm">{a.detail}</p>
                <p className="mt-1 text-xs opacity-75">
                  Raised {a.createdAt}
                  {a.dueAt ? ` · due ${a.dueAt}` : " · no deadline for this band"}
                </p>

                <form action={closeAlertAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="alertId" value={a.id} />
                  <input
                    name="resolution"
                    required
                    placeholder={
                      a.requiresDocumentedAction
                        ? "What was done — who was contacted, what was decided, what follows (required)"
                        : "Resolution (required)"
                    }
                    className="min-w-64 flex-1 rounded border border-ground/20 bg-ivory px-2 py-1 text-xs"
                  />
                  <button className="rounded-full bg-ground px-3 py-1 text-xs font-medium text-ivory">
                    Close with action
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- Caseload ---------------- */}
      <section className="mt-10">
        <h2 className="font-serif text-2xl font-medium">Caseload</h2>
        <p className="mt-1 text-sm text-olive">
          {(["immediate", "high", "standard", "watch"] as const)
            .map((b) => `${caseload.bandCounts[b]} ${b}`)
            .join(" · ")}{" "}
          · model: {caseload.model}
        </p>

        <ul className="mt-4 space-y-3">
          {caseload.rows.map((r) => {
            const coverage = isCoverageAction(caseload.model, clinician.id, r.primaryClinicianId);
            return (
              <li key={r.personId} data-testid="caseload-row" className={`rounded-2xl border px-4 py-3 ${BAND_STYLE[r.band]}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span data-testid="band" className="rounded-full bg-ground/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
                    {r.band}
                  </span>
                  <Link
                    href={`/clinician/clinical/${r.personId}`}
                    className="font-medium underline"
                  >
                    {r.displayName}
                  </Link>
                  {coverage && (
                    <span className="rounded bg-ground/10 px-1.5 py-0.5 text-[10px]">
                      coverage — not your caseload
                    </span>
                  )}
                  {!r.actionable && (
                    <span className="rounded bg-ground/10 px-1.5 py-0.5 text-[10px]">
                      read-only under the {caseload.model} model
                    </span>
                  )}
                </div>

                {/* The reason is mandatory: a bare band teaches a clinician to
                    trust a ranking they cannot interrogate. */}
                {r.reasons.length > 0 ? (
                  <ul data-testid="reasons" className="mt-1 list-disc pl-5 text-sm">
                    {r.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm opacity-75">No flags.</p>
                )}

                <p className="mt-1 text-xs opacity-75">
                  {r.lastCheckinDate ? `Last check-in ${r.lastCheckinDate}` : "No check-in recorded"}
                  {r.daysSinceContact !== null ? ` · ${r.daysSinceContact} day(s) since activity` : ""}
                  {r.openAlerts > 0 ? ` · ${r.openAlerts} open alert(s)` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
