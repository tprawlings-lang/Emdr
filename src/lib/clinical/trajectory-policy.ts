// The recovery-trajectory policy (expansion handoff 04 §4).
//
// §4's first line is a rule about method, not about numbers: "use
// deterministic, explainable rules first. Do not start with an opaque
// predictive model." Its second is a rule about where the numbers live:
// "minimum density and thresholds are versioned per domain. Example defaults
// can be seeded for demo but must be configuration, not hidden constants."
//
// So this file is the whole of what Steady currently considers a meaningful
// change, and it is readable end to end by a clinician who wants to argue with
// it. Change a number, change the version, and the next computation writes a
// new snapshot beside the old one rather than quietly restating the old one
// under new rules — the UNIQUE key on recovery_trajectory_snapshots includes
// the policy version precisely so that happens without anybody remembering.
//
// THRESHOLDS ARE IN NATIVE UNITS, WHICH IS THE POINT. There is no shared scale
// here and there is not going to be one: §1 says "do not replace that chart
// with one composite recovery score", and a policy expressed in standard
// deviations or percentages would be exactly that composite arriving through
// the back door. Two points of PHQ-9 and two points of PCL-5 are not the same
// amount of anything, so they are not the same number in this file.
//
// AND AN INSTRUMENT WITH NO REGISTERED THRESHOLD GETS NO VERDICT. See
// `measurePolicy` below: Steady does not invent a meaningful-change threshold
// for a scale it has not been told about. A generic default would produce a
// confident "improving" on an instrument nobody calibrated, which is the
// failure this whole handoff is written against.
//
// Split from the engine so the numbers can be read by a client component, a
// test, and the aggregator from one place, and so this is the file a reviewer
// opens when they want to know what counts as a change.

// ---------------------------------------------------------------------------
// Domains (§2)
// ---------------------------------------------------------------------------

export const DOMAIN_TYPES = [
  "function",
  "activation",
  "dissociation",
  "sleep",
  "measure",
  "session_recovery",
  "engagement",
] as const;
export type DomainType = (typeof DOMAIN_TYPES)[number];

/** Which way is better on this domain's own scale.
 *
 *  `none` is not a missing value — it is a domain where the question does not
 *  apply. §2 says engagement is "descriptive context only; not adherence or
 *  prediction", and the honest encoding of that is a direction of improvement
 *  that does not exist rather than one nobody filled in. A domain with no
 *  direction cannot produce `improving` or `reversing`, and the state machine
 *  enforces it rather than trusting a caller. */
export type Better = "lower" | "higher" | "none";

export interface DomainMeta {
  label: string;
  /** What the reader is looking at, in one line, on this domain's own terms. */
  note: string;
  better: Better;
  /** Whether a deviation here may reach the Command Center at all. §8: "do not
   *  emit work for every stable domain. The Command Center is for action, not
   *  chart commentary." Engagement is false because §6 forbids treating a gap
   *  as deterioration — the engagement PROVIDER in handoff 03 already reports
   *  observed gaps, and a second route would report the same silence twice
   *  under a heavier word. */
  signalEligible: boolean;
}

export const DOMAIN_META: Record<DomainType, DomainMeta> = {
  function: {
    label: "Function",
    note: "Movement on a Return-to-Life goal, on that goal's own ladder. Goals are never averaged together.",
    better: "higher",
    signalEligible: true,
  },
  activation: {
    label: "Activation",
    note: "Daily check-in activation, 0–10. Lower is calmer in context; it is not a score of how well someone is doing.",
    better: "lower",
    signalEligible: true,
  },
  dissociation: {
    label: "Dissociation",
    note: "Daily check-in dissociation, 0–10, as the person reported it.",
    better: "lower",
    signalEligible: true,
  },
  sleep: {
    label: "Sleep quality",
    note: "Daily check-in sleep quality, 0–10. Higher is better on this scale.",
    better: "higher",
    signalEligible: true,
  },
  measure: {
    label: "Validated measure",
    note: "A scored instrument, kept on its own validated scale and never converted into another one.",
    better: "lower",
    signalEligible: true,
  },
  session_recovery: {
    label: "Session recovery",
    note: "How hard the hours after a session were expected to be, from the post-session check, 0–10.",
    better: "lower",
    signalEligible: true,
  },
  engagement: {
    label: "Engagement",
    note: "How often check-ins arrived. Context for reading the other domains — not adherence, not a prediction, and never a recovery state.",
    better: "none",
    signalEligible: false,
  },
};

// ---------------------------------------------------------------------------
// States (§3)
// ---------------------------------------------------------------------------

export const TRAJECTORY_STATES = [
  "insufficient_data",
  "improving",
  "stable",
  "slowing",
  "stalled",
  "reversing",
] as const;
export type TrajectoryState = (typeof TRAJECTORY_STATES)[number];

