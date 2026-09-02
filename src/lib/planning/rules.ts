import type { MetricResult } from "@/lib/metrics/compute";
import { CURRENT_LEVEL, ladder } from "./ladder";
import type { RuleId, ThresholdSource } from "./policy";

// The seven deterministic signal rules (handoff 07 §3.4, p34).
//
// PURE, over readings rather than over the database, for the same reason
// `metrics/compute.ts` is: a rule that runs its own SQL can only be checked
// against that SQL. These take numbers and return an outcome, so the fixtures
// in `tests/planning.test.ts` are three-line objects with the expected answer
// worked out in the comment.
//
// TWO THINGS ARE STRUCTURAL HERE, and both come straight off p34.
//
// 1. THE "NO OUTPUT WHEN" COLUMN IS CHECKED FIRST. Every rule is evaluated as
//    withheld-then-triggered, in that order, and `evaluateRule` returns before
//    the trigger runs if the withholding condition holds. So a rule cannot be
//    both fired and withheld — not by discipline, but because the code that
//    would set `fired` never executes. The alternative shape, computing both
//    and letting a screen decide, is how a suppressed cell ends up published
//    in a signal that explains why it was suppressed.
//
// 2. EVERY NUMBER COMPARED AGAINST COMES FROM `ThresholdSource.get`, which
//    throws on an unknown key. There is no `?? 10` anywhere below. A rule that
//    reached for a literal would compare against a number with no owner and no
//    approval date, which is exactly what p34 forbids, and the test that
//    records which keys each rule reads is how that is detected rather than
//    reviewed.

/** One window's reading of one metric, for the cohort and its reference. */
export interface WindowReading {
  /** e.g. "2026-03-02..2026-05-31". Printed on the signal, because "the last
   *  two windows" is not reproducible and a pair of dates is. */
  label: string;
  cohort: MetricResult;
  /** The same metric over p33's primary comparison — the eligible population.
   *  A gap has no meaning without the thing it is a gap from. */
  reference: MetricResult;
  /** Proportion of the cohort's due follow-up measures that were not
   *  completed, in this window. p34's "missingness high" condition, as a
   *  number rather than an adjective. */
  missingness: number;
}

export interface FairnessInput {
  /** The measure the disparity is on — p34 permits outcome, access or error
   *  rate, and which one it is changes what the signal means. */
  measure: string;
  /** Signed percentage points, group minus reference. Negative is worse for
   *  the group; the sign is kept because "a 14-point disparity" that turns out
   *  to favour the group is a different finding. */
  disparityPp: number;
  /** Proportion of the group whose protected attribute is actually recorded.
   *  A disparity over a group that is half unrecorded is a statement about the
   *  recording. */
  completeness: number;
  groupSize: number;
}

export interface CapacityInput {
  demand: number;
  /** Null when there is no scheduling feed at all — which is the case in this
   *  deployment, and is why this rule produces nothing. */
  openFirstVisitSlots: number | null;
  slotDataAsOf: string | null;
  asOfAgeDays: number | null;
}

export interface ReviewLoadInput {
  fixedReviewEvents: number;
  /** Null when no staffing record exists. */
  staffedCapacity: number | null;
  classificationComplete: boolean;
  coverageScheduleKnown: boolean;
}

export interface DataQualityInput {
  missingness: number;
  /** Rows that did not rebuild identically from their own events. */
  projectionMismatches: number;
  /** Movement between the two windows, in percentage points. */
  driftPp: number;
  /** p29's manifest. Folded in here rather than evaluated separately: p29's
   *  "block external demonstrations" and p34's "block planning release" are
   *  the same judgement, and running them as two answers would let a planning
   *  screen release output while the admin page reports the environment
   *  broken. */
  checksFailed: number;
  checksTotal: number;
}

