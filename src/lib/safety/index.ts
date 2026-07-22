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
export { SESSION_RULES, EXPERIENCE_RULES } from "./rule-catalog";
export type { CatalogRule } from "./rule-catalog";
export { BETA_CONFIG, SESSION, BLS, autonomousSafetyEnabled, voiceInputEnabled } from "./config";
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
export {
  MemoryClass,
  classifyMemory,
  decayState,
  canExposeToModel,
  canShareWithProvider,
  canInfluenceSafety,
  SENSITIVE_EPISODIC_TTL_DAYS,
} from "./memory";
export type { Provenance, ClassifiedMemory, DecayInput } from "./memory";
export {
  validateCompanionOutput,
  buildGuardrailBlock,
  SAFE_FALLBACK,
} from "./companion-guard";
export type { Violation, ViolationKind } from "./companion-guard";
export {
  JourneyStage,
  STAGE_OWNER,
  STAGE_GATE_ROUTE,
  resolveJourneyStage,
} from "./journey";
export type { JourneySignals, TransitionOwner } from "./journey";
export { orchestrateNext } from "./orchestrate";
export type { OrchestrationDecision, OrchestrationCategory } from "./orchestrate";
export {
  SAFETY_CONFIG_VERSION,
  killSwitches,
  generativeConversationDisabled,
  providerSharingDisabled,
  escalationAutomationDisabled,
  safetyConfigSnapshot,
  safetyCoreStatus,
  AUTONOMOUS_STAGES,
} from "./governance";
