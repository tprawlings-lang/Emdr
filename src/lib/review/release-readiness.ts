// The reviewer's decision surface (handoff 09 §7.1, §10 Package 6).
//
// Package 6's exit evidence: "Version conflict and presentation access tests
// pass. Evidence-fingerprint mutation reopens approval in test and demo."
//
// WHAT WAS ALREADY RIGHT. The release screen already binds a sign-off to a
// fingerprint of the evidence it was shown, so changing the evidence reopens
// the gate rather than inheriting its approval, and it already separates a
// measured result from a person's word. Those are the hard properties and they
// are not being rebuilt.
//
// FOUR THINGS §7.1 ASKS FOR THAT WERE NOT THERE, and the first two are
// defects rather than absences:
//
//   THE ATTESTED GATES ALL SHARED ONE DEPENDENCY SET. Every attestation was
//   fingerprinted over {safetyConfigVersion, claimsVersion}, so publishing a
//   corrected sentence in the public claims registry reopened the
//   ACCESSIBILITY attestation — which is about keyboard and screen-reader
//   paths and has nothing to do with claims copy. §7.1: "Use explicit
//   dependency fingerprints. A decorative token change must not reopen
//   unrelated attestations." An attestation that reopens for unrelated reasons
//   trains its owner to re-approve without rereading, which is worse than not
//   reopening at all.
//
//   A STALE SUBMISSION WAS RECORDED RATHER THAN REJECTED. The sign-off form
//   carries the fingerprint it was rendered with; the action recorded the
//   decision against that value without checking it was still current. A
//   reviewer who opened the page, went to a meeting, and approved on return
//   wrote an approval against evidence that had since moved. It did not read
//   as approved afterwards — the fingerprint no longer matched — so the effect
//   was a decision that silently did nothing. §7.1 asks for the opposite:
//   "reject the stale submission with a comparison and a review-again route,
//   and explain which prior decisions reopened."
//
//   THE SCREEN OPENED ON A TALLY. Three cards: approved, blocking, reopened.
//   §7.1: "Open on release scope, target environment, commit, and evidence
//   date. Then blockers that need action — not a large percentage complete."
//   Six of eight approved is a progress bar, and a release conversation held
//   over a progress bar asks how far along we are rather than what is wrong.
//
//   REPEATED FAILURES WERE EIGHT SEPARATE PANELS. §7.1: "Group repeated
//   failures by root dependency without hiding the gates they affect."
//
// Client-safe: types and pure functions. The version constants it reads are
// plain strings from modules that carry no database.

import { SAFETY_CONFIG_VERSION } from "../safety/governance";
import { SITE_CLAIMS_VERSION } from "../site/registry";
import { REGISTER_COMMIT, REGISTER_DATE, ROUTE_REGISTER } from "../app/route-register";
import { RELEASE_GATES, type EvidenceStatus, type GateEvidence } from "./gates";
import type { Decision, ReviewDecision } from "./decisions";

// ---------------------------------------------------------------------------
// §7.1 — what the screen opens on
// ---------------------------------------------------------------------------

export interface ReleaseScope {
  /** What is being released. Named, because "the release" is not a scope. */
  scope: string;
  /** Where it is going. A gate passed against a demonstration environment is
   *  not evidence about production, and the two must never read alike. */
  environment: string;
  /** The commit the evidence describes. §10.1: "Require retained CI evidence
   *  for the implementation commit; prior build and lint results are
   *  historical." */
  commit: string;
  /** When the evidence was gathered. */
  evidenceDate: string;
  /** How many routes the release covers, so the scope is a size as well as a
   *  name. */
  routeCount: number;
}

export function releaseScope(): ReleaseScope {
  return {
    scope: "Controlled prototype — fabricated data, no real-person use",
    // From the environment rather than assumed. A screen that says
    // "production" because nobody set a variable is the worst possible
    // default for this particular field.
    environment: process.env.EMDR_DEMO === "1" ? "Demonstration" : "Unlabelled environment",
    commit: REGISTER_COMMIT,
    evidenceDate: REGISTER_DATE,
    routeCount: ROUTE_REGISTER.length,
  };
}

// ---------------------------------------------------------------------------
// §7.1 — explicit dependency fingerprints
// ---------------------------------------------------------------------------

/**
 * The things a gate's evidence can depend on.
 *
 * NAMED, NOT INFERRED. The point of §7.1's "explicit" is that a reader can see
 * why an attestation reopened — and the previous arrangement, where every
 * attestation carried every version, made that unanswerable: an attestation
 * reopened because *something* changed.
 */
