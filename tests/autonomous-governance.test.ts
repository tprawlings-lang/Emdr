// Engine-to-govern wiring, end to end against the seeded demo member (who passes
// every upstream gate and has a gated module pending a manual clinician unlock).
// Flag OFF → the manual unlock is required (action "unlock"). Flag ON → the
// deterministic engine governs the unlock (auto-unlock), so the module opens and
// the "unlock" requirement is gone. Env set BEFORE imports so the demo seeds.
process.env.EMDR_DATA_DIR = `/tmp/steady-governance-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1"; // seeds the fictional dataset + refreshes today's check-in
delete process.env.EMDR_AUTONOMOUS_SAFETY;
delete process.env.EMDR_OPEN_GATED;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { checkModuleAccess } from "../src/lib/gating";
import { getModule } from "../src/lib/modules";

const GATED = getModule("recent-trigger")!; // seeded with a *pending* unlock request
let alexId = "";

test("setup: demo member exists (triggers the seed)", async () => {
  const c = await data();
  const row = (await c.get("SELECT id FROM users WHERE email = 'demo@example.com'")) as { id: string } | undefined;
  assert.ok(row?.id, "demo member should be seeded");
  alexId = row!.id;
});

test("flag OFF: gated module blocked specifically at the manual unlock gate", async () => {
  delete process.env.EMDR_AUTONOMOUS_SAFETY;
  const r = await checkModuleAccess(alexId, GATED);
  assert.equal(r.allowed, false);
  if (r.allowed) assert.fail("gated module unexpectedly allowed");
  // action "unlock" proves every UPSTREAM gate passed (sub/consent/fitness/
  // screening/profile/check-in/readiness/safety-plan/prereqs) and only the manual
  // clinician unlock is missing.
  assert.equal(r.action, "unlock");
});

test("flag ON: engine governs the unlock — manual-unlock gate gone; processing stays CLOSED (autonomous stimulation off in beta)", async () => {
  process.env.EMDR_AUTONOMOUS_SAFETY = "1";
  const r = await checkModuleAccess(alexId, GATED);
  if (r.allowed) assert.fail("processing module unexpectedly allowed");
  // The manual clinician-unlock requirement is no longer the gate — the engine is.
  assert.notEqual(r.action, "unlock");
  // And because the signed beta config keeps autonomous stimulation OFF, the
  // engine holds the processing module: flipping the flag must NOT auto-open
  // processing. (This is the safety condition; the assertion guards it.)
  assert.equal(r.allowed, false);
  delete process.env.EMDR_AUTONOMOUS_SAFETY;
});

test("flag ON does not loosen the daily safety substrate (autonomous grounding still open)", async () => {
  process.env.EMDR_AUTONOMOUS_SAFETY = "1";
  const r = await checkModuleAccess(alexId, getModule("calm-place")!);
  assert.equal(r.allowed, true);
  delete process.env.EMDR_AUTONOMOUS_SAFETY;
});
