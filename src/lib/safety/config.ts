// Deterministic safety core — configuration (Autonomous Step 1).
//
// Sources: clinician-authored Volume II (Deterministic Routing) resolved with
// its own §12 "Conservative Initial Beta Configuration". EVERY value here is
// PROVISIONAL and pending independent licensed-clinician sign-off
// (docs/autonomous/01-signoff-ledger.md). Where Volume II conflicts with
// itself, we use the safest value and record the conflict in the ledger.
//
// This module is pure and side-effect-free. It does not read the DB, call the
// model, or perform I/O. It only computes deterministic access decisions from
// explicit inputs, so it is exhaustively testable.

/** Master flag. The engine is inert in app flows until this is enabled, and it
 *  must NOT be enabled outside demo/beta before clinician sign-off. */
export function autonomousSafetyEnabled(): boolean {
  return process.env.EMDR_AUTONOMOUS_SAFETY === "1";
}

// ── Conservative Initial Beta Configuration (Vol II §12) ────────────────────
export const BETA_CONFIG = {
  /** Beta ships 3 tracks; "expanded" is disabled. */
  tracks: ["grounding", "cautious", "steady"] as const,
  /** Auditory + self-tapping only in beta; no visual BLS until a11y/device
   *  validation. Enforced as a global capability removal. (Ledger A7.) */
  visualStimulationEnabled: false,
  /** Max stimulation sets in early beta (Vol II §12; ledger A5). */
  maxStimulationSets: 2,
  /** Starting-SUDS ceiling to permit stimulation (Vol II §12). */
  startingSudsCeiling: 5,
  /** Daily dissociation at/above this blocks stimulation (Vol II §12). */
  dissociationBlocksStimulationAt: 4,
  /** Mandatory closure seconds (Vol II §12; main-body value, ledger A7). */
  closureMinSeconds: 120,
  /** One activating session per operational day (Vol II §12). */
  maxActivatingSessionsPerDay: 1,
} as const;

// ── Instrument thresholds (Vol II §1; all provisional, ledger §B) ───────────
export const INSTRUMENT = {
  pcPtsd5Positive: 3, // ≥3
  pcl5Positive: 33, // ≥33
  pcl5Item16Flag: 3, // item 16 ≥3 → 72h stabilization + safety question
  pcl5WeeklyRise: 10, // week-over-week ≥10 → 14-day cautious ceiling
  itqCombinedWeeklyRise: 8, // ptsdSum+dsoSum rise ≥8 → 14-day cautious ceiling
  phq9Positive: 10, // ≥10
  phq9Item9Flag: 1, // ANY nonzero → 72h stabilization + safety question
  gad7Positive: 10, // ≥10
  des2Caution: 20, // 20–29.99 silent caution
  des2High: 30, // ≥30 grounding-first + imagery restriction + referral
} as const;

// ── Daily check-in routing thresholds (Vol II §3; ledger §B) ────────────────
export const DAILY = {
  dissociationGroundingOnly: 7, // ≥7 → grounding only
  activationGroundingOnly: 8, // ≥8 → grounding only
  shutdownGroundingOnly: 8, // ≥8 → grounding only
  dissociationStabilization: 4, // 4–6 → stabilization
  sleepStabilization: 2, // ≤2 → stabilization
} as const;

// ── Cooldown durations (Vol II §8; ledger A4 uses the longer 48h) ───────────
export const COOLDOWN_HOURS = {
  mildWorsening: 24,
  containmentEnding: 48, // ledger A4: main-body/crosswalk value (vs advisor 24h)
  severeDistress: 72,
  forcedStabilization: 72, // after item-9/item-16/post-session escalation
  crisisHold: 48, // Row 19: hold after any crisis routing
} as const;

// ── Post-cooldown cautious-ceiling durations, days (Vol II §8) ──────────────
export const CAUTIOUS_CEILING_DAYS = {
  mildWorsening: 1,
  containmentEnding: 3,
  severeDistress: 7,
  weeklyWorsening: 14, // PCL-5/ITQ worsening
  stateHardStopReturn: 30, // after a state program-fit hard-stop returns
} as const;

// ── Program-fit retake windows (Vol II §2; ledger §B) ───────────────────────
export const PROGRAM_FIT = {
  stateHardStopRetakeDays: 14, // state hard-stops: 14-day retake window
  // trait hard-stops: standing, reversible ONLY by support contact (no retake)
} as const;

// ── Acute-trauma exclusion (Vol I A-8) ──────────────────────────────────────
export const ACUTE_TRAUMA_EXCLUSION_DAYS = 30;

// ── Session-runtime safety (Vol II §5/§7; Vol I A-1..A-7) ───────────────────
// Beta uses the CONSERVATIVE UNION where Vol II conflicts with itself
// (ledger A2/A3): a set is stopped/contained if ANY stop condition fires.
export const SESSION = {
  /** Starting SUDS strictly above this denies stimulation (beta ceiling 5). */
  startingSudsCeiling: 5,
  /** Max stimulation sets in beta (ledger A5). */
  maxSets: 2,
  /** Wind-down begins (no new sets) at this many minutes (ledger A3: 30/40). */
  windDownMinutes: 30,
  /** Hard stop — force closure — at this many minutes. */
  hardStopMinutes: 40,
  /** Mandatory minimum closure seconds. */
  closureMinSeconds: 120,
  /** Ordinary-completion SUDS target at closure. */
  closureTargetSuds: 4,
  /** Post-set delta at/above which the session goes to containment (main +2). */
  containmentDelta: 2,
  /** Absolute post-set SUDS at/above which containment fires (App A ≥8). */
  containmentAbsolute: 8,
  /** Absolute SUDS at/above which the session hard-stops (App A ≥9). */
  hardStopSuds: 9,
  /** Rise over the STARTING suds at/above which containment fires (App A ≥3). */
  containmentRiseOverStart: 3,
  /** State dissociation at/above which stimulation stops (Vol II §5). */
  dissociationStop: 4,
  /** "No change" across this many sets ends stimulation (main body = 2). */
  noChangeSets: 2,
} as const;

// ── Bilateral stimulation (Vol II §7; Vol I A-1) ────────────────────────────
export const BLS = {
  defaultHz: 1.25,
  minHz: 1.0,
  maxHz: 1.5,
  cautiousHz: 1.0,
  /** WCAG 2.3.2 hard ceiling — never exceed, regardless of any other value. */
  maxFlashesPerSecond: 3,
  /** Preview seconds for a new modality. */
  previewSeconds: 5,
} as const;

// ── Readiness caps (Vol II §4 Appendix; caps ARE the safety mechanism) ──────
export const READINESS_CAP = {
  lessThanFullySafeCeiling: 30, // → stabilization band
  pauseCapacityNoCeiling: 60, // → cautious band
} as const;
