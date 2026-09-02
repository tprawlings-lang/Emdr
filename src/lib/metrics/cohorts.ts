import crypto from "crypto";

// The cohort registry (handoff 07 §3.3, p33).
//
// p33's five rules, and what each one is defending against:
//
//   EXECUTABLE JSON WITH AN IMMUTABLE VERSION. A cohort described in prose is
//   a cohort nobody can reproduce. A cohort described in SQL inside a screen
//   is a cohort that changes when the screen does. This is data, it is
//   hashed, and a dashboard can link to the exact definition behind a number.
//
//   ELIGIBILITY BEFORE GROUP FILTERS. "Never remove non-users from the
//   denominator of an engagement rate." This is the single most common way an
//   analytics layer flatters itself: filter to people who used the thing, then
//   report what fraction of them used the thing. The two stages are separate
//   FIELDS here, and `assertNoActivityInEligibility` refuses an activity
//   predicate in the first one — so the mistake is not available rather than
//   discouraged.
//
//   PARTIAL, MISSING AND CENSORED STAY SEPARATE. Three different facts. A
//   person who declined, a person whose measure was never sent, and a person
//   whose window has not elapsed are not interchangeable, and summing them
//   into "missing" destroys the only information that says which problem you
//   have.
//
//   NO SHARED DENOMINATORS UNLESS THE DEFINITIONS ARE IDENTICAL. Enforced by
//   the cohort id travelling in every result: two metrics reporting over
//   different cohorts cannot be compared by accident, because their ids differ
//   in the response.

/** Attributes a cohort may filter on. Deliberately a closed list: an open
 *  filter language would let a screen construct a group nobody declared, and
 *  p33's point is that the definition is the artefact. */
export interface CohortFilters {
  region?: string[];
  ageBand?: string[];
  language?: string[];
  race?: string[];
  ethnicity?: string[];
  tenantId?: string[];
  /** An access need, from p13's functional-access field. */
  accessNeed?: string[];
  /** Whether the person needs an interpreter. A FUNCTIONAL need, authored
   *  independently of language (p11) — which is the point of having it here as
   *  its own dimension. A cohort that can only be defined by language cannot
   *  ask whether a language gap is really an interpreter-capacity gap, and
   *  that is the question worth asking. */
  interpreterNeeded?: boolean;
  /** State of residence. A reporting dimension like region, at finer grain, so
   *  a cohort can be defined by something that cuts ACROSS regions — an effect
   *  confined to one region and an effect that merely concentrates there look
   *  identical until somebody can group the other way. */
  state?: string[];
}

/**
 * Who is eligible to be counted at all — BEFORE any group filter.
 *
 * Every field here is a fact about enrolment or coverage. None of them is a
 * fact about activity, and that is the whole point: eligibility answers "who
 * should appear in the denominator", not "who did something".
 */
export interface CohortEligibility {
  /** Enrolled on or after this date. */
  enrolledFrom?: string;
  /** Enrolled on or before this date. */
  enrolledTo?: string;
  /** Minimum days since enrolment, so a milestone that has not been reached
   *  yet censors rather than counting as a failure. */
  minDaysEnrolled?: number;
  /** Only people who have an account. */
  requiresAccount?: boolean;
}

export interface CohortDefinition {
  id: string;
  /** Immutable. A change is a NEW cohort with a new version, never an edit —
   *  p33 and p15's breaking-change rule agree on this, and a report reproduced
   *  under a silently changed cohort is the reason. */
  version: string;
  label: string;
  /** Why this group is being compared. p43's fairness screen requires the
   *  reason for comparing groups to be stated, and a cohort with no stated
   *  question is a fishing expedition with a version number. */
  question: string;
  eligibility: CohortEligibility;
  filters: CohortFilters;
}

/**
 * Refuse a cohort whose eligibility rule is really an activity filter.
 *
 * The failure this prevents is not hypothetical and not rare: filter the
 * population to people who engaged, then report engagement, and the number is
 * near 100% and completely meaningless. p33 names it directly.
 *
 * Structural rather than advisory — `CohortEligibility` has no field that
 * could express an activity predicate, and this checks the JSON for one
 * anyway, because the type is erased at runtime and a cohort may arrive from
 * the registry as data.
 */
export function assertNoActivityInEligibility(c: CohortDefinition): CohortDefinition {
  const banned = /(check_?in|checkins|session|module|measure|screening|active|engaged|completed|action)/i;
  for (const key of Object.keys(c.eligibility)) {
    if (banned.test(key)) {
      throw new Error(
        `cohort "${c.id}" resolves eligibility on "${key}", which is an activity. ` +
        "Eligibility answers who belongs in the denominator; filtering it by what people did " +
        "reports the thing being measured as its own denominator.",
      );
    }
  }
  return c;
}

/**
 * A stable fingerprint of the definition. Two cohorts that differ in any way
 * hash differently, so "is this the same cohort as last quarter" is a
 * comparison rather than a memory.
 *
 * Canonicalised RECURSIVELY. The first version passed `Object.keys(c).sort()`
 * as `JSON.stringify`'s replacer, which looks like key-order normalisation and
 * is not: the replacer array is an allow-list applied at every depth, so keys
 * that exist only inside `filters` were dropped entirely — and changing a
 * cohort's age band left its hash identical. A fingerprint that ignores the
 * part of the definition most likely to change is worse than none, because it
 * is trusted.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
}

export function cohortHash(c: CohortDefinition): string {
  return crypto.createHash("sha256").update(canonical(c)).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** The whole demo population, with no group filter. The comparison every
 *  subgroup is read against — p33's "primary comparison: eligible
 *  population". */
