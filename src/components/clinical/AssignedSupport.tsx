import Link from "next/link";
import { MODULES } from "@/lib/modules";
import { awaitingDecision, type ModuleRequest } from "@/lib/clinical/module-requests";
import {
  assignableSupport, effectiveStatus, isLive, PURPOSES, LINKABLE_GOAL_STATUSES,
  type SupportAssignment, type AssignmentStatus,
} from "@/lib/clinical/assigned-support";
import type { Goal } from "@/lib/clinical/return-to-life";
import {
  assignSupportAction, changeAssignmentAction, adjustPlanLinkAction,
} from "@/lib/clinical/assignment-actions";

// Assign support, inside Care (17 September handoff, P3).
//
//   "Replace the isolated feel of Module requests with an Assign support action
//   inside Care and relevant clinical contexts."
//
// WHAT THIS SCREEN MUST NOT IMPLY, and the copy carries it at the point of
// action rather than in a footnote: assigning is not opening. The handoff is
// explicit — "do not open restricted content because an assignment row exists.
// Access policy still controls the content request" — and a clinician who
// believes this unlocks something will assign it in order to unlock it. That is
// the same failure as a clinician documenting a response in order to clear a
// gate, one screen over.
//
// THE MODULE NAMES COME FROM THE CATALOG, never from the row: the assignment
// stores a reference, so a module renamed tomorrow renames here too rather than
// leaving a stale title in somebody's plan.

const STATUS_WORD: Record<AssignmentStatus, string> = {
  proposed: "proposed",
  active: "active",
  paused: "paused",
  completed: "completed",
  withdrawn: "withdrawn",
  expired: "expired",
};

function nameOf(supportId: string): string {
  return MODULES.find((m) => m.id === supportId)?.name ?? supportId;
}

/** The plan link, in one place, so the assign form and the change control
 *  cannot end up offering different goals. */
function PlanLinkSelect({ goals, current }: { goals: Goal[]; current: string | null }) {
  return (
    <select
      name="goalId"
      defaultValue={current ?? ""}
      className="rounded-xl border border-ground/20 bg-app-surface px-3 py-1.5 text-sm"
    >
      {/* NOT LINKED IS AN OPTION, not the absence of one. Support is often
          assigned before a goal is agreed, and a required select would make a
          clinician pick something untrue to get past the form. */}
      <option value="">Not working towards a goal</option>
      {goals.map((g) => (
        <option key={g.id} value={g.id}>
          {g.title}
          {g.status === "active" ? "" : ` (${g.status})`}
        </option>
      ))}
    </select>
  );
}

