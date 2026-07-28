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

// Clinical-review revision (config beta-clinrev-2026-07): beta runs NO
// autonomous bilateral stimulation / trauma-memory reprocessing. The
// stimulation/BLS rows below are retained as FAIL-SAFE stops and upper bounds
// only — they do not authorize autonomous sets. Any future BLS protocol needs a
// separately validated purpose, target restrictions, modality, per-set duration,
// consent, orientation checks, user stop, closure, aftercare, adverse-event
// monitoring, and clinician-supervised evidence before it may run.
export const SESSION_RULES: CatalogRule[] = [
  { id: "SESSION_START_SUDS_CEILING", category: "session_start", reason: `[No autonomous BLS in beta] If a future supervised protocol runs, deny stimulation when starting SUDS is above ${SESSION.startingSudsCeiling} — plus orientation, consent, stop-capacity, and clinician-approved context.` },
  { id: "SESSION_MAX_SETS", category: "session", reason: `[No autonomous processing sets in beta] Upper bound of ${SESSION.maxSets} sets is incomplete without per-set duration, modality, purpose, stop checks, and aftercare. Self-tapping may remain only as present-focused grounding.` },
  { id: "SESSION_CONTAINMENT_DELTA", category: "session_suds", reason: `Fail-safe: containment if post-set SUDS rises by ${SESSION.containmentDelta} or more.` },
  { id: "SESSION_CONTAINMENT_ABSOLUTE", category: "session_suds", reason: `Fail-safe: containment if post-set SUDS reaches ${SESSION.containmentAbsolute}.` },
  { id: "SESSION_HARD_STOP_SUDS", category: "session_suds", reason: `Fail-safe: hard-stop containment if SUDS reaches ${SESSION.hardStopSuds}.` },
  { id: "SESSION_RISE_OVER_START", category: "session_suds", reason: `Fail-safe: containment if SUDS rises ${SESSION.containmentRiseOverStart}+ over the starting value.` },
  { id: "SESSION_TWO_RISES", category: "session_suds", reason: "Fail-safe: containment after two consecutive +1 rises." },
  { id: "SESSION_NO_CHANGE", category: "session_suds", reason: `Fail-safe: close (no more sets) if SUDS is unchanged across ${SESSION.noChangeSets} sets ("stuck is a stop signal").` },
  { id: "SESSION_DISSOCIATION_STOP", category: "session_state", reason: `Hard stop on a defined dissociation scale (>= ${SESSION.dissociationStop}) OR loss of present orientation OR inability to follow a stop instruction; numeric elevation → reorient, no further sets.` },
  { id: "SESSION_ORIENTATION_STOP", category: "session_state", reason: "Stop + re-orient if the member is not oriented to the present (overrides SUDS)." },
  { id: "SESSION_WIND_DOWN", category: "session_time", reason: `Upper operational boundary only (${SESSION.windDownMinutes} min) — not evidence of safe processing; does not authorize autonomous BLS.` },
  { id: "SESSION_HARD_STOP_TIME", category: "session_time", reason: `Absolute session ceiling only (${SESSION.hardStopMinutes} min); it does not authorize activity inside the window.` },
  { id: "SESSION_CLOSURE_MIN", category: "session_closure", reason: `Closure FLOOR of ${SESSION.closureMinSeconds} seconds is necessary but not sufficient — closure also requires orientation confirmation, a member-reported stability check, and an escalation/human-review path if closure fails.` },
  { id: "SESSION_GROUND_ME", category: "session_control", reason: "Ground-Me: one-tap immediate halt, locks stimulation for the session, no return. User-initiated stop is available at any time." },
  { id: "BLS_HZ", category: "bls", reason: `[Disabled in beta] If later validated, bilateral stimulation ${BLS.minHz}–${BLS.maxHz} Hz (default ${BLS.defaultHz}); no adaptive speed, no mid-set increase. Speed alone cannot establish safety.` },
  { id: "BLS_NO_VISUAL_BETA", category: "bls", reason: "No visual BLS in beta (auditory + self-tapping only); visual BLS stays disabled." },
  { id: "BLS_FLASH_CEILING", category: "bls", reason: `Visual flashes/traverses never exceed ${BLS.maxFlashesPerSecond}/sec (WCAG 2.3.2).` },
  { id: "BLS_TIMING_FAILURE", category: "bls", reason: "On a stimulation timing failure: stop the set; never catch up or resume." },
];