export interface RuleContext {
  cohortId: string;
  cohortHash: string;
  referenceId: string;
  /** Oldest window first. */
  access: WindowReading[];
  followup: WindowReading[];
  change: WindowReading[];
  fairness: FairnessInput | null;
  capacity: CapacityInput | null;
  reviewLoad: ReviewLoadInput | null;
  dataQuality: DataQualityInput | null;
  /** p34: FOLLOWUP_GAP produces no output when due-date logic differs across
   *  groups, because then the gap is in the scheduler rather than in the
   *  people. Declared rather than inferred — nothing in the data could say. */
  followupDueLogicDiffers: boolean;
  /** p34: MODULE_SIGNAL produces no output when the exposure definition
   *  changed during the period. Also declared. */
  exposureDefinitionChanged: boolean;
  /** Whether the interval on observed change is a CONFIDENCE interval. It is
   *  not: `computeObservedChange` reports the observed range and says so, and
   *  p36 puts an interval estimate above level 1. p34's condition cannot be
   *  evaluated without one. */
  changeIntervalIsConfidence: boolean;
}

export interface RuleOutcome {
  ruleId: RuleId;
  /** True only when the trigger held AND nothing withheld it. */
  fired: boolean;
  /** p34's "no output when", as the reason it applied — or null when the rule
   *  was actually evaluated. A withheld rule is never fired. */
  withheld: string | null;
  /** Level-1 wording, or "" when nothing fired. */
  statement: string;
  /** p34's Output column: what a human is being asked to do, not what the
   *  system will do. */
  output: string;
  observed: Record<string, number | string | boolean | null>;
  threshold: Record<string, number>;
  metricRefs: string[];
  limitations: string[];
}

export interface RuleDefinition {
  id: RuleId;
  label: string;
  /** p34's Trigger column, verbatim in meaning. */
  trigger: string;
  /** p34's Output column. */
  output: string;
  /** p34's "No output when" column. */
  noOutputWhen: string;
  /** DATA_QUALITY only. p34 writes "Never bypassed" in its no-output cell, and
   *  this flag is that sentence made checkable: the evaluator asserts that a
   *  rule marked this way returns no withholding reason under any input. */
  neverWithheld?: true;
  evaluate: (ctx: RuleContext, t: ThresholdSource) => RuleOutcome;
}

// ---------------------------------------------------------------------------
// Shared preconditions
// ---------------------------------------------------------------------------

const pp = (r: MetricResult): number | null => (r.value === null ? null : r.value * 100);

/**
 * Whether a window's reading can support a comparison at all.
 *
 * p34 names three conditions on ACCESS_GAP — "cell suppressed, missingness
 * high or denominator below threshold". Two of them apply to any rule reading
 * a metric: a suppressed cell cannot support any signal (a rule that fires on
 * one publishes the number the suppression was protecting, inside a sentence
 * explaining that it was protected), and a group of five cannot be compared
 * with anything.
 *
 * THE MISSINGNESS CONDITION IS NOT UNIVERSAL, and applying it as though it
 * were made FOLLOWUP_GAP unable to fire at all. Follow-up completion IS a
 * missingness measure: the gap the rule looks for and the missingness the
 * guard rejects are the same number, so every cohort with a real follow-up
 * gap was withheld for having one. Measured: an authored access barrier
 * produced an 18-point gap and 41% missingness, and the rule that exists to
 * report the first was silenced by the second.
 *
 * That is why p34 lists missingness under ACCESS_GAP and not under
 * FOLLOWUP_GAP. A guard that can never pass is as useless as one that can
 * never fail, and rather harder to notice.
 */
function unusable(
  w: WindowReading, t: ThresholdSource, opts: { missingness: boolean } = { missingness: true },
): string | null {
  const minN = t.get("analysis.min_denominator");
  if (w.cohort.suppressed || w.reference.suppressed) {
    return `the cell is suppressed in window ${w.label}`;
  }
  if (w.cohort.denominator < minN) {
    return `the cohort denominator in window ${w.label} is ${w.cohort.denominator}, below the minimum analysis size of ${minN}`;
  }
  if (w.reference.denominator < minN) {
    return `the reference denominator in window ${w.label} is ${w.reference.denominator}, below the minimum analysis size of ${minN}`;
  }
  if (w.cohort.value === null || w.reference.value === null) {
    return `there is no rate to compare in window ${w.label} — the denominator is zero`;
  }
  if (opts.missingness) {
    const maxMiss = t.get("analysis.max_missingness");
    if (w.missingness > maxMiss) {
      return `missingness in window ${w.label} is ${(w.missingness * 100).toFixed(1)}%, above the limit of ${(maxMiss * 100).toFixed(0)}%`;
    }
  }
  return null;
}

/** Level-1 wording, built from the ladder rather than typed into a template,
 *  so the permitted phrase and the sentence cannot drift apart. */