export const DEPENDENCY_KEYS = [
  "safetyConfig",
  "claimsRegistry",
  "routeSurface",
] as const;
export type DependencyKey = (typeof DEPENDENCY_KEYS)[number];

export const DEPENDENCY_LABEL: Record<DependencyKey, string> = {
  safetyConfig: "the safety configuration",
  claimsRegistry: "the public claims registry",
  routeSurface: "the set of screens in the build",
};

function dependencyValue(key: DependencyKey): string {
  switch (key) {
    case "safetyConfig":
      return SAFETY_CONFIG_VERSION;
    case "claimsRegistry":
      return SITE_CLAIMS_VERSION;
    case "routeSurface":
      // The COUNT and the register's own date, not a hash of the file. A
      // comment edit in the register is a decorative change and must not
      // reopen an accessibility attestation; a screen appearing or
      // disappearing is not decorative and must.
      return `${ROUTE_REGISTER.length}@${REGISTER_DATE}`;
  }
}

/**
 * What each attested gate is attested AGAINST.
 *
 * ONE LINE PER GATE, AND THE LINES DIFFER. That difference is the whole
 * mechanism: the claims registry reopens the analytics attestation, because
 * analytics integrity is partly about how numbers are described; it does not
 * reopen accessibility, because a corrected sentence does not change a
 * keyboard path.
 *
 * A gate with an EMPTY dependency list would be an attestation nothing could
 * ever invalidate, which is a signature with no expiry. `assertDependencies`
 * refuses one.
 */
export const GATE_DEPENDENCIES: Record<string, DependencyKey[]> = {
  // The attack suite is about who can reach which surface, so it reopens when
  // the set of surfaces changes. Claims copy does not affect it.
  authorization: ["routeSurface"],
  // Keyboard and screen-reader paths are properties of the screens. A claims
  // bump is a copy change; it does not move focus order.
  accessibility: ["routeSurface"],
  // How numbers are computed and how they are described. Safety config is not
  // in this list: a threshold change moves what the numbers SAY, and that is
  // the safety gate's business rather than the analytics attestation's.
  analytics_integrity: ["claimsRegistry"],
};

export class ReadinessError extends Error {}

/** The facts an attested gate is fingerprinted over. */
export function dependencyFacts(gateId: string): Record<string, string> {
  const keys = GATE_DEPENDENCIES[gateId];
  if (!keys || keys.length === 0) {
    throw new ReadinessError(
      `"${gateId}" declares no dependencies, so its attestation could never be invalidated.`
    );
  }
  const facts: Record<string, string> = { gate: gateId };
  for (const k of keys) facts[k] = dependencyValue(k);
  return facts;
}

/** Which attested gates a change to one dependency reopens. Exported so the
 *  screen can say WHY a gate reopened rather than only that it did. */
export function reopenedBy(key: DependencyKey): string[] {
  return Object.keys(GATE_DEPENDENCIES).filter((g) => GATE_DEPENDENCIES[g].includes(key));
}

/** Every attested gate declares at least one dependency, and no gate declares
 *  all of them — a gate that depends on everything reopens for everything,
 *  which is the arrangement §7.1 rules out. */
export function assertDependencies(): void {
  for (const gate of RELEASE_GATES) {
    if (gate.evidenceClass !== "attested") continue;
    const keys = GATE_DEPENDENCIES[gate.id];
    if (!keys || keys.length === 0) {
      throw new ReadinessError(`Attested gate "${gate.id}" declares no dependencies.`);
    }
    if (keys.length === DEPENDENCY_KEYS.length) {
      throw new ReadinessError(
        `Attested gate "${gate.id}" depends on everything, so every change reopens it. ` +
          "An attestation that reopens for unrelated reasons trains its owner to re-approve " +
          "without rereading."
      );
    }
  }
}

// ---------------------------------------------------------------------------
// §7.1 — the question, the authority, the allowed decisions
// ---------------------------------------------------------------------------

/**
 * §7.1: "Each item states the question to decide, its evidence, the reviewer's
 * exact authority, and the allowed decisions."
 *
 * THE AUTHORITY LINE IS THE ONE THAT MATTERS. A reviewer looking at the
 * accessibility gate is not being asked whether the product is accessible;
 * they are being asked whether they, personally, are willing to assert it with
 * a pointer to evidence. Those are different questions and only one of them is
 * theirs to answer.
 */
