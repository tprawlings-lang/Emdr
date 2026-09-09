// Reading one fairness comparison (handoff 07 §4.4 p43, §3.7 p37).
//
// The audit screen compares a metric across the values of ONE protected
// attribute. This is the read that produces it, and almost all of it is
// delegation: the observations come from the population reader, the rate from
// the same `compute*` functions every other surface uses, the thresholds from
// src/lib/planning/policy.ts, and the suppression from the small-cell rule the
// external surfaces already share.
//
// WHAT IS ACTUALLY DECIDED HERE is which comparisons are refused, and §3.7
// gives three separate reasons for refusing one. They are kept separate all the
// way to the screen, because "not shown" covering three causes is how a
// suppressed cell, an unestimable rate and a policy refusal become one
// indistinguishable blank — and a reader who cannot tell them apart cannot tell
// a careful screen from a broken one.
//
// THE GROUPS COME FROM THE DATA, NOT FROM A LIST. Enumerating the values of a
// protected attribute in code is how a value that exists in the population
// quietly stops being reported: the person is in the denominator of the total
// and in no group at all. Every recorded value produces a row or a withheld
// row, and `accountsForEveryGroup` in fairness-audit.ts is what proves it.

import { loadObservations, metricContext } from "@/lib/metrics/population-metrics";
import { computeFollowupCompletion, type Observation, type MetricResult } from "@/lib/metrics/compute";
import { ALL_ELIGIBLE, type CohortDefinition } from "@/lib/metrics/cohorts";
import { loadThresholds } from "@/lib/planning/policy";
import { SMALL_CELL } from "@/components/charts/aggregate";
import {
  type Comparison, type GroupReading, type WithheldReason, presentationOrder,
} from "./fairness-audit";

/** The attributes this build can compare on, and the observation field each
 *  reads. Race is multi-valued and is handled as such rather than collapsed to
 *  a first entry — §2 forbids collapsing ethnicity into race and the same
 *  reasoning forbids flattening a multi-race answer to whichever came first. */
export const COMPARABLE_ATTRIBUTES = ["language", "ethnicity", "race"] as const;
export type ComparableAttribute = (typeof COMPARABLE_ATTRIBUTES)[number];

export const ATTRIBUTE_LABEL: Record<ComparableAttribute, string> = {
  language: "Preferred language",
  ethnicity: "Ethnicity",
  race: "Race",
};

/**
 * §4.4's first panel is "exact metric and reason for comparing groups", so the
 * question is written per attribute rather than generated. A generated question
 * is a label; this is supposed to be the reason somebody thought the comparison
 * was worth making.
 */
export const ATTRIBUTE_QUESTION: Record<ComparableAttribute, string> = {
  language:
    "Do members who prefer a language other than English complete follow-up measures at the same rate as the eligible population? Asked because follow-up completion is an ACCESS measure — an uneven rate here means the programme is harder to stay in, not that anybody is doing worse.",
  ethnicity:
    "Does follow-up completion differ across recorded ethnicity? Asked to check representation and access, never to characterise a group.",
  race:
    "Does follow-up completion differ across recorded race? Asked to check representation and access. Race is recorded as given and may hold more than one value; nobody is assigned to a single category to make the arithmetic easier.",
};

/** The values a person's record holds for this attribute. Empty means the
 *  attribute is not recorded for them, which is its own group (§3.7: unknown,
 *  declined and missing are shown separately and never redistributed). */
function valuesFor(o: Observation, attribute: ComparableAttribute): string[] {
  if (attribute === "language") return o.language ? [o.language] : [];
  if (attribute === "ethnicity") return o.ethnicity ? [o.ethnicity] : [];
  return o.race;
}

/** A cohort for one value of the attribute, built from the shared type so the
 *  metric functions receive exactly what they receive everywhere else. */
function cohortForValue(attribute: ComparableAttribute, value: string): CohortDefinition {
  return {
    ...ALL_ELIGIBLE,
    id: `fairness.${attribute}.${value}`,
    version: `${ALL_ELIGIBLE.version}+fairness`,
    label: value,
    question: ATTRIBUTE_QUESTION[attribute],
    filters: { ...ALL_ELIGIBLE.filters, [attribute]: [value] },
  };
}