function observed(rest: string): string {
  return `${ladder(CURRENT_LEVEL).permittedWording}: ${rest}`;
}

function nothing(
  ruleId: RuleId, output: string, withheld: string,
  observedFields: Record<string, number | string | boolean | null> = {},
  threshold: Record<string, number> = {},
): RuleOutcome {
  return {
    ruleId, fired: false, withheld, statement: "", output,
    observed: observedFields, threshold, metricRefs: [], limitations: [],
  };
}

/** Limitations every signal in this build carries, because every signal in
 *  this build is descriptive and over fabricated data. p49 puts them on the
 *  object; they are not a footnote a screen may choose to render. */
const BASE_LIMITATIONS = [
  "fabricated data",
  "observational",
  "no adjustment for confounders",
];

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const ACCESS_GAP: RuleDefinition = {
  id: "ACCESS_GAP",
  label: "Access gap",
  trigger: "Stage conversion differs by at least the configured margin from reference for two windows",
  output: "Investigate stage, channel and owner",
  noOutputWhen: "Cell suppressed, missingness high or denominator below threshold",
  evaluate(ctx, t) {
    const needed = t.get("access_gap.repeat_windows");
    const margin = t.get("access_gap.difference_pp");
    const threshold = { difference_pp: margin, repeat_windows: needed };

    if (ctx.access.length < needed) {
      return nothing(this.id, this.output,
        `only ${ctx.access.length} window${ctx.access.length === 1 ? "" : "s"} of data — the rule needs ${needed}`,
        { windows_available: ctx.access.length }, threshold);
    }
    const recent = ctx.access.slice(-needed);
    for (const w of recent) {
      const bad = unusable(w, t);
      if (bad) return nothing(this.id, this.output, bad, { window: w.label }, threshold);
    }

    const diffs = recent.map((w) => pp(w.cohort)! - pp(w.reference)!);
    // The gap must hold in EVERY window and in the SAME DIRECTION. Two windows
    // where the cohort is 11 points below and then 11 points above is not a
    // repeated gap; it is a cohort too small to be stable, and reporting the
    // absolute value of each would call it one.
    const sameSign = diffs.every((d) => d < 0) || diffs.every((d) => d > 0);
    const allOver = diffs.every((d) => Math.abs(d) >= margin);
    const fired = sameSign && allOver;
    const worst = diffs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), diffs[0]);

    return {
      ruleId: this.id,
      fired,
      withheld: null,
      statement: fired
        ? observed(
            `first-week activation is ${Math.abs(worst).toFixed(1)} percentage points ` +
            `${worst < 0 ? "below" : "above"} the eligible population, in each of the last ` +
            `${needed} windows (${recent.map((w) => w.label).join(", ")}).`)
        : "",
      output: this.output,
      observed: {
        difference_pp: Math.round(worst * 10) / 10,
        repeat_windows: recent.length,
        same_direction: sameSign,
        ...Object.fromEntries(recent.map((w, i) => [`window_${i + 1}`, `${w.label}: ${diffs[i].toFixed(1)}pp`])),
      },
      threshold,
      metricRefs: recent.map((w) => w.cohort.lineage_ref),
      limitations: [...BASE_LIMITATIONS, "stage conversion is measured as activation within 7 days"],
    };
  },
};

