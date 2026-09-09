// The active-session shell and honest resume (handoff 09 §1.6, §4.3, §4.4;
// Package 3).
//
// §1.6 IS THE RULING THIS MODULE EXISTS TO CARRY OUT:
//
//   "Define an active-session shell carrying Pause, Stop, and Get support.
//    Ground remains one direct support action. Routine navigation is removed
//    during an activity and returns after a safe exit. No fixed element may
//    obscure a focused control at 320 CSS pixels."
//
// WHY "REMOVED" AND NOT "GREYED OUT". During bilateral stimulation or a body
// scan, every destination on screen is a thing the member can fall out of the
// activity into by accident — and the ones that matter are the ones that end it
// halfway. §4.3: the activity is the whole screen. So `activityShell()` returns
// a navigation-free shape, and there is no argument that puts the sidebar back.
// The dock stays, because the dock is not navigation: it is the exit.
//
// AND THE EXIT IS THREE CONTROLS, NOT ONE. §4: "Pause preserves permitted
// progress; Stop follows the existing exit and closure rules." A single
// "Cancel" makes a person on their worst day choose between finishing something
// they cannot finish and losing what they have done, which is not a choice
// anybody makes well while activated.
//
// §4.4 IS THE OTHER HALF, AND IT IS THE HALF THAT LIES IF NOBODY WATCHES IT:
//
//   "Replace blanket claims such as Your answers are saved with confirmed
//    state. On reconnect, check current server state before offering resume. A
//    prior answer or permission may no longer be valid. Explain a failure
//    without making the member diagnose connectivity."
//
// Three consequences, and all three are properties here rather than habits:
//
//   1. A save state is derived from a CommandResult and from nothing else.
//      `saveState(result)` is the only constructor that can produce `saved`.
//   2. Resume is OFFERED BY THE SERVER, not remembered by the browser.
//      `resumeDecision` refuses to offer a resume from a local record alone —
//      the local half can only ever say "ask", never "yes".
//   3. Nothing clinical is written to browser storage. `mayPersistLocally`
//      takes the value, not just the key, and walks it.
//
// Client-safe: the only imports are types and pure helpers from Package 1.

import {
  mayRetryDirectly,
  type CommandResult,
} from "./command";
import { violations } from "./member-projection";

// ---------------------------------------------------------------------------
// §1.6 — the shell
// ---------------------------------------------------------------------------

/** The three controls, in the order they are rendered. Support last because it
 *  is the one that must never be reached by accident on the way to Pause. */
export const ACTIVITY_EXITS = ["pause", "stop", "support"] as const;
export type ActivityExit = (typeof ACTIVITY_EXITS)[number];

export const EXIT_LABEL: Record<ActivityExit, string> = {
  pause: "Pause",
  stop: "Stop",
  support: "Get support",
};

/** What each control promises, in the person's words. §4.5: a claim on a
 *  member surface must be true at the moment it is read — so Pause does not
 *  say "your progress is saved", it says what Pause is FOR. The saved claim is
 *  made later, by `saveState`, and only once a server has confirmed it. */
export const EXIT_NOTE: Record<ActivityExit, string> = {
  pause: "Stops here and keeps your place. You can come back to it.",
  stop: "Ends this properly, with a short close-down.",
  support: "Grounding, someone to talk to, and crisis lines.",
};

/**
 * Pause, for an activity that commits nothing.
 *
 * THE CONTROL IS ALWAYS THERE; ONLY THE SENTENCE CHANGES. §1.6 lists three
 * controls and this module gives three, with no argument that removes one —
 * a person who needs to stop mid-activity should not have to work out which
 * kind of activity they are in first.
 *
 * But §4.5 will not let the sentence lie. A five-step grounding practice holds
 * no server state, so "keeps your place" is false on it, and a member who
 * comes back to step one having been told otherwise has been told something
 * untrue by a product whose whole proposition is that it does not do that.
 * So the WORDS are conditional and the CONTROL is not, which is the split
 * between §1.6 (a control must exist) and §4.5 (a claim must be true).
 */
