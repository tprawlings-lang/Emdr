// The metric dictionary (handoff 07 §3.2, p32).
//
// Ten metrics, each with a definition, a version, and the fields a screen MUST
// show beside it. The required-display column is the half that usually gets
// lost, and it is the half that makes a number readable: "72%" is not a
// finding, "72% (3,470 of 4,820, 7-day window, 112 excluded)" is.
//
// WHY A REGISTRY AND NOT TEN FUNCTIONS. Until now every metric in this
// codebase was computed inside the projection that displayed it, which meant
// its definition existed only as the SQL that happened to implement it. Two
// screens could compute "engagement" differently and both be right about their
// own query. p33 forbids exactly that: "do not reuse one denominator across
// measures unless the definitions are identical" — a rule you cannot follow
// without somewhere to write the definitions down.
//
// VERSIONS ARE PART OF THE ANSWER. p48 puts `metric_version` in the response
// beside the value, because a number computed under a changed definition is a
// different number. Bumping a version here is how a chart says "this is not
// comparable with what you saw last month" instead of silently redrawing.

/** What kind of claim a value is. p36's release ladder fixes the permitted
 *  wording per level, and p48 requires observed, adjusted, pilot and modelled
 *  values to carry separate status fields and visual treatments. */
export type MetricStatus = "observed" | "adjusted" | "pilot" | "modeled";

/** The unit of analysis (p33). A rate over person-weeks and a rate over people
 *  are different numbers, and a chart that does not say which is not
 *  interpretable. */
export type Grain =
  | "person"
  | "person-week"
  | "module-instance"
  | "paired-measure-episode"
  | "enrollment-episode"
  | "safety-review-episode"
  | "cohort-window";

export interface MetricDefinition {
  id: string;
  /** Semantic. A change to the numerator, denominator or window is a MAJOR
   *  bump: the old and new values are not comparable. */
  version: string;
  label: string;
  /** p32's definition column, verbatim in meaning. */
  definition: string;
  numerator: string;
  denominator: string;
  grain: Grain;
  status: MetricStatus;
  /** p32's required-display column, as a list a screen can be checked
   *  against. `tests/metrics.test.ts` asserts each field is actually rendered. */
  requiredDisplay: string[];
  /** What this metric must never be read as. Present on every entry, because
   *  the misreading is usually the reason the metric is interesting. */
  notA: string;
}