const FOLLOWUP_GAP: RuleDefinition = {
  id: "FOLLOWUP_GAP",
  label: "Follow-up gap",
  trigger: "Follow-up completion is at least the configured margin below reference",
  output: "Review reminder timing and access barriers",
  noOutputWhen: "Due-date logic differs across groups",
  evaluate(ctx, t) {
    const margin = t.get("followup_gap.difference_pp");
    const threshold = { difference_pp: -margin };

    if (ctx.followupDueLogicDiffers) {
      return nothing(this.id, this.output,
        "due-date logic differs across groups, so the gap is in the schedule rather than in the people",
        {}, threshold);
    }
    const w = ctx.followup[ctx.followup.length - 1];
    if (!w) return nothing(this.id, this.output, "no follow-up reading in the window", {}, threshold);
    // Missingness is NOT checked here, and the exclusion is deliberate rather
    // than an omission: this rule's finding is a missingness difference, so
    // rejecting the window for high missingness would silence exactly the
    // cohorts it exists to find. Suppression and the minimum denominator still
    // apply, because neither of those is the thing being measured.
    const bad = unusable(w, t, { missingness: false });
    if (bad) return nothing(this.id, this.output, bad, { window: w.label }, threshold);

    // BELOW, not "differs by". p34 words this rule directionally and the
    // direction is the finding: a cohort completing follow-up more often than
    // the population is not an access problem to investigate.
    const diff = pp(w.cohort)! - pp(w.reference)!;
    const fired = diff <= -margin;

    return {
      ruleId: this.id,
      fired,
      withheld: null,
      statement: fired
        ? observed(
            `follow-up completion is ${Math.abs(diff).toFixed(1)} percentage points below the ` +
            `eligible population (${w.cohort.numerator} of ${w.cohort.denominator} due measures ` +
            `completed, against ${w.reference.numerator} of ${w.reference.denominator}), in ${w.label}.`)
        : "",
      output: this.output,
      observed: {
        difference_pp: Math.round(diff * 10) / 10,
        cohort_numerator: w.cohort.numerator,
        cohort_denominator: w.cohort.denominator,
        reference_numerator: w.reference.numerator,
        reference_denominator: w.reference.denominator,
        window: w.label,
      },
      threshold,
      metricRefs: [w.cohort.lineage_ref],
      limitations: [
        ...BASE_LIMITATIONS,
        "a measure that was never due is excluded from the denominator, not counted as missed",
      ],
    };
  },
};

const MODULE_SIGNAL: RuleDefinition = {
  id: "MODULE_SIGNAL",
  label: "Module signal",
  trigger: "Paired observed change differs by the configured amount and repeats in two windows",
  output: "Propose controlled pilot",
  noOutputWhen: "Exposure definition changed or confidence interval crosses zero",
  evaluate(ctx, t) {
    const needed = t.get("module_signal.repeat_windows");
    const margin = t.get("module_signal.change_difference");
    const threshold = { change_difference: margin, repeat_windows: needed };

    if (ctx.exposureDefinitionChanged) {
      return nothing(this.id, this.output,
        "the exposure definition changed during the period, so the two windows measure different things",
        {}, threshold);
    }
    // p34's second condition needs a confidence interval, and this build has
    // none. `computeObservedChange` reports the observed RANGE and says in its
    // own comment that calling it a confidence interval would promote the
    // finding a rung on p36's ladder. So the rule is withheld on a missing
    // input rather than evaluated against a substitute — which is the same
    // answer as REGION_CAPACITY's, arrived at for the same reason.
    if (!ctx.changeIntervalIsConfidence) {
      return nothing(this.id, this.output,
        "no confidence interval is computed — observed change reports the observed range, and " +
        "p34's condition cannot be evaluated without an interval estimate (p36 puts one above level 1)",
        { interval_available: false }, threshold);
    }
    if (ctx.change.length < needed) {
      return nothing(this.id, this.output,
        `only ${ctx.change.length} window${ctx.change.length === 1 ? "" : "s"} of paired change — the rule needs ${needed}`,
        { windows_available: ctx.change.length }, threshold);
    }

    const recent = ctx.change.slice(-needed);
    const diffs = recent.map((w) =>
      Number(w.cohort.detail.mean_change ?? 0) - Number(w.reference.detail.mean_change ?? 0));
    const low = Number(recent[recent.length - 1].cohort.detail.range_low ?? 0);
    const high = Number(recent[recent.length - 1].cohort.detail.range_high ?? 0);
    if (low <= 0 && high >= 0) {
      return nothing(this.id, this.output, "the interval crosses zero",
        { interval_low: low, interval_high: high }, threshold);
    }
    const sameSign = diffs.every((d) => d < 0) || diffs.every((d) => d > 0);
    const fired = sameSign && diffs.every((d) => Math.abs(d) >= margin);
    const worst = diffs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), diffs[0]);

    return {
      ruleId: this.id,
      fired,
      withheld: null,
      statement: fired
        ? observed(
            `paired change differs from the eligible population by ${Math.abs(worst).toFixed(1)} ` +
            `instrument points in each of the last ${needed} windows.`)
        : "",
      output: this.output,
      observed: {
        change_difference: Math.round(worst * 100) / 100,
        repeat_windows: recent.length,
        same_direction: sameSign,
      },
      threshold,
      metricRefs: recent.map((w) => w.cohort.lineage_ref),
      limitations: [
        ...BASE_LIMITATIONS,
        "people with two measures are not a random sample of people with one",
        "module choice is not randomised — more engaged people choose differently",
      ],
    };
  },
};