function toRow(value: string, r: MetricResult, headcount: number, minGroup: number): {
  row: GroupReading | null;
  withheld: WithheldReason | null;
} {
  // §3.7's three refusals, in the order that makes the reason the true one: a
  // cell too small to show is refused before a rate too small to estimate,
  // because the first is about disclosure and takes precedence over usefulness.
  if (r.denominator > 0 && r.denominator <= SMALL_CELL) {
    return { row: null, withheld: "small_cell" };
  }
  if (headcount > 0 && headcount < minGroup) {
    return { row: null, withheld: "below_minimum_analysis_size" };
  }
  if (r.value === null) {
    return { row: null, withheld: "not_estimable" };
  }
  return {
    row: {
      group: value,
      numerator: r.numerator,
      denominator: r.denominator,
      value: r.value,
      // No interval. The engine is deterministic and descriptive: it counts a
      // population rather than sampling one, so a confidence interval would be
      // a claim about sampling error that does not apply. §4.4 asks for an
      // interval where there is one, and saying "none, and here is why" is the
      // honest answer rather than manufacturing a number.
      interval: null,
      suppressed: false,
      missing: r.missing,
    },
    withheld: null,
  };
}

/**
 * One comparison, ready to render.
 *
 * `expectedGroups` comes back alongside the comparison so the caller can prove
 * every recorded value is accounted for — shown or withheld — rather than
 * trusting that it is.
 */
export async function readComparison(args: {
  tenantIds: string[];
  attribute: ComparableAttribute;
  window: { start: string; end: string };
  runId: string;
}): Promise<{ comparison: Comparison; expectedGroups: string[] }> {
  const rows = await loadObservations(args.tenantIds, args.window);
  const ctx = await metricContext(args.runId, args.window);
  const t = await loadThresholds();
  const minGroup = t.get("analysis.min_group_size");

  // Every value that appears in the population, plus the not-recorded group.
  const seen = new Set<string>();
  let notRecorded = 0;
  for (const o of rows) {
    const vs = valuesFor(o, args.attribute);
    if (vs.length === 0) notRecorded += 1;
    for (const v of vs) seen.add(v);
  }
  const expectedGroups = [...seen].sort();
  if (notRecorded > 0) expectedGroups.push("Missing");

  const shown: GroupReading[] = [];
  const withheld: Array<{ group: string; reason: WithheldReason }> = [];

  for (const value of [...seen].sort()) {
    const cohort = cohortForValue(args.attribute, value);
    const result = computeFollowupCompletion(rows, cohort, ctx);
    const headcount = rows.filter((o) => valuesFor(o, args.attribute).includes(value)).length;
    const { row, withheld: reason } = toRow(value, result, headcount, minGroup);
    if (row) shown.push(row);
    else if (reason) withheld.push({ group: value, reason });
  }

  // The not-recorded group is reported as a COUNT and never as a rate. §3.7
  // says to show it separately and not redistribute it; computing a completion
  // rate for "people whose language we did not write down" would turn a
  // recording gap into a finding about people.
  if (notRecorded > 0) {
    withheld.push({ group: "Missing", reason: "completeness_below_threshold" });
  }

  return {
    comparison: {
      question: ATTRIBUTE_QUESTION[args.attribute],
      metricId: "followup_completion",
      attribute: args.attribute,
      cohortId: ALL_ELIGIBLE.id,
      cohortVersion: ALL_ELIGIBLE.version,
      window: args.window,
      rows: presentationOrder(shown),
      withheld,
      // §4.4's intersection panel. Predeclared, and honest about whether the
      // sample permits it: this population is 240 people across four regions,
      // so a two-factor split lands under the minimum analysis size almost
      // immediately. Saying so is the answer; running it anyway and suppressing
      // every cell would be the same information dressed as an attempt.
      intersections: [
        {
          factors: [args.attribute, "region"],
          permitted: false,
          note: `Not run: splitting ${rows.length} observations by ${args.attribute} and region puts most cells below the minimum analysis size of ${minGroup}. A view where nearly every cell is suppressed is not an intersection check, it is a suppression report.`,
        },
      ],
    },
    expectedGroups,
  };
}

/** The count of people whose attribute is not recorded, for the representation
 *  panel. Kept as its own read so the number on the screen and the number in
 *  the withheld list come from the same walk. */
export function notRecordedCount(rows: Observation[], attribute: ComparableAttribute): number {
  return rows.filter((o) => valuesFor(o, attribute).length === 0).length;
}
