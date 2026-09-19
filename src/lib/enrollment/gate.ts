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
import { readTier, mayAdmitParticipant, type TierReading } from "../governance/environment-policy";

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
 * The environment's tier, read rather than declared.
 *
 * ENROLLMENT BEING OPEN IS AN INTENTION; THE GATES PASSING IS THE EVIDENCE.
 * Until this existed, one environment variable was the whole distance between
 * a demonstration and a deployment holding real people's clinical records —
 * and which side of that line a deployment stood on was something a reader had
 * to infer from a banner. UX 008 is exactly that: "pilot-account language
 * conflicts with fabricated-only policy statements".
 *
 * RESOLVED HERE, SO EVERY CALLER GETS THE SAME ANSWER. The signup page, the
 * admin screen and the review console were each free to read
 * `enrollmentOpen()` and decide for themselves what it meant.
 *
 * FAILS TOWARD FABRICATED-ONLY. Anything that cannot be resolved — a gate with
 * no evidence, a database this cannot open — reads as not-passing, so the
 * direction of every uncertainty is away from admitting a real participant.
 */
export async function environmentTier(): Promise<TierReading> {
  const gatePassed: Record<string, boolean> = {};
  try {
    const [{ getDb }, { resolveEvidence }] = await Promise.all([
      import("../db"),
      import("../review/gates"),
    ]);
    for (const [id, ev] of resolveEvidence(getDb())) gatePassed[id] = ev.status === "pass";
  } catch {
    // Left empty on purpose: an unreadable gate table is not a passing one.
  }
  return readTier({ enrollmentOpen: enrollmentOpen(), gatePassed });
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
  /** Whether the signup route admits anybody. Still CONFIGURATION, and the
   *  next paragraph is why it is not yet the tier.
   *
   *  NOT WIRED TO `permittedByTier`, DELIBERATELY, AND THIS IS THE WHOLE NOTE.
   *  The obvious change is `open: configured && permittedByTier`, and it was
   *  written, tested, and then taken back out — because two of the five gates
   *  the pilot requires are ATTESTED, `resolveEvidence` returns `unavailable`
   *  for every attested gate unconditionally, and NOTHING ANYWHERE RECORDS AN
   *  ATTESTATION. So that one line does not mean "gates first". It means
   *  enrollment is closed permanently, in every deployment, with no
   *  configuration that reopens it — and it takes the enrollment suite's
   *  refusals down with it: a wrong access code, an unticked acknowledgement
   *  and a minor at account creation are all proven by driving a flow that
   *  would no longer run.
   *
   *  A one-way door that also deletes the evidence for three safety refusals
   *  is not a check, so the tier is REPORTED here and consulted by nobody until
   *  an attestation can be recorded. `permittedByTier` is the value that line
   *  needs, already computed and already tested, so wiring it is one word once
   *  somebody decides who may attest. */
  open: boolean;
  /** What the environment policy says, separately from what is configured.
   *  False today in every deployment, and the reason is above. */
  permittedByTier: boolean;
  /** A code is set. The operator's intention, separate from whether the
   *  environment has earned it, because "nobody configured a pilot" and "a
   *  pilot is configured and a safety gate is failing" are different facts and
   *  a screen that rendered them identically would hide the second. */
  configured: boolean;
  /** Why, when `open` is false despite being configured. */
  tier: TierReading;
  enrolled: number;
  limit: number;
  remaining: number;
  full: boolean;
}

/** The gate's state, for a screen to render rather than re-derive. */
export async function enrollmentState(): Promise<EnrollmentState> {
  const configured = enrollmentOpen();
  const tier = await environmentTier();
  const enrolled = await enrolledCount();
  return {
    open: configured,
    permittedByTier: mayAdmitParticipant(tier),
    configured,
    tier,
    enrolled,
    limit: ENROLLMENT_LIMIT,
    remaining: Math.max(0, ENROLLMENT_LIMIT - enrolled),
    full: enrolled >= ENROLLMENT_LIMIT,
  };
}

/** The pilot's own tenant id. Derived rather than random, so it is the same
 *  value on every machine and after every reset. */
export const PILOT_TENANT_ID = "PILOT0000000000000000000000";

/**
 * The tenant enrolled people belong to, created if it is not there.
 *
 * THEY GET THEIR OWN, AND THE REASON IS A GUARD THAT CAUGHT ME. The first
 * version put enrollees in NE Care Network A so the demo clinician's caseload
 * would show them — and every aggregate screen for that organization began
 * answering 500:
 *
 *   cohort "all_eligible.v1" spans 42 fabricated people and 1 real ones.
 *   A metric over both is a number nobody can interpret: it is neither a
 *   finding about the study nor a demonstration of the product.
 *
 * `assertSingleProvenance` is right, and it refuses rather than filters on
 * purpose: a filtered metric has an undisclosed denominator, and the reader
 * cannot tell a suppressed population from a small one. So the fix is the one
 * it asks for — scope the query to one population — done at the tenant, which
 * is what every cohort is drawn from.
 *
 * IT IS ALSO THE RIGHT ANSWER FOR THE PILOT ITSELF. What a pilot is for is
 * reading what real people did, and that is a different question from what the
 * fabricated population demonstrates. Mixing them would have produced one
 * number answering neither.
 */
export async function pilotTenantId(): Promise<string> {
  const { getDb, ensurePilotRows } = await import("../db");
  // ONE IMPLEMENTATION, CALLED FROM TWO PLACES. `reconcilePilot` also runs on
  // every boot — see the note on it — and having this path do its own inserts
  // would be two definitions of the pilot's own tenant that could drift.
  ensurePilotRows(getDb());
  return PILOT_TENANT_ID;
}

/** The pilot's clinician account. */
export const PILOT_CLINICIAN_ID = "PILOTCLIN00000000000000000";
export const PILOT_CLINICIAN_EMAIL = "clinician.pilot@steady.local";

/**
 * A clinician who can actually see the pilot.
 *
 * WITHOUT ONE THE TENANT IS A DEAD END. Every clinical surface resolves its
 * scope from `users.tenant_id` — the caseload, the attention queue, the person
 * record — so a tenant with members and no clinician holds people nobody can
 * open. Separating the pilot from the fabricated population was right and it
 * left exactly that.
 *
 * NOT `clinician.demo`, AND THAT IS NOT A CHOICE. A clinician belongs to one
 * tenant, and moving the demo clinician here would empty the caseload of
 * forty-two fabricated people that the whole demonstration rests on. Two
 * populations need two clinicians; it is the same reason they needed two
 * tenants.
 */
export async function ensurePilotClinician(): Promise<string> {
  await pilotTenantId();
  return PILOT_CLINICIAN_ID;
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