const REGION_CAPACITY: RuleDefinition = {
  id: "REGION_CAPACITY",
  label: "Region capacity",
  trigger: "Demand exceeds open first-visit capacity by the configured ratio",
  output: "Operational capacity review",
  noOutputWhen: "Demand or slot data stale",
  evaluate(ctx, t) {
    const ratio = t.get("region_capacity.demand_ratio");
    const maxAge = t.get("region_capacity.slot_data_max_age_days");
    const threshold = { demand_ratio: ratio, slot_data_max_age_days: maxAge };
    const cap = ctx.capacity;

    if (!cap) {
      return nothing(this.id, this.output, "no capacity reading was supplied", {}, threshold);
    }
    // There is no scheduling feed in this deployment — the organization
    // capacity screen already renders in the PARTIAL state for exactly this
    // reason and names the missing source above the chart. A planning rule
    // that fired anyway would have to invent the denominator, and a ratio with
    // an invented denominator is the failure the screen was built to avoid.
    if (cap.openFirstVisitSlots === null || cap.slotDataAsOf === null) {
      return nothing(this.id, this.output,
        "there is no open-slot feed in this deployment, so demand has no denominator",
        { demand: cap.demand, open_first_visit_slots: null }, threshold);
    }
    if (cap.asOfAgeDays !== null && cap.asOfAgeDays > maxAge) {
      return nothing(this.id, this.output,
        `slot data is ${cap.asOfAgeDays} days old, past the ${maxAge}-day limit`,
        { slot_data_age_days: cap.asOfAgeDays }, threshold);
    }
    if (cap.openFirstVisitSlots === 0) {
      return nothing(this.id, this.output, "the open-slot count is zero, so the ratio is undefined",
        { demand: cap.demand }, threshold);
    }

    const observedRatio = cap.demand / cap.openFirstVisitSlots;
    const fired = observedRatio >= ratio;
    return {
      ruleId: this.id,
      fired,
      withheld: null,
      statement: fired
        ? observed(
            `demand for a first visit is ${observedRatio.toFixed(2)} times the open first-visit ` +
            `capacity (${cap.demand} waiting, ${cap.openFirstVisitSlots} slots).`)
        : "",
      output: this.output,
      observed: {
        demand: cap.demand,
        open_first_visit_slots: cap.openFirstVisitSlots,
        ratio: Math.round(observedRatio * 100) / 100,
        slot_data_as_of: cap.slotDataAsOf,
      },
      threshold,
      metricRefs: [],
      limitations: [...BASE_LIMITATIONS, "demand is people with a scheduled visit and no recorded care start"],
    };
  },
};

