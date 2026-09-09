// The command contract (handoff 09 §9, Package 1).
//
// Two rows of §9's table, and the reason column on each is the specification:
//
//   Command input — "Intent, target, payload, idempotency key, expected
//   version; actor and tenant resolved from the authenticated request."
//   Because "an envelope carrying submitted authority fields invites trusting
//   them."
//
//   Command result — "Distinguish confirmed, rejected, stale, unavailable,
//   indeterminate." Because "a failed network acknowledgement is not proof
//   that no write occurred."
//
// THE INPUT TYPE HAS NO ACTOR FIELD. Not an optional one, not a nullable one,
// not one the server overwrites — the field does not exist. A shape with
// `actorId?: string` is a shape somebody eventually populates from a form, and
// the code that does it will look reasonable. `resolveCommand` below is the
// only way to get from an input to something executable, and it takes the
// authenticated context as a separate argument.
//
// AND `indeterminate` IS THE STATE THAT MATTERS. Four of the five outcomes are
// answers. The fifth is the honest admission that Steady does not know whether
// the write landed — a timeout after the request left, a connection dropped
// mid-response. §9: "An indeterminate response should reconcile by idempotency
// key before inviting retry." A system with four outcomes reports that case as
// a failure, the person retries, and the action happens twice. In this product
// that is a duplicated clinical record or a second safety escalation.

import type { ExperienceContext } from "./context";

/**
 * What the caller is asking for.
 *
 * `intent` is a verb the domain already owns. This layer does not invent
 * commands; it carries them, so the vocabulary stays wherever the rule lives.
 */
export interface CommandInput<P = Record<string, unknown>> {
  intent: string;
  /** What it acts on — a person id, a signal id, a snapshot id. */
  target: string;
  payload: P;
  /** §9: retry must not create a duplicate. Supplied by the caller so a retry
   *  of the SAME user action carries the same key; generated per action rather
   *  than per request. */
  idempotencyKey: string;
  /** The version of the target the caller believed it was acting on. §5:
   *  "Reconcile with the server before accepting a decision." A command with
   *  no expected version cannot detect that somebody else moved first. */
  expectedVersion?: string | null;
}

/** A command with its authority attached, which only the server can make. */
export interface ResolvedCommand<P = Record<string, unknown>> extends CommandInput<P> {
  /** From the authenticated request. Never from the input. */
  actorPersonId: string;
  /** From the session. Never from the input. */
  tenantId: string;
  receivedAt: string;
}

export type CommandOutcome =
  /** The server did it and says so. */
  | "confirmed"
  /** The server refused, for a reason a person can read. */
  | "rejected"
  /** Somebody else moved first; the caller was acting on an old version. */
  | "stale"
  /** The capability is not available here. Distinct from rejected: nothing was
   *  wrong with the request (§8.4 — never imply a zero value). */
  | "unavailable"
  /** Steady does not know whether the write landed. */
  | "indeterminate";

export interface CommandResult<R = unknown> {
  outcome: CommandOutcome;
  /** What changed, on `confirmed` only. §5: "Show exactly what the action
   *  changed after the server confirms it" — so a surface that has not been
   *  handed this cannot claim anything happened. */
  result?: R;
  /** Why, for every outcome that is not `confirmed`. In words a person reads. */
  reason?: string;
  /** `stale` only: what the server currently holds, so the caller can show a
   *  comparison rather than just refusing. §7.1: "reject the stale submission
   *  with a comparison and a clear review-again route." */
  currentVersion?: string;
  /** `indeterminate` only: the key to reconcile with before retrying. */
  reconcileBy?: string;
  /** For the person to quote to support. */
  correlationId?: string;
}

export class CommandError extends Error {}

/**
 * Attach authority to an input.
 *
 * THE ONLY WAY TO GET A `ResolvedCommand`, and it takes the context as its
 * first argument — so a call site that has not authenticated cannot construct
 * one. The input is checked here rather than trusted: an input carrying an
 * `actorId` or a `tenantId` is not silently ignored, it is refused, because a
 * client sending one is a client that believes it can set one.
 */
