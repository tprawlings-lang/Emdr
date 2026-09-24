import { data } from "../data";
import type { TenantContext } from "../repository";
import { getProgramPlan } from "../program-plan";
import { listGoals, type Goal } from "./return-to-life";
import { MODULES } from "../modules";
import { activePolicy } from "../clinical-policy";
import { deliveryNotice } from "../notify/delivery";
import {
  assignmentsFor, effectiveStatus, isLive, PURPOSES,
  type SupportAssignment, type AssignmentStatus,
} from "./assigned-support";

// The shared between-visit plan (17 September handoff, P3).
//
//   "The plan is ONE READ MODEL assembled from current care-plan, goal,
//   assignment, session, and safety facts. DO NOT CREATE ANOTHER AUTHORITATIVE
//   PLAN TABLE unless the current domain model cannot express a required fact.
//   Patient and clinician views may use different language, but THEY MUST
//   RESOLVE TO THE SAME SOURCE VERSIONS."
//
// THE FAILURE THIS IS SHAPED AGAINST is two views of one plan becoming two
// plans. It is the ordinary way a shared plan goes wrong: a patient screen and
// a clinician screen are written months apart, each assembles what it needs
// from whatever it can reach, and by the time anybody compares them the two
// people in the room are reading different documents and neither knows. The
// clinician says "you agreed to do the container practice"; the app never told
// them that, and both are certain.
//
// SO A FIELD IS ONE THING WITH TWO RENDERINGS, not two things. Every field
// below carries its sources ONCE and both wordings beside them, so a view
// cannot cite evidence the other view does not have — there is nothing for it
// to cite from. `patientPlan` and `clinicianPlan` select a rendering; they do
// not assemble. A test asserts that field by field, because the moment one view
// can reach a source of its own, the two documents have started to drift.
//
// AND IT STORES NOTHING. There is no plan table here and the handoff is
// explicit about not adding one. Every fact is read from where it already
// lives: the care plan, the goals, the assignments, the session rows and the
// safety state. That is what makes the two views the same plan rather than two
// copies that agree today.

/** A thing this plan was assembled from, and the version it was read at. */
export interface PlanSource {
  kind: "care_plan" | "goal" | "assignment" | "session" | "safety";
  id: string;
  /** What the thing was at the time of reading — a policy version, a status. */
  version: string;
  at: string;
}

/**
 * One field: its evidence, and the two ways of saying it.
 *
 * The sources sit on the FIELD rather than on either rendering, which is what
 * makes "both views resolve to the same source versions" structural instead of
 * a rule somebody has to keep.
 */
export interface PlanField<P, C> {
  sources: readonly PlanSource[];
  patient: P;
  clinician: C;
}

/** Whether an assignment's activity is on record. Three states, because two
 *  would make "we do not know" indistinguishable from "they did not". */
export type CompletionState = "recorded" | "not_recorded" | "uncertain";

export interface AssignmentLine {
  assignmentId: string;
  supportName: string;
  completion: CompletionState;
}

export interface BetweenVisitPlan {
  personId: string;
  assembledAt: string;
  /** Every source behind every field, deduplicated — the plan's own provenance. */
  sources: readonly PlanSource[];

  currentFocus: PlanField<
    { focus: string | null; whyItMatters: string | null },
    { focus: string | null; provenance: string }
  >;
  assignedSupport: PlanField<
    Array<{
      what: string; purpose: string;
      /** The goal this is working towards, in the person's own words. */
      towards: string | null;
      timing: string; expected: string;
    }>,
    Array<{
      what: string; rationale: string;
      /** The goal this is working towards, with its state. */
      towards: string | null;
      /** Said only when the link points at a goal that cannot be read. */
      linkNote: string | null;
      authority: string;
      expires: string | null; review: string | null; status: AssignmentStatus;
    }>
  >;
  completion: PlanField<
    Array<{ what: string; said: string }>,
    Array<{ what: string; state: CompletionState; source: string; meaning: string }>
  >;
  patientReport: PlanField<
    { preview: string; shared: boolean },
    { available: boolean; note: string }
  >;
  nextReview: PlanField<
    { on: string | null; who: string },
    { on: string | null; owner: string; queueState: string; evidenceRequired: string }
  >;
  supportPath: PlanField<
    { route: string },
    { delivery: string; coverage: string; responsePolicy: string }
  >;
}

