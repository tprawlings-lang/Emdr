// Return-to-Life goals (Clinical Intelligence Expansion, handoff 01).
//
// The functional outcome layer. §1's question is the one a symptom scale cannot
// answer: what does this person want to be able to do again, and is their real
// life expanding. A PHQ-9 falling and a person walking back into a grocery
// store are different facts, and the second is usually the one they came for.
//
// FOUR RULES THIS MODULE MAKES STRUCTURAL RATHER THAN ADVISORY.
//
//   THE PATIENT OWNS THE GOAL. §1: AI "can help draft measurable wording but
//   cannot choose what matters to the patient", and §12: model-drafted language
//   "must not be saved as patient-owned language until confirmed". So a goal
//   whose wording came from a draft stays in `draft` until a person confirms
//   it, and confirming records who — there is no path that writes an active
//   goal directly.
//
//   THE FOUR EVIDENCE CLASSES NEVER COLLAPSE. A patient reporting they managed
//   the shop, a clinician seeing them arrive having driven themselves, a system
//   event that matches a criterion, and a model noticing a possible connection
//   are four different kinds of fact. §1: "these sources remain separate."
//   Every observation carries its class and nothing merges them.
//
//   A MODEL CANDIDATE CANNOT MOVE A LEVEL. §7's hard boundary: the matcher
//   "proposes evidence only; no automatic level change". `model_candidate`
//   observations are written `proposed` and `currentLevel` only reads
//   `accepted` ones, so the guarantee holds even if something later starts
//   auto-accepting the other classes.
//
//   THE LEVEL IS DERIVED, NEVER SET. §3: "do not overwrite the current level
//   without preserving the observation that caused the change." So the level is
//   a fold over accepted observations and the stored column is a cache of that
//   fold — recomputed, never assigned by a caller.
//
// AND ONE THAT IS ABOUT LANGUAGE. §3: "baseline is descriptive, not a
// judgement. Level -2 is where the person is when the ladder is set, not
// failure." §1: "achievement is not cure." Both live in the copy this module
// exports rather than in the components, so every surface says the same thing.

import { repo, type TenantContext } from "../repository";
import { ulid } from "../ids";
import { encryptField, decryptField } from "../crypto";

// The vocabulary lives in its own module so a client component can import it
// without pulling this file's database dependencies into the browser bundle.
// Re-exported here so every existing server-side caller keeps one import.
export {
  GOAL_LEVELS, GOAL_DOMAINS, DOMAIN_LABEL, EVIDENCE_LABEL, LEVEL_LABEL,
  BASELINE_NOTE, COMPLETION_NOTE,
} from "./return-to-life-vocabulary";
export type {
  GoalLevel, GoalStatus, GoalDomain, EvidenceClass, ObservationStatus, GoalLadderRung,
} from "./return-to-life-vocabulary";

import {
  GOAL_LEVELS,
  type GoalLevel, type GoalStatus, type GoalDomain,
  type EvidenceClass, type ObservationStatus, type GoalLadderRung,
} from "./return-to-life-vocabulary";

