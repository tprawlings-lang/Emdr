// What one exposure amounts to, and what a whole intervention is still missing
// (17 September handoff, P4).
//
//   "Responses — summarize patterns and allow exposure details to expand.
//   Pattern, evidence, and missing follow-up are distinct."
//
// All three were on the screen and none of them was distinct from the others.
//
// THE EVIDENCE WAS NEVER COLLAPSED. Every exposure printed its context line,
// every observation it carried and its missing windows, all the time — so a
// person with forty exposures got several hundred lines of extra-small text in
// one scroll, and the twelfth exposure was the last one anybody could read: the
// list cut off at twelve with "and N earlier — the count above includes them",
// which is a sentence telling the reader that records exist and they cannot see
// them.
//
// AND MISSING FOLLOW-UP LIVED INSIDE THE PATTERN. The fingerprint's limitations
// carried "4 of 6 had a window nobody recorded", inside the tinted block that
// also carried the pattern state — so the fact that nobody looked read as part
// of what was found. Those are different kinds of fact: one is a claim about
// the person's responses, the other is a claim about our record-keeping, and
// only one of them is work somebody can do something about today.
//
// So this module answers two questions, both purely:
//
//   For ONE exposure, what is its standing — was it followed up, partly, or not
//   at all, and did the windows disagree? That goes on the scan line, so a
//   reader knows whether opening it is worth their time.
//
//   For an INTERVENTION, how much follow-up is outstanding? That goes in its
//   own row, beside the pattern and not inside it.

import {
  missingWindowsFor, isMixed,
  MISSING_WINDOW_LABEL, EXPECTED_WINDOWS,
  type ResponseObservation, type WindowType,
} from "./response-vocabulary";
import type { InterventionInstance } from "./interventions";

/** The four standings an exposure can have, in the order they matter to a
 *  reader deciding where to look. */
export type ExposureState =
  /** The windows disagreed. Never netted, always named. */
  | "mixed"
  /** Every expected window has an observation. */
  | "followed_up"
  /** Some windows observed, some not. */
  | "partly_followed_up"
  /** Nothing was recorded after it. */
  | "not_followed_up"
  /** Nothing was expected — a clinician entry expects what the clinician chose
   *  to record, and calling that incomplete would be Steady auditing their
   *  judgement. */
  | "nothing_expected";

export interface ExposureStanding {
  state: ExposureState;
  observed: number;
  expected: number;
  missing: WindowType[];
  /** The scan line's short form. */
  said: string;
  /** Whether anything is outstanding on this exposure. */
  outstanding: boolean;
}

export function exposureStanding(
  instance: InterventionInstance, observations: ReadonlyArray<ResponseObservation>
): ExposureStanding {
  const mine = observations.filter((o) => o.instanceId === instance.id);
  const missing = missingWindowsFor(instance, [...mine]);
  const expected = (EXPECTED_WINDOWS[instance.sourceType] ?? []).length;
  const observed = mine.length;

  if (isMixed([...mine])) {
    return {
      state: "mixed", observed, expected, missing, outstanding: missing.length > 0,
      // MIXED OUTRANKS INCOMPLETE. An exposure that settled someone in the room
      // and left them worse the next day is the finding, and a scan line
      // reading "partly followed up" would hide it behind a bookkeeping fact.
      said: "Mixed — the windows did not agree",
    };
  }
  if (expected === 0) {
    return {
      state: "nothing_expected", observed, expected, missing, outstanding: false,
      said: observed === 0
        ? "No follow-up expected"
        : `${observed} observation${observed === 1 ? "" : "s"}`,
    };
  }
  if (missing.length === 0) {
    return {
      state: "followed_up", observed, expected, missing, outstanding: false,
      said: `Followed up in ${expected === 1 ? "the expected window" : `all ${expected} windows`}`,
    };
  }
  if (observed === 0) {
    return {
      state: "not_followed_up", observed, expected, missing, outstanding: true,
      // NOT "no change" and not blank. §6: a missing follow-up is reported, and
      // it is not recovery.
      said: `Not followed up — ${missing.map((w) => MISSING_WINDOW_LABEL[w]).join(", ")}`,
    };
  }
  return {
    state: "partly_followed_up", observed, expected, missing, outstanding: true,
    said: `${expected - missing.length} of ${expected} windows observed`,
  };
}

export interface FollowUpGap {
  exposures: number;
  /** Exposures with at least one expected window nobody observed. */
  withMissing: number;
  /** Expected windows across all of them that carry no observation. */
  windowsMissing: number;
  said: string;
  /** False when nothing is outstanding, so the row can say that rather than
   *  disappear. */
  outstanding: boolean;
}

/**
 * How much follow-up an intervention is missing, as its own fact.
 *
 * Separate from the pattern on purpose. "Some settling observed, on limited
 * evidence" is a statement about this person; "4 of 6 exposures have a window
 * nobody recorded" is a statement about us. Printing the second inside the
 * first made a gap in our record read as part of what we found.
 */
export function followUpGap(
  instances: ReadonlyArray<InterventionInstance>,
  observations: ReadonlyArray<ResponseObservation>
): FollowUpGap {
  const standings = instances.map((i) => exposureStanding(i, observations));
  const withMissing = standings.filter((s) => s.missing.length > 0).length;
  const windowsMissing = standings.reduce((n, s) => n + s.missing.length, 0);
  const exposures = instances.length;

  if (exposures === 0) {
    return { exposures, withMissing, windowsMissing, outstanding: false, said: "Nothing recorded yet." };
  }
  if (withMissing === 0) {
    return {
      exposures, withMissing, windowsMissing, outstanding: false,
      said: "Every exposure has an observation in each window it expected.",
    };
  }
  // THE COUNT, NOT THE CAVEAT. "That is unknown, not recovered" belongs on this
  // page once — it is in the panel's footnote, above every intervention — and
  // repeating it under all six of them is how a reader learns to skip the row
  // it is attached to. The fingerprint's stored limitations carry the sentence
  // too, so the record of what the summary cannot support is unchanged.
  return {
    exposures, withMissing, windowsMissing, outstanding: true,
    said:
      `${withMissing} of ${exposures} exposure${exposures === 1 ? "" : "s"} ` +
      `${withMissing === 1 ? "has" : "have"} a window nobody recorded — ` +
      `${windowsMissing} window${windowsMissing === 1 ? "" : "s"} in total.`,
  };
}