export const ALL_ELIGIBLE: CohortDefinition = {
  id: "all_eligible.v1",
  version: "1.0.0",
  label: "All eligible",
  question: "Who is using Steady, across the whole enrolled population?",
  eligibility: { requiresAccount: true },
  filters: {},
};

export const COHORTS: CohortDefinition[] = [
  ALL_ELIGIBLE,
  {
    id: "south_age_55_64.v1",
    version: "1.0.0",
    label: "South, 55–64",
    // p48's worked example names this cohort. The question is p31's worked
    // signal: "adults 55-64 in the South completed follow-up measures less
    // often than the overall cohort; investigate access and reminder timing."
    question: "Do people aged 55–64 in the South complete follow-up measures less often than the whole cohort?",
    eligibility: { requiresAccount: true },
    filters: { region: ["South"], ageBand: ["55-64"] },
  },
  {
    id: "spanish_preferred.v1",
    version: "1.0.0",
    label: "Spanish preferred",
    question: "Does access differ for people whose preferred language is Spanish?",
    eligibility: { requiresAccount: true },
    filters: { language: ["Spanish"] },
  },
  {
    id: "mandarin_preferred.v1",
    version: "1.0.0",
    label: "Mandarin preferred",
    question: "Does access differ for people whose preferred language is Mandarin?",
    eligibility: { requiresAccount: true },
    filters: { language: ["Mandarin"] },
  },
  {
    id: "retention_observable_180.v1",
    version: "1.0.0",
    label: "Enrolled at least 180 days",
    // The censoring rule, as a cohort. Retention at 180 days over people who
    // enrolled last week is not a low retention rate — it is a category error,
    // and this is where it is prevented rather than explained in a footnote.
    question: "Of the people whose window has actually run 180 days, how many are still active?",
    eligibility: { requiresAccount: true, minDaysEnrolled: 180 },
    filters: {},
  },
];

/**
 * Cohorts that exist to make a confound checkable.
 *
 * p36's whole argument is that a difference between two groups may be there
 * for a reason that is not the difference between the groups. Checking that
 * requires being able to define the group the OTHER way — by the operational
 * need rather than by the identity, by the state rather than by the region —
 * and a registry that only holds identity cohorts can produce the finding and
 * never the explanation.
 *
 * Each carries the question it exists to answer, as p33 requires. None of them
 * is a group to report on; they are the second half of a comparison.
 */
const CONFOUND_COHORTS: CohortDefinition[] = [
  {
    id: "interpreter_needed.v1",
    version: "1.0.0",
    label: "Needs an interpreter",
    question:
      "Is a language-cohort difference in follow-up completion carried by the people who need " +
      "an interpreter, rather than by the language?",
    eligibility: { requiresAccount: true },
    filters: { interpreterNeeded: true },
  },
  {
    id: "interpreter_not_needed.v1",
    version: "1.0.0",
    label: "Does not need an interpreter",
    question: "What does the same comparison look like with interpreter need held out?",
    eligibility: { requiresAccount: true },
    filters: { interpreterNeeded: false },
  },
  {
    id: "age_18_24.v1",
    version: "1.0.0",
    label: "18–24",
    question: "Do the youngest members start faster and sustain less?",
    eligibility: { requiresAccount: true },
    filters: { ageBand: ["18-24"] },
  },
  {
    id: "age_65_plus.v1",
    version: "1.0.0",
    label: "65 and over",
    // The reversal, as a question. Whichever metric is chosen, a different
    // group looks worse — which is why p32 puts the required display on every
    // metric and why a console must never say "doing worse" unqualified.
    question:
      "Do the oldest members take longer to start and then complete follow-up more reliably — " +
      "so that which group is 'doing worse' depends entirely on the metric?",
    eligibility: { requiresAccount: true },
    filters: { ageBand: ["65+"] },
  },
  {
    id: "rural_states.v1",
    version: "1.0.0",
    label: "Predominantly rural states",
    // Deliberately cuts across all four regions. A regional difference that is
    // really a rural one is indistinguishable from a regional one until the
    // population can be grouped this way.
    question:
      "Is a regional difference in time-to-first-visit really a difference in how far people " +
      "live from one?",
    eligibility: { requiresAccount: true },
    filters: { state: ["ME", "MO", "WI", "TN", "NC", "NV", "OR"] },
  },
  {
    id: "functional_access_need.v1",
    version: "1.0.0",
    label: "Has a functional access need",
    question:
      "Do members who need a screen reader or captions reach the same points in the programme?",
    eligibility: { requiresAccount: true },
    filters: { accessNeed: ["screen-reader", "captions"] },
  },
];

COHORTS.push(...CONFOUND_COHORTS);

export function cohort(id: string): CohortDefinition {
  const c = COHORTS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown cohort "${id}" — every cohort must be declared in the registry`);
  return assertNoActivityInEligibility(c);
}

/** Every region cohort, generated from one template so they cannot drift apart
 *  and be compared as if they had not. */
export function regionCohorts(): CohortDefinition[] {
  return ["Northeast", "Midwest", "South", "West"].map((region) =>
    assertNoActivityInEligibility({
      id: `region_${region.toLowerCase()}.v1`,
      version: "1.0.0",
      label: region,
      question: `How does ${region} compare with the eligible population?`,
      eligibility: { requiresAccount: true },
      filters: { region: [region] },
    }),
  );
}
