// The member projection boundary (handoff 09 §3, §1.3; Package 1).
//
// §3's engineering requirement is the strongest sentence in the document:
//
//   "The member projection must not return score fields — not hidden, not
//    null, not filtered client-side. If a score never crosses the boundary,
//    leakage becomes impossible rather than merely prohibited, and the property
//    is testable in CI rather than by review."
//
// And its follow-through: "Add a contract test that fails the build if a new
// field is added to the member projection without an explicit allow-list
// entry."
//
// SO THIS IS AN ALLOW-LIST, NOT A DENY-LIST, and the difference is the whole
// value. A deny-list catches the field names somebody thought of;
// `phq9_total`, `severity_band` and `recommended_track` are all on the existing
// deny-list in tests/member-boundary.test.ts and it works. What it cannot catch
// is `t` — a field somebody adds next quarter carrying a total because the
// short name felt tidy. An allow-list catches that one, because the question
// stops being "is this forbidden" and becomes "was this decided".
//
// AT ANY DEPTH. §3: "including nested inside another object." The walk below is
// recursive, and the guard checks it against a nested fixture — a boundary that
// only inspects top-level keys is a boundary somebody routes around by
// wrapping.
//
// WHY THIS IS SEPARATE FROM tests/member-boundary.test.ts RATHER THAN REPLACING
// IT. That test scans member ROUTE SOURCE for identifiers, which catches a leak
// in the commit that introduces it and needs no runtime. This checks VALUES, at
// the boundary, which catches a leak that arrives through a field the scanner
// has no reason to suspect. §3 asks for both and they fail differently.
//
// Client-safe: types and pure functions only.

// ---------------------------------------------------------------------------
// The allow-list
// ---------------------------------------------------------------------------

/**
 * Every field name a member projection may carry.
 *
 * ADDING A NAME HERE IS A DECISION, and that is the mechanism: the guard fails
 * the build when a projection carries a field this list does not name, so the
 * only way to ship a new member field is to write it down. §3 asks for exactly
 * that, and the cost — one line per field — is what buys the property.
 *
 * Grouped by what the field is for, so the reviewer reading this can see the
 * shape of what a member is told rather than an alphabetical list.
 */
export const MEMBER_ALLOWED_FIELDS: readonly string[] = [
  // ---- The day (§4.1, §4.2) ----
  // The day SHAPE is a state name from a closed set, never a level, a tier or
  // a number. §4.2's seven states.
  "dayState",
  "dayStateLabel",
  "orientingSentence",
  // §11's paused-state answer. A closed-set kind, a governed sentence, and a
  // timestamp — no reason, no criterion, no threshold. `at` is a time the
  // PRODUCT reopens something, not a fact about the person.
  "reopens",
  "sentence",
  "at",

  // ---- The one recommended activity (§4.1) ----
  // §4.1: "what it is, an approximate duration, and a clear pause promise."
  // `approximateMinutes` is a duration, which is the one number on this list
  // that describes the ACTIVITY rather than the person — and the distinction
  // is why it is allowed: nothing about "6 min" is a judgement of anybody.
  "recommended",
  "activityId",
  "title",
  "description",
  "approximateMinutes",
  "pausePromise",
  "startHref",

  // ---- Tools and support (§4.1) ----
  "tools",
  "label",
  "href",
  "supportHref",
  "groundHref",
  "crisisHref",

  // ---- Recent activity, shown quietly (§4.1) ----
  // §4.1: "No streaks, no missed-day penalties, no progress percentages, no
  // withheld-card counts." So: what happened and when, and nothing that counts
  // it into a run.
  "recent",
  "kind",
  "occurredAt",

  // ---- Honest state (§4.4, §8.4) ----
  "state",
  "reason",
  "retryHref",

  // ---- Where somebody is in an activity (§4.3, §4.4; added in Package 3) ----
  // Three names, added deliberately, because Package 3's resume marker is
  // checked against THIS list rather than a second one of its own — so
  // widening what a member may be shown and widening what may be cached on
  // their phone are the same edit, reviewed in the same diff.
  //
  // `step` is a position in a sequence the member is walking, not a level they
  // reached: "step 3 of 6" is the same kind of statement as "page 3 of 6".
  // `startedAt` is a clock reading. `reconcileBy` is an idempotency key, which
  // says nothing about anybody — it exists so a retry cannot write twice.
  "step",
  "startedAt",
  "reconcileBy",

  // ---- Identity and plumbing ----
  "displayName",
  "schemaVersion",
  "generatedAt",
];

