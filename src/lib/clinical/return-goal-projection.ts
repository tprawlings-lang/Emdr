// The Return-to-Life goal projection (handoff 01 §13 Phase 4).
//
// The versioned interface later engines read. §11: "Response Fingerprint later
// links interventions to goal observations as one outcome dimension" and
// "Recovery Trajectory later consumes accepted goal level history as the
// primary function lane." Those are handoffs 02 and 04, and Phase 4's whole
// definition of done is "stable versioned interface documented and tested".
//
// WHY A PROJECTION RATHER THAN "JUST READ THE TABLES". Because the tables carry
// things a downstream engine must not consume, and the only reliable way to
// stop that is to not hand them over:
//
//   PROPOSED AND REJECTED OBSERVATIONS ARE NOT IN IT. A fingerprint built over
//   model candidates would be an intervention-response pattern derived from
//   guesses nobody accepted, and it would look exactly like one derived from
//   evidence.
//
//   THE PATIENT'S WORDS ARE NOT IN IT. §12: goal titles and why-it-matters
//   "may be highly sensitive. Do not send them to general telemetry." A
//   trajectory engine needs the level history and the domain; it does not need
//   the sentence about wanting independence back.
//
//   THE LEVEL HISTORY IS A SERIES, NOT A CURRENT VALUE. An engine asking "did
//   this move" needs the points; one handed only `currentLevel` would have to
//   store its own history to answer, and then there would be two.
//
// VERSIONED, AND THE VERSION IS ON THE PAYLOAD. A consumer pinning v1 keeps
// working when v2 adds a field; one that finds an unfamiliar version can refuse
// rather than silently misread a shape it does not know.

import { listGoals, observationsFor, ladderFor, type GoalDomain, type GoalLevel } from "./return-to-life";
import type { TenantContext } from "../repository";

export const GOAL_PROJECTION_VERSION = "return-goal-projection.1.0.0";

/** One accepted level reading. */
export interface GoalLevelPoint {
  observationId: string;
  level: GoalLevel;
  occurredAt: string;
  /** Kept, because an outcome dimension built from patient report and one built
   *  from clinician observation are different measurements and a consumer has
   *  to be able to weigh them separately. */
  evidenceClass: string;
  sourceType: string;
  sourceId: string;
}

export interface GoalProjection {
  goalId: string;
  personId: string;
  domain: GoalDomain;
  status: string;
  /** The target rung's description — the one thing from the ladder a consumer
   *  legitimately needs, because "reached level 0" means nothing without it. */
  targetDescription: string | null;
  confirmedAt: string | null;
  /** Accepted readings, oldest first. Empty when nothing has been accepted. */
  levels: GoalLevelPoint[];
  currentLevel: GoalLevel | null;
  /** How many proposals are waiting. A consumer can tell "no evidence" from
   *  "evidence nobody has looked at", which are different situations. */
  pendingCount: number;
}

export interface GoalProjectionSet {
  version: string;
  personId: string;
  computedAt: string;
  goals: GoalProjection[];
}

/**
 * The function lane for one person.
 *
 * `statuses` defaults to active goals. A trajectory engine reconstructing a
 * course of care will want completed ones too, and asking is cheaper than
 * returning everything and hoping the consumer filters.
 */
