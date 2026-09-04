// Evidence adapters for Return-to-Life goals (handoff 01 §10, Phase 2).
//
// §10's flow has four inlets and they are not equivalent:
//
//   an explicit patient goal check-in  -> accepted patient_reported
//   a clinician recording an observation -> accepted clinician_observed
//   a system event matching a criterion -> system_measured, by policy
//   an AI semantic match -> model_candidate ONLY, human review
//
// The first two arrive accepted because they ARE the report — asking a patient
// to confirm what they just told you, or a clinician to confirm what they just
// wrote, is ceremony. The last arrives proposed because it is a guess. The
// third is the interesting one and the reason this module exists rather than
// the two obvious cases living at their call sites.
//
// WHY A SYSTEM MATCH IS NARROW ON PURPOSE. §10 says "system event maps EXACTLY
// to goal criterion". Not "relates to", not "suggests" — exactly. So the only
// system evidence this module will produce is for a goal check-in the patient
// themselves answered against a specific rung, and everything looser is a
// model candidate. The temptation is to infer function from activity — a
// person who logged a walk must be managing the mobility goal — and that
// inference is precisely the "behavioral signal silently becoming clinical
// fact" the whole program's shared product rule forbids.
//
// SESSION PREP READS THIS, IT DOES NOT COMPUTE IT. The adapter below returns
// what moved, what stalled and what has new evidence, as facts with citations;
// the brief renders them. A Session Prep that derived goal progress itself
// would be a second implementation of the level fold.

import type { TenantContext } from "../repository";
import {
  listGoals, observationsFor, ladderFor, recordObservation, refreshLevel,
  type Goal, type GoalLevel, type GoalObservation, type EvidenceClass,
} from "./return-to-life";
import {
  recordObservationRecorded, recordLevelChanged,
} from "./return-to-life-events";

/** What a patient answered against their own ladder.
 *
 *  ACCEPTED, and patient_reported. The patient is the authority on what they
 *  did; §1 keeps the source separate rather than treating their word as
 *  provisional. */
export async function recordGoalCheckin(
  ctx: TenantContext,
  args: { goalId: string; personId: string; level: GoalLevel; note?: string | null; at: string; checkinId: string }
): Promise<GoalObservation> {
  const obs = await recordObservation(ctx, {
    goalId: args.goalId,
    personId: args.personId,
    observedLevel: args.level,
    evidenceClass: "patient_reported",
    sourceType: "goal_checkin",
    sourceId: args.checkinId,
    occurredAt: args.at,
    note: args.note ?? null,
  });
  await emitAndRefresh(ctx, obs, args.at);
  return obs;
}

/** What a clinician saw. */
export async function recordClinicianObservation(
  ctx: TenantContext,
  args: { goalId: string; personId: string; level: GoalLevel; note?: string | null; at: string; sourceId: string; sourceType?: string }
): Promise<GoalObservation> {
  const obs = await recordObservation(ctx, {
    goalId: args.goalId,
    personId: args.personId,
    observedLevel: args.level,
    evidenceClass: "clinician_observed",
    sourceType: args.sourceType ?? "clinician_note",
    sourceId: args.sourceId,
    occurredAt: args.at,
    note: args.note ?? null,
  });
  await emitAndRefresh(ctx, obs, args.at);
  return obs;
}

/** A model's guess that something relates to a goal.
 *
 *  Proposed, always. The class alone would be enough — `recordObservation`
 *  writes model_candidate as proposed whatever a caller asks — and this
 *  function exists so the CALL SITE reads as a proposal too, rather than
 *  looking identical to the two above. */
export async function proposeModelEvidence(
  ctx: TenantContext,
  args: {
    goalId: string; personId: string; level: GoalLevel | null;
    sourceType: string; sourceId: string; at: string; note?: string | null;
  }
): Promise<GoalObservation> {
  const obs = await recordObservation(ctx, {
    goalId: args.goalId,
    personId: args.personId,
    observedLevel: args.level,
    evidenceClass: "model_candidate",
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    occurredAt: args.at,
    note: args.note ?? null,
  });
  await recordObservationRecorded({
    observationId: obs.id, goalId: obs.goalId, tenantId: ctx.tenantId,
    personId: obs.personId, evidenceClass: obs.evidenceClass,
    observedLevel: obs.observedLevel, sourceType: obs.sourceType,
    sourceId: obs.sourceId, status: obs.status, actorId: null,
  });
  // Deliberately NO refreshLevel. A proposal cannot move anything, and calling
  // the refresh here would be harmless today and exactly the line somebody
  // later "fixes" into an auto-accept.
  return obs;
}

