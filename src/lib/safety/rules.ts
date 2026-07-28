// Deterministic safety core — machine-ID rule table (Autonomous Step 1).
//
// Each rule is pure data: an ID (Vol II §13 crosswalk), a category, a
// member-facing reason, a trigger predicate over resolved inputs, and a
// declarative effect. The engine folds every triggered rule into one decision
// by INTERSECTION (most restrictive wins). Input-driven items that are lists
// (active cooldowns) are handled in the engine, not here.
//
// All thresholds come from config.ts and are PROVISIONAL pending clinician
// sign-off (docs/autonomous/01-signoff-ledger.md).

import { AccessTier, RuleCategory, SafetyInputs } from "./types";
import { INSTRUMENT, DAILY, ACUTE_TRAUMA_EXCLUSION_DAYS, COOLDOWN_HOURS, BETA_CONFIG } from "./config";

export interface RuleEffect {
  /** Lower the access ceiling (engine takes the MIN). */
  tierCeiling?: AccessTier;
  removeStimulation?: boolean;
  removeVisualStimulation?: boolean;
  removeImagery?: boolean;
  crisis?: boolean;
  safetyQuestion?: boolean;
  referral?: boolean;
  standingExclusion?: boolean;
  autoRefund?: boolean;
  /** Start a forced-stabilization window of N hours from now. */
  forcedStabilizationHours?: number;
  /** Record a state-hard-stop retake window of N days from the recorded time. */
  retakeDays?: number;

  // ── Clinical-review revision (config beta-clinrev-2026-07) ────────────────
  /** Restricted access pending human review (replaces standing exclusions for
   *  diagnosis/history flags). */
  humanReviewPending?: boolean;
  /** Require a present-safety clarification before routing (replaces score-/
   *  history-only automatic crisis routing). */
  presentSafetyClarification?: boolean;
  /** Surface jurisdiction-aware emergency/support resources + truthful
   *  notification status. */
  jurisdictionAwareResources?: boolean;
  /** This numeric threshold is a review trigger (fresh check-in + human review),
   *  not a standalone automatic lockout. */
  reviewTrigger?: boolean;
  /** Route a possible medical emergency to urgent medical evaluation. */
  urgentMedicalReferral?: boolean;
}

export interface Rule {
  id: string;
  category: RuleCategory;
  reason: string;
  triggers: (i: SafetyInputs) => boolean;
  effect: RuleEffect;
}

const has = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