export const EXIT_NOTE_UNCOMMITTED: Record<ActivityExit, string> = {
  ...EXIT_NOTE,
  pause: "Stops here. Nothing is recorded either way, so you can come back and begin again whenever.",
};

/** Whether an exit ends the activity. Pause does not; Stop does; Support
 *  leaves the activity in place behind it, because a person who grounds
 *  mid-session has not abandoned the session. */
export const ENDS_ACTIVITY: Record<ActivityExit, boolean> = {
  pause: false,
  stop: true,
  support: false,
};

/**
 * §1.6's "no fixed element may obscure a focused control at 320 CSS pixels".
 *
 * The narrowest phone in common use is 320 CSS px, and the member surface is
 * used on it at night. A fixed dock that overlaps the control a keyboard or
 * switch user has just focused is not a cosmetic problem: it is a person
 * pressing something they cannot see.
 *
 * Stated as data so a component has a number to satisfy and a test has one to
 * check, rather than a paragraph to interpret.
 */
export const NARROW_VIEWPORT_PX = 320;

export interface ActivityShellView {
  /** The activity being run. */
  activityId: string;
  title: string;
  /** §4.3: one primary task per screen, so the shell names it. */
  step: { index: number; total: number | null; instruction: string };
  /** §1.6: removed during an activity. Always false — there is no argument
   *  that makes it true, and the field exists so a reader sees the decision. */
  routineNavigationVisible: false;
  /** The three exits, always all three. */
  exits: Array<{ exit: ActivityExit; label: string; note: string; endsActivity: boolean }>;
  /** §1.6: "Ground remains one direct support action." Not nested inside a
   *  support menu — one press from the activity. */
  groundHref: string;
  /** Reserved space, in CSS pixels, that the fixed dock occupies at the
   *  narrowest supported width. A scroll container must reserve it rather than
   *  overlap into it. */
  dockReservePx: number;
  /** What the surface may currently say about saving. */
  save: SaveState;
}

export class ActivityShellError extends Error {}

/**
 * Build the shell for an activity in progress.
 *
 * NO NAVIGATION PARAMETER AND NO NAVIGATION FIELD. The shape cannot carry a
 * sidebar, which is §1.6 made structural rather than remembered.
 */
export function activityShell(args: {
  activityId: string;
  title: string;
  step: { index: number; total: number | null; instruction: string };
  /** Whether the activity records committed steps a member could return to.
   *  Changes what Pause SAYS, never whether Pause is there — see
   *  `EXIT_NOTE_UNCOMMITTED`. Defaults to false, so an activity has to claim
   *  that it saves rather than inherit the claim. */
  commitsProgress?: boolean;
  save?: SaveState;
}): ActivityShellView {
  if (args.step.index < 1) {
    throw new ActivityShellError("An activity step is 1-based; step 0 renders as 'step 0 of 6'.");
  }
  if (args.step.total !== null && args.step.index > args.step.total) {
    throw new ActivityShellError("Step index past the total would render 'step 7 of 6'.");
  }
  return {
    activityId: args.activityId,
    title: args.title,
    step: args.step,
    routineNavigationVisible: false,
    exits: ACTIVITY_EXITS.map((exit) => ({
      exit,
      label: EXIT_LABEL[exit],
      note: (args.commitsProgress ? EXIT_NOTE : EXIT_NOTE_UNCOMMITTED)[exit],
      endsActivity: ENDS_ACTIVITY[exit],
    })),
    groundHref: "/app/ground",
    dockReservePx: DOCK_RESERVE_PX,
    save: args.save ?? unsaved(),
  };
}

/**
 * How much bottom space the fixed dock owes the document.
 *
 * MEASURED AT 320px, NOT CHOSEN. The first value here was 96, picked as "about
 * the height of a bar with one row of buttons in it" — and at 320 CSS pixels
 * the dock's three entries wrap to two rows and the bar is 107px tall, so the
 * reserve was 11px short and the last control on the page went under it. That
 * is exactly the failure §1.6 names, arrived at by guessing a number.
 *
 * So this is the measurement plus a margin: two rows of 44px minimum-height
 * targets, an 8px gap, 24px of vertical padding and the border, rounded up.
 * A guard checks the CSS agrees with it; a Playwright pass at 320px checks
 * reality agrees with both.
 */
