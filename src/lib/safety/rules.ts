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
import { INSTRUMENT, DAILY, ACUTE_TRAUMA_EXCLUSION_DAYS, COOLDOWN_HOURS } from "./config";

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
    id: "FIT_SELFHARM_30D",
    category: "crisis",
    reason: "Your recent answers point to safety concerns that deserve real human support right now.",
    triggers: (i) => i.programFit?.selfHarm30d === true,
    effect: { tierCeiling: AccessTier.CRISIS, crisis: true, autoRefund: true, retakeDays: 14 },
  },
  {
    id: "FIT_UNSAFE_SITUATION",
    category: "crisis",
    reason: "You told us your current situation isn't safe. Support that can help today comes first.",
    triggers: (i) => i.programFit?.unsafeSituation === true,
    effect: { tierCeiling: AccessTier.CRISIS, crisis: true, autoRefund: true, retakeDays: 14 },
  },
  {
    id: "FIT_PSYCHOTIC_DISSOCIATIVE_DX",
    category: "standing_restriction",
    reason: "Based on your answers, this self-guided program isn't the right fit. A support contact can help you find better-matched care.",
    triggers: (i) => i.programFit?.psychoticOrDissociativeDx === true,
    effect: { tierCeiling: AccessTier.CRISIS, standingExclusion: true, referral: true },
  },
  {
    id: "FIT_HOSPITALIZATION_12M",
    category: "standing_restriction",
    reason: "Based on your answers, this self-guided program isn't the right fit right now. A support contact can help.",
    triggers: (i) => i.programFit?.hospitalized12m === true,
    effect: { tierCeiling: AccessTier.CRISIS, standingExclusion: true, referral: true },
  },
  {
    id: "FIT_SUBSTANCE_DEPENDENCE",
    category: "standing_restriction",
    reason: "Based on your answers, this program isn't the right fit right now. A support contact can help find better-matched care.",
    triggers: (i) => i.programFit?.substanceDependence === true,
    effect: { tierCeiling: AccessTier.CRISIS, standingExclusion: true, referral: true },
  },
  {
    id: "FIT_SEIZURE_PHOTOSENSITIVE",
    category: "modality",
    reason: "Visual movement exercises are turned off for your account for safety.",
    triggers: (i) => i.programFit?.seizureOrPhotosensitive === true,
    effect: { removeVisualStimulation: true },
  },
  {
    id: "FIT_ACUTE_MEDICAL",
    category: "program_fit",
    reason: "We'll keep the pace gentle given what you shared about your health, and surface extra resources.",
    triggers: (i) => i.programFit?.acuteMedical === true,
    effect: { tierCeiling: AccessTier.CAUTIOUS, referral: true },
  },

  // ── Acute-trauma 30-day exclusion (Vol I A-8) ─────────────────────────────
  {
    id: "ACUTE_TRAUMA_30D",
    category: "acute_trauma",
    reason: "So close to a recent hard event, grounding and orientation come first — activating exercises rest for now.",
    triggers: (i) =>
      has(i.daysSinceAcuteTrauma) && (i.daysSinceAcuteTrauma as number) < ACUTE_TRAUMA_EXCLUSION_DAYS,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true },
  },

  // ── Crisis from today's check-in (Vol II §3/§9) ───────────────────────────
  {
    id: "DAILY_HARM_URGE",
    category: "crisis",
    reason: "Today's check-in flagged an urge to harm. Support that can help right now comes first.",
    triggers: (i) => i.dailyCheckin?.harmUrge === true,
    effect: { tierCeiling: AccessTier.CRISIS, crisis: true },
  },
  {
    id: "DAILY_NOT_SAFE",
    category: "crisis",
    reason: "You told us you can't keep yourself safe right now. Human support comes first.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.feelsSafe === false,
    effect: { tierCeiling: AccessTier.CRISIS, crisis: true },
  },

  // ── Item-level instrument safety (Vol II §1/§9) ───────────────────────────
  {
    id: "CRISIS_PHQ9_ITEM9",
    category: "instrument",
    reason: "A recent answer about safety means we'll pause activating work and check in on how you're doing.",
    triggers: (i) => has(i.instruments?.phq9Item9) && i.instruments!.phq9Item9! >= INSTRUMENT.phq9Item9Flag,
    effect: {
      tierCeiling: AccessTier.STABILIZATION,
      safetyQuestion: true,
      referral: true,
      forcedStabilizationHours: COOLDOWN_HOURS.forcedStabilization,
    },
  },
  {
    id: "CRISIS_PCL5_ITEM16",
    category: "instrument",
    reason: "A recent answer means we'll keep intensity low for a little while and check in with you.",
    triggers: (i) => has(i.instruments?.pcl5Item16) && i.instruments!.pcl5Item16! >= INSTRUMENT.pcl5Item16Flag,
    effect: {
      tierCeiling: AccessTier.STABILIZATION,
      safetyQuestion: true,
      referral: true,
      forcedStabilizationHours: COOLDOWN_HOURS.forcedStabilization,
    },
  },

  // ── Daily route: grounding-only tier (Vol II §3) ──────────────────────────
  {
    id: "DAILY_DISSOCIATION_7",
    category: "daily_route",
    reason: "Today feels more disconnected than usual — grounding is the most helpful place to be today.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.dissociation >= DAILY.dissociationGroundingOnly,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true },
  },
  {
    id: "DAILY_ACTIVATION_8",
    category: "daily_route",
    reason: "Activation is running high today — grounding modules are open and steadying.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.activation >= DAILY.activationGroundingOnly,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true },
  },
  {
    id: "DAILY_SHUTDOWN_8",
    category: "daily_route",
    reason: "Things feel shut down today — gentle grounding is the right pace.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.shutdown >= DAILY.shutdownGroundingOnly,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true },
  },
  {
    id: "DAILY_INTOXICATION",
    category: "daily_route",
    reason: "Activating exercises rest while substances are on board — grounding stays open.",
    triggers: (i) => i.dailyCheckin?.intoxication === true,
    effect: { tierCeiling: AccessTier.GROUNDING_ONLY, removeStimulation: true },
  },

  // ── Daily route: stabilization tier (Vol II §3) ───────────────────────────
  {
    id: "DAILY_DISSOCIATION_4",
    category: "daily_route",
    reason: "A bit of disconnection today — stabilization and grounding are open; activating work waits.",
    triggers: (i) =>
      has(i.dailyCheckin) &&
      i.dailyCheckin!.dissociation >= DAILY.dissociationStabilization &&
      i.dailyCheckin!.dissociation < DAILY.dissociationGroundingOnly,
    effect: { tierCeiling: AccessTier.STABILIZATION, removeStimulation: true },
  },
  {
    id: "DAILY_SLEEP_LOW",
    category: "daily_route",
    reason: "Low sleep makes intense work harder — stabilization is a kinder choice today.",
    triggers: (i) => has(i.dailyCheckin) && i.dailyCheckin!.sleepQuality <= DAILY.sleepStabilization,
    effect: { tierCeiling: AccessTier.STABILIZATION, removeStimulation: true },
  },
  {
    id: "DAILY_SUBSTANCE",
    category: "daily_route",
    reason: "Keeping intensity lower today; stabilization modules are open.",
    triggers: (i) => i.dailyCheckin?.substanceFlag === true,
    effect: { tierCeiling: AccessTier.STABILIZATION, removeStimulation: true },
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
  {
    id: "DES2_HIGH",
    category: "dissociation",
    reason: "Given your dissociation screen, stabilization and grounding come first, and we'll surface clinician support.",
    triggers: (i) => has(i.instruments?.des2Mean) && i.instruments!.des2Mean! >= INSTRUMENT.des2High,
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
      has(i.instruments?.des2Mean) &&
      i.instruments!.des2Mean! >= INSTRUMENT.des2Caution &&
      i.instruments!.des2Mean! < INSTRUMENT.des2High,
    effect: { removeImagery: true },
  },

  // ── Weekly worsening → 14-day cautious ceiling + referral (Vol II §1) ─────
  {
    id: "PCL5_WEEKLY_RISE_10",
    category: "worsening",
    reason: "Your weekly measures rose sharply — we'll keep the track cautious for a couple of weeks and surface support.",
    triggers: (i) => has(i.instruments?.pcl5WeeklyRise) && i.instruments!.pcl5WeeklyRise! >= INSTRUMENT.pcl5WeeklyRise,
    effect: { tierCeiling: AccessTier.CAUTIOUS, referral: true },
  },
  {
    id: "ITQ_COMBINED_RISE_8",
    category: "worsening",
    reason: "Your weekly measures rose — cautious pacing for a couple of weeks, with support surfaced.",
    triggers: (i) =>
      has(i.instruments?.itqCombinedWeeklyRise) &&
      i.instruments!.itqCombinedWeeklyRise! >= INSTRUMENT.itqCombinedWeeklyRise,
    effect: { tierCeiling: AccessTier.CAUTIOUS, referral: true },
  },

  // ── Readiness caps (Vol II §4 — caps are the safety mechanism) ────────────
  {
    id: "READY_RISK_FLAG",
    category: "readiness",
    reason: "A safety flag means we route to support before anything else.",
    triggers: (i) => i.readiness?.riskFlag === true,
    effect: { tierCeiling: AccessTier.CRISIS, crisis: true },
  },
  {
    id: "READY_LESS_THAN_SAFE",
    category: "readiness",
    reason: "Feeling less than fully safe keeps today in the stabilization range.",
    triggers: (i) => i.readiness?.lessThanFullySafe === true,
    effect: { tierCeiling: AccessTier.STABILIZATION },
  },
  {
    id: "READY_PAUSE_CAPACITY_LOW",
    category: "readiness",
    reason: "Being able to pause is a prerequisite for activating work — we'll build that first.",
    triggers: (i) => i.readiness?.pauseCapacityNo === true,
    effect: { tierCeiling: AccessTier.CAUTIOUS, removeStimulation: true, removeImagery: true },
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
