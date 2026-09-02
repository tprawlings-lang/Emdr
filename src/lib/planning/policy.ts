import type Database from "better-sqlite3";
import { data } from "@/lib/data";

// Planning policy configuration (handoff 07 §3.4, p34; plan decision D5).
//
// p34 prints seven rules with numbers beside them and then prints the sentence
// that decides where those numbers may live:
//
//   THRESHOLDS SHOWN HERE ARE PRODUCT DEFAULTS FOR TESTING, NOT VALIDATED
//   CLINICAL CUTOFFS. STORE EVERY THRESHOLD IN POLICY CONFIGURATION, ATTACH
//   ITS OWNER AND APPROVAL DATE, AND PREVENT QUIET EDITS.
//
// So the numbers below are DEFAULTS — the values a fresh database is seeded
// with — and not the values the rules read. The rules read `policy_thresholds`,
// which carries the owner and the approval date and refuses to be edited in
// place. That distinction is the whole of D5: a threshold with no owner is a
// number somebody changed, and nobody can say who or when.

/** The rules p34 names. The union is closed: a rule that is not in this list
 *  cannot fire, because it has nowhere to read a threshold from. */
export type RuleId =
  | "ACCESS_GAP"
  | "FOLLOWUP_GAP"
  | "MODULE_SIGNAL"
  | "REGION_CAPACITY"
  | "FAIRNESS_ALERT"
  | "SAFETY_REVIEW_LOAD"
  | "DATA_QUALITY";

export const RULE_IDS: readonly RuleId[] = [
  "ACCESS_GAP", "FOLLOWUP_GAP", "MODULE_SIGNAL", "REGION_CAPACITY",
  "FAIRNESS_ALERT", "SAFETY_REVIEW_LOAD", "DATA_QUALITY",
] as const;

/** Bumped when a rule's TRIGGER changes, which makes an old signal and a new
 *  one incomparable. It travels on every signal (p49's `rule_version`). */
export const RULE_VERSION = "planning-rules.1.0.0";

/** The version stamped on the seeded threshold set. A changed value is a new
 *  version row; the old row stays readable so a signal raised under it can
 *  still be read against the number that was in force. */
export const THRESHOLD_VERSION = "planning-thresholds.1.0.0";

/**
 * Who signed the thresholds, and what their signature covers.
 *
 * p34 requires a named owner and an approval date before any rule may fire.
 * Recorded here, and written into every row of `policy_thresholds`.
 *
 * A NOTE ON THE SECOND SCOPE, because it is a real concentration of authority
 * and it should not be discovered later. p35 gives Clinical review its own
 * state, separate from whoever set the numbers, so that a person who chose a
 * threshold is not also the person who judges whether a signal crossing it may
 * affect programme content. In this environment one person holds both, by their
 * own decision, recorded on 2026-08-29. That is defensible for a demonstration
 * over fabricated data and it is not a model for a deployment with patients in
 * it — the separation p35 describes is the point of having two states.
 */
export const PLANNING_OWNER = {
  name: "Founder, MSc Mathematics",
  approvedAt: "2026-08-29",
  /** The states this signature is accepted for. */
  scope: ["thresholds", "clinical_review"] as const,
  note:
    "One person holds both the threshold ownership p34 requires and the clinical review " +
    "authority p35 separates from it. Signed for a fabricated demonstration environment; " +
    "a deployment with patients needs two people.",
};

export interface ThresholdDefault {
  key: string;
  ruleId: RuleId;
  value: number;
  unit: string;
  /** What the number is and is not. Carried into the table and rendered
   *  beside the value, so p34's caveat reaches the reader rather than
   *  staying in the handoff. */
  basis: string;
}

// p34's own values, as written. The user's instruction on 2026-08-29 was to
// use them as they stand rather than to substitute judgement, so 10 and 12 are
// the handoff's numbers and carry the handoff's caveat.
const TESTING_DEFAULT =
  "Product default for testing (handoff 07 p34). Not a validated clinical cutoff.";

