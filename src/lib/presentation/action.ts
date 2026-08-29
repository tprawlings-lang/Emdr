// The action response contract (Web GUI handoff §30.4, §15.1, §15.3, §27.5).
//
// §30.4: "The server returns committedEventId, projectionVersion, auditEventId,
// resultingState and any required follow-up. The client does not show
// completion before commit."
//
// §15.1 is the rule underneath it: "Approve, correct, override, contact
// confirmation, safety review, and notification delivery must wait for server
// confirmation." An optimistic update on a clinical action is a lie with a
// spinner — the clinician reads "done", moves on, and the write may not have
// landed. On a safety response that is the difference between a documented
// response and an undocumented one.
//
// This module is why that is awkward to get wrong: a successful result cannot
// be constructed without the ids that prove the commit happened. There is no
// `{ ok: true }` to return early with.
//
// Note what is deliberately absent: no action type here can clear a safety
// stop. §27.5 — "Safety stops have no ordinary override action. Re-entry is a
// new fixed-rule evaluation, not a clinician button that clears history."

/** §27.5's action set, plus the member-side actions that also commit. */
export type ActionType =
  | "acknowledge"
  | "review"
  | "assign"
  | "handoff"
  | "correct"
  | "approve_model_text"
  | "document_safety_response"
  | "contact"
  | "export";

/** Actions that may not complete optimistically (§15.1).
 *
 *  Everything that changes a clinical record, an ownership, or an
 *  attestation. Expanding a drawer or changing a filter is not here, because
 *  those may update immediately — §15.1 says so explicitly. */
export const HIGH_IMPACT: ActionType[] = [
  "review", "assign", "handoff", "correct",
  "approve_model_text", "document_safety_response", "export",
];

export function isHighImpact(a: ActionType): boolean {
  return HIGH_IMPACT.includes(a);
}

/** Work the action created that somebody must still do.
 *
 *  §30.4 calls this "any required follow-up". Returning it with the result is
 *  what stops a handoff from being accepted into silence. */
export interface FollowUp {
  kind: string;
  description: string;
  ownerId: string | null;
  dueAt: string | null;
}

/** Proof that the action committed.
 *
 *  All four ids are required. A result missing the audit event id means the
 *  action happened and was not recorded, which §30.6 step 7 treats as a
 *  fail-closed condition rather than a warning. */
export interface ActionResult {
  action: ActionType;
  committedEventId: string;
  auditEventId: string;
  /** The version of the projection the client should now render. */
  projectionVersion: string;
  effectiveAt: string;
  /** The state the subject is in after the commit, for the client to render
   *  rather than infer. */
  resultingState: string;
  followUp: FollowUp[];
  /** §30.4/§15.3: a downstream delivery that did NOT succeed is part of the
   *  result, not a silent omission. Empty when everything landed. */
  failedDeliveries: Array<{ channel: string; reason: string }>;
}

export class ActionContractError extends Error {}

/** Build a result, refusing one that cannot prove it committed.
 *
 *  Runtime rather than type-only because the ids arrive as strings from a
 *  service call, and "" is a string. The check that matters is not that the
 *  field exists but that it holds something. */
export function committed(r: ActionResult): ActionResult {
  const missing = (["committedEventId", "auditEventId", "projectionVersion", "effectiveAt"] as const)
    .filter((k) => !String(r[k] ?? "").trim());
  if (missing.length) {
    throw new ActionContractError(
      `action "${r.action}" reported success without ${missing.join(", ")}. ` +
      "§30.4 requires the committed event, the audit event, the projection version and the " +
      "effective time; a result missing any of them cannot show the user completion."
    );
  }
  return r;
}

/** Idempotency key for an action (§30.4: "Idempotency key required").
 *
 *  Derived from the actor, the subject, the action and a caller-supplied nonce
 *  so a double submit — the second click on a slow review button — resolves to
 *  one commit rather than two review records against one piece of evidence. */
export function idempotencyKey(args: {
  actorId: string; subjectId: string; action: ActionType; nonce: string;
}): string {
  return `${args.action}:${args.actorId}:${args.subjectId}:${args.nonce}`;
}
