import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryClass,
  classifyMemory,
  decayState,
  canExposeToModel,
  canInfluenceSafety,
  canShareWithProvider,
  SENSITIVE_EPISODIC_TTL_DAYS,
  type Provenance,
} from "../src/lib/safety/memory.ts";
import {
  validateCompanionOutput,
  buildGuardrailBlock,
  SAFE_FALLBACK,
} from "../src/lib/safety/companion-guard.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 3600 * 1000;

// ── Memory taxonomy ──────────────────────────────────────────────────────────
test("memory types map to the right classes", () => {
  assert.equal(classifyMemory("focus_area", "user_message").memoryClass, MemoryClass.Educational);
  assert.equal(classifyMemory("tone_preference", "onboarding").memoryClass, MemoryClass.Preference);
  assert.equal(classifyMemory("restricted_topic", "onboarding").memoryClass, MemoryClass.Procedural);
  assert.equal(classifyMemory("safety", "session_reflection").memoryClass, MemoryClass.SafetyAudit);
  assert.equal(classifyMemory("anything", "specialist_note").memoryClass, MemoryClass.Provider);
  assert.equal(classifyMemory("trigger", "user_message").sensitive, true);
});

test("sensitive episodic memory expires after the TTL unless pinned", () => {
  const base = { memoryClass: MemoryClass.Educational, sensitive: true, createdAtMs: NOW };
  const old = NOW + (SENSITIVE_EPISODIC_TTL_DAYS + 1) * DAY;
  assert.equal(decayState(base, old), "expired");
  assert.equal(decayState({ ...base, pinned: true }, old), "active");
  assert.equal(decayState(base, NOW + 10 * DAY), "active");
});

test("preferences and safety/audit memory are retained", () => {
  const old = NOW + 10_000 * DAY;
  assert.equal(decayState({ memoryClass: MemoryClass.Preference, sensitive: false, createdAtMs: NOW }, old), "active");
  assert.equal(decayState({ memoryClass: MemoryClass.SafetyAudit, sensitive: true, createdAtMs: NOW }, old), "active");
});

test("provider memory expires when the relationship is inactive", () => {
  const m = { memoryClass: MemoryClass.Provider, sensitive: false, createdAtMs: NOW };
  assert.equal(decayState({ ...m, providerActive: false }, NOW), "expired");
  assert.equal(decayState({ ...m, providerActive: true }, NOW), "active");
});

test("retrieval gates: account + safety/audit never reach the model", () => {
  assert.equal(canExposeToModel(MemoryClass.Account), false);
  assert.equal(canExposeToModel(MemoryClass.SafetyAudit), false);
  assert.equal(canExposeToModel(MemoryClass.Educational), true);
});

test("only member-stated, safety-relevant memory may influence safety", () => {
  const inferred: Provenance = {
    source: "x", userStated: false, confidence: "moderate", createdAtMs: NOW,
    lastConfirmedAtMs: null, mayInfluenceSafety: true, sharedWithProvider: false,
  };
  const stated: Provenance = { ...inferred, userStated: true };
  assert.equal(canInfluenceSafety(inferred), false); // inferred never
  assert.equal(canInfluenceSafety(stated), true);
  assert.equal(canInfluenceSafety({ ...stated, mayInfluenceSafety: false }), false);
});

test("provider sharing requires member opt-in AND active relationship", () => {
  const p: Provenance = {
    source: "x", userStated: true, confidence: "high", createdAtMs: NOW,
    lastConfirmedAtMs: null, mayInfluenceSafety: false, sharedWithProvider: true,
  };
  assert.equal(canShareWithProvider(p, true), true);
  assert.equal(canShareWithProvider(p, false), false);
  assert.equal(canShareWithProvider({ ...p, sharedWithProvider: false }, true), false);
});

// ── Output guard ─────────────────────────────────────────────────────────────
test("guard flags simulated feelings", () => {
  assert.equal(validateCompanionOutput("I care about you and want you to be safe.").ok, false);
  assert.equal(validateCompanionOutput("I'm scared for you right now.").ok, false);
});

test("guard flags asserted internal states", () => {
  const r = validateCompanionOutput("You are dissociating right now.");
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].kind, "asserted_internal_state");
  assert.equal(validateCompanionOutput("You're being avoidant about this.").ok, false);
});

test("guard flags diagnosis, cure claims, false monitoring, reprocessing, dependency", () => {
  assert.equal(validateCompanionOutput("You have PTSD, clearly.").ok, false);
  assert.equal(validateCompanionOutput("This will cure your trauma for good.").ok, false);
  assert.equal(validateCompanionOutput("Don't worry, help is on the way.").ok, false);
  assert.equal(validateCompanionOutput("Now recall your worst memory and hold the image in mind while we tap.").ok, false);
  assert.equal(validateCompanionOutput("Only I understand you — you don't need anyone else.").ok, false);
});

test("guard passes a clean, trauma-informed supportive message", () => {
  const good =
    "Your messages have gotten shorter. That can happen for lots of reasons. Would it help to pause, ground for a moment, or keep going?";
  assert.equal(validateCompanionOutput(good).ok, true);
});

test("guardrail block and fallback are present and substantive", () => {
  assert.ok(buildGuardrailBlock().includes("never"));
  assert.ok(buildGuardrailBlock().toLowerCase().includes("pause"));
  assert.ok(SAFE_FALLBACK.length > 20);
});