export interface Goal {
  id: string;
  personId: string;
  title: string;
  /** The patient's own words. */
  patientStatement: string;
  whyItMatters: string | null;
  domain: GoalDomain;
  status: GoalStatus;
  createdByPersonId: string;
  confirmedByPersonId: string | null;
  confirmedAt: string | null;
  targetReviewDate: string | null;
  /** Derived from accepted observations. Null until one exists. */
  currentLevel: GoalLevel | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalObservation {
  id: string;
  goalId: string;
  personId: string;
  observedLevel: GoalLevel | null;
  evidenceClass: EvidenceClass;
  sourceType: string;
  sourceId: string;
  occurredAt: string;
  note: string | null;
  status: ObservationStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface GoalRow {
  id: string; person_id: string; title: string; patient_statement: string;
  why_it_matters: string | null; domain: string; status: string;
  created_by_person_id: string; confirmed_by_person_id: string | null;
  confirmed_at: string | null; target_review_date: string | null;
  current_level: number | null; created_at: string; updated_at: string;
}

interface LevelRow { id: string; goal_id: string; level: number; description: string }

interface ObsRow {
  id: string; goal_id: string; person_id: string; observed_level: number | null;
  evidence_class: string; source_type: string; source_id: string;
  occurred_at: string; note: string | null; status: string;
  decided_by: string | null; decided_at: string | null; created_at: string;
}

function toGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    personId: r.person_id,
    title: decryptField(r.title),
    patientStatement: decryptField(r.patient_statement),
    whyItMatters: r.why_it_matters ? decryptField(r.why_it_matters) : null,
    domain: r.domain as GoalDomain,
    status: r.status as GoalStatus,
    createdByPersonId: r.created_by_person_id,
    confirmedByPersonId: r.confirmed_by_person_id,
    confirmedAt: r.confirmed_at,
    targetReviewDate: r.target_review_date,
    currentLevel: r.current_level === null ? null : (r.current_level as GoalLevel),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toObservation(r: ObsRow): GoalObservation {
  return {
    id: r.id,
    goalId: r.goal_id,
    personId: r.person_id,
    observedLevel: r.observed_level === null ? null : (r.observed_level as GoalLevel),
    evidenceClass: r.evidence_class as EvidenceClass,
    sourceType: r.source_type,
    sourceId: r.source_id,
    occurredAt: r.occurred_at,
    note: r.note ? decryptField(r.note) : null,
    status: r.status as ObservationStatus,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

function actingPerson(ctx: TenantContext): string {
  if (!ctx.personId) throw new Error("A goal command requires an authenticated person in the context.");
  return ctx.personId;
}

export class GoalError extends Error {}

// ---------------------------------------------------------------------------
// The level fold
// ---------------------------------------------------------------------------

/**
 * The current level, from accepted observations alone.
 *
 * ACCEPTED ONLY, and that is the whole guarantee. A model candidate is
 * `proposed`; a rejected observation is `rejected`; neither reaches this fold,
 * so §7's "no automatic level change" holds without anything having to
 * remember it at the call site.
 *
 * The most recent accepted observation wins rather than the highest. Progress
 * is not monotonic — a person who managed the shop in June and could not in
 * August is at where they are now, and a fold that took the maximum would
 * describe a recovery that is not happening.
 */
export function foldLevel(observations: GoalObservation[]): GoalLevel | null {
  const accepted = observations
    .filter((o) => o.status === "accepted" && o.observedLevel !== null)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const last = accepted[accepted.length - 1];
  return last ? (last.observedLevel as GoalLevel) : null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listGoals(
  ctx: TenantContext, personId: string, statuses: GoalStatus[] = ["active", "draft"]
): Promise<Goal[]> {
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = await repo(ctx).findMany<GoalRow>(
    "return_to_life_goals", `person_id = ? AND status IN (${placeholders})`, [personId, ...statuses],
    { orderBy: "created_at DESC" }
  );
  return rows.map(toGoal);
}

export async function getGoal(ctx: TenantContext, id: string): Promise<Goal | null> {
  const row = await repo(ctx).findOne<GoalRow>("return_to_life_goals", "id = ?", [id]);
  return row ? toGoal(row) : null;
}

export async function ladderFor(ctx: TenantContext, goalId: string): Promise<GoalLadderRung[]> {
  const rows = await repo(ctx).findMany<LevelRow>(
    "return_to_life_goal_levels", "goal_id = ?", [goalId], { orderBy: "level ASC" }
  );
  return rows.map((r) => ({ level: r.level as GoalLevel, description: decryptField(r.description) }));
}

export async function observationsFor(
  ctx: TenantContext, goalId: string
): Promise<GoalObservation[]> {
  const rows = await repo(ctx).findMany<ObsRow>(
    "return_to_life_observations", "goal_id = ?", [goalId],
    { orderBy: "occurred_at DESC, rowid DESC" }
  );
  return rows.map(toObservation);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a goal AS A DRAFT, with its five levels.
 *
 * Draft is not a parameter. §12: model-drafted language must not be saved as
 * patient-owned until confirmed, and the only way to be sure of that is for
 * creation to have one outcome. A goal a patient dictated themselves is also a
 * draft for one step, which costs a click and removes an entire class of
 * mistake.
 */
export async function createGoal(
  ctx: TenantContext,
  args: {
    personId: string;
    title: string;
    patientStatement: string;
    whyItMatters?: string | null;
    domain: GoalDomain;
    ladder: GoalLadderRung[];
    targetReviewDate?: string | null;
  }
): Promise<Goal> {
  const author = actingPerson(ctx);
  // §2's ladder is five rungs. Fewer is an incomplete ladder and more is a
  // different scale; either would make one goal's level incomparable with
  // another's, which is the point of having a fixed one.
  const levels = new Set(args.ladder.map((r) => r.level));
  // BOTH checks, and the length one is not redundant. A six-rung ladder that
  // repeats level 0 has a set of size five covering all five levels, so the set
  // check alone passes it — and the duplicate would then fail at
  // UNIQUE(goal_id, level) AFTER the goal row was written, leaving a goal with
  // half a ladder. Refusing here means the goal is never created.
  if (
    args.ladder.length !== GOAL_LEVELS.length ||
    levels.size !== GOAL_LEVELS.length ||
    !GOAL_LEVELS.every((l) => levels.has(l))
  ) {
    throw new GoalError("A goal needs exactly one description for each of the five levels.");
  }
  for (const rung of args.ladder) {
    if (!rung.description.trim()) {
      throw new GoalError("Every level needs a description a person could recognise.");
    }
  }
  if (!args.patientStatement.trim()) {
    throw new GoalError("A goal needs the patient's own statement of it.");
  }

  const id = ulid();
  const r = repo(ctx);
  await r.insert("return_to_life_goals", {
    id,
    person_id: args.personId,
    title: encryptField(args.title),
    patient_statement: encryptField(args.patientStatement),
    why_it_matters: args.whyItMatters ? encryptField(args.whyItMatters) : null,
    domain: args.domain,
    status: "draft",
    created_by_person_id: author,
    confirmed_by_person_id: null,
    confirmed_at: null,
    target_review_date: args.targetReviewDate ?? null,
    // Null, not -2. The baseline is a DESCRIPTION on the ladder; the current
    // level is what evidence says. Setting it at creation would assert an
    // observation nobody made.
    current_level: null,
  });
  for (const rung of args.ladder) {
    await r.insert("return_to_life_goal_levels", {
      id: ulid(),
      person_id: args.personId,
      goal_id: id,
      level: rung.level,
      description: encryptField(rung.description.trim()),
    });
  }
  const row = await r.findOne<GoalRow>("return_to_life_goals", "id = ?", [id]);
  return toGoal(row!);
}

/** Confirm a draft. The goal becomes active and the confirmer is recorded. */
export async function confirmGoal(ctx: TenantContext, goalId: string, at: string): Promise<Goal> {
  const person = actingPerson(ctx);
  const r = repo(ctx);
  const existing = await r.findOne<GoalRow>("return_to_life_goals", "id = ?", [goalId]);
  if (!existing) throw new GoalError(`No such goal: ${goalId}`);
  if (existing.status !== "draft") throw new GoalError(`This goal is already ${existing.status}.`);
  await r.update(
    "return_to_life_goals",
    { status: "active", confirmed_by_person_id: person, confirmed_at: at, updated_at: at },
    "id = ?", [goalId]
  );
  const row = await r.findOne<GoalRow>("return_to_life_goals", "id = ?", [goalId]);
  return toGoal(row!);
}

/**
 * Record an observation.
 *
 * A model candidate is ALWAYS proposed. Every other class arrives accepted,
 * because a patient saying what they did and a clinician recording what they
 * saw are not proposals — they are the report itself, and asking someone to
 * confirm their own observation is ceremony. §10's flow says exactly this.
 */
export async function recordObservation(
  ctx: TenantContext,
  args: {
    goalId: string;
    personId: string;
    observedLevel: GoalLevel | null;
    evidenceClass: EvidenceClass;
    sourceType: string;
    sourceId: string;
    occurredAt: string;
    note?: string | null;
  }
): Promise<GoalObservation> {
  const person = actingPerson(ctx);
  const goal = await getGoal(ctx, args.goalId);
  if (!goal) throw new GoalError(`No such goal: ${args.goalId}`);
  // §2: evidence belongs to an ACTIVE goal. A draft has not been agreed to and
  // an archived one is history; attaching evidence to either would let a goal
  // acquire a progress record nobody signed up for.
  if (goal.status !== "active" && goal.status !== "paused") {
    throw new GoalError(`Evidence can only be recorded against an active goal; this one is ${goal.status}.`);
  }

  const proposed = args.evidenceClass === "model_candidate";
  const id = ulid();
  await repo(ctx).insert("return_to_life_observations", {
    id,
    person_id: args.personId,
    goal_id: args.goalId,
    observed_level: args.observedLevel,
    evidence_class: args.evidenceClass,
    source_type: args.sourceType,
    source_id: args.sourceId,
    occurred_at: args.occurredAt,
    note: args.note ? encryptField(args.note) : null,
    status: proposed ? "proposed" : "accepted",
    decided_by: proposed ? null : person,
    decided_at: proposed ? null : args.occurredAt,
  });
  const row = await repo(ctx).findOne<ObsRow>("return_to_life_observations", "id = ?", [id]);
  return toObservation(row!);
}

/** Accept or reject a proposed observation (§10's human review). */
export async function decideObservation(
  ctx: TenantContext, observationId: string, decision: "accepted" | "rejected", at: string
): Promise<GoalObservation> {
  const person = actingPerson(ctx);
  const r = repo(ctx);
  const existing = await r.findOne<ObsRow>("return_to_life_observations", "id = ?", [observationId]);
  if (!existing) throw new GoalError(`No such observation: ${observationId}`);
  if (existing.status !== "proposed") {
    throw new GoalError(`This observation is already ${existing.status}.`);
  }
  await r.update(
    "return_to_life_observations",
    { status: decision, decided_by: person, decided_at: at },
    "id = ?", [observationId]
  );
  const row = await r.findOne<ObsRow>("return_to_life_observations", "id = ?", [observationId]);
  return toObservation(row!);
}

/**
 * Recompute a goal's current level from its accepted observations.
 *
 * The stored column is a CACHE of the fold, and this is the only thing that
 * writes it. §3's rule — never overwrite the level without preserving the
 * observation that caused the change — is kept by there being no other way to
 * set it: a caller who wants a different level has to record the evidence for
 * it.
 *
 * Returns the previous and current level so the caller can emit
 * `return_goal.level_changed` only when it actually changed.
 */
export async function refreshLevel(
  ctx: TenantContext, goalId: string, at: string
): Promise<{ previous: GoalLevel | null; current: GoalLevel | null; changed: boolean }> {
  const r = repo(ctx);
  const goal = await getGoal(ctx, goalId);
  if (!goal) throw new GoalError(`No such goal: ${goalId}`);
  const current = foldLevel(await observationsFor(ctx, goalId));
  const changed = current !== goal.currentLevel;
  if (changed) {
    await r.update("return_to_life_goals", { current_level: current, updated_at: at }, "id = ?", [goalId]);
  }
  return { previous: goal.currentLevel, current, changed };
}