/**
 * Field names that must never appear, at any depth, whatever the allow-list
 * says.
 *
 * REDUNDANT ON PURPOSE. Everything here is already excluded by not being on the
 * allow-list; naming them separately means the failure message says WHY rather
 * than only "unexpected field", and means a reviewer grepping for
 * `readinessScore` finds the refusal rather than an absence.
 */
export const MEMBER_FORBIDDEN_FIELDS: ReadonlyArray<{ name: string; what: string }> = [
  { name: "score", what: "any score" },
  { name: "totalScore", what: "an instrument total" },
  { name: "total_score", what: "an instrument total" },
  { name: "band", what: "a diagnostic band" },
  { name: "severity", what: "a severity label" },
  { name: "readinessScore", what: "the readiness score" },
  { name: "calculated_readiness_score", what: "the readiness score" },
  { name: "recommendedTrack", what: "the hidden track name" },
  { name: "recommended_track", what: "the hidden track name" },
  { name: "ruleId", what: "a rule identifier" },
  { name: "threshold", what: "a diagnostic threshold" },
  { name: "withheldCount", what: "a count of what was withheld" },
  { name: "recoveryScore", what: "a composite recovery figure" },
  { name: "streak", what: "a streak, which §2.2 Finding 3 rules out" },
  { name: "percentComplete", what: "a progress percentage" },
];

export class MemberBoundaryError extends Error {}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

export interface BoundaryViolation {
  /** Where it was found, as a path — so a nested leak is locatable. */
  at: string;
  field: string;
  /** Which rule it broke. */
  rule: "not_allowed" | "forbidden";
  detail: string;
}

const ALLOWED = new Set(MEMBER_ALLOWED_FIELDS);
const FORBIDDEN = new Map(MEMBER_FORBIDDEN_FIELDS.map((f) => [f.name, f.what]));

/**
 * Every field in a value that has not been decided, at any depth.
 *
 * ARRAY INDICES ARE NOT FIELDS. A list of tools is `tools[0].label`, and the
 * `0` is a position rather than a name — checking it would produce a violation
 * for every array in the product. The path still records it so a message can
 * point at the right element.
 */
export function violations(value: unknown, at = "$"): BoundaryViolation[] {
  const out: BoundaryViolation[] = [];

  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...violations(v, `${at}[${i}]`)));
    return out;
  }
  if (value === null || typeof value !== "object") return out;

  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const path = `${at}.${key}`;
    const forbidden = FORBIDDEN.get(key);
    if (forbidden) {
      out.push({
        at: path, field: key, rule: "forbidden",
        detail: `carries ${forbidden}, which Clinical Design Review Vol 2 forbids on a member surface`,
      });
    } else if (!ALLOWED.has(key)) {
      out.push({
        at: path, field: key, rule: "not_allowed",
        detail:
          "is not on the member allow-list. §3: a new member field needs an explicit allow-list entry — " +
          "the question is not whether it is forbidden, it is whether it was decided.",
      });
    }
    out.push(...violations(v, path));
  }
  return out;
}

/**
 * Refuse a value that carries anything undecided.
 *
 * Called AT THE BOUNDARY — where a projection is built, before it is returned —
 * rather than in a test only. §3's "structural impossibility beats
 * prohibition": a projection that would leak throws in development and in CI
 * instead of rendering.
 */
export function assertMemberProjection<T>(value: T, what = "member projection"): T {
  const found = violations(value);
  if (found.length > 0) {
    throw new MemberBoundaryError(
      `${what} carries ${found.length} field${found.length === 1 ? "" : "s"} that must not cross the member boundary:\n` +
      found.map((v) => `  ${v.at} — ${v.field} ${v.detail}`).join("\n")
    );
  }
  return value;
}

