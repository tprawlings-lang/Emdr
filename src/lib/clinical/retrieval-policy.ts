// The retrieval policy (§10).
//
// §10 gives a scoring formula and then says the important thing about it:
// "Initial weights above are implementation defaults, not clinical truth. Put
// them behind versioned retrieval policy so evaluation can change them without
// changing the meaning of stored records."
//
// So the weights live here with a version on them, the version is recorded on
// every proposal they produce, and a tuning change is therefore attributable
// rather than invisible. A proposal made under v1 stays a v1 proposal after the
// weights move — which is what lets somebody ask later whether the change made
// things better or only different.
//
// SEMANTIC SIMILARITY IS NOT AVAILABLE, AND IS NOT FAKED. §10's formula gives
// it 0.35, the largest single weight, and this deployment has no embedding
// index. Two dishonest options were available: score it zero, which silently
// caps every candidate at 0.65 and makes a good match look mediocre; or
// substitute a lexical proxy and call it semantic, which would report a
// capability that does not exist. Instead the available components are
// renormalized to sum to one, and every score says which components produced
// it. A reader can then tell a 0.7 computed from four signals from a 0.7
// computed from five.

export const RETRIEVAL_POLICY_VERSION = "retrieval-policy.1.0.0";

/** §10's components, with §10's weights. */
export const WEIGHTS = {
  semantic_similarity: 0.35,
  lexical_match: 0.25,
  structured_concept_match: 0.20,
  recency_signal: 0.10,
  source_reliability_weight: 0.10,
} as const;

export type ScoreComponent = keyof typeof WEIGHTS;

/** Components this deployment can actually compute. Absent: semantic, which
 *  needs an embedding index nobody has built. */
export const AVAILABLE: ScoreComponent[] = [
  "lexical_match",
  "structured_concept_match",
  "recency_signal",
  "source_reliability_weight",
];

export interface ScoreBreakdown {
  /** 0–1, renormalized over the components that were available. */
  score: number;
  /** The raw component values, before weighting. */
  components: Partial<Record<ScoreComponent, number>>;
  /** Which components contributed. A score is not comparable across different
   *  sets of these, and saying so is cheaper than pretending it is. */
  contributed: ScoreComponent[];
  policyVersion: string;
}

/**
 * Combine component values into a score.
 *
 * Renormalizes over whatever was supplied, so an unavailable component lowers
 * confidence in the comparison rather than lowering the number.
 */
export function combine(components: Partial<Record<ScoreComponent, number>>): ScoreBreakdown {
  const contributed = (Object.keys(components) as ScoreComponent[]).filter(
    (k) => typeof components[k] === "number" && AVAILABLE.includes(k)
  );
  const totalWeight = contributed.reduce((sum, k) => sum + WEIGHTS[k], 0);
  if (totalWeight === 0) {
    return { score: 0, components, contributed: [], policyVersion: RETRIEVAL_POLICY_VERSION };
  }
  const weighted = contributed.reduce((sum, k) => sum + WEIGHTS[k] * (components[k] as number), 0);
  return {
    score: weighted / totalWeight,
    components,
    contributed,
    policyVersion: RETRIEVAL_POLICY_VERSION,
  };
}

/** Below this a candidate is not worth a clinician's attention.
 *
 *  A threshold, not a cutoff on how many to show: proposing five weak links
 *  because five is the page size is how a review queue teaches people to click
 *  through it. */
export const PROPOSE_THRESHOLD = 0.45;

/** Most a single item may propose at once. §10: "cap evidence per source type".
 *  An item that plausibly touches six threads is an item whose label is too
 *  broad, and asking the clinician to arbitrate six weak links is not the fix. */
export const MAX_PROPOSALS_PER_ITEM = 3;

// ---------------------------------------------------------------------------
// Component computations
// ---------------------------------------------------------------------------

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "is", "was", "were", "be", "been", "it", "this", "that", "she", "he",
  "her", "his", "them", "they", "i", "not", "no", "about", "still", "has", "had",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Jaccard overlap of content words. Deliberately simple and deliberately not
 *  called semantic: it matches words, and two ways of saying the same thing
 *  with different words score zero. That limitation is real and is why the
 *  clinician decides. */
export function lexicalMatch(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  return shared / (sa.size + sb.size - shared);
}

/** The normalized label matching the thread's canonical label.
 *
 *  §10: "For thread matching, prefer existing canonical label + accepted
 *  members + recent evidence." An exact label match is the strongest structured
 *  signal available and is what makes "sleep" reliably reach the sleep thread
 *  without any language model at all. */
export function structuredConceptMatch(itemLabel: string | null, canonicalLabel: string): number {
  if (!itemLabel) return 0;
  const a = itemLabel.trim().toLowerCase();
  const b = canonicalLabel.trim().toLowerCase();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.6;
  return 0;
}

/** How recently the thread was last seen, decaying over ninety days.
 *
 *  A thread nobody has touched in a year is probably not what this week's
 *  observation belongs to — but it is only a tenth of the score, because
 *  "dormant and then back" is a clinically important shape and a recency signal
 *  that dominated would hide exactly that. */
export function recencySignal(lastSeenAt: string | null, now: number): number {
  if (!lastSeenAt) return 0.5;
  const days = (now - Date.parse(lastSeenAt)) / 86_400_000;
  if (!Number.isFinite(days)) return 0.5;
  if (days <= 0) return 1;
  return Math.max(0, 1 - days / 90);
}

/** How much weight the item's own epistemic class carries.
 *
 *  An observation is firmer evidence for a pattern than a hypothesis. This does
 *  NOT change what the item is — the statement class is untouched — it changes
 *  how eagerly Steady offers to file it under a theme. Speculation joining
 *  threads as readily as observation is how a tentative thought becomes part of
 *  a pattern nobody meant to assert. */
export function sourceReliability(statementClass: string): number {
  switch (statementClass) {
    case "clinician_observation": return 1;
    case "patient_report": return 0.9;
    case "clinician_hypothesis": return 0.5;
    case "clinician_uncertainty": return 0.4;
    default: return 0.5;
  }
}
