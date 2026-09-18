// FAILURE-INJECTION EVIDENCE for the failure register's
// `permissions.consent-withdrawn-while-open` and
// `permissions.flag-changes-after-page-load`
// — see src/lib/governance/failure-register.ts.
//
// THE FAILURE INJECTED HERE IS AUTHORITY CHANGING UNDER A PAGE THAT IS ALREADY
// OPEN. A rendered screen is a photograph of permissions as they were. Consent
// is withdrawn, a role is removed, and the tab is still showing what it was
// allowed to show a minute ago, with working buttons.
//
// The handoff's requirement is two words long and both halves matter:
// "Revalidate reads AND WRITES, and remove newly forbidden content."

process.env.EMDR_DATA_DIR = `/tmp/steady-permchange-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "permchange-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "permchange-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import { hasConsent } from "../src/lib/gating";
import {
  treatmentFor, firstFailure, redirectFor, GATE_ORDER, ALWAYS_OPEN, GATE_REDIRECT,
  type GateStep,
} from "../src/lib/member/care-gate";

async function anyMember(): Promise<string> {
  getDb();
  const c = await data();
  const row = (await c.get("SELECT id FROM users WHERE role = 'member' LIMIT 1", [])) as { id: string };
  return row.id;
}

async function grant(userId: string) {
  const c = await data();
  await c.run(
    `INSERT INTO consents (id, user_id, policy_version, scope, granted_at)
     VALUES (?, ?, 'test-policy', 'care_program_full', ?)
     ON CONFLICT DO NOTHING`,
    [`consent-${userId}-test`, userId, new Date().toISOString()],
  );
}

async function withdraw(userId: string) {
  const c = await data();
  await c.run(
    "UPDATE consents SET revoked_at = ? WHERE user_id = ? AND scope = 'care_program_full' AND revoked_at IS NULL",
    [new Date().toISOString(), userId],
  );
}

test("withdrawing consent takes effect on the next read, not on the next sign-in", async () => {
  const userId = await anyMember();
  await grant(userId);
  assert.equal(await hasConsent(userId), true);

  // THE INJECTION. The member's page is open; they withdraw in another tab.
  await withdraw(userId);

  // Every gated member route re-runs the chain per request, and the pages are
  // dynamic and no-store, so the next read is the revalidation. A cached copy
  // is what would make this fail, which is why the browser spec checks the
  // headers rather than trusting this.
  assert.equal(await hasConsent(userId), false, "a revoked consent still reads as consent");
  const passed: Partial<Record<GateStep, boolean>> = { subscription: true, consent: false };
  assert.equal(firstFailure(passed), "consent");
  // Back to consent, which is where the member re-reads what they are being
  // asked and decides again — not to a dead end saying they may not be here.
  assert.equal(redirectFor(passed), GATE_REDIRECT.consent);
});

test("withdrawal closes the care program and does NOT close the way out of a bad night", async () => {
  // THE HALF THAT MATTERS MOST. A gate chain that treats withdrawal as "this
  // person may no longer be here" would take grounding away from somebody at
  // the exact moment they withdrew — which is a moment people do not choose
  // when things are going well.
  // NAMED, NOT ITERATED. Written as a loop over ALWAYS_OPEN first, and
  // emptying that list passed the test: zero iterations assert nothing. A
  // guard that a deletion satisfies is not a guard.
  assert.ok(
    (ALWAYS_OPEN as readonly string[]).includes("/app/ground"),
    "grounding left the always-open list, so the gate chain can now close it",
  );
  assert.equal(treatmentFor("/app/ground"), "open");
  assert.equal(treatmentFor("/app/ground/anything-under-it"), "open");
  assert.equal(treatmentFor("/app/today"), "full_chain");

  // And the person can still reach what they revoked, and their account. A
  // withdrawal that locks somebody out of the consent page has hidden the
  // record of their own decision from them.
  assert.equal(treatmentFor("/app/consent"), "authenticate_only");
  assert.equal(treatmentFor("/app/settings"), "authenticate_only");
});

test("the chain stops at the FIRST failure, so a person is sent one place", async () => {
  // A chain that reported every failed step would send somebody to the last
  // one, or to a list — and "you cannot be here for four reasons" is not a
  // next step.
  assert.equal(firstFailure({ subscription: false, consent: false }), "subscription");
  assert.equal(firstFailure({ subscription: true, consent: true, screening: false }), "screening");
  assert.equal(firstFailure({ subscription: true, consent: true, screening: true, profile: true }), null);
  assert.equal(redirectFor({ subscription: true, consent: true, screening: true, profile: true }), null);
  assert.deepEqual(GATE_ORDER, ["subscription", "consent", "screening", "profile"]);
});

test("a revoked-authority redirect is never reported as an uncertain write", async () => {
  // THE WORST AVAILABLE OUTCOME, and a catch-all produces it by accident.
  // `redirect()` works by throwing. An action that swallowed one would tell a
  // person Steady could not confirm whether their write landed and not to
  // repeat it — when what actually happened is that their authority was
  // revoked and they should have been sent to a different page.
  const src = fs.readFileSync("src/lib/clinical/shell-actions.ts", "utf8");
  // THE RETHROW, NOT THE PREDICATE. Written against the predicate first, and
  // deleting the `throw` passed: the function that recognises a redirect was
  // still in the file, recognising nothing. What has to be true is that the
  // handler re-raises.
  assert.ok(
    /if \(isFrameworkControlFlow\(err\)\) throw err;/.test(src),
    "the catch-all no longer re-raises a framework redirect, so a revoked role reads as an uncertain write",
  );
  assert.ok(
    /NEXT_\(REDIRECT\|NOT_FOUND/.test(src),
    "nothing recognises a framework redirect any more",
  );

  // And authority is resolved BEFORE the try in every command, so the redirect
  // leaves the action rather than reaching the handler at all. The ordering is
  // invisible from inside the catch, which is why it is asserted here.
  for (const fn of ["export async function recordContact", "export async function assignWork", "export async function completeReview"]) {
    const at = src.indexOf(fn);
    assert.ok(at > 0, `${fn} is gone`);
    const head = src.slice(at, at + 400);
    const auth = head.indexOf("clinicianContext()");
    const tried = head.indexOf("try {");
    assert.ok(auth > 0 && tried > 0 && auth < tried,
      `${fn} resolves its authority inside the try, so a revoked-role redirect becomes "could not confirm"`);
  }
});

test("a runtime flag gates a surface, never a write", () => {
  // Appendix B's rule, enforced rather than documented: "turning off
  // presentation does not delete signal, action, or evidence history."
  //
  // THIS IS WHY "a feature flag changed after page load" cannot strand a
  // command in this build. A flag that gated a write would make the scenario
  // real, and the first person to add one would have no reason to know the
  // rule exists.
  const src = fs.readFileSync("src/lib/clinical/shell-actions.ts", "utf8");
  assert.ok(
    !/commandCenterFlag|COMMAND_CENTER_FLAGS|flagEnabled/.test(src),
    "a command path reads a runtime feature flag, so turning one off mid-session can refuse a write",
  );
  const log = fs.readFileSync("src/lib/command-log.ts", "utf8");
  assert.ok(!/COMMAND_CENTER_FLAGS|flagEnabled/.test(log));
});