function uniqueSources(fields: Array<PlanField<unknown, unknown>>): PlanSource[] {
  const seen = new Map<string, PlanSource>();
  for (const f of fields) {
    for (const s of f.sources) seen.set(`${s.kind}:${s.id}:${s.version}`, s);
  }
  return [...seen.values()];
}

function nameOf(supportId: string): string {
  return MODULES.find((m) => m.id === supportId)?.name ?? supportId;
}

/** The focus, from the goal the person themselves stated. */
function focusFrom(goals: Goal[]): Goal | null {
  // The first ACTIVE goal, and active rather than newest on purpose: a draft
  // goal is something a clinician is still writing, and putting it in front of
  // the person as their focus would show them a decision nobody has made.
  return goals.find((g) => g.status === "active") ?? null;
}

/**
 * Assemble the plan.
 *
 * Reads, and nothing else. A read that wrote would make opening somebody's plan
 * an event in their record.
 */
export async function buildBetweenVisitPlan(
  ctx: TenantContext,
  personId: string,
  now: Date
): Promise<BetweenVisitPlan> {
  const policy = activePolicy();
  const c = await data();
  const [planRow, goals, assignments] = await Promise.all([
    getProgramPlan(personId),
    // EVERY STATUS, not just the two the focus needs. A plan link may point at
    // a paused or completed goal — "holding gains after the main work" is a
    // purpose the product offers — and a reader that loaded only active and
    // draft goals would show a linked assignment as linked to nothing, which
    // is the one thing worse than showing no link at all. `focusFrom` still
    // picks the first ACTIVE goal, so the focus is unchanged by this.
    listGoals(ctx, personId, ["active", "draft", "paused", "completed", "archived"]),
    assignmentsFor(ctx, personId),
  ]);
  const live = assignments.filter((a) => isLive(a, now));

  // Sessions for the assigned modules, so completion is read from what
  // happened rather than asserted from the assignment existing.
  const moduleIds = [...new Set(live.map((a) => a.supportId))];
  const sessions = moduleIds.length
    ? ((await c.all(
        `SELECT id, module_id, status, started_at, ended_at FROM therapy_sessions
          WHERE user_id = ? AND module_id IN (${moduleIds.map(() => "?").join(",")})
          ORDER BY started_at DESC`,
        [personId, ...moduleIds]
      )) as Array<{ id: string; module_id: string; status: string; started_at: string; ended_at: string | null }>)
    : [];

  const goal = focusFrom(goals);
  const goalSource: PlanSource[] = goal
    ? [{ kind: "goal", id: goal.id, version: goal.status, at: goal.updatedAt }]
    : [];
  const planSource: PlanSource[] = planRow
    ? [{ kind: "care_plan", id: planRow.id, version: planRow.generated_by, at: planRow.created_at }]
    : [];

  const currentFocus: BetweenVisitPlan["currentFocus"] = {
    sources: [...goalSource, ...planSource],
    patient: {
      // THE PERSON'S OWN WORDS, not the clinical title. A focus paraphrased
      // into clinical language stops being the thing they said they wanted.
      focus: goal?.patientStatement ?? null,
      whyItMatters: goal?.whyItMatters ?? null,
    },
    clinician: {
      focus: goal ? `${goal.title} (${goal.domain})` : null,
      provenance: goal
        ? `Goal ${goal.id.slice(0, 8)}, ${goal.status}, ${goal.confirmedAt ? `confirmed ${goal.confirmedAt.slice(0, 10)}` : "not confirmed with the person"}.`
        : planRow
          ? `No goal is recorded. The care plan of ${planRow.created_at.slice(0, 10)} is the only statement of focus, and it was ${planRow.generated_by === "ai" ? "drafted by the assistant" : "produced by rules"}.`
          : "Nothing on this record states a focus.",
    },
  };

  const assignmentSources = (a: SupportAssignment): PlanSource => ({
    kind: "assignment", id: a.id, version: a.policyVersion, at: a.startsAt,
  });

  // THE PLAN LINK, AND WHY IT IS RESOLVED HERE. Before this, the plan showed a
  // person what they said they wanted and, underneath, a list of what they had
  // been asked to do, with nothing joining the two. A clinician held the join
  // in their head; the plan did not have it, so the next person to open the
  // record had to infer it and the person themselves was never told.
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const linkOf = (a: SupportAssignment): Goal | null =>
    (a.goalId ? goalById.get(a.goalId) : undefined) ?? null;

  const assignedSupport: BetweenVisitPlan["assignedSupport"] = {
    // THE LINKED GOALS ARE SOURCES OF THIS FIELD, not of the focus field only.
    // The rule this module is built on is that both renderings cite the same
    // sources, and a clinician column that named a goal the patient column
    // could not trace would be the first crack in it.
    sources: [
      ...live.map(assignmentSources),
      ...live
        .map(linkOf)
        .filter((g): g is Goal => g !== null)
        .map((g) => ({ kind: "goal" as const, id: g.id, version: g.status, at: g.updatedAt })),
    ],
    patient: live.map((a) => {
      const g = linkOf(a);
      return {
        what: nameOf(a.supportId),
        // The words a clinician wrote FOR THEM, stored with the assignment.
        purpose: a.patientExplanation,
        // THEIR OWN WORDS AGAIN, for the same reason the focus uses them: a
        // goal paraphrased into the clinical title stops being the thing they
        // said they wanted, and this line's whole value is that it is theirs.
        towards: g ? g.patientStatement : null,
        timing: a.expiresAt ? `Until ${a.expiresAt.slice(0, 10)}` : "No end date",
        expected: a.availability === "assigned" ? "Asked to do" : "Entirely optional",
      };
    }),
    clinician: live.map((a) => {
      const g = linkOf(a);
      return {
        what: nameOf(a.supportId),
        rationale: PURPOSES[a.purposeCode as keyof typeof PURPOSES] ?? a.purposeCode,
        // THE GOAL'S STATE TRAVELS WITH IT. Support can be linked to a paused or
        // completed goal on purpose, and a clinician reading "working towards X"
        // with no state would read a finished goal as a live one.
        towards: g ? `${g.title} (${g.status})` : null,
        // A LINK THAT POINTS AT NOTHING IS NOT THE SAME AS NO LINK, and this is
        // the only place that can tell the difference: a goal id on the
        // assignment that no goal answers means the goal was deleted under it.
        linkNote:
          a.goalId && !g
            ? "This is linked to a goal that can no longer be read. The link is on the record; the goal is not."
            : null,
        authority: `Assigned by ${a.assignedBy.slice(0, 8)} under ${a.policyVersion}. Assigning does not open it.`,
        expires: a.expiresAt,
        review: a.reviewAt,
        status: effectiveStatus(a, now),
      };
    }),
  };

  // COMPLETION, READ FROM SESSIONS. `support.activity.completed` is not written
  // anywhere yet, and the handoff forbids writing it "when the activity write
  // remains uncertain" — so completion is derived from what the session rows
  // say, and the uncertain case is a real one rather than a placeholder: a
  // session that started for this module after the assignment and never
  // recorded an ending is exactly "we do not know".
  const completionFor = (a: SupportAssignment): { state: CompletionState; sessionId: string | null } => {
    const mine = sessions.filter((s) => s.module_id === a.supportId && s.started_at >= a.startsAt);
    const done = mine.find((s) => s.status === "completed");
    if (done) return { state: "recorded", sessionId: done.id };
    const hanging = mine.find((s) => s.status === "in_progress" && !s.ended_at);
    if (hanging) return { state: "uncertain", sessionId: hanging.id };
    return { state: "not_recorded", sessionId: null };
  };

  const completions = live.map((a) => ({ a, ...completionFor(a) }));
  const SAID: Record<CompletionState, string> = {
    recorded: "Recorded as done.",
    not_recorded: "Not recorded yet. That is not a judgement — it only means nothing has been written down.",
    uncertain: "Started, and Steady did not record how it ended. Nothing is being assumed either way.",
  };
  const MEANING: Record<CompletionState, string> = {
    recorded: "A session row for this module reached 'completed' after the assignment began.",
    not_recorded: "No session row exists for this module since the assignment began. Absence of a record, not evidence of non-use.",
    uncertain: "A session started and never wrote an ending. The write outcome is unknown; do not read it as either.",
  };

  const completion: BetweenVisitPlan["completion"] = {
    sources: completions.flatMap(({ a, sessionId }) => [
      assignmentSources(a),
      ...(sessionId ? [{ kind: "session" as const, id: sessionId, version: "therapy_sessions", at: a.startsAt }] : []),
    ]),
    patient: completions.map(({ a, state }) => ({
      what: nameOf(a.supportId), said: SAID[state],
    })),
    clinician: completions.map(({ a, state, sessionId }) => ({
      what: nameOf(a.supportId),
      state,
      source: sessionId ? `therapy_sessions ${sessionId.slice(0, 8)}` : "no session row",
      meaning: MEANING[state],
    })),
  };

  // THE REPORT IS A PREVIEW UNTIL SOMEBODY AUTHORISES IT. Nothing in this build
  // shares a report, so the patient side is what they WOULD see and the
  // clinician side says plainly that no sharing has happened.
  const patientReport: BetweenVisitPlan["patientReport"] = {
    sources: [...goalSource, ...live.map(assignmentSources)],
    patient: {
      preview:
        "This is what your clinician can see about the plan you agreed. Nothing here has been " +
        "sent anywhere, and nothing is shared outside your care team.",
      shared: false,
    },
    clinician: {
      available: false,
      note:
        "No authorised sharing has taken place. A report exists as a preview only; there is no " +
        "route in this build that sends one, so nothing here may be described as shared.",
    },
  };

  const reviewGoal = goal?.targetReviewDate ?? null;
  const reviewAssignment = live.map((a) => a.reviewAt).filter((x): x is string => !!x).sort()[0] ?? null;
  const nextOn = [reviewGoal, reviewAssignment].filter((x): x is string => !!x).sort()[0] ?? null;

  const nextReview: BetweenVisitPlan["nextReview"] = {
    sources: [...goalSource, ...live.filter((a) => a.reviewAt).map(assignmentSources)],
    patient: {
      on: nextOn,
      who: "Your clinician. You do not need to do anything to arrange it.",
    },
    clinician: {
      on: nextOn,
      owner: "The accountable clinician on this record.",
      queueState: nextOn
        ? "A review date exists on the record; it does not itself create a queue item."
        : "No review date is set, so nothing will surface this as due.",
      evidenceRequired: live.length
        ? "Completion state for each assignment, and whether the words the person was given still describe the plan."
        : "Nothing is assigned, so a review here is about the focus rather than about support.",
    },
  };

  // The safety route. Read from the delivery module rather than described, so
  // this screen cannot claim an escalation path the product does not have.
  const supportPath: BetweenVisitPlan["supportPath"] = {
    sources: [{ kind: "safety", id: "escalation-channel", version: policy.version, at: policy.version }],
    patient: {
      route:
        "If you need help now, use the support options in the app. They do not depend on anybody " +
        "reading a message.",
    },
    clinician: {
      delivery: deliveryNotice({ state: "not_configured" }),
      coverage: `Caseload model: ${policy.caseload}.`,
      responsePolicy:
        "No response time can be promised for anything raised through the plan, because nothing " +
        "raised here reaches a person automatically.",
    },
  };

  const fields = [
    currentFocus, assignedSupport, completion, patientReport, nextReview, supportPath,
  ] as Array<PlanField<unknown, unknown>>;

  return {
    personId,
    assembledAt: now.toISOString().replace("T", " ").slice(0, 19),
    sources: uniqueSources(fields),
    currentFocus, assignedSupport, completion, patientReport, nextReview, supportPath,
  };
}

/** The field names, so a view cannot quietly render five of six. */
export const PLAN_FIELDS = [
  "currentFocus", "assignedSupport", "completion", "patientReport", "nextReview", "supportPath",
] as const;
export type PlanFieldName = (typeof PLAN_FIELDS)[number];

/**
 * The two views.
 *
 * SELECTION, NOT ASSEMBLY. Each takes the plan and picks a rendering; neither
 * reads a database, computes a fact or reaches a source the other cannot. That
 * is the whole mechanism by which the two people in the room are looking at one
 * document, and it is why these are four lines rather than two screens.
 */
export function patientPlan(p: BetweenVisitPlan) {
  return Object.fromEntries(
    PLAN_FIELDS.map((f) => [f, { value: p[f].patient, sources: p[f].sources }])
  ) as { [K in PlanFieldName]: { value: BetweenVisitPlan[K]["patient"]; sources: readonly PlanSource[] } };
}

export function clinicianPlan(p: BetweenVisitPlan) {
  return Object.fromEntries(
    PLAN_FIELDS.map((f) => [f, { value: p[f].clinician, sources: p[f].sources }])
  ) as { [K in PlanFieldName]: { value: BetweenVisitPlan[K]["clinician"]; sources: readonly PlanSource[] } };
}
