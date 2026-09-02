import type { ManifestRow } from "./demo-population-manifest";
import { seedFor } from "./demo-population-manifest";
import { armFor } from "./demo-population-seed";

// The authored access model (handoff 07 p11, p12, p14; §3.6 p36; §4.4 p43).
//
// WHY THIS FILE EXISTS. The manifest on pp16–27 is balanced on every dimension
// p29 checks — 60 per region, 40 per age band, 40 per race, 30 per archetype,
// and 10 of each language in each region. A population balanced that carefully
// contains no disparity at all, and measured before this model existed the
// largest follow-up-completion difference between any declared cohort and the
// eligible population was 3.4 percentage points against a threshold of 12.
// Every planning rule evaluated to "no gap". A fairness screen with nothing to
// find has not been tested, and neither has the engine above it.
//
// So the differences are AUTHORED, here, in one place, as named real-world
// mechanisms with stated magnitudes. Three rules govern what may go in:
//
//   1. A MECHANISM IS OPERATIONAL, NOT DISPOSITIONAL. Every entry below is
//      something the service does to a person — a measure that was never
//      delivered, a start that took longer to arrange — or a well-documented
//      behavioural pattern that is a property of a life stage rather than of
//      an identity. Nothing here says a group tries less hard. p13 permits
//      protected attributes to audit access and forbids them from driving
//      anything, and a fabricated population that encodes a stereotype teaches
//      the stereotype to everyone who reads the console.
//
//   2. EVERY MECHANISM IS CONFOUNDED ON PURPOSE. p36 opens by listing the
//      reasons a difference may exist that are not the reason it appears to:
//      selection, assignment, differential missingness, a definition that
//      changed. If the fabricated population's gaps are clean, the release
//      ladder is decoration — a reviewer follows the obvious explanation and
//      is right every time. So the largest driver below keys on INTERPRETER
//      NEED, which p11 authors INDEPENDENTLY of language: a language cohort's
//      gap is carried by the third of it that needs an interpreter, and a
//      reviewer who stratifies finds the answer is interpreter capacity rather
//      than anything about the language. That is also the correct real-world
//      conclusion, which is the point.
//
//   3. NOT EVERY GAP CROSSES THE LINE. Real operational data has differences
//      of every size, and most of them are not actionable. The magnitudes are
//      chosen so some cohorts trip p34's thresholds and some visibly do not,
//      because a console where every comparison fires is a console nobody
//      reads twice.
//
// The magnitudes are fabricated. They are shaped to be plausible rather than
// drawn from any study, and nothing here is evidence about any real population.

/** How the service treats one person, relative to the archetype's own path. */
export interface AccessProfile {
  /** Added probability that a due measure is never DELIVERED — p28's
   *  "unavailable". A service failure, recorded as one. */
  deliveryFailure: number;
  /** Multiplier on the archetype's own miss rate, which is the person's side
   *  of the same event: a measure that arrived and was not completed. */
  adherenceFactor: number;
  /** Multiplier on the check-in count. */
  engagementFactor: number;
  /** The MEAN number of days added before the first action — positive is
   *  slower to start. A mean rather than an offset, because a fixed offset is
   *  a cliff: the first version added ten days to the 65+ band and produced a
   *  cohort with exactly 0% seven-day activation, which is not a gradient, it
   *  is a rule. The generator draws around this per person, so every band
   *  contains people who started immediately and people who took a month. */
  startDragMean: number;
  /** Which mechanisms applied. Carried into the event payload, so a reviewer
   *  reading a single missing measure can see why the generator wrote it. */
  mechanisms: string[];
}

/**
 * Interpreter need, and the two access needs, derived from the profile seed.
 *
 * Re-derived rather than read back from `person_attributes`, and exported so
 * the seed and the generator cannot disagree about who needs what. p11 authors
 * these independently of language, which is the whole basis of mechanism M1's
 * ambiguity — assuming every non-English speaker needs an interpreter is the
 * stereotype p11 forbids the generator from encoding, and it would also make
 * the confound trivially visible.
 */
export function interpreterNeededFor(row: ManifestRow): boolean {
  return row.language !== "English" && seedFor(row) % 3 === 0;
}

export function accessNeedsFor(row: ManifestRow): string[] {
  const seed = seedFor(row);
  if (seed % 11 === 0) return ["screen-reader"];
  if (seed % 13 === 0) return ["captions"];
  return [];
}

/**
 * States where a large share of the population lives outside a metro area.
 *
 * Seven of the manifest's twenty-four, spread across all four regions **on
 * purpose**: a rural effect that sat inside one region would be indistinguish-
 * able from a regional one, and a reviewer comparing regions would find the
 * right number for the wrong reason. Spread this way, a regional difference is
 * partly a composition difference, and the only way to tell is to stratify.
 */
export const RURAL_STATES = new Set(["ME", "MO", "WI", "TN", "NC", "NV", "OR"]);

export function isRural(row: ManifestRow): boolean {
  return RURAL_STATES.has(row.state);
}

/**
 * The age gradient, and the reason it is the most useful thing in this file.
 *
 * Older members start SLOWER and then complete MORE reliably; younger members
 * are the reverse. Both halves are ordinary — arranging a first appointment
 * takes longer when it cannot be done from a phone at midnight, and a
 * scheduled follow-up is more likely to be kept by someone whose week is
 * stable — and together they produce a genuine REVERSAL: the 65+ cohort is the
 * worst on activation and the best on follow-up completion, and the 18–24
 * cohort is the opposite.
 *
 * A reversal is the single most instructive thing a planning console can be
 * shown, because it makes "which group is doing worse" an unanswerable
 * question until somebody names the metric. p32 puts the required display on
 * every metric for this reason; this is what makes that requirement bite.
 */
