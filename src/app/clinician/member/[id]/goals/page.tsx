import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel } from "@/components/app/surfaces";
import {
  NewGoalForm, ConfirmGoal, RecordEvidence, DecideObservation,
} from "@/components/clinical/GoalLadderForm";
import {
  listGoals, ladderFor, observationsFor,
  DOMAIN_LABEL, LEVEL_LABEL, EVIDENCE_LABEL, COMPLETION_NOTE,
} from "@/lib/clinical/return-to-life";
import { summarizeProgress } from "@/lib/clinical/return-goal-intelligence";
import type { TenantContext } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const metadata = { title: "Life goals — Steady" };

// Return-to-Life goals for one person (handoff 01 §9, Appendix A).
//
// §9's clinician surfaces are a compact card on the overview and a detail view
// with "five-level ladder, evidence timeline, source labels, revisions, and
// what changed". This is the detail view; the card is on the overview page.
//
// THE EVIDENCE TIMELINE SHOWS ITS SOURCES, ALWAYS. §14's acceptance criterion
// is that "patient report and clinician observation display differently", and
// they do here — every row is labelled with the class it was recorded under,
// using the domain's own wording so this page and the brief cannot describe the
// same evidence differently.
//
// SUGGESTIONS SIT WITH THE THING THEY ARE ABOUT, not in a separate queue. A
// proposed observation is a question about THIS goal, and answering it needs
// the ladder in view — a global review list would ask a clinician to judge a
// suggestion with the context on another screen.

export default async function MemberGoalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const c = await data();

  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;
  const ctx: TenantContext = { tenantId, personId: clinician.id };

  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!header) notFound();

  const goals = await listGoals(ctx, id, ["draft", "active", "paused", "completed"]);
  const detail = await Promise.all(
    goals.map(async (goal) => {
      const rungs = await ladderFor(ctx, goal.id);
      const observations = await observationsFor(ctx, goal.id);
      return {
        goal,
        rungs,
        observations,
        pending: observations.filter((o) => o.status === "proposed"),
        summary: summarizeProgress(goal, rungs, observations),
      };
    })
  );

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "return_goals_opened", target: id,
    detail: { count: goals.length },
  });

  return (
    <PersonShell person={header} active="/goals" title="Life goals">
      <Panel
        title="What they want to be able to do again"
        footnote="A life goal is about function, not symptoms. Progress here says a part of life changed; it makes no claim about diagnosis or cause."
      >
        <NewGoalForm personId={id} />
      </Panel>

      {detail.length === 0 ? (
        <Panel title="No goals yet" className="mt-6">
          <p className="measure text-sm text-ground">
            Nothing has been set with this person. A goal starts from something they said they
            want to be able to do — the form above takes their words first and the steps after.
          </p>
        </Panel>
      ) : (
        <div className="mt-6 space-y-4">
          {detail.map(({ goal, rungs, observations, pending, summary }) => (
            <Panel key={goal.id} title={goal.title}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-app-accent/60 px-2.5 py-1 text-xs font-medium text-app-ink">
                  {DOMAIN_LABEL[goal.domain]}
                </span>
                <span className="text-xs text-olive">{goal.status}</span>
                {goal.currentLevel !== null && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900">
                    {LEVEL_LABEL[goal.currentLevel]}
                  </span>
                )}
              </div>

              <blockquote className="measure mt-3 rounded-xl bg-app-accent/30 px-4 py-3 text-sm text-app-ink">
                &ldquo;{goal.patientStatement}&rdquo;
              </blockquote>
              {goal.whyItMatters && (
                <p className="measure mt-2 text-sm text-olive">
                  Why it matters to them: {goal.whyItMatters}
                </p>
              )}

              {goal.status === "draft" && (
                <>
                  <p className="measure mt-3 text-sm text-olive">
                    This is a draft. It becomes a goal when you confirm the wording with them.
                  </p>
                  <ConfirmGoal goalId={goal.id} personId={id} />
                </>
              )}

              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">The five steps</h3>
                <ol className="mt-2 space-y-1.5">
                  {rungs.map((r) => (
                    <li
                      key={r.level}
                      className={`measure text-sm ${
                        goal.currentLevel === r.level
                          ? "rounded-lg bg-emerald-50 px-3 py-1.5 font-medium text-emerald-900"
                          : "px-3 py-1.5 text-app-ink"
                      }`}
                    >
                      <span className="text-olive">{LEVEL_LABEL[r.level]} — </span>
                      {r.description}
                    </li>
                  ))}
                </ol>
              </div>

              {pending.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                    Suggested, waiting on you
                  </h3>
                  <p className="measure mt-1 text-xs text-amber-900/80">
                    Steady thinks these records may relate to this goal. Nothing moves until you
                    accept one.
                  </p>
                  <ul className="mt-2 space-y-3">
                    {pending.map((o) => (
                      <li key={o.id}>
                        <p className="text-sm text-app-ink">
                          {o.note ?? `A ${o.sourceType.replace(/_/g, " ")} record`}
                          {o.observedLevel !== null && (
                            <span className="text-olive"> — suggests {LEVEL_LABEL[o.observedLevel]}</span>
                          )}
                        </p>
                        <DecideObservation
                          observationId={o.id}
                          personId={id}
                          label={EVIDENCE_LABEL[o.evidenceClass]}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {goal.status === "active" && (
                <RecordEvidence goalId={goal.id} personId={id} rungs={rungs} />
              )}

              {summary.statements.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">Progress</h3>
                  <ul className="mt-2 space-y-1">
                    {summary.statements.map((s, i) => (
                      <li key={i} className="measure text-sm text-app-ink">
                        {s.text}{" "}
                        <span className="text-xs text-olive">
                          ({s.observationIds.length} observation{s.observationIds.length === 1 ? "" : "s"})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">Evidence</h3>
                {observations.length === 0 ? (
                  <p className="mt-2 text-sm text-olive">Nothing recorded yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {observations.map((o) => (
                      <li key={o.id} className="border-l-2 border-ground/15 pl-3 text-sm">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-xs font-medium text-olive">
                            {new Date(o.occurredAt).toLocaleDateString()}
                          </span>
                          {/* The source label, always. §14: patient report and
                              clinician observation must display differently. */}
                          <span className="rounded-full bg-linen px-2 py-0.5 text-xs text-olive">
                            {EVIDENCE_LABEL[o.evidenceClass]}
                          </span>
                          {o.status !== "accepted" && (
                            <span className="text-xs text-olive">· {o.status}</span>
                          )}
                        </div>
                        <p className="text-app-ink">
                          {o.observedLevel !== null ? LEVEL_LABEL[o.observedLevel] : "No level recorded"}
                          {o.note ? ` — ${o.note}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel title="What a completed goal means" className="mt-6">
        <p className="measure text-sm text-ground">{COMPLETION_NOTE}</p>
      </Panel>
    </PersonShell>
  );
}
