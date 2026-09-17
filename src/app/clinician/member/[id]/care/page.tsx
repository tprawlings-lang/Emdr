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
// ASSIGNED SUPPORT IS NAMED AND NOT OFFERED. It is the fourth thing the
// amendment puts in Care and it is a P3 command with its own authority,
// version and expiry rules — none of which exist yet. This says so in a
// sentence with no control beside it. §1.1 keeps an unbuilt capability out of
// NAVIGATION; a section that owns it saying plainly that it is not built is
// the opposite failure mode from a button that does nothing.

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
function missingFor(plan: unknown, goals: number): string[] {
  const missing: string[] = [];
  if (!plan) missing.push("a care plan, which nobody has drafted");
  if (goals === 0) {
    missing.push(
      "what this person is trying to get back to — a person with no goal is not a person doing badly, it is a conversation that has not happened"
    );
  }
  missing.push("what between-visit support is assigned, because assigned support is not built");
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
  const [planRow, goals] = await Promise.all([
    getProgramPlan(id),
    listGoals(ctx, id, ["draft", "active", "paused", "completed"]),
  ]);
  const handoffs = handoffsForPerson({ personId: id, tenantId });
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
          missing: missingFor(planRow, goals.length),
          primaryAction: pending.length
            ? { href: "/clinician/handoffs", label: "Answer the transfer" }
            : goals.length === 0
              ? { href: `/clinician/member/${id}/goals`, label: "Record a first goal" }
              : undefined,
        }}
      />

      {/* Assigned support: named, with no control beside it. §1.1 keeps an
          unbuilt capability out of NAVIGATION; a section that owns it saying
          plainly that it is not built is the opposite failure from a button
          that does nothing. */}
      <p className="measure mt-4 text-sm text-olive">
        <span className="font-medium text-ground">Assigned support.</span> Not built.
        Between-visit support is assigned through the module request queue today; a
        clinician-initiated assignment with its own purpose, sharing rule and expiry is separate
        work and is not available from this screen.
      </p>

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
