process.env.EMDR_DATA_DIR = `/tmp/steady-walkthrough-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "walkthrough-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "walkthrough-test-secret-not-a-real-secret";

// The onboarding walkthrough (demo only).
//
// THE RULE THIS LIVES UNDER is §12: public enrollment is closed, because the
// form that was open took a name, an email address and a date of birth from
// whoever found the page and wrote them into a review environment. Reopening
// that is a release-gate failure, and "it is only the demo" is not a defence —
// the demo is the environment §12 was written about.
//
// So the guards below are not about whether the walkthrough works. They are
// about the four properties that make it not-an-enrollment-form, each of which
// could be undone by a reasonable-looking change:
//
//   1. It does not exist outside the demo environment.
//   2. It accepts no input, so there is no field a real identity can enter by.
//   3. The people it creates are fabricated, and a reset clears them.
//   4. It does not pre-satisfy the consent gate it exists to demonstrate.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import { resetDemoData, DEMO_DATA_TABLES } from "../src/lib/demo-reset";
import {
  startWalkthrough, walkthroughEnabled, walkthroughCount,
  WALKTHROUGH_EMAIL_PREFIX, WALKTHROUGH_EMAIL_DOMAIN, WALKTHROUGH_LIMIT,
} from "../src/lib/demo/walkthrough";
import { orgTenantId } from "../src/lib/demo-population-seed";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
// 1. It does not exist outside the demo environment
// ---------------------------------------------------------------------------

test("the walkthrough refuses when the environment is not the demo", async () => {
  const was = process.env.EMDR_DEMO;
  try {
    process.env.EMDR_DEMO = "0";
    assert.equal(walkthroughEnabled(), false);
    const outcome = await startWalkthrough();
    assert.equal(outcome.ok, false, "a non-demo environment minted an account");
    assert.match((outcome as { reason: string }).reason, /demo environment/i);
  } finally {
    process.env.EMDR_DEMO = was;
  }
  // And nothing was written on the way to refusing.
  assert.equal(await walkthroughCount(), 0, "the refusal still created a person");
});

test("the environment is read at call time, not captured at import", () => {
  // A `const ENABLED = process.env.EMDR_DEMO === "1"` at module scope is baked
  // into the build. A production deployment sharing an image with the demo
  // would then carry whichever value the BUILDER had, and the guard above would
  // pass in a test while the door stood open in production.
  const src = code("src/lib/demo/walkthrough.ts");
  assert.doesNotMatch(
    src, /^\s*const\s+\w+\s*=\s*process\.env\.EMDR_DEMO/m,
    "the demo flag is captured at module scope, so the build freezes it"
  );
  assert.match(src, /function walkthroughEnabled\(\)[\s\S]{0,120}process\.env\.EMDR_DEMO/,
    "walkthroughEnabled does not read the environment itself");
  // Every entry point asks. A helper nobody calls guards nothing.
  assert.match(src, /if \(!walkthroughEnabled\(\)\)/, "startWalkthrough never checks the flag");
});

test("the login screen offers the walkthrough only under the demo flag", () => {
  const page = code("src/app/login/page.tsx");
  assert.match(page, /const DEMO = process\.env\.EMDR_DEMO === "1"/,
    "the login page no longer derives DEMO from the environment");
  // ANCHORED ON THE USAGE, NOT THE IMPORT. The first version searched for the
  // bare identifier and found the import statement at the top of the file, so
  // it measured the wrong region and passed for the wrong reason. The JSX
  // attribute is the thing that actually renders a button.
  const at = page.indexOf("action={startWalkthroughAction}");
  assert.ok(at > 0, "no form on the login page posts to the walkthrough action");
  const before = page.slice(0, at);
  const lastGate = before.lastIndexOf("{DEMO && (");
  assert.ok(lastGate > 0, "the walkthrough button is not inside a DEMO-gated block");
  // No conditional closes between that gate and the button — `)}` at the JSX
  // indent is how one ends here.
  assert.doesNotMatch(
    before.slice(lastGate), /\n\s{0,8}\)\}/,
    "the DEMO gate above the walkthrough button closes before reaching it"
  );
});

// ---------------------------------------------------------------------------
// 2. It accepts no input
// ---------------------------------------------------------------------------

test("the walkthrough takes no arguments, so no identity can be passed to it", () => {
  // THE LOAD-BEARING PROPERTY. §12 closed a form that accepted a real name and
  // address; this is safe because there is nothing to accept one WITH. A
  // validator could be loosened later; a function with no parameters cannot be
  // handed a name at all.
  assert.equal(startWalkthrough.length, 0, "startWalkthrough now takes an argument");

  const action = code("src/lib/demo/walkthrough-actions.ts");
  assert.doesNotMatch(action, /formData/i, "the server action reads submitted form data");
  assert.doesNotMatch(action, /FormData/, "the server action accepts a FormData parameter");

  // And the form on screen posts nothing. Anchored on the JSX attribute for
  // the same reason as above: the bare identifier matches the import first, and
  // the slice would then cover the SIGN-IN form, which has fields — so this
  // guard would have failed for a reason that has nothing to do with it.
  const page = code("src/app/login/page.tsx");
  const at = page.indexOf("action={startWalkthroughAction}");
  assert.ok(at > 0, "no form on the login page posts to the walkthrough action");
  const formEnd = page.indexOf("</form>", at);
  assert.ok(formEnd > at, "the walkthrough form is not closed");
  const form = page.slice(at, formEnd);
  assert.doesNotMatch(form, /<input|<select|<textarea/,
    "the walkthrough form has a field in it — an identity can now be typed into the review environment");
});

// ---------------------------------------------------------------------------
// 3. The people it creates are fabricated, and a reset clears them
// ---------------------------------------------------------------------------

test("a walkthrough person is fabricated, tenanted, and marked as such", async () => {
  const db = getDb();
  resetDemoData(db);

  const outcome = await startWalkthrough();
  assert.equal(outcome.ok, true, `the walkthrough refused: ${JSON.stringify(outcome)}`);
  if (!outcome.ok) return;

  const person = db.prepare("SELECT provenance, tenant_id, display_name FROM persons WHERE id = ?")
    .get(outcome.userId) as { provenance: string; tenant_id: string; display_name: string } | undefined;
  assert.ok(person, "the walkthrough created no person row");
  assert.equal(person!.provenance, "fabricated",
    "the walkthrough person is marked 'real' — it would pool with actual people and survive a reset");
  assert.equal(person!.tenant_id, orgTenantId("NE", "A"),
    "the walkthrough person is not in the demo clinician's tenant, so the caseload will never show them");
  assert.match(person!.display_name, /\(fabricated\)$/,
    "the name carries no fabricated marker — a screenshot of this caseload reads as a record");

  // The address cannot reach an inbox: RFC 6762 reserves the whole .local TLD.
  assert.ok(outcome.email.startsWith(WALKTHROUGH_EMAIL_PREFIX));
  assert.ok(outcome.email.endsWith(WALKTHROUGH_EMAIL_DOMAIN));

  // The user row agrees with the person row about which tenant it is in — the
  // caseload reads `users.tenant_id`, so the two disagreeing would show the
  // person on a console while every person-level guard scoped them elsewhere.
  const user = db.prepare("SELECT tenant_id, role, status FROM users WHERE id = ?")
    .get(outcome.userId) as { tenant_id: string; role: string; status: string };
  assert.equal(user.tenant_id, person!.tenant_id, "the user and person rows are in different tenants");
  assert.equal(user.role, "member");
  assert.equal(user.status, "active", "an inactive member never appears on the caseload");
});

test("two walkthroughs are two different people", async () => {
  const db = getDb();
  resetDemoData(db);
  const a = await startWalkthrough();
  const b = await startWalkthrough();
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.userId, b.userId, "the second walkthrough reused the first person");
  assert.notEqual(a.email, b.email, "two walkthroughs share an address");
  assert.equal(await walkthroughCount(), 2);
});

test("a demo reset clears walkthrough people", async () => {
  // The property that keeps this from accumulating. Every table the walkthrough
  // writes is in DEMO_DATA_TABLES, and the reset is what a presenter reaches
  // for between sessions.
  const db = getDb();
  resetDemoData(db);
  await startWalkthrough();
  assert.ok(await walkthroughCount() > 0, "nothing was created to clear");

  resetDemoData(db);
  assert.equal(await walkthroughCount(), 0, "walkthrough people survived a reset");

  for (const t of ["users", "persons", "accounts", "role_assignments", "subscriptions", "consents"]) {
    assert.ok(
      (DEMO_DATA_TABLES as readonly string[]).includes(t),
      `${t} is not cleared by a reset, so walkthrough rows accumulate in it`
    );
  }
});

test("the cap refuses rather than filling the caseload", async () => {
  const db = getDb();
  resetDemoData(db);
  // Written straight to the table: minting 25 through the real path is slow and
  // proves nothing the cap check needs.
  const ins = db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status)
     VALUES (?, ?, 'Capped Person (fabricated)', 'member', 'x', 'active')`
  );
  for (let i = 0; i < WALKTHROUGH_LIMIT; i += 1) {
    ins.run(`cap-${i}`, `${WALKTHROUGH_EMAIL_PREFIX}cap${i}${WALKTHROUGH_EMAIL_DOMAIN}`);
  }
  const outcome = await startWalkthrough();
  assert.equal(outcome.ok, false, "the cap did not refuse");
  // It says what to do about it, rather than only that it said no.
  assert.match((outcome as { reason: string }).reason, /reset/i,
    "the refusal does not tell the presenter how to clear them");
  resetDemoData(db);
});

