// Getting a pilot participant back into their account.
//
// THERE WAS NO WAY BACK IN, AT ALL. `hashPassword` is called in exactly three
// places and every one of them is account CREATION — signup, enrollment, demo
// seeding. No code path in the product changed an existing password. `/reset`
// refuses honestly, for want of an email channel to send a link through, and
// nothing even links to it. So a participant who forgot the password they set
// once was out permanently, and the operator's only remedy was to enrol them
// again: a second person row, their answers split across two identities, and
// one of twenty-five places burnt.
//
// AN OPERATOR, NOT AN EMAIL LINK. A reset link needs a delivery channel this
// deployment does not have, and inventing one for a pilot of twenty-five
// people who are in a room with the operator would be building the harder
// thing to avoid saying who is trusted. The operator is trusted; the audit row
// is what makes that a statement somebody can check afterwards.
//
// WHICH IS WHY THE SCOPE IS NARROW. This reaches members of the pilot tenant
// whose provenance is 'real' and nothing else — not the demo clinician, not
// the fabricated population, not another operator. An operator who can set any
// account's password can sign in as it and read that person's safety answers,
// so the set of accounts reachable from here is kept to the people this
// control exists for.
//
// THE PASSWORD IS TYPED BY THE OPERATOR, not generated and shown back. A
// generated secret has to be displayed once, which means it travels in a
// redirect, a query string, browser history and whatever logs sit in between.
// The operator is going to say the new password out loud to somebody standing
// beside them either way; having them type it keeps it out of every one of
// those places.

import { audit } from "../audit";
import { data } from "../data";
import { hashPassword } from "../db";
import { PASSWORD_RESET_EVENT } from "../auth-lockout";
import { PILOT_TENANT_ID } from "./gate";

/** Same floor as enrollment. A reset that accepted a weaker password than the
 *  signup form would quietly become the way to get one. */
export const MIN_PASSWORD = 8;

/** A refusal a person reads, not a state a client branches on. */
export class PilotAccessError extends Error {}

export interface ResetResult {
  name: string;
  email: string;
  /** Failed sign-ins that were still counting against them, and now are not.
   *  Reported because "I reset it and it still will not let me in" is the
   *  question this control exists to stop being asked. */
  clearedFailures: number;
}

/**
 * Set a pilot participant's password, and let them try again.
 *
 * The audit row is the point as much as the update is: it names the operator,
 * the account, and the moment — and `failedSignInsAgainst` reads it as the
 * lower bound for counting failures, so the same row that records the reset is
 * the one that lifts the lockout. One fact, written once, doing both jobs; a
 * separate "unlock" flag could disagree with the reset that caused it.
 */
export async function resetParticipantPassword(args: {
  operatorId: string;
  personId: string;
  newPassword: string;
}): Promise<ResetResult> {
  if (args.newPassword.length < MIN_PASSWORD) {
    throw new PilotAccessError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
  }

  const c = await data();
  // THE SCOPE IS THE QUERY, not a check beside it. A row that does not match
  // every clause is not found, so a clinician id, a demo account or a person
  // from the fabricated tenant lands in the same refusal as a typo.
  const row = (await c.get(
    `SELECT u.id, u.email, u.name
       FROM users u JOIN persons p ON p.id = u.id
      WHERE u.id = ? AND u.tenant_id = ? AND u.role = 'member' AND p.provenance = 'real'`,
    [args.personId, PILOT_TENANT_ID],
  )) as { id: string; email: string; name: string } | undefined;

  if (!row) {
    throw new PilotAccessError("That account is not a pilot participant, so this control does not reach it.");
  }

  // Read the count BEFORE the reset row is written — afterwards it is zero by
  // construction, and reporting zero would tell the operator nothing.
  const { failedSignInsAgainst } = await import("../auth-lockout");
  const clearedFailures = await failedSignInsAgainst(row.email);

  await c.run("UPDATE users SET password_hash = ? WHERE id = ?", [
    hashPassword(args.newPassword),
    row.id,
  ]);

  // TARGET IS THE ADDRESS, because that is what the lockout counts by. A row
  // targeting the person id would record the reset perfectly and lift nothing.
  //
  // The password is not in here, and no `detail` field is a near-miss for it:
  // its length, its shape and whether it was reused all narrow it.
  await audit({
    actorId: args.operatorId,
    actorRole: "demo_admin",
    family: "identity",
    type: PASSWORD_RESET_EVENT,
    target: row.email,
    detail: { personId: row.id, clearedFailures },
  });

  return { name: row.name, email: row.email, clearedFailures };
}
