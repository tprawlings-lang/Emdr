import { metric, type MetricDefinition, type MetricStatus } from "./dictionary";
import { cohortHash, type CohortDefinition } from "./cohorts";
import { SMALL_CELL } from "@/components/charts/aggregate";

// Metric computation (handoff 07 §3.2 p32, §3.3 p33, §5.3 p48).
//
// PURE, and over typed observations rather than over the database. That is the
// single decision this file turns on, and it is what makes p52's exit
// evidence — "metric fixtures match hand calculations" — possible at all: a
// function that takes rows and returns a number can be checked against
// arithmetic written out on paper. A function that runs SQL can only be
// checked against the same SQL, which is checking nothing.
//
// The database layer is separate (`population-metrics.ts`) and its only job is
// to turn rows into `Observation`s. If that layer is wrong the invariants over
// the real population catch it; if this layer is wrong the hand calculations
// do. Neither could catch both.

/**
 * One person, as every metric in the dictionary needs to see them.
 *
 * Flat and explicit rather than a graph of records, because the alternative —
 * passing the domain objects — would let a metric quietly reach for a field
 * its definition does not mention, and the definition is the thing under test.
 */
export interface Observation {
  personId: string;
  /** Attributes a cohort may filter on. */
  region: string | null;
  ageBand: string | null;
  language: string | null;
  race: string[];
  ethnicity: string | null;
  tenantId: string;
  accessNeeds: string[];
  /** Whether this person needs an interpreter. Authored independently of
   *  language (p11), so it is its own dimension and not a proxy for one. */
  interpreterNeeded: boolean;
  state: string | null;
  hasAccount: boolean;

  daysEnrolled: number;
  /** Whether the person entered the cohort inside the window being reported.
   *  Always true when no window is in play.
   *
   *  This is the field that keeps a COHORT-ENTRY metric honest. Activation
   *  asks whether someone acted within seven days of enrolling, so a window
   *  selects who entered during it — not whose activity fell inside it. A
   *  window applied the second way reports everybody who enrolled earlier as
   *  a failure to activate, which is the same censoring error retention has
   *  and is just as invisible in the output. */
  enrolledInWindow: boolean;
  /** Days from enrolment to the first completed action, or null if there was
   *  none. Null is NOT zero: one means they acted immediately. */
  daysToFirstAction: number | null;
  /** Weeks in the window with at least one meaningful action, and weeks
   *  observed. Both, because a rate over four weeks and one over twenty-six
   *  are different claims. */
  activeWeeks: number;
  observedWeeks: number;
  /** Days from enrolment to the most recent action. */
  daysToLastAction: number | null;

  modulesStarted: number;
  modulesCompleted: number;

  /** Follow-up measures, in p32's five states. Summing them is the denominator
   *  and each is separately reportable — the point of listing five rather than
   *  "complete" and "missing". */
  measuresComplete: number;
  measuresPartial: number;
  measuresDeclined: number;
  /** The system could not deliver it — p28's "unavailable" and "failed". */
  measuresUnavailable: number;
  /** The person did not do it — p28's "skipped". Kept apart from `declined`
   *  and from `unavailable` because the three are different facts: a refusal,
   *  an omission and an outage. Folding them together loses the only
   *  information that says which problem you have. */
  measuresSkipped: number;
  /** Started and cut short — p28's "interrupted". */
  measuresInterrupted: number;
  measuresNotDue: number;
  /** Measures that were never DELIVERED — the service's failure rather than
   *  the person's.
   *
   *  Overlaps `measuresUnavailable` and is not the same field. That one is
   *  p28's REASON taxonomy, which answers "what happened"; this is the CAUSE,
   *  which answers "whose failure was it". A measure recorded as unavailable
   *  because an interpreter could not be booked and one recorded as unavailable
   *  because a device failed are the same reason and different causes, and a
   *  fairness review needs the second. */
  measuresUndelivered: number;

  /** Paired baseline and follow-up on the same instrument, or null when the
   *  person is not paired. p32: observed change is over PAIRED observations. */
  baseline: number | null;
  followUp: number | null;

  hadFixedPause: boolean;
  /** Hours from a fixed review event to a documented response, per episode. */
  reviewLatencyHours: number[];
}