export interface GateBrief {
  question: string;
  authority: string;
  allowed: Decision[];
}

const ALL_THREE: Decision[] = ["approved", "blocked", "changes_requested"];

export const GATE_BRIEFS: Record<string, GateBrief> = {
  demo_identity: {
    question: "Does anything in this environment look like a real person's data?",
    authority: "You confirm the scan result. You are not asserting the scanner is complete.",
    allowed: ALL_THREE,
  },
  safety_regression: {
    question: "Did every fixed safety scenario reach the tier it is supposed to reach?",
    authority: "You confirm the replay matched. You are not certifying the thresholds are clinically correct.",
    allowed: ALL_THREE,
  },
  clinical_language: {
    question: "Does any surface make a diagnosis, readiness or care claim the evidence does not support?",
    authority: "Yours as clinical reviewer. This decision is the gate.",
    allowed: ALL_THREE,
  },
  projection_parity: {
    question: "Does a rebuild from the ledger reproduce what the screens are showing?",
    authority: "You confirm a comparison that has been run. Approving without running it asserts nothing.",
    allowed: ALL_THREE,
  },
  authorization: {
    question: "Can any role reach data outside its scope?",
    authority:
      "You assert this from evidence you name. The system cannot check it, so your pointer to the run is the evidence.",
    allowed: ALL_THREE,
  },
  accessibility: {
    question: "Is any keyboard or screen-reader path blocked?",
    authority:
      "You assert this from a run you name. An automated pass is not the same as a screen-reader pass, and this gate covers both.",
    allowed: ALL_THREE,
  },
  analytics_integrity: {
    question: "Does any figure misstate its denominator, its method, or whether it was observed or modelled?",
    authority: "You assert this from a review you name.",
    allowed: ALL_THREE,
  },
  claims_discipline: {
    question: "Does any public surface make a restricted claim?",
    authority: "You confirm the registry version and the guard. The guard runs in the suite.",
    allowed: ALL_THREE,
  },
};

export function briefFor(gateId: string): GateBrief | null {
  return GATE_BRIEFS[gateId] ?? null;
}

// ---------------------------------------------------------------------------
// §7.1 — blockers first, not a percentage
// ---------------------------------------------------------------------------

export interface GateRow {
  gateId: string;
  name: string;
  status: EvidenceStatus;
  evidenceClass: string;
  /** The decision in force at the CURRENT fingerprint, if any. */
  inForce: ReviewDecision | null;
  /** A decision recorded against an earlier fingerprint, when nothing is in
   *  force now. */
  superseded: ReviewDecision | null;
}

export const BLOCKER_KINDS = [
  "evidence_failing",
  "blocked_by_reviewer",
  "reopened",
  "not_run",
  "undecided",
] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

export const BLOCKER_LABEL: Record<BlockerKind, string> = {
  evidence_failing: "Evidence is failing",
  blocked_by_reviewer: "A reviewer blocked it",
  reopened: "Approved once, then the evidence moved",
  not_run: "The check has not been run",
  undecided: "Nobody has decided",
};

/** What is standing between this build and a release, worst first.
 *
 *  §7.1: "Then blockers that need action — not a large percentage complete."
 *  A gate that is passing and signed off does not appear here at all, which is
 *  the point: this list is empty exactly when the release is clear. */
export function blockers(rows: readonly GateRow[]): Array<GateRow & { kind: BlockerKind }> {
  const out: Array<GateRow & { kind: BlockerKind }> = [];
  for (const r of rows) {
    const kind = blockerKind(r);
    if (kind) out.push({ ...r, kind });
  }
  const order = new Map(BLOCKER_KINDS.map((k, i) => [k, i]));
  return out.sort((a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0));
}

function blockerKind(r: GateRow): BlockerKind | null {
  if (r.status === "fail") return "evidence_failing";
  if (r.inForce?.decision === "blocked") return "blocked_by_reviewer";
  if (r.inForce?.decision === "changes_requested") return "blocked_by_reviewer";
  if (!r.inForce && r.superseded) return "reopened";
  // §7.1 names "not-run checks" as their own thing. An unavailable measured
  // check and an undecided gate are different problems: one needs somebody to
  // run something, the other needs somebody to decide.
  if (r.status === "unavailable" && !r.inForce) return "not_run";
  if (!r.inForce) return "undecided";
  return null;
}