export const THRESHOLD_DEFAULTS: ThresholdDefault[] = [
  {
    key: "access_gap.difference_pp", ruleId: "ACCESS_GAP", value: 10,
    unit: "percentage points", basis: TESTING_DEFAULT,
  },
  {
    key: "access_gap.repeat_windows", ruleId: "ACCESS_GAP", value: 2,
    unit: "windows",
    basis: "p34: the gap must hold for two windows. One window is a reading; two is a pattern.",
  },
  {
    key: "followup_gap.difference_pp", ruleId: "FOLLOWUP_GAP", value: 12,
    unit: "percentage points", basis: TESTING_DEFAULT,
  },
  {
    key: "module_signal.change_difference", ruleId: "MODULE_SIGNAL", value: 2,
    unit: "instrument points",
    basis: TESTING_DEFAULT + " p34 leaves the amount configurable and states no value.",
  },
  {
    key: "module_signal.repeat_windows", ruleId: "MODULE_SIGNAL", value: 2,
    unit: "windows", basis: "p34: the difference must repeat in two windows.",
  },
  {
    key: "region_capacity.demand_ratio", ruleId: "REGION_CAPACITY", value: 1.2,
    unit: "ratio of demand to open first-visit slots",
    basis: TESTING_DEFAULT + " p34 leaves the ratio configurable and states no value.",
  },
  {
    key: "region_capacity.slot_data_max_age_days", ruleId: "REGION_CAPACITY", value: 7,
    unit: "days",
    basis: "p34's staleness condition, made a number so it can be evaluated rather than judged.",
  },
  {
    key: "fairness_alert.disparity_pp", ruleId: "FAIRNESS_ALERT", value: 10,
    unit: "percentage points", basis: TESTING_DEFAULT,
  },
  {
    key: "fairness_alert.min_group_completeness", ruleId: "FAIRNESS_ALERT", value: 0.8,
    unit: "proportion of the group with the attribute recorded",
    basis:
      "p34: no output when protected-group completeness is below the policy threshold. " +
      "A disparity computed over a group that is 40% unrecorded is a statement about the " +
      "recording, not about the group.",
  },
  {
    key: "safety_review_load.capacity_ratio", ruleId: "SAFETY_REVIEW_LOAD", value: 1,
    unit: "ratio of fixed review events to staffed review capacity",
    basis: TESTING_DEFAULT + " p34 leaves the ratio configurable and states no value.",
  },
  {
    key: "data_quality.max_missingness", ruleId: "DATA_QUALITY", value: 0.3,
    unit: "proportion of due measures missing",
    basis: TESTING_DEFAULT,
  },
  {
    key: "data_quality.max_projection_mismatch", ruleId: "DATA_QUALITY", value: 0,
    unit: "rows differing on replay",
    basis:
      "Not a tuning default. A projection that does not rebuild from its own events is " +
      "a broken environment, and p29 records the expected value as zero.",
  },
  {
    key: "data_quality.max_drift_pp", ruleId: "DATA_QUALITY", value: 10,
    unit: "percentage points of drift between windows",
    basis: TESTING_DEFAULT,
  },
  {
    key: "analysis.min_denominator", ruleId: "ACCESS_GAP", value: 30,
    unit: "people",
    basis:
      "p37's internal minimum analysis size, not a p34 default. It is a different control " +
      "from p29's small-cell suppression (11) and has a different job: suppression decides " +
      "what may be shown outside, this decides what may be compared at all.",
  },
  {
    key: "analysis.max_missingness", ruleId: "ACCESS_GAP", value: 0.3,
    unit: "proportion of due measures missing",
    basis:
      "p34's \"missingness high\" condition, made a number. A gap between two groups whose " +
      "missingness differs is first a statement about who answered.",
  },
];

