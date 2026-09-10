// The fairness audit (handoff 07 §4.4 p43, §3.7 p37; Wave 7 governance).
//
// §4.4 is nine panels, and then one sentence that governs all of them:
//
//   "The screen must make it easier to DISCOVER UNEVEN ACCESS OR HARM, not
//    easier to STEREOTYPE A GROUP. Do not rank races, assign grades to
//    demographic groups or use red and green labels on protected identities."
//
// That sentence is the hard part of this module, and it is why the audit is
// assembled here rather than in the page. Every convention that makes a
// dashboard readable — sort the worst to the top, colour the bad number red,
// give each row a letter — is, applied to protected groups, exactly the thing
// the sentence forbids. A screen built by reflex is a screen that breaks it, so
// the rules are values a test can hold rather than instructions a reader is
// asked to remember.
//
// WHAT THIS MODULE DOES NOT DO: statistics. The comparisons come from
// src/lib/metrics, the thresholds from src/lib/planning/policy.ts, and the
// suppression from the same `suppressExternal` every other external surface
// uses. A second implementation of any of those would be a second opinion about
// what a rate is.
//
// NO IMPORTS OF DATA READERS. It composes over results that were computed
// elsewhere and handed in, so the audit cannot quietly widen its own cohort.

/** §4.4's nine panels, in the order the page renders them. The order is the
 *  argument: representation before performance, because a performance gap over
 *  an unrepresentative sample is a statement about the sample. */
export const AUDIT_PANELS = [
  "question",
  "representation",
  "performance",
  "missingness",
  "errors",
  "intersection",
  "small_cells",
  "decision",
  "review_trail",
] as const;
export type AuditPanel = (typeof AUDIT_PANELS)[number];

/** §4.4's decision column. Six states, and none of them is "pass". */
export const AUDIT_DECISIONS = [
  "no_issue",
  "monitor",
  "investigate",
  "mitigate",
  "block",
  "retire",
] as const;
export type AuditDecision = (typeof AUDIT_DECISIONS)[number];

export const DECISION_LABEL: Record<AuditDecision, string> = {
  no_issue: "No issue",
  monitor: "Monitor",
  investigate: "Investigate",
  mitigate: "Mitigate",
  block: "Block",
  retire: "Retire",
};

/**
 * What each decision means for the thing being audited.
 *
 * Written as consequences rather than severities on purpose. A severity ladder
 * invites a reader to treat the group with the worst number as the worst group,
 * which is the stereotyping the section forbids; a consequence says what
 * happens next to the OUTPUT, which is the subject of the audit.
 */
export const DECISION_MEANING: Record<AuditDecision, string> = {
  no_issue: "Nothing found that this audit can act on. The comparison stays scheduled.",
  monitor: "Kept under observation at the stated interval. No change to what the output does.",
  investigate: "A named person is looking into the cause. The output continues while they do.",
  mitigate: "A change is required before this output is relied on further.",
  block: "The output does not leave this screen until the block is lifted.",
  retire: "The output is withdrawn. It is not shown, exported, or used again under this version.",
};

/** The two decisions that stop an output reaching anybody. §7's exit evidence
 *  for this wave is exactly this: "reviewers can block or retire output." */
export const STOPPING_DECISIONS: ReadonlyArray<AuditDecision> = ["block", "retire"];

export function stopsOutput(d: AuditDecision): boolean {
  return STOPPING_DECISIONS.includes(d);
}

// ---------------------------------------------------------------------------
// §4.4's presentation prohibitions, as rules
// ---------------------------------------------------------------------------

/**
 * Attributes that may never be ranked, graded, or colour-coded.
 *
 * §2's demographics table permits these for "representation and disparity
 * audit" and forbids them "to restrict or select person-level care". This list
 * is the second half of that: the attributes whose VALUES are people rather
 * than categories of work, so a presentation that orders them is ordering
 * people.
 */
export const PROTECTED_ATTRIBUTES = [
  "race",
  "ethnicity",
  "language",
  "sex",
  "gender",
  "age_band",
  "disability",
  "payer",
] as const;
export type ProtectedAttribute = (typeof PROTECTED_ATTRIBUTES)[number];