/** §3's display requirements, as the words that actually get shown.
 *
 *  "Stable" does not say "not improving" — that is §3's explicit instruction
 *  and it is not a style note. A person holding steady after a bad year has
 *  achieved something, and a label that reads it as a failure to progress will
 *  be read that way by whoever opens the record next. */
export const STATE_LABEL: Record<TrajectoryState, string> = {
  insufficient_data: "Not enough to compare",
  improving: "Moving favourably",
  stable: "Holding steady",
  slowing: "Moving more slowly than before",
  stalled: "Within a narrow band",
  reversing: "Moving the other way",
};

export const STATE_NOTE: Record<TrajectoryState, string> = {
  insufficient_data:
    "There are not enough comparable observations in this window to say anything. This is a statement about the record, not about the person.",
  improving:
    "The recent readings sit favourably against the window before them, by more than this domain's noise threshold.",
  stable:
    "No movement beyond noise in either direction. Holding steady is a state in its own right, not a failure to improve.",
  slowing:
    "There was favourable movement, and there is materially less of it now. A change in trajectory, not a failure.",
  stalled:
    "Readings have stayed inside a narrow band across the whole review window, on enough observations for that to mean something.",
  reversing:
    "Recent readings have moved against the earlier favourable direction, on more than one observation.",
};

/**
 * The state word a domain actually wears on a screen.
 *
 * A DOMAIN WITH NO DIRECTION OF IMPROVEMENT MUST NOT WEAR A RECOVERY WORD. The
 * engine gives engagement `stable` because the schema's CHECK constrains state
 * to the six and there is no seventh for "this is context" — but rendering that
 * as "Holding steady" tells a clinician their patient's course is level on the
 * strength of how often they filled in a form. §2 is explicit that engagement is
 * "descriptive context only; not adherence or prediction", and a label is
 * exactly where that gets forgotten: the caught case was a lane reading
 * "Check-ins — Holding steady" beside "19 in the last 28 days, against 0 in the
 * 28 days before", which is a course judgement over a change in contact.
 *
 * So the stored state stays the state, and the WORD is chosen per domain.
 */
export function stateLabelFor(domainType: DomainType, state: TrajectoryState): string {
  if (DOMAIN_META[domainType].better === "none") {
    return state === "insufficient_data" ? "Nothing recorded" : "Recorded, for context";
  }
  return STATE_LABEL[state];
}

export function stateNoteFor(domainType: DomainType, state: TrajectoryState): string {
  if (DOMAIN_META[domainType].better === "none") {
    return state === "insufficient_data"
      ? "Nothing has been recorded in this window. That is a fact about the record."
      : "This domain has no favourable direction, so it has no recovery state. It is here as context for reading the others.";
  }
  return STATE_NOTE[state];
}

// ---------------------------------------------------------------------------
// Thresholds (§4)
// ---------------------------------------------------------------------------

export interface DomainPolicy {
  /** Length of the current comparison window, in days. The window before it is
   *  the same length, and the one before that supplies the prior direction. */
  windowDays: number;
  /** How many observations the current window needs before any state other
   *  than `insufficient_data` is available. */
  minObservations: number;
  /** How many days the observations must actually span. Five readings in one
   *  afternoon is one reading taken five times. */
  minSpanDays: number;
  /** Movement of at least this much, in the domain's own units, is meaningful.
   *  Below it, movement is not distinguished from noise. */
  meaningfulDelta: number;
  /** Movement inside this is noise. Between `noiseDelta` and `meaningfulDelta`
   *  is real but not yet meaningful — the gap is deliberate, and it is where
   *  `slowing` lives. */
  noiseDelta: number;
  /** How wide the whole review window's readings may spread and still be called
   *  a narrow band. */
  narrowBand: number;
  /** How many observations must individually move against the prior direction
   *  before `reversing` is available. §4: "require persistence... one bad day
   *  remains one observation." */
  persistence: number;
}

export interface TrajectoryPolicy {
  version: string;
  domains: Record<DomainType, DomainPolicy>;
  /** Per-instrument thresholds for the `measure` domain, keyed by the
   *  instrument id as the record stores it. An instrument absent from this map
   *  gets no verdict — see `measurePolicy`. */
  instruments: Record<string, Pick<DomainPolicy, "meaningfulDelta" | "noiseDelta" | "narrowBand"> & { label: string; max: number; better: Better }>;
}

/** The 0–10 check-in scales share a shape, so they share their numbers. A day
 *  and a half of movement on a ten-point self-report is about the smallest
 *  difference a clinician would act on, and half of that is a mood. */