// ---------------------------------------------------------------------------
// 4. It does not pre-satisfy the gate it exists to demonstrate
// ---------------------------------------------------------------------------

test("the walkthrough starts BEFORE informed consent, not after it", async () => {
  // The reason the whole thing exists. Granting `care_program_full` here to
  // save a click would skip the consent screen — which is the screen a
  // clinician evaluating this most wants to read.
  const db = getDb();
  resetDemoData(db);
  const outcome = await startWalkthrough();
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const { hasConsent } = await import("../src/lib/gating");
  assert.equal(
    await hasConsent(outcome.userId), false,
    "the walkthrough pre-granted the care-program consent, so the onboarding skips step 2"
  );
});

test("the walkthrough clears the gates that would dead-end it", async () => {
  // /app/onboarding redirects to /subscribe without an active subscription, and
  // /subscribe says enrollment and billing are closed — which is true, and a
  // dead end. The row is marked as a demo provider, not a payment.
  const db = getDb();
  resetDemoData(db);
  const outcome = await startWalkthrough();
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const { subscriptionActive } = await import("../src/lib/billing");
  assert.equal(await subscriptionActive(outcome.userId), true,
    "the walkthrough person has no subscription, so onboarding bounces to the closed billing page");
  const sub = db.prepare("SELECT provider, price_cents FROM subscriptions WHERE user_id = ?")
    .get(outcome.userId) as { provider: string; price_cents: number };
  assert.equal(sub.provider, "demo", "the walkthrough wrote a subscription that does not read as a demo row");
  assert.equal(sub.price_cents, 0, "the walkthrough recorded a price");

  // The age gate decides eligibility once, at account creation, and is never
  // re-litigated downstream — so a walkthrough person has to satisfy it too.
  const { checkAgeEligibility } = await import("../src/lib/age-gate");
  const user = db.prepare("SELECT dob FROM users WHERE id = ?").get(outcome.userId) as { dob: string };
  assert.equal(checkAgeEligibility(user.dob), "ok",
    `the generated date of birth ${user.dob} fails the age gate`);
});

test("provisionPerson still defaults to 'real', so the signup path is unchanged", () => {
  // The parameter added for this feature defaults in the SAFE direction: a
  // caller that does not think about provenance gets 'real', which keeps an
  // actual person's row out of the fabricated pool. A default of 'fabricated'
  // would silently reclassify every future caller.
  const src = code("src/lib/spine.ts");
  assert.match(src, /args\.provenance \?\? "real"/,
    "provisionPerson no longer defaults provenance to 'real'");
  const actions = code("src/lib/actions.ts");
  const at = actions.indexOf("provisionPerson({");
  assert.ok(at > 0, "the signup path no longer calls provisionPerson");
  const call = actions.slice(at, actions.indexOf("});", at));
  assert.doesNotMatch(call, /provenance/,
    "the signup path now passes a provenance — a human filled in that form, so it must stay 'real'");
});
