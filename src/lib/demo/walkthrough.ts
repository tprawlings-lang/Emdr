// A new patient's onboarding, walked from the beginning (demo only).
//
// WHAT THIS ANSWERS. The four onboarding steps have existed for a long time —
// informed consent, the fitness screener, the baseline instruments, the profile
// and safety plan — and every one of them was reachable only by an account that
// already existed. `/signup` has redirected to `/request-review` since §12 shut
// public enrollment, which was right and is not being undone here. The effect
// nobody intended is that a clinician evaluating this product could read the
// onboarding questions in the source and never once meet them as a patient
// does: in order, on a phone, with the wording and the pacing that actually
// land. That is the half of the product hardest to judge from a description
// and the half a clinician most needs to judge.
//
// WHY IT DOES NOT REOPEN ENROLLMENT. §12 closed a form that took a name, an
// email address and a date of birth from whoever found the page, and wrote them
// into a review environment. THIS TAKES NO INPUT AT ALL. The identity is
// generated from the same dictionaries the 240 fabricated profiles use, the
// address is `@steady.local` (RFC 6762 reserves the TLD, so it can never reach
// an inbox), and the date of birth is synthetic. There is no field to type a
// real name into, which is a stronger guarantee than validating one — a
// validator can be loosened, and an absent field cannot be filled in.
//
// So the contamination §12 exists to prevent cannot happen through this door,
// and that is a property of its SHAPE rather than of anyone's care in using it.
//
// PROVENANCE IS 'fabricated', NOT 'real'. `provisionPerson` stamps 'real'
// because it was written for the signup path, where a human filled in a form —
// and its comment is right that a person exploring a demonstration is still a
// person. This is the other case: nobody is described here. No human being
// corresponds to the row, so pooling it with the fabricated population is
// correct, and it is what lets `demo reset` clear it like any other seeded row.
//
// IT LANDS IN THE CLINICIAN'S OWN TENANT, which is the second half of what was
// asked for. The caseload is tenant-scoped, so a walkthrough person created in
// NE Care Network A appears on `clinician.demo`'s panel as soon as they exist —
// and the clinician can then watch what their answers did to it. An onboarding
// a clinician cannot see the far side of demonstrates half of the thing.

import { data } from "../data";
import { hashPassword, newId } from "../db";
import { audit } from "../audit";
import { provisionPerson, grantConsent as spineGrantConsent } from "../spine";
import { displayName } from "../demo-population-dictionaries";
import { orgTenantId } from "../demo-population-seed";
import { currentTermsVersion } from "../policy";
import crypto from "node:crypto";

/** The address prefix every walkthrough account carries. It is a marker, not a
 *  convention: the count, the reset and the admin console all find these rows
 *  by it, and `tests/demo-walkthrough.test.ts` asserts that nothing else
 *  produces an address in this shape. */
export const WALKTHROUGH_EMAIL_PREFIX = "walkthrough-";
export const WALKTHROUGH_EMAIL_DOMAIN = "@steady.local";

/** How many walkthrough accounts may exist at once.
 *
 *  A button that mints an account is a button somebody can hold down. The cap
 *  is not a security boundary — the whole surface is demo-only — but an
 *  unbounded one turns a caseload of 42 into a caseload of four hundred empty
 *  people, which ruins the demonstration it was added to serve. Refusing points
 *  at the reset control rather than failing silently. */
export const WALKTHROUGH_LIMIT = 25;

export type WalkthroughOutcome =
  | { ok: true; userId: string; email: string; name: string; tenantId: string }
  | { ok: false; reason: string };

/** Whether this environment offers the walkthrough at all.
 *
 *  Read at CALL TIME rather than captured at module load. A constant evaluated
 *  on import is baked into the build, so a production deployment that shares an
 *  image with the demo would carry whichever value the BUILDER had — and the
 *  guard would be a comment. */
export function walkthroughEnabled(): boolean {
  return process.env.EMDR_DEMO === "1";
}

/** How many walkthrough people currently exist. Shown on the admin console so
 *  a presenter can see the environment filling up before the cap refuses. */