const FAIRNESS_ALERT: RuleDefinition = {
  id: "FAIRNESS_ALERT",
  label: "Fairness alert",
  trigger: "Outcome, access or error-rate disparity exceeds the policy threshold",
  output: "Human fairness review",
  noOutputWhen: "Protected-group completeness below policy threshold",
  evaluate(ctx, t) {
    const margin = t.get("fairness_alert.disparity_pp");
    const minComplete = t.get("fairness_alert.min_group_completeness");
    const minN = t.get("analysis.min_denominator");
    const threshold = {
      disparity_pp: margin, min_group_completeness: minComplete, min_denominator: minN,
    };
    const f = ctx.fairness;
    if (!f) {
      return nothing(this.id, this.output,
        "this cohort is not defined by a protected attribute, so there is no protected-group " +
        "disparity to assess — p34's condition is about protected-group completeness, and a " +
        "region or an age band has none",
        {}, threshold);
    }

    if (f.completeness < minComplete) {
      return nothing(this.id, this.output,
        `the protected attribute is recorded for ${(f.completeness * 100).toFixed(0)}% of the group, ` +
        `below the ${(minComplete * 100).toFixed(0)}% policy threshold — a disparity computed here ` +
        "would be a statement about the recording",
        { completeness: f.completeness, group_size: f.groupSize }, threshold);
    }
    if (f.groupSize < minN) {
      return nothing(this.id, this.output,
        `the group has ${f.groupSize} people, below the minimum analysis size of ${minN}`,
        { group_size: f.groupSize }, threshold);
    }

    const fired = Math.abs(f.disparityPp) >= margin;
    return {
      ruleId: this.id,
      fired,
      withheld: null,
      // NO RANKING, NO GRADE, NO COLOUR. p43: the fairness screen must make it
      // easier to discover uneven access, not easier to stereotype a group.
      // The statement names the measure and the gap and says nothing about the
      // group beyond which cohort definition it is.
      statement: fired
        ? observed(
            `${f.measure} for this cohort is ${Math.abs(f.disparityPp).toFixed(1)} percentage points ` +
            `${f.disparityPp < 0 ? "below" : "above"} the eligible population (${f.groupSize} people, ` +
            `attribute recorded for ${(f.completeness * 100).toFixed(0)}%).`)
        : "",
      output: this.output,
      observed: {
        measure: f.measure,
        disparity_pp: Math.round(f.disparityPp * 10) / 10,
        group_size: f.groupSize,
        completeness: Math.round(f.completeness * 100) / 100,
      },
      threshold,
      metricRefs: [],
      limitations: [
        ...BASE_LIMITATIONS,
        "a disparity is a difference in what was observed, not evidence of its cause",
        "protected attributes are used here to audit access, and may not drive a person-level decision",
      ],
    };
  },
};

const SAFETY_REVIEW_LOAD: RuleDefinition = {
  id: "SAFETY_REVIEW_LOAD",
  label: "Safety review load",
  trigger: "Fixed review events exceed staffed review capacity",
  output: "Coverage and workflow review",
  noOutputWhen: "Event classification or coverage schedule missing",
  evaluate(ctx, t) {
    const ratio = t.get("safety_review_load.capacity_ratio");
    const threshold = { capacity_ratio: ratio };
    const r = ctx.reviewLoad;
    if (!r) return nothing(this.id, this.output, "no review-load reading was supplied", {}, threshold);

    if (!r.classificationComplete) {
      return nothing(this.id, this.output,
        "not every review event carries a classification, so the count is of something undefined",
        { fixed_review_events: r.fixedReviewEvents }, threshold);
    }
    if (!r.coverageScheduleKnown || r.staffedCapacity === null) {
      return nothing(this.id, this.output,
        "there is no staffed coverage schedule in this deployment, so review load has no capacity to exceed",
        { fixed_review_events: r.fixedReviewEvents, staffed_capacity: null }, threshold);
    }
    if (r.staffedCapacity === 0) {
      return nothing(this.id, this.output, "staffed capacity is zero, so the ratio is undefined",
        { fixed_review_events: r.fixedReviewEvents }, threshold);
    }

    const load = r.fixedReviewEvents / r.staffedCapacity;
    const fired = load >= ratio;
    return {
      ruleId: this.id,
      fired,
      withheld: null,
      statement: fired
        ? observed(
            `fixed review events are ${load.toFixed(2)} times the staffed review capacity ` +
            `(${r.fixedReviewEvents} events, capacity ${r.staffedCapacity}).`)
        : "",
      output: this.output,
      observed: {
        fixed_review_events: r.fixedReviewEvents,
        staffed_capacity: r.staffedCapacity,
        ratio: Math.round(load * 100) / 100,
      },
      threshold,
      metricRefs: [],
      limitations: [...BASE_LIMITATIONS, "workflow latency, not clinical quality"],
    };
  },
};

