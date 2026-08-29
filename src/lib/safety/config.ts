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

/** Companion output-guard ENFORCEMENT (audit finding). Blocking a violating
 *  candidate must not wait for full autonomous governance: in demo (where the
 *  clinician reviews) and whenever the master flag is on, a violation is
 *  replaced with the safe fallback instead of merely logged. Only a
 *  no-flag production deploy still runs the guard in shadow (log-only) —
 *  and that configuration predates autonomy and keeps its current
 *  counsel-approved behavior. */
export function companionGuardEnforced(): boolean {
  return autonomousSafetyEnabled() || process.env.EMDR_DEMO === "1";
}

/** Live spoken sessions: hands-free voice + a dynamic (memory/rule/KB-aware)
 *  in-session responder. Highest-risk surface, so it is OFF by default and only
 *  available in demo (for the clinician to experience and review) unless
 *  explicitly flagged. Even when on, the deterministic session engine still
 *  owns every clinical decision; this only adds a spoken conversational layer.
 *  Requires clinician sign-off before non-demo use. */
export function liveSessionEnabled(): boolean {
  return process.env.EMDR_LIVE_SESSION === "1" || process.env.EMDR_DEMO === "1";
}

/** Voice responses (member answers a free-text reflection by speaking instead
 *  of typing). On automatically in demo so the clinician can experience it and
 *  review it; off for real members until explicitly flagged AND signed off.
 *  Typing is always available and never required — voice is an accessibility
 *  option, not a replacement. See EXPERIENCE_RULES for the guardrails under
 *  clinician review. */
export function voiceInputEnabled(): boolean {
  return process.env.EMDR_VOICE_INPUT === "1" || process.env.EMDR_DEMO === "1";
}

// ── Conservative Initial Beta Configuration (Vol II §12) ────────────────────
// Revised per the clinical-review draft (config version beta-clinrev-2026-07;
// docs/autonomous/01-signoff-ledger.md changelog). The headline change: beta
// runs NO autonomous bilateral stimulation / trauma-memory reprocessing.
export const BETA_CONFIG = {
  /** Beta ships 3 tracks; "expanded" is disabled. */
  tracks: ["grounding", "cautious", "steady"] as const,
  /** Clinical-review revision (ledger A3/A5/A7): beta performs NO autonomous
   *  BLS / trauma-memory reprocessing. Speed/duration/set-count alone cannot
   *  establish safety; a future protocol needs independent clinical +
   *  human-factors validation. Self-tapping remains available only as a
   *  present-focused grounding/orienting skill, never memory processing.
   *  When false, the engine removes the `stimulation` capability globally. */
  autonomousStimulationEnabled: false,
  /** Visual BLS (the moving dot), enabled by product-owner decision on
   *  2026-08-28. This REVERSES ledger A7, which read "auditory + self-tapping
   *  only in beta; no visual BLS until a11y/device validation."
   *
   *  Why it was reversed rather than the UI corrected: the session has been
   *  offering the moving dot as the DEFAULT modality all along, with a speed
   *  picker, to every member without a seizure flag — verified in the running
   *  app, not inferred. The config said one thing and the product did another,
   *  and the owner's call was that the product was right.
   *
   *  What this flag now means, precisely:
   *    - visual BLS is a permitted modality, not a validated one;
   *    - the a11y control A7 was waiting for is now IMPLEMENTED rather than
   *      pending — BlsVisual clamps traverses to BLS.maxFlashesPerSecond
   *      (WCAG 2.3.2), which until now existed only as a number here and a
   *      sentence in the rule catalog;
   *    - photosensitivity still removes it entirely, per the engine capability
   *      and the fitness screener's seizure flag;
   *    - DEVICE validation has still not happened. That half of A7 is open.
   *
   *  Flipping this back to false now actually works: SessionPlayer reads the
   *  capability rather than ignoring it, which was the underlying defect. */
  visualStimulationEnabled: true,
  /** Clinical-review revision (ledger A9): DES-II is NOT surfaced or scored in
   *  beta until lawful commercial licensing, scoring fidelity, interpretation
   *  limits, and clinician workflow are independently confirmed. When false,
   *  the DES-II rules never fire. */
  des2SurfaceEnabled: false,
  /** Max stimulation sets in early beta (Vol II §12; ledger A5). Retained only
   *  as an upper operational bound for any FUTURE validated protocol — it does
   *  not authorize autonomous sets while autonomousStimulationEnabled is false. */
  maxStimulationSets: 2,
  /** Starting-SUDS ceiling to permit stimulation (Vol II §12). */
  startingSudsCeiling: 5,
  /** Daily dissociation at/above this blocks stimulation (Vol II §12). */
  dissociationBlocksStimulationAt: 4,
  /** Mandatory closure seconds — a FLOOR, not a sufficient condition (ledger
   *  A2/closure change): closure also requires orientation confirmation and a
   *  member-reported stability check before a session may complete. */
  closureMinSeconds: 120,
  /** One activating session per operational day (Vol II §12). */
  maxActivatingSessionsPerDay: 1,
} as const;