async function emitAndRefresh(ctx: TenantContext, obs: GoalObservation, at: string): Promise<void> {
  await recordObservationRecorded({
    observationId: obs.id, goalId: obs.goalId, tenantId: ctx.tenantId,
    personId: obs.personId, evidenceClass: obs.evidenceClass,
    observedLevel: obs.observedLevel, sourceType: obs.sourceType,
    sourceId: obs.sourceId, status: obs.status, actorId: ctx.personId ?? null,
  });
  const { previous, current, changed } = await refreshLevel(ctx, obs.goalId, at);
  if (changed) {
    await recordLevelChanged({
      goalId: obs.goalId, tenantId: ctx.tenantId, personId: obs.personId,
      previousLevel: previous, currentLevel: current,
      // §3: the observation that caused the change travels with it. Required,
      // not optional — an event that can omit its cause is one that will.
      causedByObservationId: obs.id,
      actorId: ctx.personId ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// The Session Prep adapter
// ---------------------------------------------------------------------------

export type GoalMovement = "moved" | "stalled" | "new_evidence" | "awaiting_review";

export interface GoalContext {
  goal: Goal;
  /** The rung description for the current level, so a brief can say what the
   *  person can actually do rather than printing a number. §9: plain language,
   *  not scoring language. */
  currentDescription: string | null;
  movement: GoalMovement;
  /** Ids of the observations behind this line. Every statement the brief makes
   *  about a goal cites accepted observations (§7's summarize_progress
   *  boundary), and a proposal cites the proposal. */
  citations: string[];
  /** Present for awaiting_review: how many proposals are waiting. */
  pendingCount: number;
  /** Days since the newest accepted evidence, or null when there is none. */
  quietDays: number | null;
}

/** How long without accepted evidence before a goal counts as stalled.
 *
 *  Six weeks: long enough that a cancelled session or a holiday does not read
 *  as a stall, short enough to still be actionable within a course of therapy.
 *  A number, stated, rather than a threshold buried in a comparison. */
export const STALL_DAYS = 42;

/**
 * What each active goal looks like going into a session (§9's "Life goals"
 * section: "what moved, stalled, or has new evidence since last encounter").
 *
 * `since` is the last encounter. Without one — a first session — everything
 * accepted counts as new, which is true and is what a clinician wants on a
 * first read.
 */
export async function goalContextFor(
  ctx: TenantContext, personId: string, opts: { since?: string | null; now?: Date } = {}
): Promise<GoalContext[]> {
  const now = opts.now ?? new Date();
  const goals = await listGoals(ctx, personId, ["active"]);
  const out: GoalContext[] = [];

  for (const goal of goals) {
    const observations = await observationsFor(ctx, goal.id);
    const accepted = observations
      .filter((o) => o.status === "accepted")
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const pending = observations.filter((o) => o.status === "proposed");

    const rungs = await ladderFor(ctx, goal.id);
    const currentDescription =
      goal.currentLevel === null
        ? null
        : rungs.find((r) => r.level === goal.currentLevel)?.description ?? null;

    const newest = accepted[accepted.length - 1] ?? null;
    const quietDays = newest
      ? Math.floor((now.getTime() - Date.parse(newest.occurredAt)) / 86_400_000)
      : null;

    const sinceEncounter = opts.since
      ? accepted.filter((o) => o.occurredAt > (opts.since as string))
      : accepted;

    // The level moved if any observation since the last encounter reports a
    // different level from the one before it. Computed from the observations
    // rather than from the goal's stored level, because the stored level is a
    // cache and a brief that read it could not say WHEN it moved.
    const priorLevel = opts.since
      ? (accepted.filter((o) => o.occurredAt <= (opts.since as string)).pop()?.observedLevel ?? null)
      : null;
    const movedSince =
      sinceEncounter.length > 0 && sinceEncounter[sinceEncounter.length - 1].observedLevel !== priorLevel;

    let movement: GoalMovement;
    let citations: string[];
    if (pending.length > 0) {
      // Named first: something is waiting on the clinician, and that outranks
      // describing a state they cannot yet act on.
      movement = "awaiting_review";
      citations = pending.map((o) => o.id);
    } else if (movedSince) {
      movement = "moved";
      citations = sinceEncounter.map((o) => o.id);
    } else if (sinceEncounter.length > 0) {
      movement = "new_evidence";
      citations = sinceEncounter.map((o) => o.id);
    } else if (quietDays !== null && quietDays >= STALL_DAYS) {
      movement = "stalled";
      citations = newest ? [newest.id] : [];
    } else if (quietDays === null) {
      // Active, confirmed, and nothing has ever been recorded against it. Not
      // a stall — nothing has had a chance to move yet — and saying "stalled"
      // would blame a person for a ladder nobody has used.
      movement = "stalled";
      citations = [];
    } else {
      movement = "new_evidence";
      citations = newest ? [newest.id] : [];
    }

    out.push({
      goal, currentDescription, movement, citations,
      pendingCount: pending.length, quietDays,
    });
  }
  return out;
}

/** One line per goal, in the brief's voice.
 *
 *  Kept here rather than in the component so the sentence and the citations are
 *  produced together — a renderer writing its own wording could describe a
 *  movement the citations do not support. */
export function goalLine(c: GoalContext): string {
  const where = c.currentDescription ? ` Currently: ${c.currentDescription}` : "";
  switch (c.movement) {
    case "awaiting_review":
      return `${c.goal.title} — ${c.pendingCount} suggested observation${c.pendingCount === 1 ? "" : "s"} waiting on you.${where}`;
    case "moved":
      return `${c.goal.title} — the level changed since your last encounter.${where}`;
    case "new_evidence":
      return `${c.goal.title} — new evidence, level unchanged.${where}`;
    case "stalled":
      return c.quietDays === null
        ? `${c.goal.title} — nothing recorded against this yet.${where}`
        : `${c.goal.title} — nothing new for ${c.quietDays} days.${where}`;
  }
}

/** The evidence class of an observation, for a surface that must show patient
 *  report and clinician observation differently (§14). Re-exported so a caller
 *  does not have to reach into the store for it. */
export type { EvidenceClass };