export const DOCK_RESERVE_PX = 128;

// ---------------------------------------------------------------------------
// §4.4 — what the surface may say about saving
// ---------------------------------------------------------------------------

export const SAVE_STATES = ["unsaved", "saving", "saved", "could_not_save"] as const;
export type SaveStateName = (typeof SAVE_STATES)[number];

export interface SaveState {
  name: SaveStateName;
  /** The exact words. §4.4 names three of them. */
  label: string;
  /** Why, when there is a why. Never a network diagnosis — §4.4: "Explain a
   *  failure without making the member diagnose connectivity." */
  detail?: string;
  /** Whether the surface may offer a plain retry. False when a repeat could
   *  duplicate, which is the case the member cannot reason about. */
  retryable: boolean;
  /** The key a retry must carry so a duplicate collapses into the first
   *  attempt. Present exactly when the outcome was indeterminate. */
  reconcileBy?: string;
}

export const SAVE_LABEL: Record<SaveStateName, string> = {
  unsaved: "Not saved yet",
  saving: "Saving…",
  saved: "Saved",
  could_not_save: "Could not save",
};

export function unsaved(): SaveState {
  return { name: "unsaved", label: SAVE_LABEL.unsaved, retryable: false };
}

export function saving(): SaveState {
  return { name: "saving", label: SAVE_LABEL.saving, retryable: false };
}

/**
 * The ONLY route to `saved`.
 *
 * There is deliberately no `saved()` constructor. A component that wants to
 * print "Saved" must hold a confirmed CommandResult, which it can only get from
 * a server action. That is §4.4's rule with the loophole removed: the interface
 * cannot congratulate itself.
 */
export function saveState(result: CommandResult): SaveState {
  switch (result.outcome) {
    case "confirmed":
      return { name: "saved", label: SAVE_LABEL.saved, retryable: false };
    case "rejected":
      return {
        name: "could_not_save",
        label: SAVE_LABEL.could_not_save,
        detail: result.reason,
        // A refusal is not a transient failure. Pressing again produces the
        // same refusal, and a retry button says otherwise.
        retryable: false,
      };
    case "stale":
      return {
        name: "could_not_save",
        label: SAVE_LABEL.could_not_save,
        detail: "This changed while you were working. Open it again to see where it is now.",
        retryable: false,
      };
    case "unavailable":
      return {
        name: "could_not_save",
        label: SAVE_LABEL.could_not_save,
        // Not "check your connection". The member is not the one who can fix
        // this, and asking them to diagnose it makes the failure their fault.
        detail: "Steady could not record that just now. It is safe to try again.",
        retryable: mayRetryDirectly(result),
      };
    case "indeterminate":
      return {
        name: "could_not_save",
        label: SAVE_LABEL.could_not_save,
        detail: "Steady is not sure whether that was recorded. It will be checked before anything is written twice.",
        retryable: false,
        reconcileBy: result.reconcileBy,
      };
  }
}

/** Whether the words "Saved" may appear. Exported so the guard checks the
 *  property rather than reading the component. */
export function mayClaimSaved(state: SaveState): boolean {
  return state.name === "saved";
}

// ---------------------------------------------------------------------------
// §4.4 — resume, checked against the server
// ---------------------------------------------------------------------------

export const RESUME_DECISIONS = ["resume", "start_over", "ask_server", "no_activity"] as const;
export type ResumeDecision = (typeof RESUME_DECISIONS)[number];

export interface ResumeOffer {
  decision: ResumeDecision;
  /** What to put on screen. Empty for `ask_server`, which is not a screen
   *  state — it is a thing the surface has to go and do first. */
  label: string;
  note: string;
  /** The step the server says is committed. Null unless the decision is
   *  `resume`, because there is nothing else to resume to. */
  resumeToStep: number | null;
}