/** p48's response shape, field for field. */
export interface MetricResult {
  metric_id: string;
  cohort_id: string;
  cohort_hash: string;
  window: { start: string; end: string };
  grain: string;
  numerator: number;
  denominator: number;
  /** Null when the denominator is zero. NOT zero: "nobody qualified" and
   *  "nobody succeeded" are different answers and only one of them is a rate. */
  value: number | null;
  /** Every state that is not a plain success, kept separate (p33). */
  missing: Record<string, number>;
  suppressed: boolean;
  status: MetricStatus;
  data_version: string;
  metric_version: string;
  projection_version: string;
  refreshed_at: string;
  lineage_ref: string;
  /** Extra numbers a metric's required display needs — median, interval,
   *  threshold. Named per metric rather than crammed into `value`. */
  detail: Record<string, number | string | null>;
}

export interface ComputeContext {
  window: { start: string; end: string };
  dataVersion: string;
  projectionVersion: string;
  refreshedAt: string;
  lineageRef: string;
  /** The responder threshold. p32 requires it displayed; p57 records it as a
   *  configuration fixture with no clinical claim. */
  responderThreshold: number;
}

// ---------------------------------------------------------------------------
// Cohort application
// ---------------------------------------------------------------------------

/**
 * Eligibility FIRST, then group filters (p33).
 *
 * The order is the rule. Applying them together, or filtering by group first,
 * produces the same set — but writing it as two steps is what makes the third
 * mistake impossible: adding an activity condition to the group filter and
 * having it silently shrink the denominator too.
 */
export function eligible(rows: Observation[], c: CohortDefinition): Observation[] {
  const e = c.eligibility;
  return rows.filter((r) => {
    if (e.requiresAccount && !r.hasAccount) return false;
    if (e.minDaysEnrolled !== undefined && r.daysEnrolled < e.minDaysEnrolled) return false;
    return true;
  });
}

export function inGroup(rows: Observation[], c: CohortDefinition): Observation[] {
  const f = c.filters;
  const any = (list: string[] | undefined, v: string | null) =>
    list === undefined || (v !== null && list.includes(v));
  return rows.filter((r) =>
    any(f.region, r.region) &&
    any(f.ageBand, r.ageBand) &&
    any(f.language, r.language) &&
    any(f.ethnicity, r.ethnicity) &&
    any(f.tenantId, r.tenantId) &&
    any(f.state, r.state) &&
    (f.interpreterNeeded === undefined || f.interpreterNeeded === r.interpreterNeeded) &&
    (f.race === undefined || r.race.some((x) => f.race!.includes(x))) &&
    (f.accessNeed === undefined || r.accessNeeds.some((x) => f.accessNeed!.includes(x))),
  );
}

/** The cohort, resolved in the order p33 requires. */
export function resolve(rows: Observation[], c: CohortDefinition): Observation[] {
  return inGroup(eligible(rows, c), c);
}

// ---------------------------------------------------------------------------
// The metrics
// ---------------------------------------------------------------------------

