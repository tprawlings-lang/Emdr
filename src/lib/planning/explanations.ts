import { cohort, cohortHash, type CohortDefinition, type CohortFilters } from "@/lib/metrics/cohorts";
import {
  computeFollowupCompletion, resolve, type ComputeContext, type Observation,
} from "@/lib/metrics/compute";

// Alternative explanations (handoff 07 §4.5 p44, §3.6 p36).
//
// p44 gives the signal detail screen a row called "Alternative explanations"
// and names five: missingness, selection, confounding, version changes and
// capacity. The first version of that section rendered the rule's static
// limitation strings — "observational", "no adjustment for confounders" — which
// is true, generic, and useless. A reader who has already decided what the
// signal means is not talked out of it by a disclaimer; they are talked out of
// it by a number.
//
// So these are COMPUTED against the same observations the signal was computed
// from, and each one either finds something or says it did not.
//
// WHAT p36 PERMITS THIS TO SAY. Stratifying is level 2 on the release ladder —
// "observed within these strata" — so a stratified finding may be reported as
// an observation within the stratum and may not be reported as the cause. The
// wording below is held to that: "the difference is smaller within X" is a
// level-2 observation; "X explains the difference" would be a level-3 claim
// this build has not earned.

export type ExplanationKind =
  | "composition"
  | "stratified"
  | "differential-missingness"
  | "cause-mix"
  | "small-group";

