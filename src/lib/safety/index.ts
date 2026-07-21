// Deterministic safety core (Autonomous Step 1) — public surface.
//
// The corpus's non-negotiable architecture: safety decisions are deterministic
// and verified; the AI companion is advisory only and must never invoke this to
// widen a member's access. Everything here is PROVISIONAL and gated on
// independent licensed-clinician sign-off (docs/autonomous/01-signoff-ledger.md).

export { evaluateAccess, buildRoutingAuditDetail } from "./engine";
export { decideAccess, shadowDecide } from "./decide";
export { gatherSafetyInputs } from "./gather";
export { scoreReadiness } from "./readiness";
export { mapProgramFit, stateHardStopActive, traitHardStopActive } from "./program-fit";
export { AccessTier, TIER_LABEL } from "./types";
export type {
  SafetyInputs,
  AccessDecision,
  Capabilities,
  Dispositions,
  RuleHit,
  RuleCategory,
} from "./types";
export { RULES } from "./rules";
export { BETA_CONFIG, SESSION, BLS, autonomousSafetyEnabled } from "./config";
export {
  newSession,
  preSessionCheck,
  postSet,
  authorizeSet,
  canOfferNextSet,
  groundMe,
  tick,
  completeClosure,
} from "./session";
export type { SessionState, SessionPhase, SessionDecision, SessionAction } from "./session";
