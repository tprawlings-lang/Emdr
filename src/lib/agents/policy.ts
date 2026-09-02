import { accessProfileFor, type AccessProfile } from "@/lib/demo-population-disparity";
import { PERSON_DAYS } from "@/lib/demo-population-calendar";
import { PATHS, measureOn } from "@/lib/demo-population-generator";
import type { ManifestRow } from "@/lib/demo-population-manifest";

// What a fabricated person does on a given day.
//
// PURE, and seeded. Given a profile, a day and a seed it returns the same
// intent every time, which is what lets an agent-lived fortnight sit inside a
// baseline that `demo -- reset` reproduces byte for byte. An agent that drew
// from the clock would make the environment unverifiable, and p29's
// "recreate the expected baseline" is a release gate rather than a nicety.
//
// AN INTENT, NOT AN ACTION. This decides what the person WANTS to do. Whether
// they may — whether a session is permitted, whether only grounding content is
// available — is the gate engine's answer, and the runner asks it. Deciding
// both here would be building a second, relaxed safety path, which p3
// prohibits and p54 makes a release blocker. The separation is the point of
// the whole layer: the generator wrote what happened, and an agent proposes
// while the product disposes.
//
// It draws on the SAME sources the generator does — the archetype paths and
// the authored access model — so a fortnight lived by an agent looks like the
// eleven months written before it. Two behaviour models for one population
// would show up as a discontinuity two weeks wide on every trend on the
// console.

export interface DayIntent {
  /** The day's check-in, or null when this person does not show up today. */
  checkIn: {
    activation: number;
    shutdown: number;
    harmUrge: boolean;
    feelsSafe: boolean;
    dissociation: number;
    sleepQuality: number;
    substanceFlag: boolean;
  } | null;
  /** Whether a follow-up measure comes due today. */
  measureDue: boolean;
  /** Whether the person completes it, if it comes due. False means they were
   *  asked and did not — the person's side of missingness, distinct from the
   *  service never delivering it. */
  completesMeasure: boolean;
  /** Whether the service manages to deliver it at all. The authored access
   *  model's side: an interpreter who could not be booked, an instrument that
   *  has not been translated. */
  measureDelivered: boolean;
  /** Whether they try to open a module today. */
  wantsModule: boolean;
  /** Whether they try to start a session today. The gate decides whether they
   *  may, and a refusal is the most interesting thing this layer produces. */
  wantsSession: boolean;
}

/** Deterministic per person AND per day, so the fortnight can be replayed one
 *  day at a time or all at once and land in the same place. */
function dayRandom(seed: number, day: number): () => number {
  let a = (seed * 2654435761 + day * 40503) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The day's intent.
 *
 * @param dayFromEnrolment  Days since this person enrolled, so the archetype's
 *                          curve is read at the right point in THEIR journey.
 * @param exposure          Their full observed window, for the same reason.
 */
export function intentFor(
  row: ManifestRow, dayFromEnrolment: number, exposure: number, seed: number,
  access: AccessProfile = accessProfileFor(row),
): DayIntent {
  const path = PATHS[row.archetype];
  const rand = dayRandom(seed, dayFromEnrolment);

  // How often this archetype shows up, as a per-day probability derived from
  // its own range over a full window. A rate is the right shape HERE where it
  // was the wrong shape in the generator: the generator had to hit p14's
  // per-person totals exactly, and a fortnight has no total to hit.
  const midpoint = (path.checkIns[0] + path.checkIns[1]) / 2;
  const showUp = Math.min(1, (midpoint / PERSON_DAYS) * access.engagementFactor);

  const fraction = Math.max(0, Math.min(1, dayFromEnrolment / Math.max(1, exposure)));
  const measure = measureOn(row, fraction);
  // The daily state tracks the measure trajectory rather than being drawn
  // independently — p28: outcomes are not sampled independently of the history
  // that produced them, and a person who improves on the instrument while
  // reporting the same state every day is two datasets stapled together.
  const severity = Math.max(0, Math.min(10, Math.round(measure / 3)));

  const checkIn = rand() < showUp
    ? {
        activation: severity,
        shutdown: Math.max(0, severity - Math.floor(rand() * 3)),
        // Follows the archetype rather than being sprinkled at random. A
        // Safety-pause profile reports a harm urge some of the time and that
        // is what raises a real gate; nobody else does, so a gate that fires
        // for somebody else is a defect rather than noise.
        harmUrge: row.safety === "Fixed pause" && rand() < 0.18,
        feelsSafe: !(row.safety === "Fixed pause" && rand() < 0.12),
        dissociation: row.archetype === "Safety pause" ? Math.floor(rand() * 8) : Math.floor(rand() * 4),
        sleepQuality: Math.max(0, Math.min(10, 8 - Math.round(severity / 2) + Math.floor(rand() * 3) - 1)),
        substanceFlag: false,
      }
    : null;

  // NO MEASURES. The generator owns the whole measure schedule, across a
  // person's full exposure, and splitting a three-weekly cadence across two
  // writers double-counts at the seam — it pushed people past p14's ceiling of
  // eight, which the quality manifest caught. Measures also touch no gate, so
  // they are not what this layer is for.
  const measureDue = false;
  return {
    checkIn,
    measureDue,
    // The two sides of missingness, kept apart here exactly as the generator
    // keeps them apart, because they are two different problems with two
    // different fixes.
    measureDelivered: rand() >= access.deliveryFailure,
    completesMeasure: rand() >= path.missRate * access.adherenceFactor,
    wantsModule: checkIn !== null && rand() < 0.35,
    // Only ever asked on a day they showed up. A session request from somebody
    // who did not check in would be refused by the gate for a reason that says
    // nothing about this population.
    wantsSession: checkIn !== null && rand() < 0.06,
  };
}
