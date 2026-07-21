// Deterministic safety core — session-runtime state machine (Autonomous Step 3).
//
// A PURE reducer for one activating (BLS) session. It never auto-starts a set,
// never overrides a stop, and treats every stop condition as absolute. Where
// Vol II conflicts with itself on the SUDS rules (ledger A2/A3) it uses the
// CONSERVATIVE UNION — a set is contained/stopped if ANY rule fires.
//
// Session FSM (Vol II §11):
//   created → pre_session_check → authorized → set_active → post_set_reassessment
//     → authorized (only after explicit re-auth) → closure → completed
//   alt: denied · ground_me → containment → closure · crisis
//
// All thresholds come from config.SESSION and are PROVISIONAL pending clinician
// sign-off. The engine is side-effect-free; the caller persists state + enacts
// the returned effects (cooldown, closure, alert).

import { SESSION } from "./config";
import { COOLDOWN_HOURS } from "./config";

export type SessionPhase =
  | "created"
  | "authorized" // cleared to start a set
  | "set_active"
  | "post_set_reassessment"
  | "containment"
  | "closure"
  | "completed"
  | "denied"
  | "crisis";

export interface SessionState {
  phase: SessionPhase;
  startSuds: number | null;
  lastSuds: number | null;
  setsCompleted: number;
  /** Post-set SUDS readings in order. */
  sudsHistory: number[];
  /** Count of consecutive +1 rises (two → containment). */
  consecutiveRises: number;
  startedAtMs: number;
  stimulationLocked: boolean;
  closureStartedAtMs: number | null;
}

export type SessionAction =
  | "deny_stimulation"
  | "authorize_set"
  | "pause"
  | "offer_next_set"
  | "containment"
  | "closure"
  | "completed"
  | "crisis";

export interface SessionEffects {
  lockStimulation?: boolean;
  /** Start a cooldown of this many hours after the session (0 = none). */
  cooldownHours?: number;
  requireOrientation?: boolean;
  /** Log a coded safety alert (e.g. high SUDS / hard stop). */
  alert?: string;
}

export interface SessionDecision {
  state: SessionState;
  action: SessionAction;
  reason: string;
  /** Whether the member may be OFFERED another set (never auto-started). */
  allowNextSet: boolean;
  effects: SessionEffects;
}

export function newSession(nowMs: number): SessionState {
  return {
    phase: "created",
    startSuds: null,
    lastSuds: null,
    setsCompleted: 0,
    sudsHistory: [],
    consecutiveRises: 0,
    startedAtMs: nowMs,
    stimulationLocked: false,
    closureStartedAtMs: null,
  };
}

const minutesElapsed = (s: SessionState, nowMs: number) => (nowMs - s.startedAtMs) / 60000;

/** Pre-session starting-SUDS gate (Vol II §5; beta ceiling). */
export function preSessionCheck(state: SessionState, startSuds: number): SessionDecision {
  if (startSuds > SESSION.startingSudsCeiling) {
    return {
      state: { ...state, phase: "denied", startSuds },
      action: "deny_stimulation",
      reason:
        "Distress is a bit high to begin an activating exercise right now — grounding and stabilization are the steadier choice.",
      allowNextSet: false,
      effects: {},
    };
  }
  return {
    state: { ...state, phase: "authorized", startSuds, lastSuds: startSuds },
    action: "authorize_set",
    reason: "Cleared to begin — you can stop at any time.",
    allowNextSet: true,
    effects: {},
  };
}

/** Whether another set may be OFFERED (max sets, time, not locked). */
export function canOfferNextSet(state: SessionState, nowMs: number): boolean {
  return (
    !state.stimulationLocked &&
    state.setsCompleted < SESSION.maxSets &&
    minutesElapsed(state, nowMs) < SESSION.windDownMinutes &&
    state.phase !== "containment" &&
    state.phase !== "closure" &&
    state.phase !== "completed"
  );
}

/** Explicitly authorize a new set (caller confirmed the member chose to). */
export function authorizeSet(state: SessionState, nowMs: number): SessionDecision {
  if (!canOfferNextSet(state, nowMs)) {
    return toClosure(state, "This session is complete — let's close gently.");
  }
  return {
    state: { ...state, phase: "set_active" },
    action: "authorize_set",
    reason: "Starting the next set — stop whenever you need.",
    allowNextSet: false,
    effects: {},
  };
}

function toContainment(state: SessionState, reason: string, alert: string): SessionDecision {
  return {
    state: { ...state, phase: "containment", stimulationLocked: true },
    action: "containment",
    reason,
    allowNextSet: false,
    // Containment ending → cooldown (ledger A4 uses the 48h value).
    effects: { lockStimulation: true, cooldownHours: COOLDOWN_HOURS.containmentEnding, alert },
  };
}

function toClosure(state: SessionState, reason: string): SessionDecision {
  return {
    state: { ...state, phase: "closure", closureStartedAtMs: state.closureStartedAtMs },
    action: "closure",
    reason,
    allowNextSet: false,
    effects: {},
  };
}