export interface ThresholdRecord {
  key: string;
  version: string;
  ruleId: RuleId;
  value: number;
  unit: string;
  owner: string;
  approvedAt: string;
  basis: string;
}

/**
 * A read-only accessor over the loaded thresholds.
 *
 * `get` THROWS on an unknown key rather than returning a default. That is what
 * makes the guard in `tests/planning.test.ts` possible: every rule is evaluated
 * against a recording accessor, the keys it actually read are collected, and
 * each one is checked against the policy table. A rule that reached for a
 * hard-coded number would read no key, and the number would have no owner —
 * which is the failure D5 exists to prevent, discovered by the absence of a
 * read rather than by reviewing a diff.
 */
export interface ThresholdSource {
  get(key: string): number;
  /** Every key this source can answer, for the coverage guard. */
  keys(): string[];
}

export function thresholdsFrom(map: Record<string, number>): ThresholdSource {
  return {
    get(key: string): number {
      if (!(key in map)) {
        throw new Error(
          `no policy threshold for "${key}". Every number a planning rule compares against ` +
          "must be a row in policy_thresholds with an owner and an approval date (p34).",
        );
      }
      return map[key];
    },
    keys: () => Object.keys(map),
  };
}

/** The defaults, as a source. For tests and for a rule evaluated before the
 *  table is seeded — never for a signal that is stored, which must record the
 *  thresholds that were actually in force. */
export function defaultThresholds(): ThresholdSource {
  return thresholdsFrom(Object.fromEntries(THRESHOLD_DEFAULTS.map((t) => [t.key, t.value])));
}

/**
 * Seed the policy table. Idempotent, and NOT an upsert.
 *
 * `ON CONFLICT DO NOTHING` is deliberate: if a row for this key and version
 * already exists it is left exactly as it is, because it may carry an owner
 * and an approval date that a redeploy has no business overwriting. Changing a
 * value means inserting a new VERSION, which is a decision somebody makes and
 * signs, not something a boot sequence does.
 */
export function seedPolicyThresholds(db: Database.Database): { inserted: number } {
  const ins = db.prepare(
    `INSERT INTO policy_thresholds (key, version, rule_id, value, unit, owner, approved_at, basis)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key, version) DO NOTHING`,
  );
  let inserted = 0;
  db.transaction(() => {
    for (const t of THRESHOLD_DEFAULTS) {
      const r = ins.run(
        t.key, THRESHOLD_VERSION, t.ruleId, t.value, t.unit,
        PLANNING_OWNER.name, PLANNING_OWNER.approvedAt, t.basis,
      );
      inserted += r.changes;
    }
  })();
  return { inserted };
}

/** Every threshold currently in force, newest approval first. */
export async function loadThresholdRecords(): Promise<ThresholdRecord[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT key, version, rule_id, value, unit, owner, approved_at, basis
       FROM policy_thresholds
      WHERE superseded_at IS NULL
      ORDER BY rule_id, key`, [],
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    key: String(r.key),
    version: String(r.version),
    ruleId: String(r.rule_id) as RuleId,
    value: Number(r.value),
    unit: String(r.unit),
    owner: String(r.owner),
    approvedAt: String(r.approved_at),
    basis: String(r.basis),
  }));
}

/**
 * The thresholds the rules read.
 *
 * REFUSES to answer if the table holds nothing, rather than falling back to
 * the defaults in this file. A fallback would make the owner record optional
 * in practice while appearing mandatory in the schema — the rules would fire
 * on unowned numbers and nothing would say so.
 */
export async function loadThresholds(): Promise<ThresholdSource> {
  const records = await loadThresholdRecords();
  if (records.length === 0) {
    throw new Error(
      "policy_thresholds is empty. No planning rule may fire until every threshold has an " +
      "owner and an approval date (p34).",
    );
  }
  return thresholdsFrom(Object.fromEntries(records.map((r) => [r.key, r.value])));
}