export function isProtected(attribute: string): boolean {
  return (PROTECTED_ATTRIBUTES as ReadonlyArray<string>).includes(attribute);
}

/**
 * A group's row, before presentation.
 *
 * `order` is deliberately absent. There is no field on this type that a page
 * could sort by to produce a ranking, because the type is the last place a
 * ranking can be prevented cheaply.
 */
export interface GroupReading {
  /** The attribute VALUE, as recorded. Never inferred, never collapsed. */
  group: string;
  /** Numerator and denominator, always both — a rate with no denominator is a
   *  claim with no size. */
  numerator: number;
  denominator: number;
  /** Null when the denominator is zero or the cell is suppressed. Not zero. */
  value: number | null;
  /** §4.4's "point estimate, interval". Null when not estimable. */
  interval: { low: number; high: number } | null;
  suppressed: boolean;
  /** §3.7: unknown, declined and missing shown SEPARATELY, never redistributed. */
  missing: Record<string, number>;
}

/**
 * The stable presentation order for a protected attribute.
 *
 * DECLARED ORDER, NEVER COMPUTED ORDER. The whole prohibition rests on this
 * one function: if the rows arrive in a fixed order that has nothing to do with
 * the numbers, no reader can mistake position for rank, and no later edit can
 * introduce a ranking by changing a comparator — there is no comparator.
 *
 * Alphabetical by the recorded value, with the three non-answers last and in a
 * fixed order among themselves. Alphabetical is not neutral in any deep sense,
 * but it is INDEPENDENT OF THE MEASUREMENT, which is the property required.
 */
const NON_ANSWERS = ["unknown", "declined", "missing"];

export function presentationOrder(rows: ReadonlyArray<GroupReading>): GroupReading[] {
  const rank = (g: string) => {
    const i = NON_ANSWERS.indexOf(g.toLowerCase());
    return i === -1 ? 0 : 1 + i;
  };
  return [...rows].sort((a, b) => {
    const ra = rank(a.group);
    const rb = rank(b.group);
    if (ra !== rb) return ra - rb;
    if (ra > 0) return 0;
    return a.group.localeCompare(b.group);
  });
}

/** Whether a proposed row order is a ranking by the measurement. */
export function ordersByMeasurement(rows: ReadonlyArray<GroupReading>): boolean {
  const values = rows.map((r) => r.value).filter((v): v is number => v !== null);
  if (values.length < 2) return false;
  const ascending = values.every((v, i) => i === 0 || v >= values[i - 1]);
  const descending = values.every((v, i) => i === 0 || v <= values[i - 1]);
  return ascending || descending;
}

/**
 * Tones a group row may carry. There is one.
 *
 * §4.4 forbids "red and green labels on protected identities", and the honest
 * reading is not "use amber instead" — it is that a group is not a status. The
 * STATE of the audit (its decision) carries colour; the groups do not.
 */
export const GROUP_TONE = "neutral" as const;

export function toneFor(_row: GroupReading): typeof GROUP_TONE {
  return GROUP_TONE;
}

/** §4.4: "Do not assign grades to demographic groups." */
export const GRADE_TOKENS = ["grade", "score", "rating", "tier", "rank", "best", "worst", "top", "bottom"];

export function readsAsGrade(text: string): boolean {
  const t = text.toLowerCase();
  return GRADE_TOKENS.some((g) => new RegExp(`\\b${g}\\b`).test(t));
}

// ---------------------------------------------------------------------------
// §3.7's controls, as answers the screen must carry
// ---------------------------------------------------------------------------

/**
 * Why a comparison was not made. §3.7 lists the controls; these are the reasons
 * they produce, and each is a distinct sentence because "not shown" covering
 * four different causes is how a suppressed cell and a broken query become
 * indistinguishable.
 */
export const WITHHELD_REASONS = [
  "small_cell",
  "below_minimum_analysis_size",
  "completeness_below_threshold",
  "not_estimable",
] as const;
export type WithheldReason = (typeof WITHHELD_REASONS)[number];

