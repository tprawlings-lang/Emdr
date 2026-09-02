import type { Role } from "@/lib/roles";
import { PLANNING_OWNER } from "./policy";

// The planning-signal state machine (handoff 07 §3.5, p35) and the action set
// the server supplies with it (§5.4, p49).
//
// p35 closes with the sentence the whole lifecycle is built around:
//
//   NO STATE TRANSITION CHANGES A PATIENT'S PERMITTED ACTIVITY. SAFETY AND
//   CARE ACTIONS STAY IN THEIR EXISTING DETERMINISTIC AND CLINICIAN-GOVERNED
//   SYSTEMS.
//
// That is enforced by what this module CANNOT reach, not by what it declines
// to do. Nothing under `src/lib/planning` imports the safety engine, the
// gating chain or any member module, and `tests/planning.test.ts` fails the
// build on such an import. A transition here writes one row saying a signal
// moved from one state to another; there is no code path from that row to a
// gate, and adding one would have to get past the guard first.
//
// And p49's rule, which is the other half:
//
//   THE SERVER SUPPLIES allowed_actions AFTER POLICY EVALUATION. THE CLIENT
//   NEVER INVENTS OR WIDENS THE ACTION SET.
//
// So `allowedActions` is computed here, travels on the signal object, and is
// re-derived on the server when an action arrives. A client that posts an
// action it was not offered is refused by the same function that decided not
// to offer it — the list on the page is a rendering of the decision, never the
// decision itself.

export type SignalState =
  | "draft"
  | "analysis_requested"
  | "clinical_review"
  | "fairness_review"
  | "pilot_proposed"
  | "pilot_active"
  | "decision_recorded"
  | "retired";

export const SIGNAL_STATES: readonly SignalState[] = [
  "draft", "analysis_requested", "clinical_review", "fairness_review",
  "pilot_proposed", "pilot_active", "decision_recorded", "retired",
] as const;

export type ReviewAction =
  | "reject"
  | "request_analysis"
  | "return_with_evidence"
  | "assign_owner"
  | "propose_pilot"
  | "advance"
  | "mitigate"
  | "approve"
  | "revise"
  | "stop"
  | "complete"
  | "archive";

/**
 * p49's `blocked_actions`, and p44's Blocked actions row.
 *
 * FROZEN and always present on every signal, in every state, for every role.
 * A blocked action is not a permission that nobody currently holds — it is a
 * thing this subsystem does not do, listed on the object so a reader can see
 * that it was considered and refused rather than merely absent.
 */
export const BLOCKED_ACTIONS = ["route_person", "change_gate", "deny_access"] as const;
export type BlockedAction = (typeof BLOCKED_ACTIONS)[number];

export const BLOCKED_ACTION_REASONS: Record<BlockedAction, string> = {
  route_person:
    "No direct patient assignment. A planning signal is about a cohort; assigning a person to " +
    "anything is a clinician's decision in the clinical system (p44, p46).",
  change_gate:
    "No gate change. Safety gates are deterministic and live in the safety engine, which this " +
    "subsystem does not import (p35, p46).",
  deny_access:
    "No payer restriction. Nothing here may narrow what a person is entitled to (p44).",
};

export interface StateDefinition {
  state: SignalState;
  /** p35's Entry column. */
  entry: string;
  /** p35's Allowed action column — what a human does IN the state, which is
   *  not the same as the transitions out of it. */
  allowedActivity: string;
  /** p35's Exit column, as the actions that produce it. */
  exits: ReviewAction[];
  terminal?: true;
}

