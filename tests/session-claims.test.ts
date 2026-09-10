// Session claims (handoff 07 §1.3, p7).
//
// p7 asks for environment, dataset_version, tenant_id, person_id, role,
// purpose, issued_at, expires_at and an allowed_projection list, and it states
// the rule that makes them safe to carry:
//
//   THE CLIENT MAY DISPLAY THE SELECTED ROLE. IT MUST NEVER CALCULATE
//   AUTHORIZATION FROM THE DROPDOWN, URL, HIDDEN FIELD OR LOCAL STORAGE.
//
// A token is a hidden field the client holds. So the claims travel signed, and
// the DATABASE stays authoritative: they are checked against the account row
// and a disagreement destroys the session rather than resolving in either
// direction. A token that carries a role and is trusted for it has to be
// revoked; one that carries a role and is checked for it revokes itself.

process.env.EMDR_DATA_DIR = `/tmp/steady-claims-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "claims-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "claims-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import crypto from "node:crypto";
import { makeSessionToken, readClaims, getUserFromToken } from "../src/lib/auth";
import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import { isAggregateRole, type Role } from "../src/lib/roles";

async function userByRole(role: Role): Promise<{ id: string; tenant_id: string }> {
  getDb();
  const c = await data();
  return (await c.get("SELECT id, tenant_id FROM users WHERE role = ? LIMIT 1", [role])) as
    { id: string; tenant_id: string };
}

// ---------------------------------------------------------------------------
// Every claim p7 names
// ---------------------------------------------------------------------------

test("a session carries every claim §1.3 names", async () => {
  const u = await userByRole("clinician");
  const claims = readClaims(await makeSessionToken(u.id));
  assert.ok(claims, "the token this codebase just issued does not parse");

  for (const k of [
    "environment", "dataset_version", "tenant_id", "role", "purpose",
    "issued_at", "expires_at", "allowed_projections",
  ] as const) {
    assert.ok(claims![k] !== undefined && claims![k] !== "", `the ${k} claim is missing`);
  }
  assert.equal(claims!.environment, "demo");
  assert.equal(claims!.role, "clinician");
  assert.ok(Array.isArray(claims!.allowed_projections) && claims!.allowed_projections.length > 0,
    "no projection is allowed, so the session can request nothing");
});

test("an aggregate session carries no person_id", async () => {
  // p7: "person_id when relevant". An aggregate role reports on a population
  // and acts for no one, and carrying a person would be the first half of
  // exactly the drift §30.6 forbids.
  for (const role of ["organization", "payer"] as const) {
    const u = await userByRole(role);
    const claims = readClaims(await makeSessionToken(u.id))!;
    assert.ok(isAggregateRole(claims.role));
    assert.equal(claims.person_id, undefined, `a ${role} session carries a person_id`);
  }
  // And a person-acting role does.
  const m = await userByRole("member");
  assert.equal(readClaims(await makeSessionToken(m.id))!.person_id, m.id);
});

test("allowed projections are named per role, and never widened by the client", async () => {
  const payer = await userByRole("payer");
  const claims = readClaims(await makeSessionToken(payer.id))!;
  // p8's second negative test: "payer session cannot request person_summary,
  // even by direct API call." The projection list is where that is decided.
  assert.ok(!claims.allowed_projections.includes("person_summary.v4"),
    "a payer session may request a person projection");
  assert.ok(claims.allowed_projections.some((p) => p.startsWith("payer_")),
    "a payer session may not request its own projections");
});

// ---------------------------------------------------------------------------
// The claims grant nothing
// ---------------------------------------------------------------------------

test("a tampered claim is rejected, not believed", async () => {
  const u = await userByRole("member");
  const token = await makeSessionToken(u.id);
  const [payload] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

  // Escalate the role and re-encode WITHOUT re-signing.
  claims.role = "demo_admin";
  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url") + "." + token.split(".")[1];
  assert.equal(readClaims(forged), null, "a re-encoded payload passed the signature check");
  assert.equal(await getUserFromToken(forged), null, "a forged role was accepted");
});

test("a claim that disagrees with the account row destroys the session", async () => {
  // The case a signature cannot catch: a VALIDLY signed token issued before a
  // role or tenant changed. Trusting the claim would let the old role travel;
  // trusting the row alone would make the claim decorative, and an audit entry
  // citing a scope nothing checked is worse than one citing none.
  const u = await userByRole("member");
  const token = await makeSessionToken(u.id);
  assert.ok(await getUserFromToken(token), "a freshly issued token does not resolve");

  const c = await data();
  await c.run("UPDATE users SET role = 'clinician' WHERE id = ?", [u.id]);
  try {
    assert.equal(await getUserFromToken(token), null,
      "a token issued under the old role still resolves after the role changed");
  } finally {
    await c.run("UPDATE users SET role = 'member' WHERE id = ?", [u.id]);
  }
});

test("the absolute lifetime is inside the token, so a cookie cannot extend it", async () => {
  const u = await userByRole("member");
  const token = await makeSessionToken(u.id);
  const claims = readClaims(token)!;

  // Demo: 8 hours absolute (p7). Not the 30 days a member's own device gets —
  // a demonstration session left open on a laptop in a conference room is a
  // different exposure, and one compromise would suit neither.
  const hours = (claims.expires_at - claims.issued_at) / 3_600_000;
  assert.ok(hours > 7.9 && hours < 8.1, `demo sessions last ${hours}h, not 8`);

  // An expired token is refused even with a perfectly valid signature.
  const expired = { ...claims, expires_at: Date.now() - 1000 };
  const payload = Buffer.from(JSON.stringify(expired)).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.EMDR_SESSION_SECRET!).update(payload).digest("hex");
  assert.equal(readClaims(`${payload}.${sig}`), null, "an expired token was accepted");
});

test("a session's tenant is the account's, and the platform tenant is not a scope", async () => {
  const org = await userByRole("organization");
  const claims = readClaims(await makeSessionToken(org.id))!;
  assert.equal(claims.tenant_id, org.tenant_id);
  assert.notEqual(claims.tenant_id, "0".repeat(26),
    "the organization account is still in the platform tenant, so its console would " +
    "report on every unassigned person in the deployment");
});

test("signing out everywhere invalidates a token already issued", async () => {
  const u = await userByRole("member");
  const token = await makeSessionToken(u.id);
  const c = await data();
  await c.run("UPDATE users SET token_epoch = token_epoch + 1 WHERE id = ?", [u.id]);
  try {
    assert.equal(await getUserFromToken(token), null, "a revoked token still resolves");
  } finally {
    await c.run("UPDATE users SET token_epoch = token_epoch - 1 WHERE id = ?", [u.id]);
  }
});

test("a token signed with another key is refused", async () => {
  const u = await userByRole("member");
  const token = await makeSessionToken(u.id);
  const [payload] = token.split(".");
  const other = crypto.createHmac("sha256", "a-different-secret-entirely").update(payload).digest("hex");
  assert.equal(readClaims(`${payload}.${other}`), null);
});