const AGE_GRADIENT: Record<string, { adherence: number; engagement: number; drag: number }> = {
  "18-24": { adherence: 1.55, engagement: 0.96, drag: 1 },
  "25-34": { adherence: 1.25, engagement: 1.00, drag: 2 },
  "35-44": { adherence: 1.00, engagement: 1.00, drag: 3 },
  "45-54": { adherence: 0.90, engagement: 1.00, drag: 4 },
  "55-64": { adherence: 0.78, engagement: 0.97, drag: 5 },
  "65+":   { adherence: 0.65, engagement: 0.92, drag: 6 },
};

/**
 * Interpreter-dependent delivery, by site.
 *
 * The larger of the two numbers belongs to arm B. p11 gives each region two
 * organizations and says nothing about how they differ; the difference
 * authored here is that arm A holds a contracted interpreter line and arm B
 * books ad hoc, which is an ordinary and consequential procurement decision.
 *
 * It is also the second confound: `armFor` sends clinician C3's panel to arm
 * B, so the interpreter effect is concentrated in a third of each region — and
 * a signal about a language cohort is partly a signal about one site's
 * contract. Stratifying by organization is what separates them.
 */
const INTERPRETER_DELIVERY_FAILURE = { A: 0.11, B: 0.30 } as const;

/**
 * Which languages the follow-up instrument has actually been shipped in.
 *
 * The most consequential mechanism here, and the most ordinary. Measurement-
 * based care runs on instruments, instruments need validated translations, and
 * a translation is a piece of work somebody has to fund and deploy. Where it
 * has not been deployed the measure goes out in English or does not go out at
 * all, and the person's follow-up is missing for a reason that has nothing to
 * do with them.
 *
 * This is a statement about what this fabricated product shipped. It is not a
 * statement about anybody's engagement, and the data says so plainly: a
 * delivery failure is recorded as p28's "unavailable" while a person choosing
 * not to complete a measure is recorded as "skipped" or "declined". The
 * missingness breakdown is therefore the diagnostic — a reviewer who reads the
 * reasons finds a supply problem, and a reviewer who reads only the
 * completion rate finds a group.
 *
 * p43 asks that a fairness screen make it easier to discover uneven access and
 * harder to stereotype a group. A gap whose cause is a shipping decision, and
 * whose fix is to ship the translation, is exactly that.
 */
const INSTRUMENT_TRANSLATION_GAP: Record<string, number> = {
  // Deployed and validated. A residual failure rate, not none.
  Spanish: 0.06,
  // Not yet deployed in this fabricated deployment.
  Mandarin: 0.17,
};

export function accessProfileFor(row: ManifestRow): AccessProfile {
  const mechanisms: string[] = [];
  let deliveryFailure = 0;
  let adherenceFactor = 1;
  let engagementFactor = 1;
  let startDragMean = 0;

  // M1 — interpreter-dependent delivery, amplified by the site's contract.
  if (interpreterNeededFor(row)) {
    const arm = armFor(row.clinician);
    deliveryFailure += INTERPRETER_DELIVERY_FAILURE[arm];
    mechanisms.push(`interpreter-dependent delivery (site arm ${arm})`);
  }

  // M6 — instrument translation coverage. Applies to the whole language
  // cohort, unlike M1, which applies only to the third of it that needs an
  // interpreter. That difference is the reason the two cohorts behave
  // differently: the language with a deployed translation shows a visible gap
  // that does not cross p34's threshold, and the one without crosses it.
  const translation = INSTRUMENT_TRANSLATION_GAP[row.language];
  if (translation) {
    deliveryFailure += translation;
    mechanisms.push(`follow-up instrument translation coverage (${row.language})`);
  }

  // M2 — the age gradient, in both directions.
  const age = AGE_GRADIENT[row.ageBand];
  if (age) {
    adherenceFactor *= age.adherence;
    engagementFactor *= age.engagement;
    startDragMean += age.drag;
    if (age.drag !== 0 || age.adherence !== 1) mechanisms.push(`age gradient (${row.ageBand})`);
  }

  // M3 — distance. Longer to arrange a first visit, and more sessions cut
  // short — which the generator records as p28's "interrupted" rather than as
  // a person declining.
  if (isRural(row)) {
    startDragMean += 2;
    engagementFactor *= 0.93;
    deliveryFailure += 0.03;
    mechanisms.push("distance to a first appointment");
  }

  // M4 — a functional access need the product does not fully accommodate.
  // Small, and real: a screen-reader user meeting an unlabelled control does
  // not file a complaint, they stop.
  if (accessNeedsFor(row).length > 0) {
    engagementFactor *= 0.94;
    deliveryFailure += 0.04;
    mechanisms.push("unaccommodated functional access need");
  }

  // M5 — coverage instability. The archetype already carries the authored
  // gap; what this adds is that engagement drops while COMPLETION WHEN DUE
  // does not, so the two metrics disagree about the same person. Real, and the
  // reason p32 refuses to let one be read off the other.
  if (row.archetype === "Access barrier") {
    engagementFactor *= 0.90;
    adherenceFactor *= 0.95;
    mechanisms.push("coverage and scheduling instability");
  }

  return {
    // Bounded, so no combination of mechanisms can drive delivery to zero and
    // produce a person with no measures at all — which would fall outside
    // p14's stated per-person range and fail the quality manifest.
    deliveryFailure: Math.min(0.45, deliveryFailure),
    adherenceFactor,
    engagementFactor,
    startDragMean,
    mechanisms,
  };
}
