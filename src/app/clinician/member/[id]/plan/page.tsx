import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { getMemberTracks } from "@/lib/tracks";
import { getProgramPlan } from "@/lib/program-plan";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { ReviewBadge, EmptyState } from "@/components/clinical/primitives";

export const dynamic = "force-dynamic";

// Care plan (§26: "Review active plan and versions — authority and next review
// — Draft change").
//
// The clinician half of the member's /app/plan. Same underlying record, and
// deliberately the same status vocabulary: §9.3's four labels mean the same
// thing on both sides, so a clinician and a member reading "AI draft" are
// reading the same claim about the same text.
//
// "Authority" is the column that matters. A model-drafted plan a clinician has
// not approved is a suggestion; the badge says so, and the approval action is
// on the full record where the audit trail is, rather than duplicated here as a
// second path to the same write.

export default async function ClinicianPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clinician = await requireClinician();
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? "";

  const person = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!person) notFound();

  const [tracks, planRow] = await Promise.all([getMemberTracks(id), getProgramPlan(id)]);

  return (
    <PersonShell person={person} active="/plan" title="Care plan">
      <section aria-labelledby="tracks">
        <h2 id="tracks" className="type-display text-xl font-medium text-ground">Active paths</h2>
        {tracks.length === 0 ? (
          <div className="mt-3">
            <EmptyState kind="clear" title="No path selected"
              detail="This person has not chosen a care path. Paths are optional and the programme runs without one." />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {tracks.map((t) => (
              <li key={t.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ground">{t.name}</p>
                  <p className="font-mono text-xs text-olive">{t.evidenceGrade}</p>
                </div>
                <p className="mt-1 text-sm text-ground/90">{t.scope}</p>
                <p className="mt-1.5 text-xs text-olive">{t.evidenceNote}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="programme" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="programme" className="type-display text-xl font-medium text-ground">
            Suggested programme
          </h2>
          {planRow && <ReviewBadge state={planRow.generated_by === "ai" ? "draft" : "validated"} />}
        </div>

        {!planRow ? (
          <div className="mt-3">
            <EmptyState kind="clear" title="No programme drafted"
              detail="Nothing has been generated for this person yet." />
          </div>
        ) : (
          <div className="mt-3 rounded-3xl border border-ground/10 bg-linen p-5">
            <p className="text-ground/90">{planRow.plan.summary}</p>
            {planRow.plan.nextSteps.length > 0 && (
              <ol className="mt-4 space-y-2">
                {planRow.plan.nextSteps.map((s, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-ground">{s.focus}</span>
                    <span className="block text-olive">{s.why}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-4 border-t border-ground/10 pt-3 text-xs text-olive">
              Generated {planRow.created_at.slice(0, 16)} by{" "}
              {planRow.generated_by === "ai" ? "a model" : "fixed rules"}. The member sees the same
              status label. Approve or correct it on the full record, where the action is audited.
            </p>
          </div>
        )}
      </section>
    </PersonShell>
  );
}
