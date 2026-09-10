// Return-to-Life goal events (handoff 01 §6).
//
// Separate from the store for the same reason memory-store and save-thoughts
// are separate: the store persists, this records, and an event is emitted only
// after the write it describes has landed. The ledger is append-only and there
// is no taking back an event for a write that failed.
//
// WHAT TRAVELS AND WHAT DOES NOT. §12: "goal titles and why-it-matters text may
// be highly sensitive. Do not send them to general telemetry." So the events
// carry ids, domains, levels and classes — enough to replay which goal reached
// which level on what evidence — and never the patient's words. The words are
// in a row a scoped reader can open; a second copy in an append-only ledger is
// a copy retention policy can never reach.

import { appendEventSafe } from "../events";
import type { EvidenceClass, GoalDomain, GoalLevel } from "./return-to-life";

export async function recordGoalCreated(args: {
  goalId: string; tenantId: string; personId: string;
  domain: GoalDomain; createdBy: string;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId, tenantId: args.tenantId,
    type: "return_goal.created",
    actorId: args.createdBy,
    // A goal may be authored by the patient or by the clinician with them. The
    // actor is a person either way; which person is the interesting part.
    actorType: args.createdBy === args.personId ? "patient" : "clinician",
    payload: { goalId: args.goalId, domain: args.domain, createdBy: args.createdBy },
  });
}

export async function recordLadderSet(args: {
  goalId: string; tenantId: string; personId: string;
  levels: number[]; authoredBy: string;
  /** True when a model drafted the wording. §12: model-drafted language is not
   *  patient-owned until confirmed, and a replay has to be able to tell which
   *  ladders came from a draft. */
  modelDrafted: boolean;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId, tenantId: args.tenantId,
    type: "return_goal.ladder_set",
    actorId: args.authoredBy,
    actorType: args.modelDrafted ? "model" : "clinician",
    payload: {
      goalId: args.goalId, levels: args.levels,
      modelDrafted: args.modelDrafted, authoredBy: args.authoredBy,
    },
  });
}

export async function recordGoalConfirmed(args: {
  goalId: string; tenantId: string; personId: string; confirmedBy: string;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId, tenantId: args.tenantId,
    type: "return_goal.confirmed",
    actorId: args.confirmedBy,
    actorType: args.confirmedBy === args.personId ? "patient" : "clinician",
    payload: { goalId: args.goalId, confirmedBy: args.confirmedBy },
  });
}

/** Evidence about current function.
 *
 *  The CLASS is on the event, because §1's "these sources remain separate" has
 *  to survive a rebuild. An event that recorded only "level 0 observed" would
 *  replay a patient's report and a clinician's observation as the same fact. */
export async function recordObservationRecorded(args: {
  observationId: string; goalId: string; tenantId: string; personId: string;
  evidenceClass: EvidenceClass; observedLevel: GoalLevel | null;
  sourceType: string; sourceId: string; status: string; actorId: string | null;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId, tenantId: args.tenantId,
    type: "return_goal.observation_recorded",
    actorId: args.actorId,
    actorType:
      args.evidenceClass === "patient_reported" ? "patient"
        : args.evidenceClass === "clinician_observed" ? "clinician"
          : args.evidenceClass === "model_candidate" ? "model" : "system",
    payload: {
      observationId: args.observationId, goalId: args.goalId,
      evidenceClass: args.evidenceClass, observedLevel: args.observedLevel,
      sourceType: args.sourceType, sourceId: args.sourceId, status: args.status,
    },
  });
}

/** A level moved, and the observation that moved it.
 *
 *  §3: "do not overwrite the current level without preserving the observation
 *  that caused the change." The causing observation id is required rather than
 *  optional — an event that could omit it is an event that will. */
export async function recordLevelChanged(args: {
  goalId: string; tenantId: string; personId: string;
  previousLevel: GoalLevel | null; currentLevel: GoalLevel | null;
  causedByObservationId: string; actorId: string | null;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId, tenantId: args.tenantId,
    type: "return_goal.level_changed",
    actorId: args.actorId,
    actorType: "system",
    payload: {
      goalId: args.goalId,
      previousLevel: args.previousLevel,
      currentLevel: args.currentLevel,
      causedByObservationId: args.causedByObservationId,
    },
  });
}

export async function recordGoalRevised(args: {
  goalId: string; tenantId: string; personId: string;
  revisedBy: string; what: string;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId, tenantId: args.tenantId,
    type: "return_goal.revised",
    actorId: args.revisedBy,
    actorType: args.revisedBy === args.personId ? "patient" : "clinician",
    // WHAT changed, not the new wording. §6: "prior version remains
    // reconstructable" — from the rows, which keep their own history; the
    // ledger records that a revision happened and who made it.
    payload: { goalId: args.goalId, what: args.what, revisedBy: args.revisedBy },
  });
}

export async function recordGoalCompleted(args: {
  goalId: string; tenantId: string; personId: string; completedBy: string;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId, tenantId: args.tenantId,
    type: "return_goal.completed",
    actorId: args.completedBy,
    actorType: args.completedBy === args.personId ? "patient" : "clinician",
    // §1: "achievement is not cure." The payload says a function changed and
    // nothing else — no remission, no treatment effect — so a downstream reader
    // cannot find a claim here that was never made.
    payload: { goalId: args.goalId, completedBy: args.completedBy, meaning: "function_changed" },
  });
}

export async function recordGoalArchived(args: {
  goalId: string; tenantId: string; personId: string; archivedBy: string; reason: string | null;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId, tenantId: args.tenantId,
    type: "return_goal.archived",
    actorId: args.archivedBy,
    actorType: args.archivedBy === args.personId ? "patient" : "clinician",
    payload: { goalId: args.goalId, archivedBy: args.archivedBy, reason: args.reason },
  });
}