export const STATES: StateDefinition[] = [
  {
    state: "draft",
    entry: "Rule fires on verified metrics",
    allowedActivity: "Inspect cohort, lineage, missingness and confounders",
    // p44's "Allowed next actions" row names these four for a candidate
    // signal, and p49's worked object carries exactly this list.
    exits: ["reject", "request_analysis", "assign_owner", "propose_pilot"],
  },
  {
    state: "analysis_requested",
    entry: "Owner asks for adjusted or sensitivity analysis",
    allowedActivity: "Run predeclared analysis plan",
    // p35's Exit cell for this state names one thing and only one. A reject
    // from here would be a shortcut around the evidence that was asked for.
    exits: ["return_with_evidence"],
  },
  {
    state: "clinical_review",
    entry: "Signal may affect program content",
    allowedActivity: "Clinical reviewer comments and sets limits",
    exits: ["reject", "advance"],
  },
  {
    state: "fairness_review",
    entry: "Protected-group impact or disparity is present",
    allowedActivity: "Assess benefit, harm, access and alternatives",
    exits: ["reject", "mitigate", "advance"],
  },
  {
    state: "pilot_proposed",
    entry: "Question and test design approved",
    allowedActivity: "Create bounded pilot protocol",
    exits: ["approve", "revise", "reject"],
  },
  {
    state: "pilot_active",
    entry: "Separate release flag and enrolled cohort",
    allowedActivity: "Monitor safety, quality and stop rules",
    exits: ["stop", "complete"],
  },
  {
    state: "decision_recorded",
    entry: "Pilot result reviewed",
    allowedActivity: "Document adopt, do not adopt or retest",
    exits: ["archive"],
  },
  {
    state: "retired",
    entry: "Definition or evidence obsolete",
    allowedActivity: "Read only",
    // p35: "No reactivation; create new version." An empty exit list is that
    // sentence, and it is why `reject` lands here — the eight states are the
    // whole vocabulary, so a rejected signal is a retired one, and the reason
    // survives on the transition row rather than in a ninth state.
    exits: [],
    terminal: true,
  },
];

export function stateDef(state: SignalState): StateDefinition {
  const s = STATES.find((x) => x.state === state);
  if (!s) throw new Error(`unknown planning-signal state "${state}" — p35 defines eight`);
  return s;
}

/** What a signal needs to know about itself for the machine to route it. */
export interface SignalRouting {
  /** p35's entry condition for Clinical review. True when the signal's output
   *  could change what a person is offered — which is a property of the RULE,
   *  not of whoever is looking at it. */
  affectsProgramContent: boolean;
  /** p35's entry condition for Fairness review. */
  protectedGroupImpact: boolean;
}

/**
 * Where `advance` and `propose_pilot` go from here.
 *
 * p35 gives three states an entry CONDITION rather than a fixed predecessor,
 * so the next state is a property of the signal. The order is p35's own: a
 * signal that could change programme content is seen by a clinical reviewer
 * before anyone proposes a pilot, and one with protected-group impact is seen
 * by fairness review before that.
 *
 * A signal with neither condition goes straight to Pilot proposed — and that
 * is not a loophole, it is what "entry: signal may affect program content"
 * means. A rule about slot capacity does not need a clinical reviewer.
 */
export function advanceTarget(from: SignalState, r: SignalRouting): SignalState | null {
  const order: SignalState[] = ["draft", "clinical_review", "fairness_review", "pilot_proposed"];
  const i = order.indexOf(from);
  if (i < 0) return null;
  for (const next of order.slice(i + 1)) {
    if (next === "clinical_review" && !r.affectsProgramContent) continue;
    if (next === "fairness_review" && !r.protectedGroupImpact) continue;
    return next;
  }
  return null;
}

/** The state an action lands in, or null if the action is not an exit from
 *  `from`. The single source of truth for both the API and the screen. */