export function AssignedSupport({
  personId, assignments, goals = [], now, idempotencyKey, requests = [],
}: {
  personId: string;
  assignments: SupportAssignment[];
  /** This person's goals. Filtered here to the ones a link may point at, so
   *  the screen cannot offer a draft nobody has confirmed with them. */
  goals?: Goal[];
  now: Date;
  /** Minted when this form is drawn, so a double submit is one assignment. */
  idempotencyKey: string;
  /** What this person has asked to open. The other half of the conversation:
   *  the clinician's ask is above, theirs is below, and until now theirs lived
   *  on a screen this record never mentioned. */
  requests?: ModuleRequest[];
}) {
  const waiting = awaitingDecision(requests);
  const live = assignments.filter((a) => isLive(a, now));
  const linkable = goals.filter((g) =>
    (LINKABLE_GOAL_STATUSES as readonly string[]).includes(g.status)
  );
  const goalTitle = (id: string | null) =>
    id ? (goals.find((g) => g.id === id)?.title ?? null) : null;
  const past = assignments.filter((a) => !isLive(a, now));

  return (
    <section aria-labelledby="support" className="mt-8">
      <h2 id="support" className="type-display text-xl font-medium text-ground">
        Assigned support <span className="text-base font-normal text-olive">({live.length})</span>
      </h2>
      <p className="mt-1 measure text-sm text-olive">
        What this person has been asked to do between visits, and why. Assigning does not open
        anything — access is decided by the safety rules at the moment they try, exactly as it
        was before.
      </p>

      {live.length === 0 ? (
        <p className="mt-3 measure text-sm text-ground">
          Nothing is assigned. That is a state, not a gap: between-visit support is a choice, and
          a person with none has not been overlooked by this screen.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {live.map((a) => (
            <li key={a.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ground">{nameOf(a.supportId)}</p>
                <p className="text-xs text-olive">
                  {a.availability === "assigned" ? "Asked to do" : "Offered as optional"}
                  {" · "}{STATUS_WORD[effectiveStatus(a, now)]}
                </p>
              </div>
              <p className="mt-1 text-sm text-ground/90">
                {PURPOSES[a.purposeCode as keyof typeof PURPOSES] ?? a.purposeCode}
              </p>
              {/* THE WORDS THE PERSON READS, shown to the clinician who wrote
                  them. A clinician reviewing an assignment should see what was
                  actually said rather than a summary of it. */}
              <p className="mt-2 measure rounded-2xl bg-app-surface px-3 py-2 text-sm text-app-ink">
                “{a.patientExplanation}”
              </p>
              {/* WHAT IT IS FOR, beside what kind of thing it is. The purpose
                  code above says "practising a skill already introduced in
                  session"; this says which of the person's own goals that
                  practice is meant to move, and five assignments can share the
                  first and differ in the second. */}
              <p className="mt-2 text-sm text-ground/90">
                {a.goalId
                  ? goalTitle(a.goalId)
                    ? `Working towards: ${goalTitle(a.goalId)}`
                    : "Linked to a goal that is not on this screen."
                  : "Not linked to a goal."}
              </p>
              <p className="mt-2 text-xs text-olive">
                Assigned {a.startsAt.slice(0, 10)}
                {a.expiresAt ? ` · runs out ${a.expiresAt.slice(0, 10)}` : " · no end date"}
                {a.reviewAt ? ` · review ${a.reviewAt.slice(0, 10)}` : ""}
                {" · under "}{a.policyVersion}
              </p>

              {/* CHANGING THE LINK IS ITS OWN CONTROL and its own record. It
                  is not a state change: the person is still being asked to do
                  this, and what has moved is what it is for. Submitting the
                  same link again is refused rather than ignored, because a
                  care-time record of an adjustment that did not happen is
                  worse than no record of one that did. */}
              <form
                action={adjustPlanLinkAction}
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="personId" value={personId} />
                <input type="hidden" name="assignmentId" value={a.id} />
                <label className="text-sm text-olive">
                  <span className="mr-2">Working towards</span>
                  <PlanLinkSelect goals={linkable} current={a.goalId} />
                </label>
                <button className="rounded-full border border-ground/25 px-4 py-1.5 text-sm text-ground hover:bg-ground/5">
                  Save link
                </button>
              </form>

              <div className="mt-3 flex flex-wrap gap-3">
                <form action={changeAssignmentAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="personId" value={personId} />
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <input type="hidden" name="to" value="completed" />
                  <button className="rounded-full border border-ground/25 px-4 py-1.5 text-sm text-ground hover:bg-ground/5">
                    Mark completed
                  </button>
                </form>
                {/* WITHDRAWING NEEDS A REASON and completing does not.
                    Completing says they did it; withdrawing takes back
                    something a person was told to do, and somebody who opens
                    their plan to find it gone is owed the reason. */}
                <form action={changeAssignmentAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="personId" value={personId} />
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <input type="hidden" name="to" value="withdrawn" />
                  <input
                    name="note"
                    required
                    minLength={8}
                    placeholder="Why this is being withdrawn"
                    className="rounded-xl border border-ground/20 bg-app-surface px-3 py-1.5 text-sm"
                  />
                  <button className="rounded-full border border-ground/25 px-4 py-1.5 text-sm text-ground hover:bg-ground/5">
                    Withdraw
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* WHAT THEY ASKED FOR, beside what was asked of them. The handoff's
          complaint about module requests is the isolation, not the screen:
          /clinician/unlocks answers a request properly and is the only place in
          the product that knows it exists. The decision stays there — a reason
          is required and the person reads it back — and this says the request
          is waiting rather than growing a second way to answer it. */}
      {waiting.length > 0 && (
        <div className="mt-4 rounded-2xl border border-state-caution/40 bg-state-caution-bg/40 p-4">
          <p className="text-sm font-medium text-ground">
            {waiting.length === 1
              ? "This person has asked to open a module"
              : `This person has asked to open ${waiting.length} modules`}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {waiting.map((r) => (
              <li key={r.id}>
                <span className="font-medium text-ground">{nameOf(r.moduleId)}</span>
                <span className="text-olive"> — asked {r.requestedAt.slice(0, 10)}</span>
                {/* Their own words, not a summary of them. */}
                {r.note && <span className="measure block text-xs text-olive">“{r.note}”</span>}
              </li>
            ))}
          </ul>
          <Link
            href="/clinician/unlocks"
            className="mt-2 inline-block text-sm text-state-info underline"
          >
            Answer it, with a reason they will read
          </Link>
        </div>
      )}

      <details className="mt-4 rounded-2xl border border-ground/15 bg-app-surface px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-ground">
          Assign support
        </summary>
        <form action={assignSupportAction} className="mt-3 space-y-3">
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

          <label className="block text-sm">
            <span className="font-medium text-ground">What</span>
            <select
              name="supportId"
              required
              className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
            >
              {assignableSupport().map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-ground">What for</span>
            <select
              name="purposeCode"
              required
              className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
            >
              {Object.entries(PURPOSES).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-ground">What it is working towards</span>
            <span className="mt-1 block">
              <PlanLinkSelect goals={linkable} current={null} />
            </span>
            <span className="mt-1 block text-xs text-olive">
              {linkable.length === 0
                ? "This person has no confirmed goal yet, so there is nothing to link to. A draft goal is not offered: it is wording nobody has agreed with them."
                : "Their own goal, in their words. It shows on their plan beside this, so they can see what the work is for."}
            </span>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-ground">What they will read</span>
            <textarea
              name="patientExplanation"
              required
              minLength={20}
              rows={3}
              placeholder="In their words: what this is, and what it is for."
              className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-olive">
              Stored with the assignment as written. It is the only part of this the person
              experiences, and it is kept so a later reader sees what was said at the time
              rather than today&rsquo;s wording.
            </span>
          </label>

          <fieldset className="text-sm">
            <legend className="font-medium text-ground">How firmly</legend>
            <label className="mt-1 flex items-center gap-2">
              <input type="radio" name="availability" value="assigned" defaultChecked />
              <span>Asked to do it</span>
            </label>
            <label className="mt-1 flex items-center gap-2">
              <input type="radio" name="availability" value="optional" />
              <span>Offered, entirely optional</span>
            </label>
          </fieldset>

          <label className="block text-sm">
            <span className="font-medium text-ground">Runs out on (optional)</span>
            <input
              type="date"
              name="expiresAt"
              className="mt-1 rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
            />
          </label>

          <p className="measure text-xs text-olive">
            This records what you are asking for. It does not unlock anything, and it does not
            notify anyone — the person sees it when they next open Steady.
          </p>
          <button className="rounded-full bg-app-ink px-5 py-2 text-sm font-medium text-app-surface hover:opacity-90">
            Assign
          </button>
        </form>
      </details>

      {past.length > 0 && (
        <details className="mt-3 rounded-2xl border border-ground/15 bg-app-surface px-4 py-3">
          <summary className="cursor-pointer text-sm text-olive">
            Finished and withdrawn ({past.length})
          </summary>
          <ul className="mt-2 space-y-2 text-sm">
            {past.map((a) => (
              <li key={a.id} className="text-ground/90">
                <span className="font-medium">{nameOf(a.supportId)}</span>
                <span className="text-olive">
                  {" — "}{STATUS_WORD[effectiveStatus(a, now)]}
                  {a.decidedAt ? ` ${a.decidedAt.slice(0, 10)}` : ""}
                  {a.decidedNote ? ` · ${a.decidedNote}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
