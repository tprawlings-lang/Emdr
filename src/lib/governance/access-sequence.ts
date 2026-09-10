// The permission and consent sequence (handoff 06 §30.6), as data.
//
// §31.5's acceptance requirement for Security is unusual among the nine: every
// other audience is asked whether they can DO something, and Security is asked
// whether it can PROVE something — "prove tenant, role, consent, purpose and
// minimum-necessary enforcement for every protected endpoint". A claim about
// every endpoint cannot be made by reading a few of them, and it cannot be made
// by a test that passes: a passing test proves the cases it exercises.
//
// So the eight steps are written here with what counts as EVIDENCE for each,
// and src/lib/governance/access-evidence.ts checks every protected route in the
// register against them.
//
// THE HONEST PART, and the reason this file distinguishes two kinds of proof.
// Finding `requireClinician(` in a route proves the guard is CALLED. It does
// not prove the guard is correct, and it never will — that is what
// tests/member-boundary.ts, tests/aggregate-boundary.ts, tests/payer-boundary.ts
// and tests/tenant-isolation.ts are for, and they work by attacking the
// boundary rather than by reading it. A step whose enforcement has no single
// named mechanism is marked `behaviourally` and reports the tests that carry
// it, instead of being given a marker that would turn absence into a green
// cell. An inventory that cannot say "I cannot prove this here" is not an
// inventory, it is a wall.

import type { Audience, RouteEntry } from "../app/route-register";

export type ProofKind = "statically" | "behaviourally";

export interface AccessStep {
  /** §30.6's step number, unchanged. */
  n: number;
  name: string;
  /** §30.6's Check column. */
  check: string;
  /** §30.6's Failure behavior column. */
  onFailure: string;
  proof: ProofKind;
  /**
   * Source markers that constitute evidence the step ran, for a step that can
   * be proven statically. Each is matched as a CALL or a SQL fragment in the
   * route's own source, or in the body of a symbol the route imports and calls.
   */
  evidence: string[];
  /** Test files that attack this boundary rather than reading it. */
  attackedBy: string[];
}

const AGGREGATE: Audience[] = ["organization", "payer"];

/**
 * A route where one account reads ANOTHER PERSON'S record.
 *
 * §30.6 step 3 is "resolve person-to-care relationship", and its failure
 * behaviour is "no routine person view WITHOUT RELATIONSHIP". A member opening
 * their own progress page has no relationship to resolve — they are the person,
 * and the relationship check that applies to a clinician is meaningless there.
 * The first run of this inventory owed step 3 to thirty-six member routes and
 * reported all of them as gaps, which was the model being wrong rather than the
 * routes.
 *
 * So this is about a route whose SUBJECT IS SOMEBODY ELSE: a path carrying a
 * person id, read by an account that is not that person.
 */
