// Consent-bypass integration check (Part-6 red-team scenario). End-to-end against
// a real (hermetic, temp) SQLite DB: a resourcing BLS session is unavailable
// without an unrevoked processing-session consent, available with it, gone on
// revoke, and the BLS kill switch overrides a granted consent. Env is set BEFORE
// imports so the data layer opens the isolated DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-bls-consent-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;
process.env.EMDR_BLS_RESOURCING = "1"; // feature flag on so the gate depends on consent
delete process.env.EMDR_KILL_BLS;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { resourcingBlsAvailable, hasProcessingConsent } from "../src/lib/gating";

const USER = "bls-consent-user";

test("setup: create the member", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    USER, "bls@test.local", "BLS Tester", "member", "x",
  ]);
});

test("consent gate: no processing consent → resourcing unavailable even with the flag on", async () => {
  assert.equal(await hasProcessingConsent(USER), false);
  assert.equal(await resourcingBlsAvailable(USER), false);
});

test("consent gate: grant → available; revoke → unavailable", async () => {
  const c = await data();
  await c.run("INSERT INTO consents (id, user_id, policy_version, scope) VALUES (?, ?, ?, ?)", [
    "c-bls-1", USER, "processing-consent-v1.0", "processing_session",
  ]);
  assert.equal(await hasProcessingConsent(USER), true);
  assert.equal(await resourcingBlsAvailable(USER), true);

  await c.run("UPDATE consents SET revoked_at = ? WHERE user_id = ? AND scope = 'processing_session'", [
    new Date().toISOString(), USER,
  ]);
  assert.equal(await hasProcessingConsent(USER), false);
  assert.equal(await resourcingBlsAvailable(USER), false);
});

test("consent gate: BLS kill switch overrides a granted consent", async () => {
  const c = await data();
  await c.run("INSERT INTO consents (id, user_id, policy_version, scope) VALUES (?, ?, ?, ?)", [
    "c-bls-2", USER, "processing-consent-v1.0", "processing_session",
  ]);
  assert.equal(await resourcingBlsAvailable(USER), true);
  process.env.EMDR_KILL_BLS = "1";
  assert.equal(await resourcingBlsAvailable(USER), false);
  delete process.env.EMDR_KILL_BLS;
});
