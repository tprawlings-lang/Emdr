// Journey model (Autonomous Step 5) — the 22-stage member journey (Vol V Ch.4).
// Journey mapping is treated as hazard analysis; EVERY transition has a named
// owner (who is responsible for advancing it). Pure and side-effect-free.

export enum JourneyStage {
  Discovery = "discovery",
  Eligibility = "eligibility",
  AccountCreation = "account_creation",
  RoleClarification = "role_clarification",
  Orientation = "orientation",
  GoalFormation = "goal_formation",
  BaselinePreparation = "baseline_preparation",
  ModuleSelection = "module_selection",
  Preparation = "preparation",
  ModuleParticipation = "module_participation",
  Reflection = "reflection",
  Consolidation = "consolidation",
  Transition = "transition",
  ProviderConnection = "provider_connection",
  ProviderReview = "provider_review",
  Interruption = "interruption",
  ElevatedRisk = "elevated_risk",
  Disengagement = "disengagement",
  Return = "return",
  LongitudinalUse = "longitudinal_use",
  RelationshipChange = "relationship_change",
  AccountClosure = "account_closure",
}

/** Who owns advancing a transition (accountability, Vol V Ch.4/Ch.13). */
export type TransitionOwner = "member" | "system" | "deterministic_safety" | "clinician" | "billing";

export const STAGE_OWNER: Record<JourneyStage, TransitionOwner> = {
  [JourneyStage.Discovery]: "member",
  [JourneyStage.Eligibility]: "deterministic_safety",
  [JourneyStage.AccountCreation]: "member",
  [JourneyStage.RoleClarification]: "system",
  [JourneyStage.Orientation]: "member",
  [JourneyStage.GoalFormation]: "member",
  [JourneyStage.BaselinePreparation]: "member",
  [JourneyStage.ModuleSelection]: "system",
  [JourneyStage.Preparation]: "system",
  [JourneyStage.ModuleParticipation]: "member",
  [JourneyStage.Reflection]: "member",
  [JourneyStage.Consolidation]: "system",
  [JourneyStage.Transition]: "system",
  [JourneyStage.ProviderConnection]: "member",
  [JourneyStage.ProviderReview]: "clinician",
  [JourneyStage.Interruption]: "system",
  [JourneyStage.ElevatedRisk]: "deterministic_safety",
  [JourneyStage.Disengagement]: "member",
  [JourneyStage.Return]: "deterministic_safety",
  [JourneyStage.LongitudinalUse]: "system",
  [JourneyStage.RelationshipChange]: "member",
  [JourneyStage.AccountClosure]: "member",
};

/** Signals used to place a member in the journey (all already-resolved facts). */
export interface JourneySignals {
  hasAccount: boolean;
  eligibilityPassed: boolean; // program-fit passed (no active hard stop)
  subscribed: boolean;
  consented: boolean;
  baselineComplete: boolean;
  profileComplete: boolean;
  checkedInToday: boolean;
  inActiveSession: boolean;
  elevatedRisk: boolean; // crisis/standing-exclusion from the safety engine
  reentryPending: boolean;
  hasProviderConnection: boolean;
  disengaged: boolean; // long inactivity
  accountClosing: boolean;
}

/**
 * Resolve the member's primary journey stage. Safety-relevant states override
 * ordinary progression (elevated risk and account closure win), matching the
 * corpus rule that increasing risk narrows the journey rather than advancing it.
 */
export function resolveJourneyStage(s: JourneySignals): JourneyStage {
  if (s.accountClosing) return JourneyStage.AccountClosure;
  if (s.elevatedRisk) return JourneyStage.ElevatedRisk;
  if (!s.hasAccount) return JourneyStage.Discovery;
  if (!s.eligibilityPassed) return JourneyStage.Eligibility;
  if (!s.subscribed) return JourneyStage.AccountCreation;
  if (!s.consented) return JourneyStage.Orientation;
  if (!s.baselineComplete) return JourneyStage.BaselinePreparation;
  if (!s.profileComplete) return JourneyStage.GoalFormation;
  if (s.reentryPending) return JourneyStage.Return;
  if (s.inActiveSession) return JourneyStage.ModuleParticipation;
  if (!s.checkedInToday) return JourneyStage.ModuleSelection;
  if (s.disengaged) return JourneyStage.Disengagement;
  return JourneyStage.LongitudinalUse;
}

/** The gate route a pre-dashboard stage should send the member to. */
export const STAGE_GATE_ROUTE: Partial<Record<JourneyStage, string>> = {
  [JourneyStage.Discovery]: "/signup",
  [JourneyStage.Eligibility]: "/app/screening/fit",
  [JourneyStage.AccountCreation]: "/subscribe",
  [JourneyStage.Orientation]: "/app/onboarding",
  [JourneyStage.BaselinePreparation]: "/app/screening",
  [JourneyStage.GoalFormation]: "/app/onboarding/profile",
  [JourneyStage.ModuleSelection]: "/app/check-in",
  [JourneyStage.ElevatedRisk]: "/crisis",
  [JourneyStage.Return]: "/app/check-in",
  [JourneyStage.AccountClosure]: "/app/settings/account",
};
