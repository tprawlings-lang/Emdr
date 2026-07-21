import { test } from "node:test";
import assert from "node:assert/strict";
import {
  killSwitches,
  safetyCoreStatus,
  safetyConfigSnapshot,
  generativeConversationDisabled,
  SAFETY_CONFIG_VERSION,
} from "../src/lib/safety/governance.ts";

test("kill switches default to off", () => {
  delete process.env.EMDR_KILL_GENERATIVE;
  delete process.env.EMDR_KILL_PROVIDER_SHARING;
  delete process.env.EMDR_KILL_ESCALATION;
  const k = killSwitches();
  assert.equal(k.generativeConversation, false);
  assert.equal(k.providerSharing, false);
  assert.equal(k.escalationAutomation, false);
});

test("generative kill switch reflects the env var", () => {
  process.env.EMDR_KILL_GENERATIVE = "1";
  assert.equal(generativeConversationDisabled(), true);
  delete process.env.EMDR_KILL_GENERATIVE;
  assert.equal(generativeConversationDisabled(), false);
});

test("status defaults to shadow mode with governance disabled and sign-off required", () => {
  delete process.env.EMDR_AUTONOMOUS_SAFETY;
  const s = safetyCoreStatus();
  assert.equal(s.mode, "shadow");
  assert.equal(s.governanceEnabled, false);
  assert.equal(s.signoffRequired, true);
  assert.equal(s.provisional, true);
  // All six stages present.
  assert.equal(Object.values(s.stages).every(Boolean), true);
});

test("status flips to governing when the flag is set", () => {
  process.env.EMDR_AUTONOMOUS_SAFETY = "1";
  assert.equal(safetyCoreStatus().mode, "governing");
  delete process.env.EMDR_AUTONOMOUS_SAFETY;
});

test("config snapshot is versioned, provisional, and complete (no secrets)", () => {
  const c = safetyConfigSnapshot();
  assert.equal(c.version, SAFETY_CONFIG_VERSION);
  assert.equal(c.provisional, true);
  assert.ok(c.session.maxSets >= 1);
  assert.ok(c.bls.maxFlashesPerSecond <= 3);
  assert.ok(c.instrument.pcl5Positive === 33);
  const json = JSON.stringify(c).toLowerCase();
  assert.ok(!json.includes("secret") && !json.includes("key") && !json.includes("password"));
});
