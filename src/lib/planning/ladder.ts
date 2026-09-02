// The release ladder (handoff 07 §3.6, p36).
//
// p36 opens with the reason it exists, and it is worth keeping in front of
// anyone reading a planning screen:
//
//   A module may look successful because more engaged people choose it,
//   because clinicians assign it to different patients, because missing
//   follow-up differs, or because the module changed during the period. Raw
//   averages cannot answer what caused the result.
//
// So the ladder is not a maturity model to climb. It is a mapping from METHOD
// to PERMITTED WORDING, and the wording is the enforceable half: a level-1
// count may be reported as "observed among this cohort" and may not be
// reported as an effect, a cause, or a reason. Every rule in this build
// produces level 1, because level 1 is what counts, rates and paired change
// support — and the wording follows from the level rather than from whoever
// wrote the sentence.

export interface LadderLevel {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  method: string;
  /** p36's permitted-wording column. A statement at this level must OPEN with
   *  this phrase — not merely contain it, because a causal sentence with a
   *  hedge appended is still a causal sentence. */
  permittedWording: string;
  decisionUse: string;
}

export const LADDER: LadderLevel[] = [
  {
    level: 1,
    name: "Descriptive",
    method: "Counts, rates, paired change, missingness",
    permittedWording: "Observed among this cohort",
    decisionUse: "Dashboard and gap finding",
  },
  {
    level: 2,
    name: "Stratified",
    method: "Predeclared age, region and demographic strata",
    permittedWording: "Observed within these strata",
    decisionUse: "Fairness and consistency review",
  },
  {
    level: 3,
    name: "Adjusted",
    method: "Regression or weighting with documented confounders",
    permittedWording: "Adjusted association",
    decisionUse: "Pilot prioritization only",
  },
  {
    level: 4,
    name: "Quasi-experimental",
    method: "Difference-in-differences, interrupted time series or matched design",
    permittedWording: "Estimated effect under stated assumptions",
    decisionUse: "Governed program decision",
  },
  {
    level: 5,
    name: "Controlled pilot",
    method: "Randomized or controlled rollout with protocol",
    permittedWording: "Pilot effect estimate",
    decisionUse: "Adopt, reject or retest after review",
  },
];

/** The only level this build produces. Nothing here computes an adjusted
 *  association, so nothing here may be worded as one. */
export const CURRENT_LEVEL = 1 as const;

export function ladder(level: number): LadderLevel {
  const l = LADDER.find((x) => x.level === level);
  if (!l) throw new Error(`no release ladder level ${level} — p36 defines 1 through 5`);
  return l;
}

/**
 * Words a level-1 or level-2 statement may not contain.
 *
 * Causation, and the softer forms of it that read as description. "Drives",
 * "leads to" and "because of" are claims about mechanism; "improves" and
 * "reduces" are claims about what a thing DID rather than what was seen. The
 * list is applied to generated statements, which is why it can be strict: the
 * sentences are built from a template, so a match is a template bug rather
 * than a reviewer's phrasing being second-guessed.
 */
const CAUSAL = [
  "caused", "causes", "causing", "because of", "due to", "drives", "driven by",
  "leads to", "led to", "results in", "resulted in", "effect of", "impact of",
  "improves", "improved by", "reduces", "reduced by", "increases outcomes",
  "responsible for", "explains", "attributable to", "thanks to",
];

/**
 * Check a statement against its level.
 *
 * Returns the offending phrase, or null. A `throw` would be wrong here: the
 * caller is a screen, and the right response to a statement that overclaims is
 * to refuse to render it, not to 500.
 */
export function wordingViolation(statement: string, level: number): string | null {
  const l = ladder(level);
  const s = statement.trim();
  if (!s.toLowerCase().startsWith(l.permittedWording.toLowerCase())) {
    return `a level-${level} statement must open with "${l.permittedWording}"`;
  }
  if (level <= 2) {
    const lower = s.toLowerCase();
    for (const phrase of CAUSAL) {
      if (lower.includes(phrase)) {
        return `a level-${level} statement claims causation: "${phrase}"`;
      }
    }
  }
  return null;
}

/**
 * p36's flat prohibition, kept as a named export so it can be asserted rather
 * than remembered:
 *
 *   DO NOT USE RACE CORRECTION FACTORS. Protected attributes may be used to
 *   audit performance, study disparate impact and verify representation. Any
 *   future adjusted model needs a source-attribute record, fairness
 *   evaluation, monitoring plan, named owner and retirement criteria.
 *
 * Nothing in this build adjusts anything, so there is no correction factor to
 * prohibit yet. The constant exists so that the first model which does adjust
 * arrives into a codebase where the rule is already written down and already
 * checked, rather than into one where it has to be remembered.
 */
export const NO_RACE_CORRECTION =
  "Race correction factors are prohibited. Protected attributes may be used to audit " +
  "performance, study disparate impact and verify representation, and for nothing else.";

/** What a future adjusted model must carry before it may leave shadow mode
 *  (p36, and the model registry on p38). Five fields, listed so Wave 7 has a
 *  shape to build against rather than a paragraph to re-read. */
export const ADJUSTED_MODEL_REQUIREMENTS = [
  "source-attribute record",
  "fairness evaluation",
  "monitoring plan",
  "named owner",
  "retirement criteria",
] as const;