export const WITHHELD_EXPLANATION: Record<WithheldReason, string> = {
  small_cell:
    "Suppressed: the cell is small enough that a value could identify someone, and so are the cells that would let you work it back out.",
  below_minimum_analysis_size:
    "Not compared: fewer people than the minimum analysis size this policy requires for a statement about how a group is treated.",
  completeness_below_threshold:
    "Not compared: the attribute is recorded for too few of this group. A disparity computed here would be a statement about the recording, not about the people.",
  not_estimable:
    "No rate: the denominator is zero. Nobody qualified, which is not the same as nobody succeeding.",
};

/**
 * §3.7's multiple-testing control: "Control false discovery or LABEL THE VIEW
 * EXPLORATORY."
 *
 * This build does neither silently. It takes the second option and says so,
 * because the first would be a statistical claim this engine is not making —
 * the planning layer is descriptive and deterministic, and a false-discovery
 * correction implies an inferential frame it does not have.
 */
export const EXPLORATORY_LABEL =
  "Exploratory. Several groups are compared at once and no false-discovery correction is applied, so a single difference here is a reason to look, not a finding.";

export interface Comparison {
  /** §4.4's first panel: "exact metric and reason for comparing groups". */
  question: string;
  metricId: string;
  attribute: string;
  cohortId: string;
  cohortVersion: string;
  window: { start: string; end: string };
  rows: ReadonlyArray<GroupReading>;
  /** Cells the controls withheld, with which control did it. */
  withheld: ReadonlyArray<{ group: string; reason: WithheldReason }>;
  /** §4.4's intersection panel. Empty is a real answer — "sample did not
   *  permit" is different from "we did not look". */
  intersections: ReadonlyArray<{ factors: [string, string]; permitted: boolean; note: string }>;
}

/**
 * A comparison is only publishable if it says what it did not show.
 *
 * The failure this prevents: a screen that renders four groups and silently
 * drops the fifth because it was small. The reader sees four groups and
 * believes that is the population.
 */
export function accountsForEveryGroup(
  c: Comparison,
  expectedGroups: ReadonlyArray<string>
): { complete: boolean; unaccounted: string[] } {
  const shown = new Set(c.rows.map((r) => r.group));
  const withheld = new Set(c.withheld.map((w) => w.group));
  const unaccounted = expectedGroups.filter((g) => !shown.has(g) && !withheld.has(g));
  return { complete: unaccounted.length === 0, unaccounted };
}

/** §4.4's review trail. A decision with no reviewer is an opinion with a
 *  timestamp. */
export interface ReviewTrail {
  owner: string;
  clinicalReviewer: string | null;
  fairnessReviewer: string | null;
  comments: string;
  decidedAt: string | null;
}

export function trailComplete(t: ReviewTrail, decision: AuditDecision): boolean {
  if (!t.owner.trim()) return false;
  // A stopping decision is the one this wave exists to make possible, and it is
  // also the one somebody will want to record quickly. It still needs the
  // fairness reviewer who made it and the date they did.
  if (stopsOutput(decision)) {
    return Boolean(t.fairnessReviewer?.trim()) && Boolean(t.decidedAt?.trim());
  }
  return true;
}

/**
 * p36's prohibition, held where it can be checked.
 *
 * "Race correction factors are prohibited." The planning ladder already records
 * the sentence; this is the operational half — a fairness audit is the one
 * place in the product where protected attributes and numeric adjustment sit on
 * the same screen, so it is the place the prohibition is worth enforcing rather
 * than restating.
 */
export const RACE_CORRECTION_PROHIBITED = true;

export const CORRECTION_TOKENS = ["adjust", "correct", "normalise", "normalize", "calibrate", "offset"];

/** Whether a described transformation applies an adjustment to a protected
 *  attribute. Any true here is a defect, not a warning. */
export function appliesCorrection(transform: { attribute: string; operation: string }): boolean {
  if (!isProtected(transform.attribute)) return false;
  const op = transform.operation.toLowerCase();
  return CORRECTION_TOKENS.some((t) => op.includes(t));
}