function base(
  def: MetricDefinition, c: CohortDefinition, ctx: ComputeContext,
  numerator: number, denominator: number,
  missing: Record<string, number>, detail: Record<string, number | string | null>,
): MetricResult {
  return {
    metric_id: def.id,
    cohort_id: c.id,
    cohort_hash: cohortHash(c),
    window: ctx.window,
    grain: def.grain,
    numerator,
    denominator,
    // Null, not zero. "Nobody qualified" and "nobody succeeded" are different
    // answers and only the second is a rate — a chart drawing 0% for an empty
    // denominator reports a failure that did not happen.
    value: denominator === 0 ? null : numerator / denominator,
    // Suppression is NOT applied here. p29 scopes it to "aggregate external
    // views", and it is a disclosure control rather than an arithmetic one:
    // applying it inside the computation would mean every internal check —
    // including the hand calculations this file exists to be checkable by —
    // reads a withheld value instead of the answer. `suppressExternal` below
    // applies it at the boundary, where the result leaves.
    suppressed: false,
    missing,
    status: def.status,
    data_version: ctx.dataVersion,
    metric_version: def.version,
    projection_version: ctx.projectionVersion,
    refreshed_at: ctx.refreshedAt,
    lineage_ref: ctx.lineageRef,
    detail,
  };
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const percentile = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  // Nearest-rank. Stated because "the 90th percentile" is three different
  // numbers depending on the convention, and a metric whose convention is
  // undocumented cannot be reproduced.
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export function computeActivation(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): MetricResult {
  const def = metric("activation.v1");
  const pop = resolve(rows, c);
  // Excluded: people whose first seven days have not elapsed. They cannot have
  // activated within a window that has not finished, and counting them as
  // failures is the censoring error retention has too.
  // Two exclusions, and they are different. `enrolledInWindow` removes people
  // who entered before the window this result is labelled with — they belong
  // to an earlier cohort and were already counted there. `daysEnrolled >= 7`
  // removes people whose seven days have not elapsed, who cannot have
  // activated within a window that has not finished.
  const entered = pop.filter((r) => r.enrolledInWindow);
  const observable = entered.filter((r) => r.daysEnrolled >= 7);
  const n = observable.filter((r) => r.daysToFirstAction !== null && r.daysToFirstAction <= 7).length;
  return base(def, c, ctx, n, observable.length,
    {
      excluded_window_not_elapsed: entered.length - observable.length,
      excluded_entered_earlier: pop.length - entered.length,
    },
    { window_days: 7 });
}

export function computeWeeklyEngagement(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): MetricResult {
  const def = metric("weekly_engagement.v1");
  const pop = resolve(rows, c);
  // Person-WEEKS, and the denominator is every observed week for every
  // eligible person — including the weeks of people who did nothing. p33:
  // "never remove non-users from the denominator of an engagement rate."
  const active = pop.reduce((s, r) => s + r.activeWeeks, 0);
  const observed = pop.reduce((s, r) => s + r.observedWeeks, 0);
  return base(def, c, ctx, active, observed,
    { people_with_no_active_week: pop.filter((r) => r.activeWeeks === 0).length },
    { people: pop.length, action_definition: "a completed check-in, module or session" });
}

export function computeModuleCompletion(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): MetricResult {
  const def = metric("module_completion.v1");
  const pop = resolve(rows, c);
  const started = pop.reduce((s, r) => s + r.modulesStarted, 0);
  const completed = pop.reduce((s, r) => s + r.modulesCompleted, 0);
  return base(def, c, ctx, completed, started,
    { abandoned: started - completed },
    { starts: started, completions: completed });
}

export function computeFollowupCompletion(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): MetricResult {
  const def = metric("followup_completion.v1");
  const pop = resolve(rows, c);
  const sum = (f: (r: Observation) => number) => pop.reduce((s, r) => s + f(r), 0);
  const complete = sum((r) => r.measuresComplete);
  const partial = sum((r) => r.measuresPartial);
  const declined = sum((r) => r.measuresDeclined);
  const unavailable = sum((r) => r.measuresUnavailable);
  const skipped = sum((r) => r.measuresSkipped);
  const interrupted = sum((r) => r.measuresInterrupted);
  // DUE excludes "not due" — a measure that never came due is not a missed
  // one, and folding it into the denominator makes every completion rate look
  // worse the longer a cohort is enrolled.
  const due = complete + partial + declined + unavailable + skipped + interrupted;
  return base(def, c, ctx, complete, due,
    // All six of p28's reasons, separately. p32's required display names five
    // states; reporting six and letting the screen group them is honest, while
    // squeezing six into five means relabelling somebody's refusal as an
    // outage.
    { partial, declined, unavailable, skipped, interrupted, not_due: sum((r) => r.measuresNotDue) },
    { due });
}

export function computeObservedChange(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): MetricResult {
  const def = metric("observed_change.v1");
  const pop = resolve(rows, c);
  const paired = pop.filter((r) => r.baseline !== null && r.followUp !== null);
  const deltas = paired.map((r) => r.followUp! - r.baseline!);
  const mean = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
  return base(def, c, ctx, paired.length, pop.length,
    { unpaired: pop.length - paired.length },
    {
      paired_n: paired.length,
      mean_change: mean === null ? null : Math.round(mean * 100) / 100,
      median_change: median(deltas),
      // The interval is the observed spread, NOT a confidence interval — this
      // is a descriptive metric at the bottom rung of p36's ladder, and
      // labelling a range as a confidence interval would promote it a level.
      range_low: deltas.length ? Math.min(...deltas) : null,
      range_high: deltas.length ? Math.max(...deltas) : null,
      instrument_version: "phq-9 standard",
    });
}

export function computeResponderRate(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): MetricResult {
  const def = metric("responder_rate.v1");
  const paired = resolve(rows, c).filter((r) => r.baseline !== null && r.followUp !== null);
  // A DROP of at least the threshold. Written as baseline − followUp so the
  // direction is explicit: on this instrument a lower score is an improvement,
  // and a metric whose sign convention is implicit gets inverted eventually.
  const responders = paired.filter((r) => r.baseline! - r.followUp! >= ctx.responderThreshold);
  return base(def, c, ctx, responders.length, paired.length, {},
    { threshold: ctx.responderThreshold, threshold_basis: "configuration fixture; not a validated clinical cutoff" });
}

export function computeSafetyPauseRate(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): MetricResult {
  const def = metric("safety_pause_rate.v1");
  const pop = resolve(rows, c);
  const active = pop.filter((r) => r.activeWeeks > 0);
  return base(def, c, ctx, active.filter((r) => r.hadFixedPause).length, active.length,
    { inactive_excluded: pop.length - active.length },
    { rule_version: "beta-clinrev-2026-07" });
}

export function computeTimeToReview(rows: Observation[], c: CohortDefinition, ctx: ComputeContext): MetricResult {
  const def = metric("time_to_review.v1");
  const latencies = resolve(rows, c).flatMap((r) => r.reviewLatencyHours);
  // The numerator IS the episode count; the summary lives in `detail`. A
  // latency has no numerator over denominator, and forcing one would make the
  // response shape lie about what kind of metric this is.
  return base(def, c, ctx, latencies.length, latencies.length, {},
    {
      median_hours: median(latencies),
      p90_hours: percentile(latencies, 90),
      percentile_method: "nearest-rank",
      coverage_schedule: "business hours, weekdays",
    });
}

export function computeRetention(
  rows: Observation[], c: CohortDefinition, ctx: ComputeContext, day: 30 | 60 | 90 | 180,
): MetricResult {
  const def = metric("retention.v1");
  const pop = resolve(rows, c);
  // CENSORING. Someone enrolled sixty days ago cannot be retained at day 180,
  // and counting them as lost makes the last milestone always look worst — the
  // classic survival-analysis error, and the reason p32 puts censoring in the
  // required display.
  const observable = pop.filter((r) => r.daysEnrolled >= day);
  const retained = observable.filter((r) => r.daysToLastAction !== null && r.daysToLastAction >= day);
  const censored = pop.length - observable.length;
  return base(def, c, ctx, retained.length, observable.length,
    { censored_window_not_elapsed: censored },
    {
      day,
      cohort_start: ctx.window.start,
      // When most of the cohort is censored the rate describes a handful of
      // people at the edge of the window, and 0% reads as a finding rather
      // than as "not observable yet". The flag is what a chart reads to draw
      // it as pending instead of as a result — the demo window is 180 days,
      // so day-180 retention is structurally unobservable and would otherwise
      // report a flat zero.
      mostly_censored: censored > observable.length ? "true" : "false",
    });
}


// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

/**
 * Apply p29's small-cell rule to a result that is about to leave.
 *
 * SEPARATE from the computation, and the separation is the point. Suppression
 * is a disclosure control: it decides what may be shown to someone outside,
 * not what is true. Folding it into the arithmetic makes every internal
 * check — including a hand calculation — read a withheld value rather than
 * the answer, which is how a suppression bug hides behind the suppression.
 *
 * The DENOMINATOR survives. A withheld numerator over a visible denominator
 * says "this cell was suppressed"; withholding both says nothing, and a reader
 * cannot tell a suppressed cell from a missing one.
 *
 * p37's internal minimum analysis size (n ≥ 30 for a reported comparison) is a
 * different control with a different threshold, and it belongs to the fairness
 * layer rather than here.
 */
export function suppressExternal(r: MetricResult): MetricResult {
  const hide = r.numerator > 0 && r.numerator < SMALL_CELL;
  if (!hide) return r;
  return {
    ...r,
    numerator: -1,
    // The rate goes too: a value over a visible denominator reconstructs the
    // numerator exactly, so suppressing one and publishing the other
    // suppresses nothing.
    value: null,
    suppressed: true,
    missing: {
      ...r.missing,
      suppressed_below: SMALL_CELL,
    },
  };
}
