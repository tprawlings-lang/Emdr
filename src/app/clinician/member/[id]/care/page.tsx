import { notFound } from "next/navigation";
import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { PersonSummary } from "@/components/experience/templates";
import { EmptyState } from "@/components/clinical/primitives";
import { getProgramPlan } from "@/lib/program-plan";
import { listGoals } from "@/lib/clinical/return-to-life";
import { handoffsForPerson, isOpen } from "@/lib/clinical/handoff";
import type { TenantContext } from "@/lib/repository";
import { randomUUID } from "node:crypto";
import { readingFrame } from "@/lib/clock";
import { assignmentsFor } from "@/lib/clinical/assigned-support";
import { moduleRequestsFor } from "@/lib/clinical/module-requests";
import { AssignedSupport } from "@/components/clinical/AssignedSupport";
import { LANE_MODULES, laneVisibility } from "@/lib/assigned-lane";
import { assignmentFor, assignmentHistory } from "@/lib/clinical/caseload-assignment";
import { assignCaseloadAction } from "@/lib/clinical/assignment-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Care — Steady Clinical" };

// Care: what is active for this person and who is accountable for it.
//
// THE 17 SEPTEMBER AMENDMENT ADDS THIS SECTION, and names what it owns: "Care
// plan, goals, assigned support, and handoffs." Its opening question is "what
// plan and between-visit support are active", against Course's "what has been
// observed over time".
//
// THE SPLIT IS SET AND READ, and it is the reason goals moved. Goals were
// under Course, beside measures and trajectory, which are things a clinician
// READS. A goal is something they SET — with the person, in words the person
// chose — and the amendment says so directly: "keep goals in Care as the
// working location and allow Course to show a read-only progress summary that
// links back to the goal." Nothing moved address; what moved is which question
// leads to it.
//
// HANDOFFS ARE SHOWN HERE RATHER THAN LINKED. /clinician/handoffs answers
// "what is waiting for ME", which is a queue. The question on a person's
// record is "who is accountable for THIS person", and the amendment's
// requirement is the same either way: "Show pending ownership and recipient
// acceptance. There is no responsibility gap." A proposal that nobody has
// accepted is exactly the gap, so it is stated in place rather than counted
// somewhere else.
//
// ASSIGNED SUPPORT IS THE FOURTH THING, and it is a command now rather than a
// sentence saying it does not exist. It sits here — "inside Care and relevant
// clinical contexts" — and it is a presentation and workflow change over the
// authority that was already there: assigning records what a clinician is
// asking for, and the safety rules still decide access at the moment the person
// tries. Nothing on this screen opens anything.

/** One sentence for what is active, from the record rather than from a phrase. */
function activeStatement(
  plan: { created_at: string } | null, goals: number, pendingHandoffs: number
): string {
  const parts: string[] = [];
  parts.push(plan ? `A care plan was drafted ${plan.created_at.slice(0, 10)}` : "No care plan has been drafted");
  parts.push(goals === 0 ? "no goals are recorded" : `${goals} goal${goals === 1 ? " is" : "s are"} recorded`);
  parts.push(
    pendingHandoffs === 0
      ? "and no transfer of accountability is in progress"
      : `and ${pendingHandoffs} transfer${pendingHandoffs === 1 ? "" : "s"} of accountability ${pendingHandoffs === 1 ? "is" : "are"} waiting for an answer`
  );
  return `${parts.join(", ")}.`;
}

/** What this screen does not know. Absence as a named state, never a blank. */
function missingFor(plan: unknown, goals: number, assignments: number): string[] {
  const missing: string[] = [];
  if (!plan) missing.push("a care plan, which nobody has drafted");
  if (goals === 0) {
    missing.push(
      "what this person is trying to get back to — a person with no goal is not a person doing badly, it is a conversation that has not happened"
    );
  }
  // THIS USED TO SAY "because assigned support is not built", unconditionally,
  // directly above a working Assigned support panel with a working Assign
  // control. It was true when it was written and stopped being true when the
  // feature landed — a screen telling a clinician a feature does not exist
  // while the feature sits under it. Nothing is missing when something is
  // assigned, and when nothing is, the panel below says so in its own words.
  if (assignments === 0) {
    missing.push("what between-visit support is assigned, because none has been");
  }
  return missing;
}

