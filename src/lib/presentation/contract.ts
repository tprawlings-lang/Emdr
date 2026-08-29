// The shared presentation contract (GUI and Decision-Surface Handoff §8.2).
//
// The rule this encodes (§8): "The UI should never build clinical meaning by
// joining raw event arrays in React or SwiftUI. The server should publish
// role-scoped presentation objects."
//
// Today the opposite is true in places — the guided session flow re-derives its
// own state from raw profile fields rather than reading the safety engine's
// decision, and that divergence is exactly how the flow ended up with no
// closure state and a visual stimulus the signed config disables. A shared
// object with the decision already made is the structural answer to that class
// of bug, the same way src/lib/member/view.ts is the structural answer to score
// leakage.
//
// §8.1 draws the line precisely: the client may "render, collect an authorized
// action, show state" and must not "infer safety, fabricate freshness, or claim
// delivery". Those three verbs name three defects this repository has actually
// shipped, so the contract is written to make each of them awkward rather than
// natural.

export type SourceKind = "event" | "measure" | "policy" | "review" | "integration";

/** A pointer to the thing that justifies a claim.
 *
 *  Both times are kept because they answer different questions: `occurredAt` is
 *  when it happened to the person, `recordedAt` is when the system learned. A
 *  late-arriving integration makes those far apart, and a surface that shows
 *  only one of them will mislead about how current the picture is. */
export interface EvidenceRef {
  id: string;
  kind: SourceKind;
  occurredAt: string;
  recordedAt: string;
  label: string;
  href?: string;
}

/** How old the decision is, and whether that matters yet.
 *
 *  `state` is computed on the server. A client that derives freshness from a
 *  local clock is fabricating it — the failure §8.1 names — because it has no
 *  way to know the staleness policy or when the projection actually ran. */
export interface Freshness {
  computedAt: string;
  newestEvidenceAt: string;
  staleAfter: string;
  state: "fresh" | "aging" | "stale" | "unknown";
}

/** One reason a state holds, in language a person can read, with the evidence
 *  that supports it. A reason with no evidence is an assertion. */
export interface ReasonItem {
  code: string;
  label: string;
  detail?: string;
  evidence: EvidenceRef[];
}

export type ActionKind =
  | "navigate" | "review" | "contact" | "approve" | "correct" | "override" | "export";

/** Something this role is allowed to do, in this state, right now.
 *
 *  Authorization is decided server-side and travels with the action. A client
 *  that decides for itself which buttons to draw is inferring permission, and
 *  §20.1 requires that "every action shown is authorized for that role and
 *  current state".
 *
 *  `disabledReason` exists so a blocked action can explain itself rather than
 *  vanish — except where absence is the correct treatment. §15.2 is explicit
 *  that an attempted safety-stop override does not render at all: offering a
 *  disabled control teaches that the override exists and is merely unavailable
 *  today. */
export interface AllowedAction {
  id: string;
  label: string;
  kind: ActionKind;
  href?: string;
  confirmation: "none" | "standard" | "high_risk";
  disabledReason?: string;
}

export type ReviewState = "not_needed" | "pending" | "approved" | "corrected" | "rejected";

/** The object every decision surface renders from.
 *
 *  §8.2: "The server creates the DecisionSurface. The clients render it. The
 *  clients may choose a mobile or desktop layout, but they may not change
 *  state, reasons, allowed actions, or review state."
 *
 *  The four fields answer §1's four questions in order — what changed, why it
 *  matters, what this user can do, what gets recorded — which is why they are
 *  required rather than optional. A surface that cannot answer all four is not
 *  a decision surface; it is a report. */
export interface DecisionSurface {
  id: string;
  state: string;
  headline: string;
  explanation: string;
  change?: {
    label: string;
    direction: "better" | "worse" | "mixed" | "stable" | "unknown";
  };
  reasons: ReasonItem[];
  actions: AllowedAction[];
  owner?: { id: string; displayName: string; role: string };
  freshness: Freshness;
  policy?: { id: string; version: string };
  review?: { state: ReviewState; reviewedAt?: string };
}

export class PresentationContractError extends Error {}

/** Reject a surface that cannot answer the four questions, or that carries an
 *  action the handoff forbids rendering.
 *
 *  Runtime rather than type-only for the same reason `assertNoScores` is: types
 *  protect the code we write, and this protects the object assembled by a
 *  future helper that spreads something wider into it. */
export function assertRenderable(s: DecisionSurface): DecisionSurface {
  if (!s.headline.trim()) {
    throw new PresentationContractError(`surface ${s.id} has no headline — nothing states what is true now`);
  }
  if (!s.explanation.trim()) {
    throw new PresentationContractError(`surface ${s.id} has no explanation — §23.4 forbids a state without a reason`);
  }
  if (!s.freshness?.state) {
    throw new PresentationContractError(`surface ${s.id} has no freshness — §20.1 requires every state card to answer it`);
  }
  for (const a of s.actions) {
    if (a.kind === "override" && /safety[ _-]?stop/i.test(a.id + a.label)) {
      throw new PresentationContractError(
        `surface ${s.id} offers a safety-stop override. §15.2: do not render the action. ` +
        "A disabled control still teaches that the override exists."
      );
    }
  }
  return s;
}

/** A rate that knows its own denominator (§23.3, §20.4).
 *
 *  "Do not show a percentage without its denominator." Modelled as a type
 *  rather than a convention so an aggregate surface cannot carry a bare
 *  percentage in the first place. */
export interface Rate {
  numerator: number;
  denominator: number;
  period: { from: string; to: string };
  cohort: string;
}

export function ratePercent(r: Rate): number {
  if (r.denominator <= 0) {
    throw new PresentationContractError("a rate with no denominator is not a rate");
  }
  return (r.numerator / r.denominator) * 100;
}
