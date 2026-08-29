import Link from "next/link";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { buildCaseload, isCoverageAction } from "@/lib/clinical/caseload";
import { alertQueue, overdueAlerts } from "@/lib/clinical/alerts";
import { activePolicy, policyBanner } from "@/lib/clinical-policy";
import { closeAlertAction } from "@/lib/clinical/actions";
import { NoteForm } from "@/components/clinical/NoteForm";
import { PriorityBadge, OwnerChip, FreshnessLabel } from "@/components/clinical/primitives";

export const dynamic = "force-dynamic";

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

  // Owner names, resolved once. The row showed a raw clinician id or nothing at
  // all; §23.2 wants a clear owner, and an id is not an owner to a person
  // reading it.
  const ownerIds = [...new Set(caseload.rows.map((r) => r.primaryClinicianId).filter((x): x is string => !!x))];
  const ownerNames = new Map<string, string>();
  if (ownerIds.length) {
    const rows = (await c.all(
      `SELECT id, name FROM users WHERE id IN (${ownerIds.map(() => "?").join(",")})`,
      ownerIds
    )) as Array<{ id: string; name: string }>;
    for (const r of rows) ownerNames.set(r.id, r.name);
  }

  // Freshness renders against a server time, never the browser clock.
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const alerts = await alertQueue({ tenantId, policy });
  const overdue = overdueAlerts(alerts);

  return (
    <ClinicianPage
      layer="progress"
      here="/clinician/caseload"
      title="Caseload"
      lede={`Everyone assigned to ${clinician.name}, ordered by clinical need. The work queue is what needs doing; this is who you have.`}
    >

      {/* Handoff §2: a screen resembling a live service must never imply approval. */}
      <p className="mt-4 rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-xs text-ground">
        <strong>Provisional configuration.</strong> {policyBanner(policy)}. These are
        demonstration assumptions, not clinical approval — the packet seeking ratification is{" "}
        <code className="text-[11px]">clinical-pilot-2026-09</code>, which is unsubmitted.
      </p>

      {error && (
        <p className="mt-4 rounded-2xl border border-state-support/40 bg-state-support-bg/60 px-4 py-3 text-sm text-state-support">
          {error}
        </p>
      )}

      {/* ---------------- Alerts ---------------- */}
      <section className="mt-8">
        <h2 className="type-display text-2xl font-medium">
          Alerts{" "}
          <span className="ml-1 rounded-full bg-ground px-2.5 py-0.5 text-sm text-ivory">
            {alerts.length}
          </span>
          {overdue.length > 0 && (
            <span className="ml-2 rounded-full bg-state-support px-2.5 py-0.5 text-sm text-ivory">
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
                className={`rounded-2xl border border-ground/10 bg-linen px-4 py-3 ${
                  a.overdue ? "ring-2 ring-state-support/50" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <PriorityBadge band={a.band} />
                  <Link href={`/clinician/member/${a.personId}/record`} className="font-medium underline">
                    {a.personName}
                  </Link>
                  <span className="text-xs opacity-80">{a.type.replace(/_/g, " ")}</span>
                  {a.overdue && (
                    <span className="rounded bg-state-support px-1.5 py-0.5 text-[10px] font-medium text-ivory">
                      OVERDUE
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm">{a.detail}</p>
                <p className="mt-1 text-xs opacity-75">
                  Raised {a.createdAt}
                  {a.dueAt ? ` · due ${a.dueAt}` : " · no deadline for this band"} ·{" "}
                  <Link href={`/clinician/alerts/${a.id}`} className="underline">
                    audit trail
                  </Link>
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
        {/* Named for what it lists. The page is already "Caseload"; a section
            inside it with the same name says nothing and, as it turned out,
            makes the page heading ambiguous to anything looking for it. */}
        <h2 className="type-display text-2xl font-medium text-ground">People</h2>
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
              // Neutral card, state in the badge. The row used to be tinted by
              // band, so a caseload read as four blocks of colour and the
              // person's name competed with the tint for attention. The badge
              // carries the state — glyph, label and colour — and the card
              // stays out of the way.
              <li key={r.personId} data-testid="caseload-row" className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span data-testid="band"><PriorityBadge band={r.band} /></span>
                  <Link
                    href={`/clinician/member/${r.personId}/record`}
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

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <FreshnessLabel evidenceAt={r.lastCheckinDate} now={now} prefix="Last check-in" />
                  <OwnerChip name={r.primaryClinicianId ? ownerNames.get(r.primaryClinicianId) ?? null : null} />
                  {r.openAlerts > 0 && (
                    <span className="text-xs text-state-support">{r.openAlerts} open alert(s)</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <NoteForm surface="Caseload" returnTo="/clinician/caseload" defaultCategory="Caseload and prioritisation" />
      </section>
    </ClinicianPage>
  );
}
