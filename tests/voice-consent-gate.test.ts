import { test } from "node:test";
import assert from "node:assert/strict";
import { decideVoiceAvailability } from "../src/lib/gating.ts";

test("demo is always available (reviewer experience), consent irrelevant", () => {
  assert.equal(decideVoiceAvailability({ demo: true, flagOn: false, hasConsent: false }), true);
  assert.equal(decideVoiceAvailability({ demo: true, flagOn: true, hasConsent: true }), true);
});

test("flag ON but NO consent → NOT available (the gate)", () => {
  assert.equal(decideVoiceAvailability({ demo: false, flagOn: true, hasConsent: false }), false);
});

test("flag ON and consent granted → available", () => {
  assert.equal(decideVoiceAvailability({ demo: false, flagOn: true, hasConsent: true }), true);
});

test("flag OFF → never available for real members, even with consent", () => {
  assert.equal(decideVoiceAvailability({ demo: false, flagOn: false, hasConsent: true }), false);
});
