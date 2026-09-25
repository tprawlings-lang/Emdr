import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel } from "@/components/app/surfaces";
import { getLaneModule, laneRunsForClinician, laneSteps, LaneRefused, type RunStatus } from "@/lib/assigned-lane";
import { DISTRESS_CEILING_FLAG, DISTRESS_RISE_FLAG } from "@/lib/content/h10-assigned-lane";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assigned practice — Steady" };

// The runs of one clinician-assigned practice (Handoff 10 Phase 3; CV10_E01,
// E02). For the clinician who assigned it, and only them: what was written is
// "visible only to the member and the assigning clinician", so a colleague on
// the same care team is told whose it is and shown nothing else. Each read is
// audited (assigned_writing_viewed).

const STATUS_WORD: Record<RunStatus, string> = {
  started: "In progress",
  completed: "Finished",
  stopped_by_patient: "Stopped by them",
  hard_stopped_by_policy: "Ended by the safety check",
};

export default async function AssignedRunsPage({ params }: { params: Promise<{ id: string; assignmentId: string }> }) {
  const clinician = await requireClinician();
  const { id, assignmentId } = await params;
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as { tenant_id: string } | undefined;
  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId: me?.tenant_id ?? PLATFORM_TENANT_ID });
  if (!header) notFound();
  const row = (await c.get("SELECT support_id FROM support_assignments WHERE id = ? AND person_id = ?", [assignmentId, id])) as
    | { support_id: string } | undefined;
  const mod = row ? getLaneModule(row.support_id) : undefined;
  if (!mod) notFound();

  // Worksheet boxes by the labels the person saw, not their ids.
  const labels = new Map((laneSteps(mod) ?? []).flatMap((s) => (s.kind === "fields" ? s.fields.map((f) => [f.id, f.label] as const) : [])));
  let runs: Awaited<ReturnType<typeof laneRunsForClinician>> | null = null;
  try {
    runs = await laneRunsForClinician(clinician.id, id, assignmentId);
  } catch (e) {
    if (!(e instanceof LaneRefused)) throw e;
  }

  return (
    <PersonShell person={header} active="/care" title={mod.title}>
      {runs === null ? (
        <Panel title="Only the assigning clinician">
          <p className="measure text-sm text-ground">
            What is written in a clinician-assigned practice is visible to the person and the clinician
            who assigned it, and nobody else. You did not assign this one.
          </p>
        </Panel>
      ) : (
        <Panel
          title="Runs"
          footnote={`Flagged when distress after rose by ${DISTRESS_RISE_FLAG} or more, or went above ${DISTRESS_CEILING_FLAG}; they were shown grounding and SOS, and an alert went to your queue. Stopping is always allowed and is not held against anyone.`}
        >
          {runs.length === 0 ? (
            <p className="text-sm text-ground">Not started yet.</p>
          ) : (
            <ul className="space-y-4">
              {runs.map((r) => (
                <li key={r.id} className="rounded-2xl border border-ground/10 bg-app-surface p-4 text-sm">
                  <p className="font-medium text-ground">
                    {r.startedAt.slice(0, 16)} · {STATUS_WORD[r.status]}
                    {r.flagged && <span className="ml-2 rounded-full bg-state-caution-bg px-2 py-0.5 text-xs text-state-caution">Distress flag</span>}
                  </p>
                  <p className="mt-1 text-olive">
                    Distress before {r.distressBefore}{r.distressAfter === null || r.distressAfter === undefined ? " · after not given" : ` · after ${r.distressAfter}`}
                    {r.useful ? ` · felt useful: ${r.useful.replace("_", " ")}` : ""}
                  </p>
                  {r.written.map((w) => (
                    <div key={w.stepId} className="mt-3 whitespace-pre-line rounded-xl bg-linen px-3 py-2 text-ground">
                      {typeof w.answer === "string" ? w.answer : Object.entries(w.answer).map(([k, v]) => `${labels.get(k) ?? k}: ${v}`).join("\n")}
                    </div>
                  ))}
                  {r.note && <p className="mt-2 text-ground">For you: “{r.note}”</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </PersonShell>
  );
}