export function transition(from: SignalState, action: ReviewAction, r: SignalRouting): SignalState | null {
  if (!stateDef(from).exits.includes(action)) return null;
  switch (action) {
    // A rejected signal is retired: p35 has no ninth state, and "no
    // reactivation; create new version" is exactly the right disposal for
    // something a reviewer has said no to.
    case "reject": return "retired";
    case "request_analysis": return "analysis_requested";
    case "return_with_evidence": return "draft";
    // State-preserving. p44 lists it among the allowed next actions and it
    // records accountability rather than movement.
    case "assign_owner": return from;
    case "propose_pilot":
    case "advance": return advanceTarget(from, r);
    // Mitigation is work done INSIDE fairness review — p35's exit cell reads
    // "reject, mitigate or advance", and mitigating is what makes advancing
    // possible rather than being an alternative to it.
    case "mitigate": return from;
    case "approve": return "pilot_active";
    case "revise": return "draft";
    case "stop":
    case "complete": return "decision_recorded";
    case "archive": return "retired";
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Who may act
// ---------------------------------------------------------------------------

/**
 * Roles that may move a signal at all, from p50's `planning_review` row.
 *
 * Reviewer is "yes" and demo admin is "yes"; clinician, organization and payer
 * are "subset", which is a READ grant — they see planning output that concerns
 * them and do not decide its lifecycle. Member is "no" and does not reach the
 * console.
 */
const TRANSITION_ROLES: readonly Role[] = ["reviewer", "demo_admin"] as const;

export function mayTransition(role: Role): boolean {
  return TRANSITION_ROLES.includes(role);
}

/**
 * Who may complete a CLINICAL review.
 *
 * p35 gives clinical review its own state so that the person who set the
 * thresholds is not automatically the person who judges whether a signal may
 * affect programme content. In this environment the owner holds both, by their
 * own signature — recorded in `PLANNING_OWNER`, with the reason it is
 * acceptable here and not in a deployment with patients in it.
 *
 * The check is written as a check rather than assumed, so that the day the two
 * roles separate, this function is the only thing that changes.
 */
export function mayCompleteClinicalReview(role: Role): boolean {
  if (!PLANNING_OWNER.scope.includes("clinical_review")) return role === "clinician";
  return mayTransition(role) || role === "clinician";
}

/**
 * p49's `allowed_actions`, computed on the server after policy evaluation.
 *
 * Three filters, in order: the state's own exits (p35), the role's authority
 * (p50), and the clinical-review signature (`PLANNING_OWNER`). A blocked
 * action can never appear here because it is not in `ReviewAction` at all —
 * the two sets are different types, so widening one cannot accidentally widen
 * the other.
 */
export function allowedActions(
  state: SignalState, role: Role, routing: SignalRouting,
): ReviewAction[] {
  if (!mayTransition(role)) return [];
  const def = stateDef(state);
  return def.exits.filter((a) => {
    // An advance out of clinical review is the sign-off itself.
    if (state === "clinical_review" && a === "advance" && !mayCompleteClinicalReview(role)) return false;
    // Offer nothing that goes nowhere: a propose_pilot from a draft whose
    // routing sends it to no next state would be a button that does nothing.
    if ((a === "advance" || a === "propose_pilot") && transition(state, a, routing) === null) return false;
    return true;
  });
}

/** Whether a posted action may be performed. The API calls this rather than
 *  trusting the list the client was given, which is the whole of p49's rule. */
export function actionPermitted(
  state: SignalState, role: Role, routing: SignalRouting, action: string,
): action is ReviewAction {
  return (allowedActions(state, role, routing) as string[]).includes(action);
}

/** Whether a posted action is one of the three this subsystem refuses
 *  outright. Separated from "not allowed" because the two deserve different
 *  answers: an action that is merely unavailable in this state may become
 *  available later, and these never will. */
export function isBlockedAction(action: string): action is BlockedAction {
  return (BLOCKED_ACTIONS as readonly string[]).includes(action);
}

export const ACTION_LABELS: Record<ReviewAction, string> = {
  reject: "Reject",
  request_analysis: "Request analysis",
  return_with_evidence: "Return to draft with evidence",
  assign_owner: "Assign owner",
  propose_pilot: "Propose pilot",
  advance: "Advance",
  mitigate: "Record mitigation",
  approve: "Approve pilot",
  revise: "Revise",
  stop: "Stop pilot",
  complete: "Complete pilot",
  archive: "Archive",
};
