import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { getModule } from "@/lib/modules";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { EmptyState, relativeAge } from "@/components/clinical/primitives";
import { ClinicalFigure, Slope } from "@/components/charts/clinical";
import { buildSessionResponse } from "@/lib/clinical/session-response";

export const dynamic = "force-dynamic";

// Sessions (§26: "Review session pattern — concise list and gate state — Open
// session").
//
// Concise is the specification. A clinician scanning this is asking whether the
// pattern is changing, not reading each session — so a row carries the module,
// when, how it ended, and nothing else. The detail is one click away and that
// is where it belongs.
//
// "Gate state" is why hard stops are marked rather than left to be inferred
// from a status word: a session that ended because a rule fired is a different
// event from one the member chose to end, and a list that renders both as
// "ended" hides the distinction a clinician is here for.

const STATUS: Record<string, { label: string; cls: string }> = {
  completed:   { label: "Completed",  cls: "text-state-safe" },
  hard_stop:   { label: "Hard stop",  cls: "text-state-support font-semibold" },
  abandoned:   { label: "Left early", cls: "text-state-caution" },
  in_progress: { label: "In progress", cls: "text-state-info" },
};

export default async function SessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clinician = await requireClinician();
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? "";

  const person = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!person) notFound();

  const rows = (await c.all(
    `SELECT id, module_id, status, hard_stop_reason, started_at, ended_at
       FROM therapy_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 50`,
    [id]
  )) as Array<{
    id: string; module_id: string; status: string;
    hard_stop_reason: string | null; started_at: string; ended_at: string | null;
  }>;

  // The pattern, above the list. A clinician scanning this asks whether
  // sessions are settling this person before they ask about any one session.
  const response = await buildSessionResponse(id);

  return (
    <PersonShell person={person} active="/sessions" title="Sessions">
      <h2 className="type-display text-xl font-medium text-ground">
        Sessions <span className="text-base font-normal text-olive">({rows.length})</span>
      </h2>

      {response && (
        <section className="mb-8 rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
          <ClinicalFigure
            title="Activation before and after each session"
            summary={`Opening and closing activation for the last ${response.rows.length} sessions, on a 0 to ${response.scaleMax} scale.`}
            footnote={[
              `Last ${response.total} sessions.`,
              response.noOpening > 0
                ? `${response.noOpening} recorded no opening reading and cannot be placed on this scale.`
                : null,
              `${response.withClose} of ${response.rows.length} plotted sessions recorded a reading at close; the rest keep their row and say why.`,
              "One session does not establish that anything changed.",
            ].filter(Boolean).join(" ")}
          >
            <Slope rows={response.rows} max={response.scaleMax} />
          </ClinicalFigure>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            kind="clear"
            title="No sessions recorded"
            detail="This person has not started a guided session. That is an empty result, not a failure to load."
          />
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-3xl border border-ground/10 bg-linen">
          {rows.map((r) => {
            const s = STATUS[r.status] ?? { label: r.status, cls: "text-olive" };
            return (
              <li key={r.id} className="border-b border-ground/10 last:border-b-0">
                <Link
                  href={`/clinician/member/${id}/session/${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-ground/5"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ground">
                      {getModule(r.module_id)?.name ?? r.module_id}
                    </p>
                    <p className="text-xs text-olive">
                      {relativeAge(r.started_at, person.now)} ago · {r.started_at.slice(0, 16)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm ${s.cls}`}>{s.label}</p>
                    {/* The reason, not just the label. "Hard stop" tells a
                        clinician that a rule fired; the reason tells them which. */}
                    {r.hard_stop_reason && (
                      <p className="text-xs text-olive">{r.hard_stop_reason}</p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PersonShell>
  );
}