export async function walkthroughCount(): Promise<number> {
  const c = await data();
  const row = (await c.get(
    "SELECT COUNT(*) AS n FROM users WHERE email LIKE ? AND role = 'member'",
    [`${WALKTHROUGH_EMAIL_PREFIX}%${WALKTHROUGH_EMAIL_DOMAIN}`]
  )) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Create a fabricated person and put them at the start of onboarding.
 *
 * Deliberately does NOT grant the care-program consent. That is step two of the
 * flow, and pre-granting it to save a click would skip the screen the clinician
 * came to read.
 *
 * It DOES write a subscription. `/app/onboarding` bounces to `/subscribe` when
 * one is missing, and `/subscribe` says enrollment and billing are closed —
 * true, and a dead end. The row is marked `provider: 'demo'` like the seeded
 * memberships, so nothing reads it as a payment.
 */
export async function startWalkthrough(): Promise<WalkthroughOutcome> {
  if (!walkthroughEnabled()) {
    return { ok: false, reason: "The onboarding walkthrough exists only in the demo environment." };
  }

  const existing = await walkthroughCount();
  if (existing >= WALKTHROUGH_LIMIT) {
    return {
      ok: false,
      reason:
        `There are already ${existing} walkthrough people in this environment, which is the limit. ` +
        "Reset the demo data from the admin console to clear them and start again.",
    };
  }

  // A fresh seed per walkthrough, so two in a row are two different people.
  // The seeded population is deterministic by design; this is the one place
  // that must NOT be, or a presenter running the flow twice would create one
  // person and then collide with them.
  const seed = crypto.randomInt(0, 1_000_000);
  const name = displayName(seed);
  const c = await data();

  // The suffix is what makes the address unique, and it is checked rather than
  // assumed: `users.email` is UNIQUE, and a collision here would surface as a
  // constraint error in the middle of a demonstration.
  let email = "";
  for (let attempt = 0; attempt < 8 && !email; attempt += 1) {
    const candidate =
      `${WALKTHROUGH_EMAIL_PREFIX}${crypto.randomBytes(4).toString("hex")}${WALKTHROUGH_EMAIL_DOMAIN}`;
    if (!(await c.get("SELECT id FROM users WHERE email = ?", [candidate]))) email = candidate;
  }
  if (!email) return { ok: false, reason: "Could not allocate a walkthrough address. Try again." };

  const userId = newId();
  const tenantId = orgTenantId("NE", "A");

  // NO USABLE PASSWORD. The session is set directly by the caller, so this
  // account is reachable for exactly the walkthrough it was made for. A known
  // password would be a credential that has to live somewhere a presenter can
  // read it, and §3's rule about that is the one that survives everything else.
  const passwordHash = hashPassword(crypto.randomBytes(32).toString("hex"));

  // A synthetic adult date of birth. The age gate (compliance 4A.7) decides
  // eligibility at account creation and is never re-litigated downstream, so a
  // walkthrough person has to satisfy it like anyone else — with a value
  // nobody typed.
  const birthYear = new Date().getUTCFullYear() - (24 + (seed % 30));
  const dob = `${birthYear}-0${1 + (seed % 9)}-1${seed % 10}`;

  await c.run(
    `INSERT INTO users (id, email, name, role, password_hash, dob, tenant_id)
     VALUES (?, ?, ?, 'member', ?, ?, ?)`,
    [userId, email, name, passwordHash, dob, tenantId]
  );

  // Identity dual-write (ADR 0011), before any event append: a user with no
  // person row fails longitudinal_events' foreign key.
  await provisionPerson({
    userId, name, email, role: "member", passwordHash, tenantId,
    provenance: "fabricated",
  });

  await c.run(
    `INSERT INTO subscriptions (user_id, plan, status, price_cents, provider, current_period_end)
     VALUES (?, 'monthly', 'active', 0, 'demo', ?)`,
    [userId, new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 19).replace("T", " ")]
  );

  // The two acknowledgments the closed signup path used to record. They are
  // not the care-program consent — `hasConsent` looks for scope
  // 'care_program_full' specifically — so the onboarding gate still opens on
  // step two, which is the point.
  await spineGrantConsent({ userId, policyVersion: "wellness-ack-v1", scope: "wellness_acknowledgment" });
  await spineGrantConsent({ userId, policyVersion: currentTermsVersion(), scope: "terms_acceptance" });

  await audit({
    actorId: userId,
    actorRole: "member",
    family: "identity",
    type: "account_created",
    // Named in the audit trail, so a reviewer replaying this environment can
    // tell a walkthrough person from a seeded one without matching on an
    // address shape.
    detail: { demoWalkthrough: true, provenance: "fabricated", tenantId },
  });

  return { ok: true, userId, email, name, tenantId };
}
