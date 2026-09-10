// The response fingerprint policy (expansion handoff 02 §6).
//
// §6 says thresholds go in versioned policy, and the reason is §13: "all
// pattern summaries are reproducible from evidence + policy version." A
// threshold that lived as a literal inside the aggregator could be changed
// without anything recording that the meaning of every stored snapshot had
// changed with it — and a clinician would have no way to tell whether the
// pattern they read last month was computed under the same rules as the one
// they are reading now.
//
// So: change a number here, change the version, and the next computation writes
// a NEW snapshot beside the old one. The UNIQUE key on
// response_fingerprint_snapshots includes the policy version precisely so that
// happens automatically rather than by anybody remembering.
//
// Split into its own module so the numbers can be read by a client component,
// a test, and the aggregator from one place — and so this file is what a
// reviewer opens when they want to know what Steady currently considers enough
// evidence.

export interface ResponsePolicy {
  version: string;
  /** §6: "at least 3 comparable intervention instances" before a pattern is
   *  displayed at all. Below this the state is `insufficient_data` and no
   *  descriptive statistic is shown — not a provisional one, not a greyed-out
   *  one. Two encounters is an anecdote and rendering it faintly does not make
   *  it less of one. */
  displayThreshold: number;
  /** §6: "a stronger 'repeated pattern' label only after 5." */
  repeatedPatternThreshold: number;
  /** §6: "separate context strata only when each stratum has enough support."
   *  A stratum below this is folded back into the whole rather than shown — a
   *  two-instance stratum is how "grounding at high activation" becomes a
   *  clinical belief with two data points behind it. */
  stratumThreshold: number;
  /** How many exposures showing delayed burden make it a pattern rather than a
   *  hard week. §11: "do not turn a single difficult session into a Command
   *  Center work item." */
  recoveryBurdenThreshold: number;
  /** The share of exposures that must move toward settled, and the share that
   *  must disagree with themselves, before the pattern takes that name.
   *  Fractions rather than counts so they hold at any support level. */
  favorableShare: number;
  mixedShare: number;
  /** Activation bands used for context strata. Closed intervals on the
   *  0-10 opening reading. */
  activationBands: Array<{ key: string; label: string; min: number; max: number }>;
}

export const RESPONSE_POLICY: ResponsePolicy = {
  version: "response-fingerprint.1.0.0",
  displayThreshold: 3,
  repeatedPatternThreshold: 5,
  stratumThreshold: 3,
  recoveryBurdenThreshold: 2,
  favorableShare: 2 / 3,
  mixedShare: 1 / 2,
  activationBands: [
    { key: "low", label: "starting settled (0–4)", min: 0, max: 4 },
    { key: "mid", label: "starting activated (5–7)", min: 5, max: 7 },
    { key: "high", label: "starting highly activated (8–10)", min: 8, max: 10 },
  ],
};

/** §6's five states. Nothing outside this list is a pattern state, and none of
 *  the five contains an efficacy word — "favorable_observed_pattern" says what
 *  was OBSERVED, which is the whole distinction §6 draws when it bars "works",
 *  "effective treatment", "caused improvement" and "contraindicated". */
export const PATTERN_STATES = [
  "insufficient_data",
  "mixed",
  "favorable_observed_pattern",
  "limited_observed_pattern",
  "recovery_burden_observed",
] as const;
export type PatternState = (typeof PATTERN_STATES)[number];

/** How each state is put to a clinician. Every one of these is a sentence about
 *  the RECORD, not about the intervention: what has been seen, how often, and
 *  what is still unknown. */
export const PATTERN_STATE_LABEL: Record<PatternState, string> = {
  insufficient_data: "Not enough recorded yet",
  mixed: "Mixed across windows",
  favorable_observed_pattern: "Settling has been observed repeatedly",
  limited_observed_pattern: "Some settling observed, on limited evidence",
  recovery_burden_observed: "Difficulty afterwards has been observed more than once",
};

export const PATTERN_STATE_NOTE: Record<PatternState, string> = {
  insufficient_data:
    "Fewer than three comparable exposures. Nothing is summarised from this until there is more.",
  mixed:
    "The windows disagree — settling in one and difficulty in another. They are shown separately and are never combined into one figure.",
  favorable_observed_pattern:
    "Most recorded exposures were followed by movement toward settled. That is what was observed, across these encounters, for this person; it is not a claim that the intervention caused it.",
  limited_observed_pattern:
    "Movement toward settled has been seen, but on few enough exposures that it may not hold.",
  recovery_burden_observed:
    "Difficulty in the hours or days after has been recorded more than once. Worth reading with the immediate readings rather than instead of them.",
};