// Experience & input features (for clinician sign-off). These are member-facing
// interaction features — how the session is delivered and how the member can
// respond — that carry safety, privacy, or accessibility weight and therefore
// need a clinician verdict before they may govern a real member. Same
// {id, category, reason} shape and same autonomous_signoffs storage as the
// rules above. Pure.
export const EXPERIENCE_RULES: CatalogRule[] = [
  {
    id: "VOICE_INPUT_ENABLED",
    category: "voice_input",
    reason:
      "Members may answer a free-text reflection by speaking. Typing is always available and never required — voice is an accessibility option, not a replacement (deaf and hard-of-hearing members keep a fully equivalent typed path).",
  },
  {
    id: "VOICE_INPUT_ON_DEVICE",
    category: "voice_input",
    reason:
      "Production commitment: speech is transcribed on the member's own device (native on-device recognition); raw audio is never uploaded or stored. Only the transcript the member confirms is kept, encrypted like any typed free text. (The in-browser demo uses the browser's built-in recognition and is labeled as a preview.)",
  },
  {
    id: "VOICE_INPUT_CONFIRM",
    category: "voice_input",
    reason:
      "The recognized text is shown in an editable field for the member to read, correct, and confirm before it is submitted or drives anything — recognition errors can never silently enter the record.",
  },
  {
    id: "VOICE_INPUT_SCOPE",
    category: "voice_input",
    reason:
      "Voice is offered only for free-text reflection entries — never for distress (SUDS) ratings, fit-screening answers, or any safety-gate input, which stay explicit taps/selections.",
  },
  {
    id: "VOICE_INPUT_CONSENT",
    category: "voice_input",
    reason:
      "Voice may be treated as biometric data in some jurisdictions. Before non-demo use it requires a distinct, versioned voice-input consent and counsel review; it is disabled by default outside demo.",
  },
  {
    id: "LIVE_SESSION_ENGINE_OWNS_FLOW",
    category: "live_session",
    reason:
      "In live spoken sessions the dynamic responder returns words and at most a Ground-me UI hint — it can NEVER continue a set, end closure, or override a stop. The deterministic session engine (SUDS → containment/hard-stop/cooldown) alone owns all clinical progression.",
  },
  {
    id: "LIVE_SESSION_CRISIS_SCRIPTED",
    category: "live_session",
    reason:
      "Spoken input is checked for crisis first (detectRisk); crisis and high-activation responses are deterministic and never AI-generated. Clinical-review revision: the response is a direct present-safety clarification with verified jurisdiction-aware resources, emergency guidance where danger is immediate, and truthful human-notification status — not one universal '988' script implying monitoring. Any AI phrasing only rewords an already-safe, non-crisis line and is discarded if it fails the output guard.",
  },
  {
    id: "LIVE_SESSION_BOUNDED_RESPONSE",
    category: "live_session",
    reason:
      "The responder draws on the member's tier, distress, exposable memory, and the tier-gated therapy KB, but never instructs reprocessing (no 'bring up / stay with the memory') and never claims feelings or outcomes. Every line passes the output guard with a deterministic fallback.",
  },
  {
    id: "LIVE_SESSION_DEMO_GATED",
    category: "live_session",
    reason:
      "Hands-free voice + dynamic in-session response is OFF for real members (demo/flag only) and requires clinician sign-off plus the voice/biometric consent before any non-demo use. Browser preview uses the browser recognizer; production uses on-device recognition.",
  },
];
