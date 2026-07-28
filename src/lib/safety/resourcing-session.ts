// Phase-4a resourcing session — pure reducer (Calm/Safe Place installation flow).
//
// Drives: intro → prep steps (settle/choose/sense/cue) → short slow BLS set loop
// (set → between-set check) → mandatory closure → completed. Fail-safe stops:
// Ground-Me and an unpleasant resource both go straight to closure. Pure data;
// the caller renders it and runs the stimulus. NOT desensitization.

import { BLS_RESOURCING, SESSION } from "./config";
import { RESOURCING_STEPS } from "./resourcing";

/** The prep prompts shown before any set (everything except the closing step). */
export const RESOURCING_PREP_STEPS = RESOURCING_STEPS.filter((s) => s.phase !== "closure");
export const RESOURCING_PREP_COUNT = RESOURCING_PREP_STEPS.length;

export type ResourcingSessionPhase =
  | "intro"
  | "prep"
  | "set"
  | "between"
  | "closure"
  | "completed";

export interface ResourcingState {
  phase: ResourcingSessionPhase;
  /** Index into RESOURCING_PREP_STEPS during the prep phase. */
  stepIndex: number;
  setsCompleted: number;
  /** True once a fail-safe stop (Ground-Me or unpleasant resource) fired. */
  stopped: boolean;
  reason: string | null;
}

export function newResourcing(): ResourcingState {
  return { phase: "intro", stepIndex: 0, setsCompleted: 0, stopped: false, reason: null };
}

export function begin(s: ResourcingState): ResourcingState {
  return { ...s, phase: "prep", stepIndex: 0 };
}

/** Advance the prep prompts; after the last prep step, move to the first set. */
export function advancePrep(s: ResourcingState): ResourcingState {
  const next = s.stepIndex + 1;
  if (next >= RESOURCING_PREP_COUNT) return { ...s, phase: "set", stepIndex: next };
  return { ...s, phase: "prep", stepIndex: next };
}

/** A stimulation set finished — go to the between-set check (never auto-continue). */
export function completeSet(s: ResourcingState): ResourcingState {
  return { ...s, phase: "between" };
}

/** Between-set answer. If the resource did NOT feel better/pleasant, STOP to
 *  closure (never push a distressing resource). Otherwise offer another short set
 *  until the max, then close. */
export function answerBetween(s: ResourcingState, feltBetter: boolean): ResourcingState {
  if (!feltBetter) {
    return { ...s, phase: "closure", stopped: true, reason: "resource_unpleasant" };
  }
  const setsCompleted = s.setsCompleted + 1;
  if (setsCompleted >= BLS_RESOURCING.maxSets) {
    return { ...s, phase: "closure", setsCompleted };
  }
  return { ...s, phase: "set", setsCompleted };
}

/** One-tap Ground-Me — halts and goes straight to closure, no return. */
export function groundMe(s: ResourcingState): ResourcingState {
  return { ...s, phase: "closure", stopped: true, reason: "ground_me" };
}

/** Complete closure only after the mandatory minimum duration. */
export function completeClosure(s: ResourcingState, closureSeconds: number): ResourcingState {
  if (closureSeconds < SESSION.closureMinSeconds) return { ...s, phase: "closure" };
  return { ...s, phase: "completed" };
}

/** Whether a stimulation set may run now. */
export function canRunSet(s: ResourcingState): boolean {
  return s.phase === "set" && !s.stopped && s.setsCompleted < BLS_RESOURCING.maxSets;
}