/** Whether the release is clear. Deliberately not a percentage. */
export function releaseClear(rows: readonly GateRow[]): boolean {
  return blockers(rows).length === 0;
}

// ---------------------------------------------------------------------------
// §7.1 — group repeated failures by root dependency
// ---------------------------------------------------------------------------

export interface FailureGroup {
  /** What they have in common, in the reviewer's words. */
  cause: string;
  /** Every gate it affects. §7.1: "without hiding the gates they affect." */
  gateIds: string[];
}

/**
 * Repeated failures, grouped by what they share.
 *
 * WITHOUT HIDING THE GATES, which is the constraint that makes this useful
 * rather than a summary. A grouping that says "3 gates failing for one reason"
 * and does not name them has replaced eight rows with one row and lost the
 * only thing a reviewer needed. Each group carries its members.
 *
 * A group of ONE is not a group. Two gates failing for unrelated reasons are
 * two problems, and pretending otherwise is the same collapse in the other
 * direction.
 */
export function groupFailures(
  rows: readonly GateRow[],
  evidence: ReadonlyMap<string, GateEvidence>
): FailureGroup[] {
  const byCause = new Map<string, string[]>();
  for (const r of rows) {
    if (r.status !== "fail") continue;
    const ev = evidence.get(r.gateId);
    if (!ev) continue;
    const cause = rootCause(ev);
    byCause.set(cause, [...(byCause.get(cause) ?? []), r.gateId]);
  }
  return [...byCause.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([cause, gateIds]) => ({ cause, gateIds }));
}

/** The shared fact two failing gates have in common, when they have one.
 *
 *  Deliberately coarse. A cleverer classifier would find relationships that
 *  are not there, and a reviewer acting on a false grouping fixes the wrong
 *  thing. */
function rootCause(ev: GateEvidence): string {
  const facts = ev.facts;
  if (facts.qualityFailed && Number(facts.qualityFailed) > 0) {
    return "The fabricated dataset does not satisfy its own manifest.";
  }
  if (facts.configVersion && facts.failed && Number(facts.failed) > 0) {
    return `The safety configuration ${String(facts.configVersion)} does not reproduce its fixed scenarios.`;
  }
  if (facts.diffs && Number(facts.diffs) > 0) {
    return "A rebuild from the ledger does not reproduce the live projections.";
  }
  return ev.summary;
}

// ---------------------------------------------------------------------------
// §7.1 — the stale submission
// ---------------------------------------------------------------------------

export interface StaleSubmission {
  stale: boolean;
  submittedFingerprint: string;
  currentFingerprint: string;
  /** What changed, as key → [was, is]. Empty when the fingerprints match. */
  changed: Array<{ fact: string; was: string; is: string }>;
  /** Which prior decisions this reopened. §7.1 asks the screen to "explain
   *  which prior decisions reopened", so the reason travels with the refusal
   *  rather than being left for the reviewer to work out. */
  reopened: string[];
}

/**
 * Whether a sign-off arriving now describes the evidence as it is now.
 *
 * THE COMPARISON IS THE POINT, not the boolean. §7.1 asks to "reject the stale
 * submission with a comparison and a review-again route" — a refusal that says
 * only "the evidence changed" leaves the reviewer to diff two hex strings, and
 * they will approve again without reading rather than do that.
 *
 * `submittedFacts` is what the page was rendered with. It travels in the form
 * so the comparison can name the fields; the fingerprint alone cannot.
 */
export function checkSubmission(args: {
  submittedFingerprint: string;
  currentFingerprint: string;
  submittedFacts: Record<string, string | number | boolean>;
  currentFacts: Record<string, string | number | boolean>;
  /** Gate ids whose decisions the change reopened. */
  reopened?: string[];
}): StaleSubmission {
  const stale = args.submittedFingerprint !== args.currentFingerprint;
  const changed: StaleSubmission["changed"] = [];
  if (stale) {
    const keys = new Set([...Object.keys(args.submittedFacts), ...Object.keys(args.currentFacts)]);
    for (const k of [...keys].sort()) {
      const was = String(args.submittedFacts[k] ?? "—");
      const is = String(args.currentFacts[k] ?? "—");
      if (was !== is) changed.push({ fact: k, was, is });
    }
  }
  return {
    stale,
    submittedFingerprint: args.submittedFingerprint,
    currentFingerprint: args.currentFingerprint,
    changed,
    reopened: args.reopened ?? [],
  };
}