const DATA_QUALITY: RuleDefinition = {
  id: "DATA_QUALITY",
  label: "Data quality",
  trigger: "Missingness, drift or projection mismatch crosses the limit",
  output: "Block planning release",
  // p34 writes "Never bypassed" in this cell, and it is the only rule with
  // that property. `neverWithheld` makes the sentence checkable: the guard
  // evaluates this rule against every degenerate input it can construct and
  // asserts the withholding reason is always null.
  noOutputWhen: "Never bypassed",
  neverWithheld: true,
  evaluate(ctx, t) {
    const maxMiss = t.get("data_quality.max_missingness");
    const maxMismatch = t.get("data_quality.max_projection_mismatch");
    const maxDrift = t.get("data_quality.max_drift_pp");
    const threshold = {
      max_missingness: maxMiss, max_projection_mismatch: maxMismatch, max_drift_pp: maxDrift,
    };
    // NO WITHHOLDING PATH. Not "no path that is currently reachable" — no
    // branch at all. A missing reading is itself a data-quality failure, so it
    // fires rather than falling silent: an environment that cannot say whether
    // its projections rebuild is not an environment that may release planning
    // output.
    const q = ctx.dataQuality;
    if (!q) {
      const noReading: RuleOutcome = {
        ruleId: this.id, fired: true, withheld: null,
        statement: observed("no data-quality reading is available for this environment."),
        output: this.output,
        observed: { reading_available: false },
        threshold, metricRefs: [],
        limitations: ["fabricated data"],
      };
      return noReading;
    }

    const reasons: string[] = [];
    if (q.missingness > maxMiss) {
      reasons.push(`missingness is ${(q.missingness * 100).toFixed(1)}% against a limit of ${(maxMiss * 100).toFixed(0)}%`);
    }
    if (q.projectionMismatches > maxMismatch) {
      reasons.push(`${q.projectionMismatches} rows did not rebuild identically from their own events`);
    }
    if (Math.abs(q.driftPp) > maxDrift) {
      reasons.push(`the population drifted ${Math.abs(q.driftPp).toFixed(1)} percentage points between windows`);
    }
    if (q.checksFailed > 0) {
      reasons.push(`${q.checksFailed} of ${q.checksTotal} manifest checks failed`);
    }

    return {
      ruleId: this.id,
      fired: reasons.length > 0,
      withheld: null,
      statement: reasons.length > 0
        ? observed(`the environment does not meet its own data-quality limits — ${reasons.join("; ")}.`)
        : "",
      output: this.output,
      observed: {
        missingness: Math.round(q.missingness * 1000) / 1000,
        projection_mismatches: q.projectionMismatches,
        drift_pp: Math.round(q.driftPp * 10) / 10,
        checks_failed: q.checksFailed,
        checks_total: q.checksTotal,
      },
      threshold,
      metricRefs: [],
      limitations: ["fabricated data"],
    };
  },
};

export const RULES: RuleDefinition[] = [
  ACCESS_GAP, FOLLOWUP_GAP, MODULE_SIGNAL, REGION_CAPACITY,
  FAIRNESS_ALERT, SAFETY_REVIEW_LOAD, DATA_QUALITY,
];

export function rule(id: RuleId): RuleDefinition {
  const r = RULES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown planning rule "${id}"`);
  return r;
}

/**
 * Evaluate one rule, with the invariant enforced here rather than trusted.
 *
 * Every rule already returns withheld-then-fired in the right order, and this
 * still checks: the rules are the part most likely to be edited, and an
 * outcome that is both withheld and fired would be published as a signal
 * carrying its own reason for not existing.
 */
export function evaluateRule(id: RuleId, ctx: RuleContext, t: ThresholdSource): RuleOutcome {
  const def = rule(id);
  const out = def.evaluate(ctx, t);
  if (out.withheld !== null && out.fired) {
    throw new Error(
      `${id} returned an outcome that is both withheld and fired. p34's "no output when" column ` +
      "is a precondition, not a caveat printed beside the output.",
    );
  }
  if (def.neverWithheld && out.withheld !== null) {
    throw new Error(
      `${id} withheld output ("${out.withheld}"), and p34 marks it never bypassed. ` +
      "A data-quality rule that can be silenced is a data-quality rule that will be.",
    );
  }
  return out;
}

/**
 * Evaluate all seven, with p34's release block applied.
 *
 * DATA_QUALITY's output is "Block planning release", and that is a statement
 * about the other six rather than a row on a dashboard. When it fires, the
 * only outcome returned is its own: the environment does not meet its own
 * limits, so nothing computed from it may be released as a planning signal.
 * Returning the others alongside a warning would leave a reader to decide how
 * much to discount them, which is a decision nobody can make.
 */
export function evaluateAll(ctx: RuleContext, t: ThresholdSource): RuleOutcome[] {
  const quality = evaluateRule("DATA_QUALITY", ctx, t);
  if (quality.fired) return [quality];
  return RULES.filter((r) => r.id !== "DATA_QUALITY").map((r) => evaluateRule(r.id, ctx, t));
}
