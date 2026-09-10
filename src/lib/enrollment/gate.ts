// Who may create an account here, and how many (the enrollment gate).
//
// WHAT THIS REOPENS, AND WHAT IT DOES NOT. §12 closed public enrollment
// because the form took a name, an email address and a date of birth from
// whoever found the page. This puts a lock on that door rather than leaving it
// shut: a shared code, a hard cap, and a count anybody can read. It is a pilot
// gate, not a return to retail signup, and every refusal below is what keeps
// those two different.
//
// THE CONSEQUENCE, STATED PLAINLY because the code cannot state it: once this
// is configured, REAL PEOPLE'S ANSWERS LIVE HERE. Not just names and addresses
// — the fitness screener asks whether somebody has had suicidal thoughts in the
// past thirty days, and the daily check-in asks about harm urges, dissociation
// and substance use. That is sensitive health information about identifiable
// people, in an environment whose own banner says it is not monitored in real
// time and not cleared for clinical use. Both facts can be true and the second
// one is the one a person signing up needs to have read.
//
// So the gate does three things, and the third is the one that is easy to skip:
//
//   1. Refuses without the code.
//   2. Refuses past the cap.
//   3. Makes the count visible, so nobody has to guess how much real data is
//      in here before deciding what to do with the environment.
//
// A SHARED CODE IS A WEAK CREDENTIAL and is meant to be. It stops the open
// internet, not a determined person, and it cannot tell two holders apart —
// which is why the cap is a hard number rather than a rate limit, and why the
// audit records every account it lets through.

import crypto from "node:crypto";

import { data } from "../data";

/** How many real people may enrol against one code. */
export const ENROLLMENT_LIMIT = 25;

/**
 * Is enrollment configured at all?
 *
 * UNSET MEANS CLOSED, which is the same convention the review gateway uses and
 * the safe direction for a variable somebody forgets to set. A deployment that
 * has never heard of this stays exactly as it was.
 *
 * Read at CALL TIME rather than captured at module load: a constant evaluated
 * on import is baked into the build, so an image built with the variable set
 * would carry enrollment open into every environment it was deployed to.
 */
export function enrollmentOpen(): boolean {
  return Boolean(process.env.EMDR_ENROLLMENT_CODE);
}

/**
 * Constant-time comparison, so a wrong code cannot be discovered by timing.
 *
 * The same shape as `verifyAccessCode` in lib/site/review-access.ts, and
 * deliberately a SEPARATE variable: reading the review environment and creating
 * an account in it are different permissions, and one code for both would mean
 * every reviewer who was ever sent a link can enrol.
 */
export function verifyEnrollmentCode(supplied: string): boolean {
  const expected = process.env.EMDR_ENROLLMENT_CODE;
  if (!expected) return false;
  const a = Buffer.from(supplied.trim());
  const b = Buffer.from(expected);
  // Length is compared first because timingSafeEqual throws on a mismatch.
  // It leaks the length of the code, which is not the secret.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * How many real people have accounts here.
 *
 * PROVENANCE, NOT AN EMAIL SHAPE. `persons.provenance` is already the column
 * that separates somebody who filled in a form from a generated profile, it is
 * enforced by a trigger, and `demo-quality.ts` already reports on it — "Real
 * people in this environment: reported, not asserted — a human signup is
 * legitimate here". Counting by address pattern would have been a second,
 * disagreeing definition of the same thing.
 */
export async function enrolledCount(): Promise<number> {
  const c = await data();
  const row = (await c.get(
    "SELECT COUNT(*) AS n FROM persons WHERE provenance = 'real'"
  )) as { n: number } | undefined;
  return row?.n ?? 0;
}

export interface EnrollmentState {
  open: boolean;
  enrolled: number;
  limit: number;
  remaining: number;
  full: boolean;
}

/** The gate's state, for a screen to render rather than re-derive. */
export async function enrollmentState(): Promise<EnrollmentState> {
  const open = enrollmentOpen();
  const enrolled = await enrolledCount();
  return {
    open,
    enrolled,
    limit: ENROLLMENT_LIMIT,
    remaining: Math.max(0, ENROLLMENT_LIMIT - enrolled),
    full: enrolled >= ENROLLMENT_LIMIT,
  };
}

export type GateVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The one question both doors ask.
 *
 * BOTH DOORS, and that is the point of it living here. §12 closed `/signup` on
 * the web and left `POST /api/mobile/v1/auth/signup` creating accounts with no
 * code and no cap — a gate on one of two doors is a sign, not a gate. This is
 * called from each, so a third door cannot be added without meeting it.
 *
 * The refusals do not distinguish "no code" from "wrong code", because the two
 * together tell somebody guessing whether a code exists to guess at.
 */
export async function checkEnrollment(suppliedCode: string): Promise<GateVerdict> {
  if (!enrollmentOpen()) {
    return {
      ok: false,
      reason: "Enrollment is closed. Scoped access is arranged through a review request.",
    };
  }
  if (!verifyEnrollmentCode(suppliedCode)) {
    return { ok: false, reason: "That access code is not valid." };
  }
  const enrolled = await enrolledCount();
  if (enrolled >= ENROLLMENT_LIMIT) {
    // Says the number. A cap that refuses without saying what it is reads as a
    // fault, and the person on the other side has no way to tell whether
    // waiting or asking is the right move.
    return {
      ok: false,
      reason:
        `This pilot is full — all ${ENROLLMENT_LIMIT} places are taken. ` +
        "Ask for a review request instead.",
    };
  }
  return { ok: true };
}

/**
 * Whether this account describes a real person.
 *
 * ADDED BECAUSE A SCREEN WAS LYING. The demo shell labels whoever is signed in
 * "Fabricated persona: <name>", which is right for the seeded population and
 * for the onboarding walkthrough, and false for somebody who enrolled — it told
 * a real person their own name was invented, and told anyone reading over their
 * shoulder that real answers on the screen were synthetic. Both directions of
 * that are wrong, and the second one is worse.
 *
 * Absent means fabricated: every seeded person has a row, so a missing one is a
 * lookup that failed rather than evidence about a human being, and the shell's
 * existing label is the safe thing to fall back to.
 */
export async function personIsReal(userId: string): Promise<boolean> {
  const c = await data();
  const row = (await c.get(
    "SELECT provenance FROM persons WHERE id = ?", [userId]
  )) as { provenance: string } | undefined;
  return row?.provenance === "real";
}