/** Post-set reassessment — the core in-session safety logic (Vol II §5). */
export function postSet(
  state: SessionState,
  reading: { suds: number; dissociation: number; oriented: boolean },
  nowMs: number
): SessionDecision {
  const start = state.startSuds ?? reading.suds;
  const prev = state.lastSuds ?? start;
  const delta = reading.suds - prev;
  const riseOverStart = reading.suds - start;
  const rises = delta >= 1 ? state.consecutiveRises + 1 : 0;

  const next: SessionState = {
    ...state,
    phase: "post_set_reassessment",
    setsCompleted: state.setsCompleted + 1,
    sudsHistory: [...state.sudsHistory, reading.suds],
    lastSuds: reading.suds,
    consecutiveRises: rises,
  };

  // Orientation / dissociation stops (Vol II §5).
  if (!reading.oriented) {
    return {
      ...toContainment(next, "Let's pause the exercise and get grounded and oriented to right now.", "orientation_stop"),
      effects: { lockStimulation: true, cooldownHours: COOLDOWN_HOURS.containmentEnding, requireOrientation: true, alert: "orientation_stop" },
    };
  }
  if (reading.dissociation >= SESSION.dissociationStop) {
    return toContainment(next, "Feeling disconnected is a signal to stop the exercise and come back to the present.", "dissociation_stop");
  }

  // Containment conditions — conservative UNION (ledger A2).
  if (reading.suds >= SESSION.hardStopSuds) {
    return toContainment(next, "That's a strong wave — we'll stop the exercise and steady things.", "suds_hard_stop");
  }
  if (reading.suds >= SESSION.containmentAbsolute) {
    return toContainment(next, "Distress is high — we'll move to grounding and closure now.", "suds_absolute");
  }
  if (riseOverStart >= SESSION.containmentRiseOverStart) {
    return toContainment(next, "Distress has climbed since we began — time to steady and close.", "suds_rise_over_start");
  }
  if (delta >= SESSION.containmentDelta) {
    return toContainment(next, "That set raised distress — we'll pause the exercise and ground.", "suds_delta");
  }
  if (rises >= 2) {
    return toContainment(next, "Distress has risen two sets in a row — let's stop and steady.", "suds_two_rises");
  }
  // "No change" across N sets ends stimulation ("stuck is a stop signal").
  if (
    next.sudsHistory.length >= SESSION.noChangeSets &&
    next.sudsHistory.slice(-SESSION.noChangeSets).every((v) => v === next.sudsHistory[next.sudsHistory.length - 1])
  ) {
    return toClosure({ ...next, stimulationLocked: true }, "We'll rest the exercise here and close — no need to push.");
  }

  // Single +1 → pause and reassess (not containment).
  if (delta === 1) {
    return {
      state: { ...next, phase: "post_set_reassessment" },
      action: "pause",
      reason: "Let's pause a moment and check in before anything more.",
      allowNextSet: false,
      effects: {},
    };
  }

  // Stable/improved → eligible to be offered another set, else close.
  if (canOfferNextSet(next, nowMs)) {
    return {
      state: { ...next, phase: "authorized" },
      action: "offer_next_set",
      reason: "Steady — you can do another set or close here, your choice.",
      allowNextSet: true,
      effects: {},
    };
  }
  return toClosure(next, "That's our sets for today — let's close gently.");
}

/** One-tap Ground-Me — halts immediately, locks stimulation, no return (Vol II §5). */
export function groundMe(state: SessionState): SessionDecision {
  return {
    state: { ...state, phase: "containment", stimulationLocked: true },
    action: "containment",
    reason: "Grounding now. The exercise is paused for the rest of today — you're in control.",
    allowNextSet: false,
    effects: { lockStimulation: true, alert: "ground_me" },
  };
}

/** Time tick — wind-down and hard-stop (Vol II §5). */
export function tick(state: SessionState, nowMs: number): SessionDecision {
  const mins = minutesElapsed(state, nowMs);
  if (mins >= SESSION.hardStopMinutes && state.phase !== "completed" && state.phase !== "closure") {
    return toClosure({ ...state, stimulationLocked: true }, "We've reached the time limit — let's close well.");
  }
  if (mins >= SESSION.windDownMinutes) {
    return {
      state: { ...state, stimulationLocked: state.phase === "authorized" ? true : state.stimulationLocked },
      action: state.phase === "closure" ? "closure" : "offer_next_set",
      reason: "We're in the wind-down window — no new sets, just steadying and closing.",
      allowNextSet: false,
      effects: {},
    };
  }
  return {
    state,
    action: state.phase === "closure" ? "closure" : "offer_next_set",
    reason: "",
    allowNextSet: canOfferNextSet(state, nowMs),
    effects: {},
  };
}

/** Attempt to complete closure. Enforces the mandatory minimum duration. */
export function completeClosure(
  state: SessionState,
  finalSuds: number,
  closureSeconds: number
): SessionDecision {
  if (closureSeconds < SESSION.closureMinSeconds) {
    return {
      state: { ...state, phase: "closure" },
      action: "closure",
      reason: "A little longer with the closing exercise — it matters for how you land.",
      allowNextSet: false,
      effects: {},
    };
  }
  return {
    state: { ...state, phase: "completed", lastSuds: finalSuds },
    action: "completed",
    reason: "Closed and complete. Well done for taking care of yourself today.",
    allowNextSet: false,
    effects: {},
  };
}