export function crossesBoundary(value: unknown): boolean {
  return violations(value).length === 0;
}

// ---------------------------------------------------------------------------
// The one declared exception
// ---------------------------------------------------------------------------

/**
 * The one declared exception, and it is settled.
 *
 * There is one member surface in this product that carries measured values:
 * `/app/progress`, under its own projection `member_progress.v6`.
 *
 * §11 made keeping it a Package 1 decision and listed what a kept exception
 * requires: "its own narrow server projection, its own contract test, and a
 * recorded clinical decision before a single field is exposed." Handoff 09
 * §1.3 recommended closing it instead.
 *
 * THE PRODUCT OWNER DECIDED TO KEEP IT, on 2026-09-08, and that decision
 * stands. All three requirements are recorded below as met. The third is worth
 * reading precisely rather than skimming: the authority behind it is the
 * product owner's recorded decision in docs/site/gui-decisions.md, which sets
 * out both sides of the argument and the steps to revert. That is what backs
 * this exception. Anyone auditing it should read that record rather than infer
 * a clinical sign-off from this field being true.
 *
 * WHAT KEEPS IT NARROW is unchanged and is the reason it can be settled at all.
 * The allow-list above does not cover this projection; `MemberDay` was never
 * widened, so no other member surface inherited the licence; and
 * `assertPatternOnly` refuses verdict language, so a number here may be a
 * PATTERN and may never be a VERDICT. Those three properties are what the
 * decision rests on, and each has a test.
 */
export interface DeclaredException {
  route: string;
  projection: string;
  /** Why it exists. */
  rationale: string;
  /** §11's three requirements, each with its state. */
  ownProjection: { met: boolean; evidence: string };
  ownContractTest: { met: boolean; evidence: string };
  /** §11's third requirement. `authority` names whose decision it is, so a
   *  later reader does not have to infer it from `met`. */
  recordedClinicalDecision: { met: boolean; authority: string; evidence: string };
  /** What handoff 09 recommends doing about it. */
  ruling: string;
}

export const MEMBER_SCORE_EXCEPTION: DeclaredException = {
  route: "/app/progress",
  projection: "member_progress.v6",
  rationale:
    "Handoff 06 §10.2 designs a member Progress screen built on measured values, with pattern language and a comparison window, so a person can see their own course. The product owner took the reversal knowingly; docs/site/gui-decisions.md records both sides and the steps to revert.",
  ownProjection: {
    met: true,
    evidence: "src/lib/member/progress.ts — a separate projection. MemberDay is untouched, so no other member surface inherited the licence.",
  },
  ownContractTest: {
    met: true,
    evidence: "tests/member-boundary.test.ts names /app/progress as the single exemption, fails if any other /app route appears outside the guard, and fails if MemberDay gains a score-bearing field. assertPatternOnly refuses verdict language.",
  },
  recordedClinicalDecision: {
    met: true,
    authority: "Product owner, 2026-09-08.",
    evidence:
      "docs/site/gui-decisions.md, Reversal 2 — recorded with both sides of the argument, the four conditions that bound the exemption, and the steps to revert. Handoff 09 §1.3 recommended closing it; the product owner reviewed that recommendation and decided to keep it.",
  },
  ruling:
    "Settled: kept, by the product owner's decision of 2026-09-08, against handoff 09 §1.3's recommendation to close it. It stays narrow — its own projection, its own contract test, MemberDay untouched, and assertPatternOnly refusing verdict language. Widening any of those four is a new decision, not a continuation of this one.",
};

/** Whether every prerequisite for a declared exception is met. The guard
 *  asserts each one names its authority and its evidence, so a `met: true`
 *  cannot be a bare assertion. */
export function exceptionFullyMet(e: DeclaredException): boolean {
  return e.ownProjection.met && e.ownContractTest.met && e.recordedClinicalDecision.met;
}
