"use server";

import { redirect } from "next/navigation";

import { audit } from "../audit";
import { data } from "../data";
import { hashPassword, newId } from "../db";
import { setSessionCookie } from "../auth";
import { checkAgeEligibility } from "../age-gate";
import { currentTermsVersion } from "../policy";
import { provisionPerson, grantConsent as spineGrantConsent } from "../spine";
import { orgTenantId } from "../demo-population-seed";
import { checkEnrollment } from "./gate";

// Creating an account through the enrollment gate.
//
// THIS IS THE REAL-PERSON PATH, and everything it does differently from the
// onboarding walkthrough follows from that one fact. The walkthrough generates
// a person and stamps them 'fabricated' because nobody is described. Here a
// human typed their own name, their own address and their own date of birth,
// so the person is 'real' — which is `provisionPerson`'s default, and the
// default is not relied on quietly: it is passed explicitly below, because a
// reader of this file should not have to open another one to learn whether
// somebody's answers are about to be pooled with synthetic data.
//
// THE RULES ARE THE ONES THAT ALREADY EXISTED. Age at account creation
// (compliance 4A.7), a password floor, an explicit wellness acknowledgment that
// is never pre-checked, one account per address. They were written for the
// signup path §12 closed and none of them stopped being right.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where a refusal goes. One key, so the form can render any of them in the
 *  same place, and the text rather than a code — these are sentences a person
 *  reads, not states a client branches on. */
function refuse(reason: string): never {
  redirect(`/signup?refused=${encodeURIComponent(reason)}`);
}

export async function enrollAction(formData: FormData): Promise<void> {
  const code = String(formData.get("access_code") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") ?? "");
  const dob = String(formData.get("dob") ?? "");

  // THE GATE FIRST, before anything is validated and long before anything is
  // written. A form that checked the password before the code would tell
  // somebody without a code which addresses are already taken.
  const gate = await checkEnrollment(code);
  if (!gate.ok) refuse(gate.reason);

  if (!name) refuse("Enter the name you would like to be called.");
  if (!EMAIL_RE.test(email)) refuse("Enter a valid email address.");
  if (password.length < 8) refuse("Choose a password of at least 8 characters.");

  // Age is decided once, here, and never re-litigated downstream. The fitness
  // screener re-checks FIT later; it does not re-check age.
  const ageVerdict = checkAgeEligibility(dob);
  if (ageVerdict === "dob") refuse("Enter a valid date of birth.");
  if (ageVerdict === "age") refuse("Steady is for adults 18 and older.");

  // Never pre-checked, and recorded with a version and a timestamp
  // (compliance packet 3.4).
  if (formData.get("wellness_ack") !== "on") {
    refuse("Please acknowledge what this environment is before continuing.");
  }
  if (formData.get("data_ack") !== "on") {
    refuse("Please acknowledge how your answers are handled before continuing.");
  }

  const c = await data();
  if (await c.get("SELECT id FROM users WHERE email = ?", [email])) {
    // SAME ANSWER AS A REFUSED SIGN-IN would be better, and it is not available
    // here: a signup that silently succeeded on a taken address would leave the
    // person unable to sign in and unable to find out why. The address is
    // already known to whoever typed it.
    refuse("An account with that email already exists. Sign in instead.");
  }

  const userId = newId();
  const passwordHash = hashPassword(password);
  // The demo clinician's tenant, so a clinician can see the account they are
  // watching somebody create. The caseload is tenant-scoped, and an enrollee in
  // the platform tenant would be invisible to every clinical screen.
  const tenantId = orgTenantId("NE", "A");

  await c.run(
    `INSERT INTO users (id, email, name, role, password_hash, dob, tenant_id)
     VALUES (?, ?, ?, 'member', ?, ?, ?)`,
    [userId, email, name, passwordHash, dob, tenantId]
  );
  // Identity dual-write (ADR 0011), before any event append: a user with no
  // person row fails longitudinal_events' foreign key.
  await provisionPerson({
    userId, name, email, role: "member", passwordHash, tenantId,
    // EXPLICIT, though it is the default. See the note at the top of the file.
    provenance: "real",
  });

  await spineGrantConsent({ userId, policyVersion: "wellness-ack-v1", scope: "wellness_acknowledgment" });
  await spineGrantConsent({ userId, policyVersion: currentTermsVersion(), scope: "terms_acceptance" });

  // The membership row the care gate requires. `/app/onboarding` redirects to
  // `/subscribe` without one, and `/subscribe` says enrollment and billing are
  // closed — true, and a dead end. Marked as a demo provider at zero, so
  // nothing reads it as a payment taken.
  await c.run(
    `INSERT INTO subscriptions (user_id, plan, status, price_cents, provider, current_period_end)
     VALUES (?, 'monthly', 'active', 0, 'demo', ?)`,
    [userId, new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 19).replace("T", " ")]
  );

  await audit({
    actorId: userId, actorRole: "member", family: "identity", type: "account_created",
    // Says which door and that a person is behind it, so a reviewer reading the
    // trail can tell a pilot enrollee from a walkthrough without joining to
    // another table.
    detail: { via: "enrollment_gate", provenance: "real", tenantId, wellnessAck: "wellness-ack-v1" },
  });

  await setSessionCookie(userId);
  // The gate's own first destination. NOT /app/welcome: that is not a gate
  // destination, so the member layout redirects onward from it, and a
  // server-action redirect into a redirecting route renders a blank page.
  redirect("/app/onboarding");
}