// ── Resourcing BLS (Phase 4a — Calm/Safe Place installation) ────────────────
// The clinician-approved BLS protocol (bls-protocol-v1) staged rollout begins
// with RESOURCING ONLY: short, slow bilateral stimulation paired with a positive
// resource + cue word (docs/autonomous/bls-validation). This is NOT trauma-memory
// desensitization — that stays disabled (`autonomousStimulationEnabled = false`).
// Resourcing is gated separately so 4a can be piloted without enabling 4b/4c.
export const BLS_RESOURCING = {
  /** Slow speed for resourcing (research: short, slow sets). */
  hz: 1.0,
  /** Short sets so installation does NOT open processing (~4–8 passes). */
  passesPerSet: 6,
  /** Approximate seconds per set at the above (short by design). */
  approxSecondsPerSet: 8,
  /** A few short sets to install the resource. */
  maxSets: 4,
  /** Member chooses a cue word paired with the resource. */
  cueWordRequired: true,
} as const;

/** Phase-4a resourcing BLS gate.
 *
 *  ON in demo, so a clinician reviewing the environment can actually walk a
 *  resourcing session and say what they would change. It was previously off
 *  even in demo, which meant the flagship clinical workstream was the one thing
 *  a clinical reviewer could not exercise — a reviewer who cannot run the
 *  workflow cannot give feedback on it, and unusable-by-default is not a safety
 *  property when the data is fabricated.
 *
 *  Off by default everywhere else, and enabled explicitly for a monitored
 *  pilot. Two things still hold regardless: `EMDR_KILL_BLS` overrides this to
 *  false, and each member needs an unrevoked processing-session consent.
 *
 *  Desensitization is NOT this flag. It stays governed by
 *  `autonomousStimulationEnabled`, which is false in the signed configuration
 *  and which no environment variable can reach. Set `EMDR_BLS_RESOURCING=0` to
 *  force it off in demo — useful for demonstrating the refusal path. */
export function blsResourcingEnabled(): boolean {
  if (process.env.EMDR_BLS_RESOURCING === "0") return false;
  return process.env.EMDR_BLS_RESOURCING === "1" || process.env.EMDR_DEMO === "1";
}

// ── Finalized program-fit gate wording (ledger A8) ──────────────────────────
// Replaces the `fit-v1-placeholder` item. Preparation-only scope stated plainly;
// no diagnosis, no readiness-for-processing determination, no clinician
// replacement. Pending clinician ratification at the new config version.
export const PROGRAM_FIT_GATE_WORDING = {
  version: "fit-v2-clinrev",
  prompt:
    "Steady provides education, preparation, and grounding-oriented skills. It does not diagnose, determine readiness for trauma processing, or replace a licensed clinician. Are you seeking general education/preparation rather than emergency help or independent trauma-memory processing?",
  responses: ["Yes", "I am not sure", "No, I need urgent or clinical help"] as const,
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