/**
 * What to offer somebody who comes back to an unfinished activity.
 *
 * THE LOCAL RECORD ALONE CAN NEVER SAY "RESUME". §4.4: "On reconnect, check
 * current server state before offering resume. A prior answer or permission may
 * no longer be valid." Two things can have changed while the member was away,
 * and they are the two that matter most: the answers may not have landed, and
 * the gate may have closed. Offering "pick up where you left off" from a value
 * in localStorage is offering to resume an activity the person may no longer be
 * permitted to do — which is a safety failure wearing a convenience costume.
 *
 * So `server` is a required argument with no default. A caller that has not
 * asked cannot get an answer.
 */
export function resumeDecision(args: {
  /** What the browser thinks was in progress. Advisory only. */
  local: { activityId: string; step: number } | null;
  /** What the server holds. `null` means the surface has not asked yet. */
  server:
    | { activityId: string; committedStep: number; stillPermitted: boolean }
    | null;
}): ResumeOffer {
  if (!args.server) {
    return {
      decision: "ask_server",
      label: "",
      note: "The surface has not checked yet. Nothing may be offered until it has.",
      resumeToStep: null,
    };
  }
  if (!args.server.stillPermitted) {
    // The gate closed while they were away. Not an error and not a scolding —
    // §2: narrowing must never read as "you failed the check".
    return {
      decision: "start_over",
      label: "Start fresh when you are ready",
      note: "Today is set up differently than when you started. Nothing you did was lost; it is just not the right thing to pick up right now.",
      resumeToStep: null,
    };
  }
  if (args.server.committedStep < 1) {
    return {
      decision: "no_activity",
      label: "",
      note: "Nothing was committed, so there is nothing to come back to.",
      resumeToStep: null,
    };
  }
  return {
    decision: "resume",
    label: "Pick up where you left off",
    // Says what is actually true: the server holds this step. Not "your
    // answers are saved", which is a claim about everything they did.
    note: `Steady has your work up to step ${args.server.committedStep}.`,
    resumeToStep: args.server.committedStep,
  };
}

/** Whether the local record and the server disagree about where the person
 *  was. Not an error — a phone that lost signal mid-step is the ordinary case
 *  — but the surface resumes to the SERVER's step, never the browser's. */
export function localRunsAhead(
  local: { step: number } | null,
  server: { committedStep: number } | null
): boolean {
  if (!local || !server) return false;
  return local.step > server.committedStep;
}

// ---------------------------------------------------------------------------
// §4.4 — what may be written to the browser
// ---------------------------------------------------------------------------

/**
 * Whether a value may be kept in browser storage.
 *
 * §4.4 and §3's boundary together: a resume marker is fine, and the content of
 * a trauma processing session is not. The check TAKES THE VALUE, not just a
 * key name, and walks it through Package 1's member allow-list — because the
 * failure mode is not somebody storing a field called `sudsScore`, it is
 * somebody storing the whole draft object "just to be safe" and shipping the
 * member's narrative into a place that survives sign-out on a shared phone.
 *
 * The allow-list is the same one the member projection uses, so widening what
 * a member may see and widening what may be cached are the same edit.
 */
export const LOCAL_STORAGE_ALLOWED_KEYS = [
  "activityId",
  "step",
  "startedAt",
  "reconcileBy",
] as const;

export function mayPersistLocally(value: unknown): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reasons: ["A resume marker is an object with the four allowed keys."] };
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!(LOCAL_STORAGE_ALLOWED_KEYS as readonly string[]).includes(key)) {
      reasons.push(`"${key}" is not one of the four keys a resume marker may hold.`);
    }
  }
  // And the allow-list check on top, so a value that sneaks in under an
  // allowed key still has to survive the member boundary.
  for (const v of violations(value, "resume marker")) reasons.push(`${v.at}: ${v.detail}`);
  return { ok: reasons.length === 0, reasons };
}
