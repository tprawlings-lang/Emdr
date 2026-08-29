import { requireClinician } from "@/lib/auth";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { data } from "@/lib/data";
import { activePolicy } from "@/lib/clinical-policy";
import { buildWorkQueue, GROUP_LABEL, type WorkGroup } from "@/lib/clinical/work-queue";
import { alertQueue, alertPressure } from "@/lib/clinical/alerts";
import { EmptyState } from "@/components/clinical/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports — Steady Clinical" };

// Clinical reports (§26: "Review team quality — aggregate clinical operations
// — Open report").
//
// Operations, not outcomes. §26 puts outcome reporting under organization and
// payer, and the difference is not cosmetic: a caseload-sized denominator
// cannot support an outcome claim, and a screen that presents one invites the
// reading that it can.
//
// So every figure here is a count of work, with its denominator visible. §23.3
// — "do not show a percentage without its denominator" — is the reason the
// rates are rendered as "n of N" rather than as a bare percentage.

export default async function ReportsPage() {
  const clinician = await requireClinician();
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? "";
  const policy = activePolicy();

  const [queue, alerts] = await Promise.all([
    buildWorkQueue({ clinicianId: clinician.id, tenantId, policy }),
    alertQueue({ tenantId, includeResolved: true, policy }),
  ]);
  const pressure = alertPressure(alerts);
  const groups: WorkGroup[] = ["needs_action", "review_today", "waiting_member", "waiting_staff", "recently_resolved"];
  const total = queue.items.length;

  return (
    <ClinicianPage layer="evidence" here="/clinician/reports" title="Reports">
      <p className="-mt-2 mb-6 text-sm text-olive">
        Clinical operations for this tenant. Computed {queue.computedAt} under policy{" "}
        {queue.policyVersion}.
      </p>

      {total === 0 ? (
        <div className="mt-8">
          <EmptyState kind="clear" title="No work to report on"
            detail={`The queue ran under policy ${queue.policyVersion} and found no items. This is an empty result, not a failure to load.`} />
        </div>
      ) : (
        <>
          <section aria-labelledby="workload" className="mt-8">
            <h2 id="workload" className="type-display text-xl font-medium text-ground">
              Where the work sits
            </h2>
            <ul className="mt-3 space-y-2">
              {groups.map((g) => {
                const n = queue.groupCounts[g];
                return (
                  <li key={g} className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-ground">{GROUP_LABEL[g]}</span>
                      {/* Numerator and denominator, never a bare share. */}
                      <span className="font-mono text-sm text-olive">
                        {n} of {total}
                      </span>
                    </div>
                    <div
                      className="mt-2 h-1.5 rounded-full bg-ground/10"
                      role="img"
                      aria-label={`${GROUP_LABEL[g]}: ${n} of ${total} items`}
                    >
                      <div
                        className="h-full rounded-full bg-state-info"
                        style={{ width: `${total ? (n / total) * 100 : 0}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="alerts" className="mt-8">
            <h2 id="alerts" className="type-display text-xl font-medium text-ground">
              Alert pressure
            </h2>
            <p className="mt-1 text-sm text-olive">
              Volume and overdue count. AHRQ&apos;s alert-fatigue guidance is the reason this is
              reported at all: an alert stream nobody can keep up with stops being read.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Open", n: alerts.filter((a) => a.status === "open").length },
                { label: "Overdue", n: pressure.overdueTotal },
                { label: "Total recorded", n: alerts.length },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-olive">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-ground">{s.n}</p>
                </div>
              ))}
            </div>
            {/* By type, because a single noisy rule is what alert fatigue
                usually turns out to be, and a total hides it. */}
            {Object.keys(pressure.byType).length > 0 && (
              <ul className="mt-3 space-y-1">
                {Object.entries(pressure.byType).map(([type, v]) => (
                  <li key={type} className="flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-mono text-olive">{type}</span>
                    <span className="text-ground">
                      {v.open} open{v.overdue > 0 && `, ${v.overdue} overdue`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <p className="mt-10 text-xs text-olive">
        These are operational counts for one caseload. They are not outcome measures, and the
        denominator here cannot support an outcome claim — that reporting belongs to the
        organization and payer views.
      </p>
    </ClinicianPage>
  );
}
