import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceInputEnabled } from "../src/lib/safety/config.ts";
import { EXPERIENCE_RULES, SESSION_RULES } from "../src/lib/safety/rule-catalog.ts";
import { RULES } from "../src/lib/safety/rules.ts";

test("voice input is off by default (no demo, no flag)", () => {
  delete process.env.EMDR_VOICE_INPUT;
  delete process.env.EMDR_DEMO;
  assert.equal(voiceInputEnabled(), false);
});

test("voice input is on in demo so the clinician can review it", () => {
  delete process.env.EMDR_VOICE_INPUT;
  process.env.EMDR_DEMO = "1";
  assert.equal(voiceInputEnabled(), true);
  delete process.env.EMDR_DEMO;
});

test("voice input can be enabled explicitly by flag outside demo", () => {
  delete process.env.EMDR_DEMO;
  process.env.EMDR_VOICE_INPUT = "1";
  assert.equal(voiceInputEnabled(), true);
  delete process.env.EMDR_VOICE_INPUT;
});

test("experience rules are well-formed and cover the voice guardrails", () => {
  assert.ok(EXPERIENCE_RULES.length >= 5);
  for (const r of EXPERIENCE_RULES) {
    assert.match(r.id, /^[A-Z0-9_]+$/);
    assert.ok(r.category.length > 0);
    assert.ok(r.reason.length > 20);
  }
  const ids = EXPERIENCE_RULES.map((r) => r.id);
  for (const required of [
    "VOICE_INPUT_ENABLED",
    "VOICE_INPUT_ON_DEVICE",
    "VOICE_INPUT_CONFIRM",
    "VOICE_INPUT_SCOPE",
    "VOICE_INPUT_CONSENT",
  ]) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
});

test("all sign-off rule ids are globally unique across registers", () => {
  const ids = [...RULES, ...SESSION_RULES, ...EXPERIENCE_RULES].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});
