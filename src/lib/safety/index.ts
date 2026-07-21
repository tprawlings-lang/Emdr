// Deterministic safety core (Autonomous Step 1) — public surface.
//
// The corpus's non-negotiable architecture: safety decisions are deterministic
// and verified; the AI companion is advisory only and must never invoke this to
// widen a member's access. Everything here is PROVISIONAL and gated on
// independent licensed-clinician sign-off (docs/autonomous/01-signoff-ledger.md).

export { evaluateAccess, buildRoutingAuditDetail } from "./engine";
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
export { BETA_CONFIG, autonomousSafetyEnabled } from "./config";