// Order here is documentation only; the engine evaluates all and intersects.
// Priority for the member-facing "primary reason" is derived from the resulting
// tier (lowest wins), with crisis always first.
export const RULES: Rule[] = [
  // ── Program-fit: permanent + state + trait (Vol II §2) ────────────────────
  {
    id: "FIT_UNDER_18",
    category: "program_fit",
    reason: "Steady is for adults 18 and over.",
    triggers: (i) => i.programFit?.under18 === true,
    effect: { tierCeiling: AccessTier.CRISIS, standingExclusion: true },
  },
  {
    // Clinical-review revision: a 30-day *history* flag alone is not present
    // crisis. Suspend activating content and run a present-safety clarification;
    // urgent routing only on current intent / inability to stay safe / action
    // already taken. No automatic crisis, refund, or fixed retake by history.
    id: "FIT_SELFHARM_30D",
    category: "program_fit",
    reason: "Given what you shared, we'll keep to grounding for now and check in on how you're doing today before anything activating.",
    triggers: (i) => i.programFit?.selfHarm30d === true,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, presentSafetyClarification: true, referral: true },
  },
  {
    // Clinical-review revision: define "unsafe situation" and branch by type in
    // the clarification (immediate danger? another person involved?); provide
    // jurisdiction-appropriate resources rather than one generic crisis script.
    id: "FIT_UNSAFE_SITUATION",
    category: "crisis",
    reason: "You told us your current situation isn't safe. Let's look at what would help most right now.",
    triggers: (i) => i.programFit?.unsafeSituation === true,
    effect: {
      tierCeiling: AccessTier.CRISIS,
      crisis: true,
      presentSafetyClarification: true,
      jurisdictionAwareResources: true,
    },
  },
  {
    // Clinical-review revision: diagnosis alone must not be a permanent
    // autonomous ban on low-demand education. Restrict activating access pending
    // human review of current orientation, stability, support, intended use.
    id: "FIT_PSYCHOTIC_DISSOCIATIVE_DX",
    category: "human_review",
    reason: "Based on your answers, we'll have a person review the best fit before activating work opens. Grounding and support stay available.",
    triggers: (i) => i.programFit?.psychoticOrDissociativeDx === true,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, humanReviewPending: true, referral: true },
  },
  {
    // Clinical-review revision (ledger A6): replace the fixed 12-month calendar
    // exclusion with human review using current stability, discharge plan,
    // safety, support, and clinician guidance. Activating stays closed until reviewed.
    id: "FIT_HOSPITALIZATION_12M",
    category: "human_review",
    reason: "Based on your answers, we'll have a person review the best fit before activating work opens. Grounding and support stay available.",
    triggers: (i) => i.programFit?.hospitalized12m === true,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, humanReviewPending: true, referral: true },
  },
  {
    // Clinical-review revision: history alone is not a permanent exclusion.
    // Current intoxication/withdrawal/impaired orientation is handled by the
    // daily rules; a dependence *history* routes to human review.
    id: "FIT_SUBSTANCE_DEPENDENCE",
    category: "human_review",
    reason: "Based on your answers, we'll have a person review the best fit before activating work opens. Grounding and support stay available.",
    triggers: (i) => i.programFit?.substanceDependence === true,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, humanReviewPending: true, referral: true },
  },
  {
    id: "FIT_SEIZURE_PHOTOSENSITIVE",
    category: "modality",
    reason: "Visual movement exercises are turned off for your account for safety.",
    triggers: (i) => i.programFit?.seizureOrPhotosensitive === true,
    effect: { removeVisualStimulation: true },
  },
  {
    // Clinical-review revision: route possible emergencies to urgent medical
    // evaluation; no activating work while an acute medical concern is unresolved.
    id: "FIT_ACUTE_MEDICAL",
    category: "program_fit",
    reason: "Given what you shared about your health, we'll keep to grounding and point you to medical support for anything urgent.",
    triggers: (i) => i.programFit?.acuteMedical === true,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true, urgentMedicalReferral: true, referral: true },
  },

  // ── Acute-trauma 30-day exclusion (Vol I A-8) ─────────────────────────────
  {
    // Clinical-review revision: retain the no-BLS restriction, but 30 days is
    // not treated as a universal clinical boundary — it is a review trigger.
    // Only low-demand education/orientation; current-state or clinician review
    // gates any later activating pathway.
    id: "ACUTE_TRAUMA_30D",
    category: "acute_trauma",
    reason: "So close to a recent hard event, grounding and orientation come first — activating exercises rest for now.",
    triggers: (i) =>
      has(i.daysSinceAcuteTrauma) && (i.daysSinceAcuteTrauma as number) < ACUTE_TRAUMA_EXCLUSION_DAYS,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true, reviewTrigger: true },
  },

  // ── Crisis from today's check-in (Vol II §3/§9) ───────────────────────────
  // Clinical-review revision: present-state crisis inputs keep the crisis floor,
  // but routing is a graduated present-safety clarification with jurisdiction-
  // aware resources and truthful notification status — not one generic script.
  {
    id: "DAILY_HARM_URGE",
    category: "crisis",
    reason: "Today's check-in flagged an urge to harm. Let's check in on right now and what would help most.",
    triggers: (i) => i.dailyCheckin?.harmUrge === true,
    effect: {
      tierCeiling: AccessTier.CRISIS,
      crisis: true,
      presentSafetyClarification: true,
      jurisdictionAwareResources: true,
    },
  },
  {
    id: "DAILY_NOT_SAFE",
    category: "crisis",
    reason: "You told us you can't keep yourself safe right now. Let's get you to support that can help.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.feelsSafe === false,
    effect: {
      tierCeiling: AccessTier.CRISIS,
      crisis: true,
      presentSafetyClarification: true,
      jurisdictionAwareResources: true,
    },
  },

  // ── Item-level instrument safety (Vol II §1/§9) ───────────────────────────
  {
    // Clinical-review revision: a nonzero PHQ-9 item 9 triggers a present-risk
    // clarification, not a fixed 72-hour lockout by itself. Response depends on
    // present intent/plan/means/action and ability to stay safe.
    id: "CRISIS_PHQ9_ITEM9",
    category: "instrument",
    reason: "A recent answer about safety means we'll keep to grounding and check in with you about how you're doing right now.",
    triggers: (i) => has(i.instruments?.phq9Item9) && i.instruments!.phq9Item9! >= INSTRUMENT.phq9Item9Flag,
    effect: {
      tierCeiling: AccessTier.STABILIZATION,
      presentSafetyClarification: true,
      safetyQuestion: true,
      referral: true,
    },
  },
  {
    // Clinical-review revision: PCL-5 item 16 concerns risk-taking behavior, not
    // suicidal ideation — it is NOT a suicide proxy. Removed as a safety-routing
    // rule; retained only as a context prompt (review trigger, no lockout).
    id: "PCL5_ITEM16_CONTEXT",
    category: "instrument",
    reason: "A recent answer is a good prompt to check in on how things are going — no change to your access.",
    triggers: (i) => has(i.instruments?.pcl5Item16) && i.instruments!.pcl5Item16! >= INSTRUMENT.pcl5Item16Flag,
    effect: { reviewTrigger: true },
  },

  // ── Daily route: grounding-only tier (Vol II §3) ──────────────────────────
  // Clinical-review revision: a numeric self-rating routes to grounding + a
  // present-orientation check and clarification — it is a review trigger, not a
  // diagnosis. Loss of present orientation / inability to follow a stop are the
  // hard stops (enforced in the session engine), not the number alone.
  {
    id: "DAILY_DISSOCIATION_7",
    category: "daily_route",
    reason: "Today feels more disconnected than usual — grounding is the most helpful place to be today.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.dissociation >= DAILY.dissociationGroundingOnly,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true, reviewTrigger: true },
  },
  {
    id: "DAILY_ACTIVATION_8",
    category: "daily_route",
    reason: "Activation is running high today — grounding modules are open and steadying, and you can stop any time.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.activation >= DAILY.activationGroundingOnly,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true, reviewTrigger: true },
  },
  {
    id: "DAILY_SHUTDOWN_8",
    category: "daily_route",
    reason: "Things feel shut down today — gentle, low-demand orientation is the right pace.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.shutdown >= DAILY.shutdownGroundingOnly,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true, reviewTrigger: true },
  },
  {
    // Agree (current intoxication): activating rests, grounding stays open.
    id: "DAILY_INTOXICATION",
    category: "daily_route",
    reason: "Activating exercises rest while substances are on board — grounding stays open.",
    triggers: (i) => i.dailyCheckin?.intoxication === true,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true },
  },

  // ── Daily route: stabilization tier (Vol II §3) ───────────────────────────
  {
    // Clinical-review revision: 4–6 is a caution signal → grounding + a present-
    // orientation check, not a state determination from the score alone.
    id: "DAILY_DISSOCIATION_4",
    category: "daily_route",
    reason: "A bit of disconnection today — stabilization and grounding are open; activating work waits.",
    triggers: (i) =>
      has(i.dailyCheckin) &&
      i.dailyCheckin!.dissociation >= DAILY.dissociationStabilization &&
      i.dailyCheckin!.dissociation < DAILY.dissociationGroundingOnly,
    effect: { tierCeiling: AccessTier.STABILIZATION, removeStimulation: true, reviewTrigger: true },
  },
  {
    // Clinical-review revision: low sleep reduces demand and prompts a brief
    // current-impairment check — a cautious ceiling, not a universal
    // stabilization restriction without context.
    id: "DAILY_SLEEP_LOW",
    category: "daily_route",
    reason: "Low sleep makes intense work harder — we'll keep the pace cautious and check in on today.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.sleepQuality <= DAILY.sleepStabilization,
    effect: { tierCeiling: AccessTier.CAUTIOUS, removeStimulation: true, reviewTrigger: true },
  },
  {
    // Clinical-review revision: distinguish current intoxication/withdrawal
    // (handled by DAILY_INTOXICATION) from a historical/prescribed report; a
    // same-day substance flag lowers intensity and prompts clarification.
    id: "DAILY_SUBSTANCE",
    category: "daily_route",
    reason: "Keeping intensity lower today; stabilization modules are open.",
    triggers: (i) => i.dailyCheckin?.substanceFlag === true,
    effect: { tierCeiling: AccessTier.STABILIZATION, removeStimulation: true, reviewTrigger: true },
  },

  // ── Missing check-in (Vol II §3/§11 — never default favorably) ─────────────
  {
    id: "MISSING_CHECKIN",
    category: "missing_input",
    reason: "Complete today's check-in before an activating session — until then, grounding is open.",
    triggers: (i) => !has(i.dailyCheckin),
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true },
  },

  // ── Dissociation trait (DES-II, Vol II §1/§2) ─────────────────────────────
  // Clinical-review revision (ledger A9): DES-II is NOT implemented/scored in
  // beta until lawfully licensed, validated, and given a clinician workflow.
  // Both rules are gated OFF via BETA_CONFIG.des2SurfaceEnabled and never fire.
  // If later adopted they must inform caution/referral only — never diagnose or
  // independently authorize/deny processing.
  {
    id: "DES2_HIGH",
    category: "dissociation",
    reason: "Given your dissociation screen, stabilization and grounding come first, and we'll surface clinician support.",
    triggers: (i) =>
      BETA_CONFIG.des2SurfaceEnabled &&
      has(i.instruments?.des2Mean) &&
      i.instruments!.des2Mean! >= INSTRUMENT.des2High,
    effect: {
      tierCeiling: AccessTier.STABILIZATION,
      removeStimulation: true,
      removeImagery: true,
      referral: true,
    },
  },
  {
    id: "DES2_CAUTION",
    category: "dissociation",
    reason: "We'll keep imagery gentle and state-dependent based on your dissociation screen.",
    triggers: (i) =>
      BETA_CONFIG.des2SurfaceEnabled &&
      has(i.instruments?.des2Mean) &&
      i.instruments!.des2Mean! >= INSTRUMENT.des2Caution &&
      i.instruments!.des2Mean! < INSTRUMENT.des2High,
    effect: { removeImagery: true },
  },

  // ── Weekly worsening → REVIEW TRIGGER (Vol II §1) ─────────────────────────
  // Clinical-review revision: a sharp rise is a review trigger + fresh check-in,
  // not an automatic 14-day ceiling. Confirm timing, data completeness, current
  // safety, and likely measurement variation via human review before any
  // consequential restriction. Low-demand education stays open meanwhile.
  {
    id: "PCL5_WEEKLY_RISE_10",
    category: "worsening",
    reason: "Your weekly measures rose sharply — we'll surface support and check in; nothing changes automatically.",
    triggers: (i) => has(i.instruments?.pcl5WeeklyRise) && i.instruments!.pcl5WeeklyRise! >= INSTRUMENT.pcl5WeeklyRise,
    effect: { reviewTrigger: true, referral: true },
  },
  {
    id: "ITQ_COMBINED_RISE_8",
    category: "worsening",
    reason: "Your weekly measures rose — we'll surface support and check in; nothing changes automatically.",
    triggers: (i) =>
      has(i.instruments?.itqCombinedWeeklyRise) &&
      i.instruments!.itqCombinedWeeklyRise! >= INSTRUMENT.itqCombinedWeeklyRise,
    effect: { reviewTrigger: true, referral: true },
  },

  // ── Educational Access State (clinical-review rename of "readiness") ───────
  // Clinical-review revision (ledger A1): do not represent a composite score as
  // clinical "readiness." These are explicit domain gates — current safety,
  // orientation, pause/stop capacity — that rank permitted educational options
  // and never authorize trauma processing.
  {
    id: "READY_RISK_FLAG",
    category: "educational_access",
    reason: "A safety flag means we route to support before anything else.",
    triggers: (i) => i.readiness?.riskFlag === true,
    effect: { tierCeiling: AccessTier.CRISIS, crisis: true },
  },
  {
    id: "READY_LESS_THAN_SAFE",
    category: "educational_access",
    reason: "Feeling less than fully safe keeps today in the steadying range — a current-safety gate, not a readiness score.",
    triggers: (i) => i.readiness?.lessThanFullySafe === true,
    effect: { tierCeiling: AccessTier.STABILIZATION },
  },
  {
    id: "READY_PAUSE_CAPACITY_LOW",
    category: "educational_access",
    reason: "Being able to pause and stop is a prerequisite — we'll practice those controls first.",
    triggers: (i) => i.readiness?.pauseCapacityNo === true,
    effect: { tierCeiling: AccessTier.CAUTIOUS, removeStimulation: true, removeImagery: true, reviewTrigger: true },
  },

  // ── Re-entry pending after a cooldown (Vol II §8) ─────────────────────────
  {
    id: "REENTRY_PENDING",
    category: "reentry",
    reason: "Coming back after a rest — a fresh check-in and grounding first, then access opens gradually.",
    triggers: (i) => i.reentryPending === true,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true },
  },
];