export function readsAnotherPerson(entry: RouteEntry): boolean {
  if (entry.audience === "member") return false;
  return /\/(member|patients|person|signals)\/\[/.test(entry.path);
}

/** A route that shows one person's record, whoever is reading — the member's
 *  own care surfaces included. Consent (step 4) is owed here: a member's own
 *  care program runs on a consent they can revoke. */
export function isPersonLevel(entry: RouteEntry): boolean {
  return readsAnotherPerson(entry)
    || entry.workspace === "member_day"
    || entry.workspace === "member_activity"
    || entry.workspace === "member_account";
}

export function isAggregate(entry: RouteEntry): boolean {
  return AGGREGATE.includes(entry.audience);
}

export function isProtected(entry: RouteEntry): boolean {
  return entry.audience !== "public";
}

export const ACCESS_STEPS: AccessStep[] = [
  {
    n: 1,
    name: "Authenticate and resolve the acting tenant",
    check: "Resolve authenticated account and active tenant",
    onFailure: "Return generic denied state",
    proof: "statically",
    evidence: [
      "requireUser(", "requireMember(", "requireClinician(", "requireReviewer(",
      "requireReviewAccess(", "requireOrganization(", "requirePayer(",
      "requireIntelligence(", "requireDemoAdmin(",
    ],
    attackedBy: ["tests/e2e/smoke.spec.ts", "tests/demo-roles.test.ts"],
  },
  {
    n: 2,
    name: "Confirm the role and the purpose for this route",
    check: "Confirm role and purpose for route",
    onFailure: "Do not reveal protected subject existence",
    proof: "statically",
    // Deliberately NOT `requireUser(`: authenticating is step 1. A route whose
    // only guard is "somebody is signed in" has not confirmed a role, and that
    // is the difference between the two steps.
    evidence: [
      "requireMember(", "requireClinician(", "requireReviewer(", "requireReviewAccess(",
      "requireOrganization(", "requirePayer(", "requireIntelligence(", "requireDemoAdmin(",
    ],
    attackedBy: ["tests/demo-roles.test.ts", "tests/e2e/role-projections.spec.ts"],
  },
  {
    n: 3,
    name: "Resolve the person-to-care relationship",
    check: "Resolve person-to-care relationship",
    onFailure: "No routine person view without relationship",
    proof: "statically",
    // THE TENANT IS THE CARE RELATIONSHIP in this product: the caseload selects
    // members by tenant, so a person in a clinician's tenant is in their
    // caseload and one anywhere else is invisible to them. A subject lookup
    // constrained by tenant IS the relationship check, and `notFound` is how it
    // fails without revealing that the subject exists.
    evidence: ["tenant_id = ?", "repo(ctx)", "assertScopable(", "loadPersonHeader("],
    attackedBy: ["tests/tenant-isolation.test.ts", "tests/member-boundary.test.ts"],
  },
  {
    n: 4,
    name: "Confirm current, non-revoked consent and scope",
    check: "Confirm current, non-revoked consent and scope",
    onFailure: "Return consent-required projection",
    proof: "statically",
    evidence: ["hasConsent(", "revoked_at IS NULL", "consentActive", "requireConsent("],
    attackedBy: ["tests/signup-gates.test.ts", "tests/voice-consent-gate.test.ts", "tests/bls-consent-gate.test.ts"],
  },
  {
    n: 5,
    name: "Apply the minimum-necessary field policy",
    check: "Apply minimum-necessary field policy",
    onFailure: "Remove fields before serialization",
    // NO SINGLE NAMED MECHANISM, and inventing a marker for it would be worse
    // than admitting that. Minimum-necessary here is a property of what the
    // projections can return at all — the aggregate population has no names in
    // the database, so an aggregate console cannot leak one whatever it asks.
    // That is a stronger guarantee than a filter, and it is invisible to a
    // scan of the route. The boundary tests are what hold it.
    proof: "behaviourally",
    evidence: [],
    attackedBy: [
      "tests/aggregate-boundary.test.ts", "tests/payer-boundary.test.ts",
      "tests/member-boundary.test.ts", "tests/role-projections.test.ts",
    ],
  },
  {
    n: 6,
    name: "Apply small-cell suppression for aggregate roles",
    check: "Apply small-cell suppression for aggregate roles",
    onFailure: "Suppress value and related derivations",
    proof: "statically",
    evidence: ["SMALL_CELL", "suppressed(", "suppressExternal(", "suppressSmallCells("],
    attackedBy: ["tests/aggregate-boundary.test.ts", "tests/metrics.test.ts"],
  },
  {
    n: 7,
    name: "Record the access audit event",
    check: "Record access audit event",
    onFailure: "Fail closed for protected evidence if audit write fails",
    proof: "statically",
    evidence: ["audit(", "auditUnavailable("],
    attackedBy: ["tests/audit-chain.test.ts", "tests/access-states.test.ts"],
  },
  {
    n: 8,
    name: "Return the projection version and the allowed actions",
    check: "Return signed projection version and allowed actions",
    onFailure: "Client renders only provided actions",
    proof: "statically",
    evidence: [
      "projectionVersion", "schemaVersion", "allowedActions", "ProjectionMeta",
      "resolveCommand(",
    ],
    attackedBy: ["tests/presentation-spine.test.ts", "tests/experience-contracts.test.ts"],
  },
];

export function step(n: number): AccessStep | null {
  return ACCESS_STEPS.find((s) => s.n === n) ?? null;
}

/**
 * Which of the eight steps a given route has to satisfy.
 *
 * NOT ALL EIGHT APPLY TO EVERY ROUTE, and pretending they do would make the
 * inventory useless in the other direction: a reviewer reading a wall of
 * not-applicable cells stops reading. Steps 3 and 4 are about a PERSON, so a
 * queue does not owe them. Step 6 is about an aggregate, so a person's chart
 * does not. Steps 1, 2, 5 and 8 are owed by every protected route.
 *
 * Step 7 is owed by any route that reads a protected record — every person-level
 * route, and every aggregate one, because an export or a drilldown is a
 * disclosure whether or not it names anybody.
 */
export function stepsFor(entry: RouteEntry): number[] {
  if (!isProtected(entry)) return [];
  const owed = [1, 2, 5];
  if (servesAProjection(entry)) owed.push(8);
  if (readsAnotherPerson(entry)) owed.push(3);
  if (isPersonLevel(entry)) owed.push(4, 7);
  if (isAggregate(entry)) owed.push(6, 7);
  return [...new Set(owed)].sort((a, b) => a - b);
}

/**
 * Whether §30.6 step 8 applies: "return signed projection version and allowed
 * actions".
 *
 * A SERVER-RENDERED PAGE HAS NO SUCH RETURN. Step 8 is about a payload that
 * crosses a boundary and carries its own version, which is why §30.4 puts it in
 * the API table — the browser here receives HTML the server already composed,
 * and there is no DTO to version. Owing it to all 108 protected routes made 104
 * of them read as gaps on the first run of this inventory, which said nothing
 * except that the model was wrong.
 *
 * So it is owed by the routes that really do serve a versioned contract: the
 * API routes, and §30.3's own list of projection consumers. That list is the
 * handoff's rather than derived from the code — a route that quietly stopped
 * reading its projection would otherwise stop owing the step at the same
 * moment it broke it.
 */
export const PROJECTION_ROUTES: string[] = [
  "/app/today",                      // member_today
  "/app/progress",                   // member_today (progress view)
  "/clinician/today",                // clinician_queue
  "/clinician/member/[id]",          // clinician_patient
  "/organization/overview",          // organization_overview
  "/payer/overview",                 // payer_overview
  "/payer/evidence",                 // evidence_bundle
  "/review/audit",                   // audit_trace
  "/app/session/[moduleId]/safety",  // the gate projection a session reads
];

export function servesAProjection(entry: RouteEntry): boolean {
  return PROJECTION_ROUTES.includes(entry.path) || entry.path.startsWith("/api/");
}

/**
 * A step a named route does not owe, and why.
 *
 * EXEMPTIONS ARE THE INTERESTING ROWS, so they are declared here and rendered
 * on the screen rather than quietly subtracted. Every one is a decision
 * somebody made about a route, and a reviewer who disagrees with one should be
 * able to find it in a list rather than by noticing an absence.
 *
 * The test holds each of these to naming a real route that really would owe the
 * step: an exemption for something that was never owed is a comment pretending
 * to be a control.
 */
export interface AccessExemption {
  path: string;
  step: number;
  reason: string;
}

export const ACCESS_EXEMPTIONS: AccessExemption[] = [
  {
    path: "/app/ground",
    step: 1,
    reason:
      "Grounding is reachable without signing in, on purpose. It is one of the controls a " +
      "member must always have, and the envelope states the same rule for every failure " +
      "state: there is no condition in which support is withdrawn. The page personalises " +
      "from the safety plan when somebody is signed in and works without one when they " +
      "are not.",
  },
  {
    path: "/app/ground",
    step: 2,
    reason:
      "There is no role to confirm on a page that is open to everybody. The route is listed " +
      "under the member audience because that is who it is FOR, not because signing in is a " +
      "condition of reaching it.",
  },
  {
    path: "/app/ground",
    step: 4,
    reason:
      "Nothing here runs on a consent. A breathing exercise and five sentences are not the " +
      "care program, and gating them behind a consent record would withdraw support from " +
      "exactly the person least able to complete a form.",
  },
  {
    path: "/app/settings/account",
    step: 2,
    reason:
      "Deliberately every role, not one. This is self-serve account deletion, and an " +
      "account of any role may delete itself; `requireUser` is the correct guard and a " +
      "role check here would lock somebody out of closing their own account.",
  },
  {
    path: "/demo",
    step: 1,
    reason:
      "The review gateway is the door taken BEFORE a role exists. Its control is the entry " +
      "code submitted on the page, not an account — a session that required an account " +
      "would have nowhere to send somebody who has not got one yet.",
  },
  {
    path: "/demo",
    step: 2,
    reason:
      "Nobody has a role at the door. The gateway asks which review path somebody wants and " +
      "takes an entry code; the role is chosen after that, on the other side of it.",
  },
  {
    path: "/demo/[path]",
    step: 1,
    reason: "The same door, entered at a named screen. The entry code is still the control.",
  },
  {
    path: "/demo/[path]",
    step: 2,
    reason:
      "The same door, entered at a named screen. The role is still chosen after the entry " +
      "code is accepted, so there is nothing to confirm here.",
  },
];

export function exemption(routePath: string, step: number): AccessExemption | null {
  return ACCESS_EXEMPTIONS.find((e) => e.path === routePath && e.step === step) ?? null;
}

/** What a static scan does and does not establish, said once, in the place the
 *  inventory is built from rather than in a footnote somebody can move. */
export const STATIC_PROOF_LIMIT =
  "Finding a guard in a route proves the guard is called on that route. It does not " +
  "prove the guard is correct, and no scan of the source ever will. Correctness is " +
  "held by the boundary tests named against each step, which work by attacking the " +
  "boundary rather than by reading it.";
