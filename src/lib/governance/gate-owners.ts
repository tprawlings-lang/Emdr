// Who may sign each attested gate.
//
// DECIDED 19 SEPTEMBER: a named individual per gate, not any reviewer. p99
// already gives every gate an owner — "Security", "Product and QA" — and a
// team is not a signature. The gates that matter here decide whether a
// deployment may hold real people, and "somebody in Security approved it" is
// not a thing anybody can follow up.
//
// UNNAMED MEANS ANY REVIEWER, AND THE SCREEN SAYS SO. That is a decision
// rather than a default: refusing every sign-off until three names exist would
// be the same one-way door this codebase has now walked into twice — a gate
// that cannot pass closes enrollment permanently, and the second time it was
// harder to see because the other gates were green. So an unnamed gate keeps
// today's behaviour and the release console states plainly that no owner is
// set for it. A rule that was never set must not look identical to a rule that
// was; that is exactly how the sign-off gap survived unnoticed.
//
// NAMES ARE NOT FILLED IN HERE YET, deliberately. Writing a plausible name
// would be this codebase inventing who is accountable for whether a keyboard
// path is blocked, which is the one thing it must not do. Each is null until
// somebody says.

export interface GateOwner {
  /** As it should appear beside the signature. */
  name: string;
  /** Matched against the signing account. The email is the identity the
   *  product actually holds; a display name is not unique and changes. */
  email: string;
}

/**
 * Gate id -> the individual who may sign it, or null while nobody is named.
 *
 * EVERY ATTESTED GATE APPEARS, including the unnamed ones. A map that only
 * listed the configured gates could not tell "no owner is set" from "this gate
 * is not attestable", and the screen has to say the first one out loud.
 */
export const GATE_OWNERS: Record<string, GateOwner | null> = {
  authorization: null,
  accessibility: null,
  analytics_integrity: null,
};

export type SignerVerdict =
  /** This account is the named owner. */
  | { may: true; reason: "named_owner"; owner: GateOwner }
  /** Nobody is named, so any reviewer may sign — and the screen must say so. */
  | { may: true; reason: "no_owner_named" }
  /** Somebody else is named. */
  | { may: false; reason: "not_the_owner"; owner: GateOwner }
  /** Not a reviewer at all. */
  | { may: false; reason: "not_a_reviewer" }
  /** Not a gate anybody signs. */
  | { may: false; reason: "not_attestable" };

/**
 * May this account sign this gate?
 *
 * RETURNS A VERDICT RATHER THAN A BOOLEAN, because the caller has three
 * different things to say and a boolean collapses them: a refusal names who
 * should sign instead, and a permission granted only because nobody is named
 * has to be labelled as such wherever it is used.
 */
export function signerFor(
  actor: { email: string; role: string },
  gateId: string,
  attestable: boolean,
): SignerVerdict {
  if (!attestable) return { may: false, reason: "not_attestable" };
  if (actor.role !== "reviewer") return { may: false, reason: "not_a_reviewer" };
  const owner = GATE_OWNERS[gateId] ?? null;
  if (!owner) return { may: true, reason: "no_owner_named" };
  // CASE-INSENSITIVE, because an address typed into a configuration file and
  // an address stored at sign-up differ by capitalisation often enough that
  // matching exactly would refuse the right person and name them in the
  // refusal — the most confusing failure available.
  return owner.email.toLowerCase() === actor.email.toLowerCase()
    ? { may: true, reason: "named_owner", owner }
    : { may: false, reason: "not_the_owner", owner };
}

/** What to tell somebody who may not sign. */
export function refusalFor(v: SignerVerdict, gateName: string): string | null {
  if (v.may) return null;
  switch (v.reason) {
    case "not_attestable":
      return `${gateName} is checked by the system, so a signature cannot stand in for the check.`;
    case "not_a_reviewer":
      return "Signing off a release gate needs review access.";
    case "not_the_owner":
      return `${gateName} is signed by ${v.owner.name}. Ask them, rather than signing it here.`;
  }
}

/** Said on the screen wherever a gate has no named owner, so that the absence
 *  of a rule cannot be mistaken for a rule. */
export const NO_OWNER_NAMED =
  "No individual is named for this gate, so any reviewer can sign it. That is the absence of a " +
  "decision rather than a decision: naming somebody is what makes a signature a person to follow " +
  "up rather than a role.";