export interface Explanation {
  kind: ExplanationKind;
  /** What was checked. Present whether or not anything was found, because
   *  "we looked and it was not that" is the half a reader never gets. */
  question: string;
  /** True when the check found something a reader should weigh. */
  found: boolean;
  detail: string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pp = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)} percentage points`;

function rate(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): number | null {
  return computeFollowupCompletion(rows, c, ctx).value;
}

/** A cohort identical to `c` with one filter added — the stratified view. */
function narrow(c: CohortDefinition, extra: Partial<CohortFilters>, suffix: string): CohortDefinition {
  return {
    ...c,
    id: `${c.id}+${suffix}`,
    label: `${c.label}, ${suffix}`,
    filters: { ...c.filters, ...extra },
  };
}

/**
 * The dimensions worth checking a cohort's composition against.
 *
 * Every one is an OPERATIONAL or reporting attribute rather than an identity:
 * what the service had to do for this person, and where they live. That is
 * deliberate. The purpose of a composition check is to find the thing the
 * service did differently, and a check that reported "this cohort is 40% Black"
 * would be producing exactly the sentence p43 exists to prevent, in the section
 * that is supposed to be guarding against it.
 */
const COMPOSITION_DIMENSIONS: Array<{
  key: string;
  /** "needs an interpreter" — reads after "members who". */
  predicate: string;
  /** "interpreter need" — reads after "with ... held out". Two forms rather
   *  than one, because a single label produced "members who do not needs an
   *  interpreter" in half the sentences it appeared in. */
  noun: string;
  of: (r: Observation) => boolean;
  filter: Partial<CohortFilters>;
  invert: Partial<CohortFilters>;
}> = [
  {
    key: "interpreter",
    predicate: "needs an interpreter",
    noun: "interpreter need",
    of: (r) => r.interpreterNeeded,
    filter: { interpreterNeeded: true },
    invert: { interpreterNeeded: false },
  },
  {
    key: "access-need",
    predicate: "has a functional access need",
    noun: "a functional access need",
    of: (r) => r.accessNeeds.length > 0,
    filter: { accessNeed: ["screen-reader", "captions"] },
    invert: {},
  },
];

export interface ExplanationInput {
  cohort: CohortDefinition;
  reference: CohortDefinition;
  rows: Observation[];
  ctx: ComputeContext;
  /** p37's minimum analysis size, applied to the metric's DENOMINATOR — what
   *  decides whether a stratified rate can be estimated at all. */
  minDenominator: number;
  /** p37's minimum analysis size, applied to a HEADCOUNT — what decides
   *  whether a statement about how a group is treated may be made. */
  minGroup: number;
}

/** Missing measures split by whose failure they were, summed over a group.
 *  Computed from the observations rather than queried, so this whole module
 *  stays pure and checkable against arithmetic. */
function causeMix(rows: Observation[]): { service: number; person: number } {
  let service = 0;
  let person = 0;
  for (const r of rows) {
    service += r.measuresUndelivered;
    // Everything else that came due and was not completed. `notDue` is
    // excluded because a measure that never came due is not a missing one —
    // the same exclusion `computeFollowupCompletion` makes in its denominator.
    person += r.measuresPartial + r.measuresDeclined + r.measuresSkipped
      + r.measuresInterrupted + Math.max(0, r.measuresUnavailable - r.measuresUndelivered);
  }
  return { service, person };
}

/**
 * Work through the alternatives, in the order a reader should.
 *
 * Composition first, because a cohort that differs from the reference on
 * something other than its own definition is the commonest reason a gap is not
 * what it looks like. Then the stratified recomputation, which is the only one
 * that can actually move the number. Then the two that bound the finding
 * rather than explaining it — differential missingness and small groups.
 */
export function explain(input: ExplanationInput): Explanation[] {
  const { cohort: c, reference: ref, rows, ctx, minGroup } = input;
  const out: Explanation[] = [];

  const group = resolve(rows, c);
  const refGroup = resolve(rows, ref);
  const baseGap = (() => {
    const a = rate(rows, c, ctx);
    const b = rate(rows, ref, ctx);
    return a === null || b === null ? null : (a - b) * 100;
  })();

  // ── Composition ────────────────────────────────────────────────────────
  for (const d of COMPOSITION_DIMENSIONS) {
    const inCohort = group.length === 0 ? 0 : group.filter(d.of).length / group.length;
    const inRef = refGroup.length === 0 ? 0 : refGroup.filter(d.of).length / refGroup.length;
    // A 1.5x over-representation, and at least five percentage points, so a
    // cohort of forty with three of something does not generate a paragraph.
    const over = inRef > 0 && inCohort >= inRef * 1.5 && inCohort - inRef >= 0.05;
    out.push({
      kind: "composition",
      question: `Is this cohort over-represented among members who ${d.predicate}?`,
      found: over,
      detail: over
        ? `${pct(inCohort)} of this cohort ${d.predicate}, against ${pct(inRef)} of the eligible ` +
          "population. A difference between the two groups may be a difference in this instead."
        : `${pct(inCohort)} of this cohort ${d.predicate}, against ${pct(inRef)} of the eligible ` +
          "population — not a material difference in composition.",
    });

    // ── Stratified ───────────────────────────────────────────────────────
    // Only worth computing where the composition check found something: a
    // stratified recomputation on a dimension the cohort does not differ on
    // answers a question nobody asked.
    if (!over || baseGap === null) continue;
    const held = narrow(c, d.invert, `${d.noun} held out`);
    const heldRate = rate(rows, held, ctx);
    const refRate = rate(rows, ref, ctx);
    const heldN = resolve(rows, held).length;
    // Gated on the DENOMINATOR, not the headcount. Holding out a stratum
    // leaves fewer people by construction, and refusing the comparison on
    // headcount refused the one check that could tell two causes apart — on a
    // rate that rested on nearly two hundred observations. The headcount limit
    // still applies to what may be SAID about the group, below.
    const heldDenominator = computeFollowupCompletion(rows, held, ctx).denominator;
    if (heldRate === null || refRate === null || heldDenominator < input.minDenominator) {
      out.push({
        kind: "stratified",
        question: `With ${d.noun} held out, is the difference still there?`,
        found: false,
        detail:
          `Cannot be checked: holding out ${d.noun} leaves ${heldDenominator} observations, below ` +
          `the minimum analysis size of ${input.minDenominator}. The comparison is not available ` +
          "at this cohort size, which is a limit of the data rather than a finding either way.",
      });
      continue;
    }
    const heldGap = (heldRate - refRate) * 100;
    // "Most of it" is a judgement, so it is a stated number: the gap has to
    // fall by more than half to be described as concentrated.
    const concentrated = Math.abs(heldGap) < Math.abs(baseGap) * 0.5;
    out.push({
      kind: "stratified",
      question: `With ${d.noun} held out, is the difference still there?`,
      found: true,
      detail: concentrated
        ? `Observed within these strata: the difference is ${pp(baseGap)} overall and ${pp(heldGap)} ` +
          `among the ${heldN} members of this cohort without it, so it is concentrated in the ` +
          `part of the cohort that ${d.predicate}. That is where an operational fix would have to go. ` +
          "This is an observation within a stratum, not a demonstration that it is the cause."
        : `Observed within these strata: the difference is ${pp(baseGap)} overall and ${pp(heldGap)} ` +
          `among the ${heldN} members of this cohort without it. It survives the ` +
          "stratification, so whatever is producing it is not confined to that group.",
    });
  }

  // ── Differential missingness ───────────────────────────────────────────
  //
  // The one that most often turns a finding into a bound. If the cohort's
  // missing measures are disproportionately the SERVICE's failures rather than
  // the person's, the completion rate is measuring delivery and not adherence
  // — and the two call for opposite responses.
  const m = { cohort: causeMix(group), reference: causeMix(refGroup) };
  const cohortTotal = m.cohort.service + m.cohort.person;
  const refTotal = m.reference.service + m.reference.person;
  const cohortShare = cohortTotal === 0 ? 0 : m.cohort.service / cohortTotal;
  const refShare = refTotal === 0 ? 0 : m.reference.service / refTotal;
  const serviceDriven = cohortShare > refShare + 0.15;
  out.push({
    kind: "cause-mix",
    question: "Are the missing measures this cohort's, or the service's?",
    found: serviceDriven,
    detail: serviceDriven
      ? `${pct(cohortShare)} of this cohort's missing measures were never DELIVERED, against ` +
        `${pct(refShare)} in the eligible population. On these numbers the difference is mostly ` +
        "in what the service sent, not in what people did with it — and those have opposite fixes."
      : `${pct(cohortShare)} of this cohort's missing measures were never delivered, against ` +
        `${pct(refShare)} in the eligible population — a similar mix, so the difference is not ` +
        "explained by delivery alone.",
  });

  const cohortMissRate = group.length === 0 ? 0 : cohortTotal / group.length;
  const refMissRate = refGroup.length === 0 ? 0 : refTotal / refGroup.length;
  const differential = cohortMissRate > refMissRate * 1.25;
  out.push({
    kind: "differential-missingness",
    question: "Does this cohort have more missing follow-up than the reference?",
    found: differential,
    detail: differential
      ? `${cohortMissRate.toFixed(1)} missing measures per person against ${refMissRate.toFixed(1)}. ` +
        "Any comparison of outcomes between these groups is a comparison between the people who " +
        "answered, and those are not the same fraction of each group. Treat the difference as a " +
        "bound rather than an estimate."
      : `${cohortMissRate.toFixed(1)} missing measures per person against ${refMissRate.toFixed(1)} ` +
        "— comparable, so the outcome comparison is not obviously distorted by who answered.",
  });

  // ── Group size ─────────────────────────────────────────────────────────
  out.push({
    kind: "small-group",
    question: "Is the cohort large enough to compare at all?",
    found: group.length < minGroup,
    detail: group.length < minGroup
      ? `${group.length} people, below the minimum analysis size of ${minGroup}.`
      : `${group.length} people, at or above the minimum analysis size of ${minGroup}.`,
  });

  return out;
}

/** The cohort a signal names, resolved to a definition, or null when it has
 *  left the registry. */
export function cohortFor(id: string): CohortDefinition | null {
  try { return cohort(id); } catch { return null; }
}

export { cohortHash };