export async function goalProjection(
  ctx: TenantContext,
  personId: string,
  opts: { statuses?: string[]; now?: Date; asOf?: string } = {}
): Promise<GoalProjectionSet> {
  const now = opts.now ?? new Date();
  const statuses = (opts.statuses ?? ["active", "completed"]) as Parameters<typeof listGoals>[2];
  const goals = await listGoals(ctx, personId, statuses);

  const projections: GoalProjection[] = [];
  for (const goal of goals) {
    // `asOf` is the evidence cutoff, and it filters the OBSERVATIONS rather
    // than only setting the clock. A projection that moved its clock back but
    // still folded every observation would report the level a goal reached
    // later as the level it had then — future data wearing a historical date,
    // which is the exact leak the cross-feature invariant names.
    const all = await observationsFor(ctx, goal.id);
    const observations = opts.asOf ? all.filter((o) => o.occurredAt <= opts.asOf!) : all;
    const rungs = await ladderFor(ctx, goal.id);
    const accepted = observations
      .filter((o) => o.status === "accepted" && o.observedLevel !== null)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    projections.push({
      goalId: goal.id,
      personId: goal.personId,
      domain: goal.domain,
      status: goal.status,
      targetDescription: rungs.find((r) => r.level === 0)?.description ?? null,
      confirmedAt: goal.confirmedAt,
      levels: accepted.map((o) => ({
        observationId: o.id,
        level: o.observedLevel as GoalLevel,
        occurredAt: o.occurredAt,
        evidenceClass: o.evidenceClass,
        sourceType: o.sourceType,
        sourceId: o.sourceId,
      })),
      currentLevel: goal.currentLevel,
      pendingCount: observations.filter((o) => o.status === "proposed").length,
    });
  }

  return {
    version: GOAL_PROJECTION_VERSION,
    personId,
    computedAt: now.toISOString(),
    goals: projections,
  };
}

// ---------------------------------------------------------------------------
// The Command Center signal adapter
// ---------------------------------------------------------------------------

/** §13 Phase 4: "Command Center signal adapter for meaningful stall/reversal
 *  later". Handoff 03 builds the Command Center; this is the shape it will
 *  read, defined here so the goal domain owns what counts as a goal signal
 *  rather than the surface deciding after the fact. */
export type GoalSignalKind = "stall" | "reversal" | "awaiting_review";

export interface GoalSignal {
  kind: GoalSignalKind;
  goalId: string;
  personId: string;
  domain: GoalDomain;
  /** In words, for a surface that must state a reason (§23.2's "an alert
   *  without a clear owner and possible action" is the thing to avoid). */
  reason: string;
  /** The observations behind it. A signal that cannot open its evidence is an
   *  assertion. */
  citations: string[];
  occurredAt: string;
}

/** Days without accepted evidence before a goal is a stall signal. Matches the
 *  Session Prep adapter's threshold deliberately: two numbers for "how long is
 *  too long" would let a brief and an alert disagree about the same goal. */
export { STALL_DAYS } from "./return-goal-evidence";

/**
 * Goal signals for one person.
 *
 * A REVERSAL IS NOT A STALL AND NEITHER IS A DIP. A reversal here is the level
 * going down and STAYING down across the two most recent readings — a single
 * lower reading is an ordinary bad week, and a system that alerted on it would
 * be alerting on the normal shape of recovery.
 */
export function goalSignals(set: GoalProjectionSet, now: Date, stallDays: number): GoalSignal[] {
  const out: GoalSignal[] = [];
  for (const g of set.goals) {
    if (g.status !== "active") continue;

    if (g.pendingCount > 0) {
      const waiting = g.pendingCount;
      out.push({
        kind: "awaiting_review",
        goalId: g.goalId, personId: g.personId, domain: g.domain,
        reason: `${waiting} suggested observation${waiting === 1 ? "" : "s"} on this goal have not been reviewed.`,
        citations: [],
        occurredAt: set.computedAt,
      });
    }

    const points = g.levels;
    if (points.length === 0) continue;
    const newest = points[points.length - 1];

    const quietDays = Math.floor((now.getTime() - Date.parse(newest.occurredAt)) / 86_400_000);
    if (quietDays >= stallDays) {
      out.push({
        kind: "stall",
        goalId: g.goalId, personId: g.personId, domain: g.domain,
        reason: `No accepted evidence on this goal for ${quietDays} days.`,
        citations: [newest.observationId],
        occurredAt: newest.occurredAt,
      });
    }

    if (points.length >= 3) {
      const [a, b, c] = points.slice(-3);
      // Down and stayed down. One lower reading is a bad week; two consecutive
      // readings below the one before them is a direction.
      if (b.level < a.level && c.level <= b.level) {
        out.push({
          kind: "reversal",
          goalId: g.goalId, personId: g.personId, domain: g.domain,
          reason: "The last two readings are below the one before them.",
          citations: [a.observationId, b.observationId, c.observationId],
          occurredAt: c.occurredAt,
        });
      }
    }
  }
  return out;
}