export function resolveCommand<P extends Record<string, unknown>>(
  ctx: ExperienceContext, input: CommandInput<P>
): ResolvedCommand<P> {
  const smuggled = ["actorId", "actorPersonId", "tenantId", "role", "audience", "personId"]
    .filter((k) => k in (input.payload as Record<string, unknown>));
  if (smuggled.length > 0) {
    throw new CommandError(
      `A command payload carried authority fields (${smuggled.join(", ")}). ` +
      "Actor and tenant are resolved from the authenticated request; a payload that supplies them is refused rather than overwritten."
    );
  }
  if (!input.intent.trim()) throw new CommandError("A command needs an intent.");
  if (!input.target.trim()) throw new CommandError("A command needs a target.");
  if (!input.idempotencyKey.trim()) {
    throw new CommandError(
      "A command needs an idempotency key. Without one a retry cannot be told from a second action."
    );
  }
  return {
    ...input,
    actorPersonId: ctx.personId,
    tenantId: ctx.tenantId,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * A stable key for one user action.
 *
 * DERIVED FROM THE ACTION, not from the moment. A key containing a timestamp
 * makes every retry a new action, which is the failure the key exists to
 * prevent. The nonce is the caller's own idea of "this press of this button" —
 * a form's mount id, a row's version — and stays constant across retries of it.
 *
 * NOT A HASH, AND DELIBERATELY SO. The first version ran the parts through
 * sha256, which looked tidier and made this module unusable from a client
 * component — `node:crypto` is not in the browser, and the control that presses
 * the button is where the key has to be made. A joined string is exactly as
 * stable, works everywhere, and has the advantage that a key in a log says what
 * action it belongs to.
 *
 * The parts are escaped rather than trusted: a target containing the separator
 * would let two different actions collide on one key, which is the one failure
 * this function must not have.
 */
export function commandKey(args: {
  intent: string; target: string; actorPersonId: string; nonce: string;
}): string {
  const part = (v: string) => v.replace(/[|\\]/g, (c) => `\\${c}`);
  return [args.intent, args.target, args.actorPersonId, args.nonce].map(part).join("|");
}

// ---------------------------------------------------------------------------
// Constructors — one per outcome, so an outcome is chosen rather than defaulted
// ---------------------------------------------------------------------------

export function confirmed<R>(result: R): CommandResult<R> {
  return { outcome: "confirmed", result };
}

export function rejected(reason: string): CommandResult<never> {
  if (!reason.trim()) throw new CommandError("A refusal must say why.");
  return { outcome: "rejected", reason };
}

export function stale(reason: string, currentVersion: string): CommandResult<never> {
  if (!currentVersion.trim()) {
    throw new CommandError(
      "A stale result must carry what the server currently holds, so the caller can show a comparison rather than only a refusal."
    );
  }
  return { outcome: "stale", reason, currentVersion };
}

export function unavailable(reason: string): CommandResult<never> {
  if (!reason.trim()) throw new CommandError("An unavailable capability must name the reason.");
  return { outcome: "unavailable", reason };
}

/**
 * Steady does not know whether the write landed.
 *
 * `reconcileBy` is required. §9: "An indeterminate response should reconcile by
 * idempotency key before inviting retry" — an indeterminate result with no key
 * to reconcile against leaves the caller with nothing to do but guess, and the
 * guess that feels safe (retry) is the one that duplicates.
 */
export function indeterminate(
  reason: string, reconcileBy: string, correlationId?: string
): CommandResult<never> {
  if (!reconcileBy.trim()) {
    throw new CommandError(
      "An indeterminate result must carry the idempotency key to reconcile by. Without it the only available action is a blind retry."
    );
  }
  return { outcome: "indeterminate", reason, reconcileBy, correlationId };
}

/** Whether a surface may say something changed. Only one outcome permits it. */
export function mayClaimChange(r: CommandResult): boolean {
  return r.outcome === "confirmed";
}

/** Whether a plain retry is safe. It never is on `indeterminate`: reconcile
 *  first (§9). */
export function mayRetryDirectly(r: CommandResult): boolean {
  return r.outcome === "rejected" || r.outcome === "stale";
}

export const OUTCOME_LABEL: Record<CommandOutcome, string> = {
  confirmed: "Done",
  rejected: "Not done",
  stale: "Somebody else changed this first",
  unavailable: "Not available here",
  indeterminate: "Steady could not confirm this",
};

export const OUTCOME_NOTE: Record<CommandOutcome, string> = {
  confirmed: "The server confirmed it. What changed is shown below.",
  rejected: "The server refused, and the reason is below. Nothing was written.",
  stale: "The version you were acting on is no longer current. Read what changed before deciding again.",
  unavailable: "Nothing was wrong with what you asked for; this capability does not exist in this build.",
  indeterminate:
    "The request left and no answer came back, so Steady cannot say whether it landed. Do not repeat it — the state is being reconciled, and repeating it is how one action becomes two records.",
};
