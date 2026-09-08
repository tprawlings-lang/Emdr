// Task state (handoff 09 §9, Package 1).
//
// §9's shape: "idle, editing, submitting, confirmed, conflict, recoverable
// failure — tracked separately from domain state." Its reason, in six words:
// "UI progress must never become clinical state."
//
// THE FAILURE THIS PREVENTS IS SPECIFIC AND IT HAS HAPPENED IN THIS PRODUCT'S
// CATEGORY. A form sets a local `saved` flag when its submit handler returns,
// the screen says "Saved", the write never landed, and the person believes
// their answer is on file. §4.4: "Replace blanket claims such as Your answers
// are saved with confirmed state: Saving, Saved, or Could not save."
//
// So the two things are separate types in separate modules. A `TaskState`
// describes what the INTERFACE is doing. A `CommandResult` describes what the
// SERVER did. `confirmed` here can only be reached by passing a confirmed
// command result, and `advance` below is the only transition function — there
// is no setter that takes `confirmed` on its own.
//
// CLIENT-SAFE ON PURPOSE. This module imports nothing but the command result
// type, so a client component can hold a task state without pulling the server
// into the browser bundle.

import type { CommandOutcome, CommandResult } from "./command";

export const TASK_STATES = [
  "idle",
  "editing",
  "submitting",
  "confirmed",
  "conflict",
  "recoverable_failure",
] as const;
export type TaskStateName = (typeof TASK_STATES)[number];

export interface TaskState {
  name: TaskStateName;
  /** What to put on screen. Never "Saved" unless the name is `confirmed`. */
  label: string;
  /** Detail, where there is any: the refusal, the conflict, the failure. */
  detail?: string;
  /** `conflict` only: what the server holds now. */
  currentVersion?: string;
  /** `recoverable_failure` only: the key to reconcile by before retrying.
   *  Present exactly when a plain retry is unsafe. */
  reconcileBy?: string;
  /** Whether the interface may offer a retry button. */
  retryable: boolean;
}

/** §4.4's vocabulary, and it is deliberately in the past tense only once. */
export const TASK_LABEL: Record<TaskStateName, string> = {
  idle: "",
  editing: "Not saved yet",
  submitting: "Saving…",
  confirmed: "Saved",
  conflict: "Somebody else changed this",
  recoverable_failure: "Could not save",
};

export function idle(): TaskState {
  return { name: "idle", label: TASK_LABEL.idle, retryable: false };
}

export function editing(): TaskState {
  return { name: "editing", label: TASK_LABEL.editing, retryable: false };
}

export function submitting(): TaskState {
  return { name: "submitting", label: TASK_LABEL.submitting, retryable: false };
}

/**
 * The only way to reach `confirmed`.
 *
 * TAKES THE SERVER'S ANSWER, and refuses anything but a confirmation. This is
 * the whole point of the module: a UI cannot decide it succeeded. §4.4's "a
 * failed save never appears as saved" is a property of this function rather
 * than a rule the next form author has to remember.
 */
export function advance(result: CommandResult): TaskState {
  switch (result.outcome) {
    case "confirmed":
      return { name: "confirmed", label: TASK_LABEL.confirmed, retryable: false };
    case "rejected":
      return {
        name: "recoverable_failure",
        label: TASK_LABEL.recoverable_failure,
        detail: result.reason,
        // A refusal is safe to retry after the caller changes something: the
        // server said no rather than going quiet.
        retryable: true,
      };
    case "stale":
      return {
        name: "conflict",
        label: TASK_LABEL.conflict,
        detail: result.reason,
        currentVersion: result.currentVersion,
        // §5: "Do not silently overwrite." A conflict is resolved by reading
        // what changed, not by pressing the button again.
        retryable: false,
      };
    case "unavailable":
      return {
        name: "recoverable_failure",
        label: "Not available here",
        detail: result.reason,
        retryable: false,
      };
    case "indeterminate":
      return {
        name: "recoverable_failure",
        label: "Steady could not confirm this",
        detail: result.reason,
        reconcileBy: result.reconcileBy,
        // §9: reconcile by idempotency key BEFORE inviting retry. The button
        // is not offered, because the safe-feeling action is the one that
        // duplicates.
        retryable: false,
      };
  }
}

/** Whether a surface may tell somebody their work is saved. */
export function mayClaimSaved(t: TaskState): boolean {
  return t.name === "confirmed";
}

/** The outcomes that must never produce a `confirmed` task state. Exported for
 *  the guard, so the mapping above cannot quietly widen. */
export const NEVER_CONFIRMS: CommandOutcome[] = [
  "rejected", "stale", "unavailable", "indeterminate",
];
