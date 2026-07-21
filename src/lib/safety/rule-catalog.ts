// Session-rule catalog (for clinician sign-off). The session-runtime rules live
// as thresholds/logic in session.ts rather than as machine-ID data rows, so this
// catalog exposes each one — with its current provisional value — as a
// sign-off-able item, in the same {id, category, reason} shape as the access
// RULES. Verdicts are stored in the same autonomous_signoffs table, scoped to
// the config version. Pure.

import { SESSION, BLS } from "./config";

export interface CatalogRule {
  id: string;
  category: string;
  reason: string;
}

export const SESSION_RULES: CatalogRule[] = [
  { id: "SESSION_START_SUDS_CEILING", category: "session_start", reason: `Deny stimulation if starting SUDS is above ${SESSION.startingSudsCeiling}.` },
  { id: "SESSION_MAX_SETS", category: "session", reason: `At most ${SESSION.maxSets} stimulation sets per session (beta).` },
  { id: "SESSION_CONTAINMENT_DELTA", category: "session_suds", reason: `Containment if post-set SUDS rises by ${SESSION.containmentDelta} or more.` },
  { id: "SESSION_CONTAINMENT_ABSOLUTE", category: "session_suds", reason: `Containment if post-set SUDS reaches ${SESSION.containmentAbsolute}.` },
  { id: "SESSION_HARD_STOP_SUDS", category: "session_suds", reason: `Hard-stop containment if SUDS reaches ${SESSION.hardStopSuds}.` },
  { id: "SESSION_RISE_OVER_START", category: "session_suds", reason: `Containment if SUDS rises ${SESSION.containmentRiseOverStart}+ over the starting value.` },
  { id: "SESSION_TWO_RISES", category: "session_suds", reason: "Containment after two consecutive +1 rises." },
  { id: "SESSION_NO_CHANGE", category: "session_suds", reason: `Close (no more sets) if SUDS is unchanged across ${SESSION.noChangeSets} sets ("stuck is a stop signal").` },
  { id: "SESSION_DISSOCIATION_STOP", category: "session_state", reason: `Stop the exercise if in-session dissociation reaches ${SESSION.dissociationStop}.` },
  { id: "SESSION_ORIENTATION_STOP", category: "session_state", reason: "Stop + re-orient if the member is not oriented to the present." },
  { id: "SESSION_WIND_DOWN", category: "session_time", reason: `Wind-down (no new sets) at ${SESSION.windDownMinutes} minutes.` },
  { id: "SESSION_HARD_STOP_TIME", category: "session_time", reason: `Force closure at ${SESSION.hardStopMinutes} minutes.` },
  { id: "SESSION_CLOSURE_MIN", category: "session_closure", reason: `Mandatory closure of at least ${SESSION.closureMinSeconds} seconds, regardless of score.` },
  { id: "SESSION_GROUND_ME", category: "session_control", reason: "Ground-Me: one-tap immediate halt, locks stimulation for the session, no return." },
  { id: "BLS_HZ", category: "bls", reason: `Bilateral stimulation ${BLS.minHz}–${BLS.maxHz} Hz (default ${BLS.defaultHz}); no adaptive speed, no mid-set increase.` },
  { id: "BLS_NO_VISUAL_BETA", category: "bls", reason: "No visual BLS in beta (auditory + self-tapping only)." },
  { id: "BLS_FLASH_CEILING", category: "bls", reason: `Visual flashes/traverses never exceed ${BLS.maxFlashesPerSecond}/sec (WCAG 2.3.2).` },
  { id: "BLS_TIMING_FAILURE", category: "bls", reason: "On a stimulation timing failure: stop the set; never catch up or resume." },
];