export const METRICS: MetricDefinition[] = [
  {
    id: "activation.v1",
    version: "1.0.0",
    label: "Activation",
    definition: "Enrolled people with a first completed action within 7 days, over eligible enrolled people.",
    numerator: "Enrolled people whose first completed action falls within 7 days of enrolment",
    denominator: "Eligible enrolled people",
    grain: "person",
    status: "observed",
    requiredDisplay: ["numerator and denominator", "7-day window", "exclusions"],
    notA: "A measure of whether the programme works. It measures whether people could start.",
  },
  {
    id: "weekly_engagement.v1",
    version: "1.0.0",
    label: "Weekly engagement",
    definition: "People with at least one meaningful action in the week, over active eligible people.",
    numerator: "People with at least one meaningful action in the week",
    denominator: "Active eligible people",
    grain: "person-week",
    status: "observed",
    requiredDisplay: ["numerator and denominator", "what counts as a meaningful action", "missingness"],
    notA: "Adherence. p33: never remove non-users from the denominator of an engagement rate.",
  },
  {
    id: "module_completion.v1",
    version: "1.0.0",
    label: "Module completion",
    definition: "Completed module instances over started module instances.",
    numerator: "Module instances that reached completion",
    denominator: "Module instances that were started",
    grain: "module-instance",
    status: "observed",
    requiredDisplay: ["starts", "completions", "abandonment", "module version"],
    notA: "A measure of a module's effectiveness. It measures whether people finished it.",
  },
  {
    id: "followup_completion.v1",
    version: "1.0.0",
    label: "Follow-up completion",
    definition: "Completed follow-up measures over due follow-up measures.",
    numerator: "Follow-up measures completed",
    denominator: "Follow-up measures that came due",
    grain: "person",
    status: "observed",
    // Five states, not two. A measure that was declined and one that was never
    // due are different facts, and collapsing them into "missing" throws away
    // the only thing that distinguishes a coverage problem from a consent one.
    requiredDisplay: ["due", "complete", "partial", "declined", "unavailable"],
    notA: "A measure of engagement. A person can be fully engaged and have a measure go unsent.",
  },
  {
    id: "observed_change.v1",
    version: "1.0.0",
    label: "Observed change",
    definition: "Follow-up value minus baseline, among paired observations.",
    numerator: "Sum of within-person differences",
    denominator: "People with both a baseline and a follow-up on the same instrument",
    grain: "paired-measure-episode",
    status: "observed",
    requiredDisplay: ["paired n", "mean", "median", "interval", "instrument version"],
    notA: "A treatment effect. Nobody was randomised, and the people with two measures are not a random sample of the people with one.",
  },
  {
    id: "responder_rate.v1",
    version: "1.0.0",
    label: "Responder rate",
    definition: "Paired people meeting the configured change threshold, over paired people.",
    numerator: "Paired people whose change meets the threshold",
    denominator: "Paired people",
    grain: "paired-measure-episode",
    status: "observed",
    requiredDisplay: ["threshold", "numerator and denominator", "interval", "not a diagnosis"],
    notA: "A diagnosis or a clinical response. The threshold is a configuration fixture, not a validated cutoff.",
  },
  {
    id: "safety_pause_rate.v1",
    version: "1.0.0",
    label: "Safety pause rate",
    definition: "People with a fixed pause, over active people.",
    numerator: "People with a fixed safety pause in the window",
    denominator: "Active people",
    grain: "person",
    status: "observed",
    requiredDisplay: ["numerator and denominator", "rule version"],
    // p32 states this one on the metric itself, and it is the only entry in
    // the dictionary that does.
    notA: "A predicted risk score. It counts pauses that HAPPENED under a stated rule version.",
  },
  {
    id: "time_to_review.v1",
    version: "1.0.0",
    label: "Time to review",
    definition: "Elapsed time from a fixed review event to a documented response.",
    numerator: "Elapsed hours, summarised",
    denominator: "Review episodes with a documented response",
    grain: "safety-review-episode",
    status: "observed",
    requiredDisplay: ["median", "percentile", "coverage schedule"],
    notA: "A measure of clinical quality. It measures workflow latency against the schedule in force.",
  },
  {
    id: "retention.v1",
    version: "1.0.0",
    label: "Retention",
    definition: "People active at day 30, 60, 90 and 180, over eligible starters.",
    numerator: "People with an action on or after the day-N boundary",
    denominator: "Eligible starters whose window has run long enough to be observed",
    grain: "person",
    status: "observed",
    // Censoring is in the required display because without it the last
    // milestone always looks worst: people who have not been enrolled 180 days
    // cannot be retained at 180 and must not be counted as lost.
    requiredDisplay: ["cohort start", "censoring", "numerator and denominator"],
    notA: "A measure of satisfaction. Someone who finished the programme and left is retained by no definition and lost by this one.",
  },
  {
    id: "estimated_cost.v1",
    version: "1.0.0",
    label: "Estimated cost",
    definition: "A modelled amount derived from named assumptions.",
    numerator: "Modelled amount",
    denominator: "Named assumption set",
    grain: "cohort-window",
    // The only MODELLED entry. p32 requires observed and modelled values to be
    // shown separately, and the status field is what a chart reads to decide
    // which visual register to draw in.
    status: "modeled",
    requiredDisplay: ["assumption set", "observed and modelled shown separately"],
    notA: "An observed saving. Nothing here was counted; it was computed from assumptions that are stated and may be wrong.",
  },
];

export function metric(id: string): MetricDefinition {
  const m = METRICS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown metric "${id}" — every metric must be declared in the dictionary`);
  return m;
}