const CHECKIN_SCALE: DomainPolicy = {
  windowDays: 21,
  minObservations: 4,
  minSpanDays: 7,
  meaningfulDelta: 1.5,
  noiseDelta: 0.75,
  narrowBand: 1.5,
  persistence: 2,
};

export const TRAJECTORY_POLICY: TrajectoryPolicy = {
  version: "recovery-trajectory.1.0.0",
  domains: {
    // A goal ladder has five rungs and moving one of them is a real change in
    // what somebody can do. There is no sub-rung noise to filter, so the noise
    // threshold sits below a whole rung only to allow for a goal whose
    // observations disagree within a window.
    function: {
      windowDays: 42,
      minObservations: 2,
      minSpanDays: 14,
      meaningfulDelta: 1,
      noiseDelta: 0.5,
      narrowBand: 0.5,
      persistence: 2,
    },
    activation: { ...CHECKIN_SCALE },
    dissociation: { ...CHECKIN_SCALE },
    sleep: { ...CHECKIN_SCALE },
    // Instruments are scored weeks apart, so the window is long and the
    // density requirement is low — two scores eight weeks apart is what a
    // measure trajectory actually looks like. The deltas here are placeholders
    // that `measurePolicy` replaces per instrument.
    measure: {
      windowDays: 90,
      minObservations: 2,
      minSpanDays: 21,
      meaningfulDelta: 0,
      noiseDelta: 0,
      narrowBand: 0,
      persistence: 2,
    },
    // Post-session delayed-risk readings, 0–10. Two points is the smallest
    // move worth reading; the escalation threshold elsewhere in the product
    // sits at 8, and this domain describes the trend below it rather than
    // duplicating that rule.
    session_recovery: {
      windowDays: 56,
      minObservations: 3,
      minSpanDays: 14,
      meaningfulDelta: 2,
      noiseDelta: 1,
      narrowBand: 2,
      persistence: 2,
    },
    // Check-ins per window. Direction is `none`, so the only states reachable
    // are `insufficient_data` and `stable`; the movement itself is reported in
    // the explanation as a count, where it reads as what it is.
    engagement: {
      windowDays: 28,
      minObservations: 1,
      minSpanDays: 0,
      meaningfulDelta: 0,
      noiseDelta: 0,
      narrowBand: 0,
      persistence: 2,
    },
  },
  instruments: {
    "phq-9": { label: "PHQ-9", max: 27, better: "lower", meaningfulDelta: 5, noiseDelta: 2.5, narrowBand: 3 },
    "gad-7": { label: "GAD-7", max: 21, better: "lower", meaningfulDelta: 4, noiseDelta: 2, narrowBand: 3 },
    "pcl-5": { label: "PCL-5", max: 80, better: "lower", meaningfulDelta: 10, noiseDelta: 5, narrowBand: 6 },
    itq: { label: "ITQ", max: 48, better: "lower", meaningfulDelta: 8, noiseDelta: 4, narrowBand: 5 },
    "pc-ptsd-5": { label: "PC-PTSD-5", max: 5, better: "lower", meaningfulDelta: 1, noiseDelta: 0.5, narrowBand: 1 },
  },
};

/**
 * The policy for one measure series, or null if Steady has no threshold for it.
 *
 * NULL IS THE IMPORTANT RETURN VALUE. An unregistered instrument could be given
 * a generic default — a fraction of its observed range, say — and it would then
 * produce a confident "improving" on a scale nobody has calibrated a meaningful
 * change for. That is a fabricated clinical judgement wearing the same badge as
 * a real one, and a clinician has no way to tell them apart on the screen.
 *
 * So an unregistered instrument still PLOTS on the longitudinal chart, where it
 * is a series of numbers a reader interprets, and it produces no trajectory
 * state here.
 */
export function measurePolicy(
  instrument: string, policy: TrajectoryPolicy = TRAJECTORY_POLICY
): (DomainPolicy & { label: string; max: number; better: Better }) | null {
  const spec = policy.instruments[instrument.toLowerCase()];
  if (!spec) return null;
  return { ...policy.domains.measure, ...spec };
}

/** The policy for any domain/key pair, or null when there is none to apply. */
export function policyFor(
  domainType: DomainType, domainKey: string, policy: TrajectoryPolicy = TRAJECTORY_POLICY
): DomainPolicy | null {
  if (domainType === "measure") return measurePolicy(domainKey, policy);
  return policy.domains[domainType];
}

/** Which way is better for a domain/key pair. Measures carry their own, because
 *  an instrument where a higher score is better would otherwise be read
 *  backwards by the whole engine. */
export function betterFor(
  domainType: DomainType, domainKey: string, policy: TrajectoryPolicy = TRAJECTORY_POLICY
): Better {
  if (domainType === "measure") return measurePolicy(domainKey, policy)?.better ?? "lower";
  return DOMAIN_META[domainType].better;
}
