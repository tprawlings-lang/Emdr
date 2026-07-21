// Deterministic safety core — domain types (Autonomous Step 1).

/** Ordered access ceiling. Lower ordinal = more restrictive. "Most restrictive
 *  wins" is implemented as the MIN over all triggered rules. */
export enum AccessTier {
  CRISIS = 0, // crisis resources only; no program content
  GROUNDING_ONLY = 1, // grounding/orientation only
  STABILIZATION = 2, // stabilization + grounding; no activating content
  CAUTIOUS = 3, // cautious-track preparation
  STEADY = 4, // steady-track preparation (top of the beta ladder)
}

export const TIER_LABEL: Record<AccessTier, string> = {
  [AccessTier.CRISIS]: "crisis",
  [AccessTier.GROUNDING_ONLY]: "grounding_only",
  [AccessTier.STABILIZATION]: "stabilization",
  [AccessTier.CAUTIOUS]: "cautious",
  [AccessTier.STEADY]: "steady",
};

/** Independently-removable capabilities. A rule can strip a capability without
 *  necessarily lowering the tier (e.g. photosensitivity removes only visual
 *  stimulation). */
export interface Capabilities {
  /** Any activating bilateral stimulation (BLS) / processing-shaped practice. */
  stimulation: boolean;
  /** Visual BLS specifically (off globally in beta regardless). */
  visualStimulation: boolean;
  /** Guided imagery (e.g. calm-place) — restricted under high dissociation. */
  imagery: boolean;
}

/** A single deterministic rule firing. */
export interface RuleHit {
  /** Machine ID (Vol II §13 crosswalk), e.g. "DAILY_HARM_URGE". */
  id: string;
  /** Category for audit/grouping. */
  category: RuleCategory;
  /** Plain-language safety reason shown to the member (never a punitive score). */
  reason: string;
}

export type RuleCategory =
  | "crisis"
  | "program_fit"
  | "standing_restriction"
  | "dissociation"
  | "acute_trauma"
  | "daily_route"
  | "instrument"
  | "worsening"
  | "cooldown"
  | "reentry"
  | "readiness"
  | "missing_input"
  | "modality";

/** Accumulated dispositions (side-effects the caller must enact). */
export interface Dispositions {
  /** Present verified crisis/human-support resources immediately. */
  crisis: boolean;
  /** Ask the one approved binary safety question. */
  safetyQuestionRequired: boolean;
  /** Surface a clinician-referral route. */
  referralSurfaced: boolean;
  /** Standing program exclusion (reversible only by support contact). */
  standingExclusion: boolean;
  /** Auto-refund the current billing period (program-fit hard stop). */
  autoRefund: boolean;
  /** Absolute UTC ms until which activating content is blocked (max of all). */
  cooldownUntil: number | null;
  /** Absolute UTC ms until which forced stabilization applies (max of all). */
  forcedStabilizationUntil: number | null;
  /** Absolute UTC ms at which a state hard-stop may be retaken (if any). */
  retakeAllowedAt: number | null;
}

/** The inputs to a deterministic access decision. All already-resolved facts;
 *  the engine performs NO I/O. Missing/undefined safety inputs never default
 *  favorably (Vol II §11). `now` is passed for deterministic testing. */
export interface SafetyInputs {
  nowMs: number;

  /** Program-fit screener outcome (Vol II §2), already scored. */
  programFit?: {
    under18?: boolean;
    // state hard-stops (past 30d): recent self-harm ideation, unsafe situation
    selfHarm30d?: boolean;
    unsafeSituation?: boolean;
    // trait hard-stops: standing exclusions (support-contact reversal only)
    psychoticOrDissociativeDx?: boolean;
    hospitalized12m?: boolean;
    substanceDependence?: boolean;
    // soft flags
    seizureOrPhotosensitive?: boolean;
    acuteMedical?: boolean;
    /** ms since the state hard-stop was recorded (for the 14-day retake). */
    stateHardStopAtMs?: number | null;
  };

  /** Today's check-in (Vol II §3). Undefined = missing → grounding only. */
  dailyCheckin?: {
    activation: number; // 0–10
    shutdown: number; // 0–10
    harmUrge: boolean;
    feelsSafe: boolean;
    dissociation: number; // 0–10
    sleepQuality: number; // 0–10
    substanceFlag: boolean;
    intoxication?: boolean;
  };

  /** Item-level instrument safety flags + trend (Vol II §1). */
  instruments?: {
    phq9Item9?: number; // 0–3
    pcl5Item16?: number; // 0–4
    pcl5WeeklyRise?: number | null;
    itqCombinedWeeklyRise?: number | null;
    des2Mean?: number | null; // 0–100 (if DES-II adopted)
  };

  /** Days since a qualifying recent trauma, if known (Vol I A-8, 30-day). */
  daysSinceAcuteTrauma?: number | null;

  /** Active cooldowns as absolute expiry timestamps (Vol II §8). */
  activeCooldowns?: Array<{
    id: string;
    kind: "mild" | "containment" | "severe" | "forced_stabilization" | "crisis_hold";
    untilMs: number;
  }>;

  /** Pending re-entry after a cooldown, not yet satisfied (Vol II §8). */
  reentryPending?: boolean;

  /** Post-cooldown / worsening cautious-ceiling expiry timestamps. */
  cautiousCeilingUntilMs?: number | null;

  /** Resolved readiness track + caps (computed elsewhere — step 2). Optional so
   *  step 1 works before the readiness formula is ratified (ledger A1). */
  readiness?: {
    track?: "grounding" | "cautious" | "steady";
    lessThanFullySafe?: boolean; // → cap 30
    pauseCapacityNo?: boolean; // → cap 60 + no BLS/imagery
    riskFlag?: boolean; // → 0 / crisis
  };
}

/** The deterministic decision. Pure data — the caller persists the audit record
 *  and enacts dispositions. */
export interface AccessDecision {
  /** Effective access ceiling (most-restrictive of all triggered rules). */
  tier: AccessTier;
  tierLabel: string;
  /** Remaining capabilities after all removals. */
  capabilities: Capabilities;
  /** Whether an activating (BLS/processing-shaped) session may start now. */
  activatingSessionsAllowed: boolean;
  /** Whether ONLY grounding content is available (tier ≤ GROUNDING_ONLY). */
  groundingOnly: boolean;
  /** Accumulated dispositions. */
  dispositions: Dispositions;
  /** Every rule that fired, in evaluation order. */
  hits: RuleHit[];
  /** The member-facing reason for the strongest restriction (or null if none). */
  primaryReason: string | null;
}