export default async function MemberCarePage({
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

  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!header) notFound();

  const ctx: TenantContext = { tenantId, personId: clinician.id };
  const frame = await readingFrame();
  const [planRow, goals, assignments, requests] = await Promise.all([
    getProgramPlan(id),
    listGoals(ctx, id, ["draft", "active", "paused", "completed"]),
    assignmentsFor(ctx, id),
    // What they have asked for, beside what was asked of them. Until now the
    // request half of that conversation lived only on /clinician/unlocks, which
    // is not in navigation and which a person's own record never mentioned.
    moduleRequestsFor(ctx, id),
  ]);

  // MINTED WHEN THE FORM IS DRAWN, not when it is submitted. Re-posting the
  // same rendered form — a double click, the browser's "resend?" after a
  // refresh — carries this same key and produces one assignment; a key
  // generated inside the action would be new every time, which is the failure
  // the key exists to prevent.
  //
  // RANDOM PER RENDER, AND NOT DERIVED FROM THE REQUEST. A key hashed from
  // tenant, person, clinician and the minute looked tidier and was wrong: a
  // clinician assigning two different things inside one minute would submit the
  // same key twice, and the second assignment would be silently answered with
  // the first. Deduplicating two distinct instructions is worse than the
  // duplicate this is here to stop.
  const assignKey = randomUUID();
  // Handoff 10 Phase 3: clinician-assigned practices, where visible (live, or
  // drafts in the demo).
  const laneModules = (await Promise.all(LANE_MODULES.map(async (m) => ({ module: m, v: await laneVisibility(m) }))))
    .filter((x) => x.v !== "absent").map((x) => ({ module: x.module, draft: x.v === "draft" }));
  const handoffs = handoffsForPerson({ personId: id, tenantId });
  const [assignment, history] = await Promise.all([
    assignmentFor(tenantId, id),
    assignmentHistory(tenantId, id),
  ]);
  // Who work could be assigned to. READ FROM ROLE ASSIGNMENTS, NOT FROM
  // ACCOUNTS — eleven of the twelve fabricated clinicians are persons with a
  // role and no login, and being able to sign in was never a condition of
  // holding a caseload. DISTINCT, because a clinician with two role rows
  // appeared twice in the list on the queue's own Assign control.
  const assignees = (await c.all(
    `SELECT DISTINCT ra.person_id AS id, p.display_name AS name
       FROM role_assignments ra
       JOIN persons p ON p.id = ra.person_id
      WHERE ra.tenant_id = ?
        AND ra.role IN ('clinician', 'care_manager')
        AND ra.person_id != ?
        AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_TIMESTAMP)
      ORDER BY p.display_name LIMIT 24`,
    [tenantId, id]
  )) as Array<{ id: string; name: string }>;
  const pending = handoffs.filter((h) => isOpen(h.state));

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "person_care_opened", target: id,
    detail: { goals: goals.length, pendingHandoffs: pending.length },
  });

  return (
    <PersonShell person={header} active="/care" title="Care">
      {/* The status contract, from the template rather than assembled here.
          The amendment asks every destination to open with "a concise status
          statement, one primary action when work exists, the reason for the
          status, evidence freshness, missing information, ownership, and any
          real due state" — seven things, which is exactly the list a screen
          written in a hurry gets five of. PersonSummary's type carries all
          seven, so this page supplies them or does not compile.

          NO DUE STATE IS PASSED, and that is the type doing its job: `due`
          carries the deadline AND the policy that created it, and no policy in
          this build puts a deadline on a care plan. A screen that wanted an
          urgent-looking date here would have to name a rule that does not
          exist. */}
      <PersonSummary
        status={{
          statement: activeStatement(planRow, goals.length, pending.length),
          reason:
            "Assembled from what is on the record — the latest plan draft, the goals with an open status, and any transfer nobody has answered. Nothing here is computed from a model.",
          missing: missingFor(planRow, goals.length, assignments.length),
          primaryAction: pending.length
            ? { href: "/clinician/handoffs", label: "Answer the transfer" }
            : goals.length === 0
              ? { href: `/clinician/member/${id}/goals`, label: "Record a first goal" }
              : undefined,
        }}
      />

      {/* Assigned support, the fourth thing this section owns. It said "not
          built" until P3; the command is here now, inside Care and over the
          existing authority rather than beside it. */}
      <AssignedSupport
        personId={id}
        assignments={assignments}
        goals={goals}
        now={frame.now}
        idempotencyKey={assignKey}
        requests={requests}
        laneModules={laneModules}
      />

      <section aria-labelledby="work" className="mt-8">
        <h2 id="work" className="type-display text-xl font-medium text-ground">
          The working screens
        </h2>
        <ul className="mt-3 space-y-3">
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link
              href={`/clinician/member/${id}/plan`}
              className="font-medium text-app-ink hover:underline"
            >
              Care plan
            </Link>
            <p className="mt-1 text-sm text-ground/90">
              The active paths and the suggested programme, with the authority each carries.
              The member reads the same status labels.
            </p>
          </li>
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link
              href={`/clinician/member/${id}/goals`}
              className="font-medium text-app-ink hover:underline"
            >
              Life goals
            </Link>
            <p className="mt-1 text-sm text-ground/90">
              What this person is trying to get back to, in their words, with the evidence
              behind each step and its source. Course shows whether it is moving.
            </p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="handoffs" className="mt-8">
        <h2 id="handoffs" className="type-display text-xl font-medium text-ground">
          Accountability
        </h2>

        {/* WHO HOLDS THIS PERSON. Until this existed the section could only
            propose a HANDOFF — a transfer between two people — which is not the
            same as saying who holds somebody in the first place, and which
            nobody could do because nobody held anybody: the field behind it was
            derived from module-unlock decisions, so all 250 members read
            unassigned. */}
        <div className="mt-3 rounded-3xl border border-ground/10 bg-app-surface p-5">
          <p className="text-sm">
            {assignment ? (
              <>
                <span className="text-olive">Clinician: </span>
                <strong className="text-app-ink">{assignment.clinicianName ?? assignment.clinicianPersonId}</strong>
                <span className="text-olive"> since {assignment.startedAt.slice(0, 10)}</span>
              </>
            ) : (
              <span className="text-olive">
                Nobody is assigned to this person. That is a real state rather than a gap in the
                record, and it is counted on the Command Center.
              </span>
            )}
          </p>

          {assignees.length === 0 ? (
            <p className="measure mt-2 text-xs text-olive">
              No clinician in this tenant holds a current role assignment, so there is nobody to
              assign to.
            </p>
          ) : (
            <form action={assignCaseloadAction} className="mt-4 space-y-3">
              <input type="hidden" name="personId" value={id} />
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="text-sm">
                  <span className="mb-1 block text-olive">Assign to</span>
                  <select
                    name="clinician_person_id"
                    required
                    defaultValue={assignment?.clinicianPersonId ?? ""}
                    className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2"
                  >
                    <option value="">Choose…</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                    {/* A REAL OPTION, NOT AN EMPTY SELECTION. Leaving somebody
                        unassigned is a decision and needs a reason; an empty
                        dropdown would record it as a mistake. */}
                    <option value="__none__">Nobody — leave unassigned</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-olive">Reason (required to unassign)</span>
                  <input
                    name="reason"
                    maxLength={500}
                    className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="rounded-full bg-ground px-4 py-2 text-sm font-medium text-ivory"
              >
                Record assignment
              </button>
              <p className="measure text-xs text-olive">
                Nobody is notified — there is no delivery path in this build. This records who is
                accountable; it does not change who may act, which the caseload model decides.
              </p>
            </form>
          )}

          {history.length > 1 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-olive">
                Who held this person before ({history.length - 1})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-olive">
                {history.slice(1).map((h) => (
                  <li key={h.id}>
                    {h.clinicianName ?? h.clinicianPersonId} — {h.startedAt.slice(0, 10)} to{" "}
                    {h.endedAt?.slice(0, 10) ?? "—"}
                    {h.endedReason ? ` (${h.endedReason})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {handoffs.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              kind="clear"
              title="No transfer has been proposed"
              detail={
                header.ownerName
                  ? `${header.ownerName} remains accountable for this record.`
                  : "Nobody is recorded as accountable for this record. That is a gap rather than a clear state."
              }
              action={{ href: "/clinician/handoffs", label: "Propose a handoff" }}
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {handoffs.map((h) => (
              <li key={h.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ground">
                    {h.fromName} &rarr; {h.toName}
                  </p>
                  <p className="text-xs font-medium text-olive">
                    {h.state === "proposed" ? "Awaiting acceptance" : h.state}
                  </p>
                </div>
                <p className="mt-1 text-sm text-ground/90">{h.reason}</p>
                <p className="mt-2 text-xs text-olive">
                  Proposed {h.createdAt.slice(0, 16)}
                  {h.decidedAt ? ` · answered ${h.decidedAt.slice(0, 16)}` : ""}
                  {/* The amendment's rule, stated where it applies: "A transfer
                      proposal must not transfer responsibility." */}
                  {h.state === "proposed"
                    ? ` · ${h.fromName} is still accountable until ${h.toName} accepts.`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-olive">
          Nothing notifies the recipient of a proposal in this build. A proposal waits until the
          other clinician opens their own handoff queue.
        </p>
      </section>
    </PersonShell>
  );
}
