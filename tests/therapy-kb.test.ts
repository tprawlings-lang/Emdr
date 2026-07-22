import { test } from "node:test";
import assert from "node:assert/strict";
import { MODALITIES, TECHNIQUES } from "../src/lib/therapy-kb/catalog.ts";
import { selectTechniques, techniqueAllowed, buildTechniqueBlock } from "../src/lib/therapy-kb/select.ts";
import { THERAPY_KB_RULES } from "../src/lib/therapy-kb/signoff.ts";
import { AccessTier } from "../src/lib/safety/types.ts";
import { SESSION } from "../src/lib/safety/config.ts";
import { validateCompanionOutput } from "../src/lib/safety/companion-guard.ts";
import { RULES } from "../src/lib/safety/rules.ts";
import { SESSION_RULES, EXPERIENCE_RULES } from "../src/lib/safety/rule-catalog.ts";

test("catalog integrity: unique ids, valid modality refs, sane gates", () => {
  const ids = TECHNIQUES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "technique ids must be unique");
  const modalityIds = new Set(MODALITIES.map((m) => m.id));
  for (const t of TECHNIQUES) {
    assert.ok(modalityIds.has(t.modality), `${t.id}: unknown modality ${t.modality}`);
    assert.ok(t.minTier >= AccessTier.GROUNDING_ONLY, `${t.id}: minTier below grounding`);
    assert.ok(t.maxActivation >= 0 && t.maxActivation <= 10, `${t.id}: bad maxActivation`);
    assert.ok(t.signals.length > 0, `${t.id}: needs at least one signal`);
    assert.ok(t.signals.every((s) => s === s.toLowerCase()), `${t.id}: signals must be lowercase`);
    assert.ok(t.guidance.length > 40, `${t.id}: guidance too short to be usable`);
  }
});

test("every KB guidance text passes the companion output guard", () => {
  // The KB feeds the generation prompt; its own language must never model a
  // violation ("I care about you", diagnosis, reprocessing instructions...).
  for (const t of TECHNIQUES) {
    const { ok, violations } = validateCompanionOutput(t.guidance);
    assert.ok(
      ok,
      `${t.id} guidance trips the guard: ${violations.map((v) => `${v.kind} ("${v.match}")`).join(", ")}`
    );
  }
});

test("crisis tier receives no KB content at all", () => {
  for (const t of TECHNIQUES) {
    assert.equal(techniqueAllowed(t, AccessTier.CRISIS, 0, 0), false);
  }
  const sel = selectTechniques({
    tier: AccessTier.CRISIS,
    activation: 9,
    dissociation: 0,
    text: "panic overwhelmed can't calm down",
  });
  assert.equal(sel.length, 0);
});

test("tier gating: grounding-only member gets only grounding-tier entries", () => {
  const sel = selectTechniques({
    tier: AccessTier.GROUNDING_ONLY,
    activation: 5,
    dissociation: 0,
    text: "i'm a failure it's my fault always never worthless what's the point",
  });
  for (const s of sel) {
    assert.ok(s.technique.minTier <= AccessTier.GROUNDING_ONLY, `${s.technique.id} leaked past tier gate`);
  }
  // Cognitive/values entries (CAUTIOUS/STEADY) must not appear.
  assert.ok(!sel.some((s) => s.technique.id === "cbt-thought-noticing"));
  assert.ok(!sel.some((s) => s.technique.id === "act-values-compass"));
});

test("activation ceiling: high distress filters demanding entries", () => {
  const sel = selectTechniques({
    tier: AccessTier.STEADY,
    activation: 9,
    dissociation: 0,
    text: "what's the point why bother haven't done anything small win pattern",
  });
  for (const s of sel) {
    assert.ok(s.technique.maxActivation >= 9, `${s.technique.id} offered above its ceiling`);
  }
});

test("elevated dissociation restricts selection to grounding entries", () => {
  const sel = selectTechniques({
    tier: AccessTier.STEADY,
    activation: 5,
    dissociation: SESSION.dissociationStop,
    text: "not real floating far away ashamed i hate myself part of me torn",
  });
  assert.ok(sel.length > 0, "grounding entries should still be offered");
  for (const s of sel) {
    assert.equal(s.technique.category, "grounding", `${s.technique.id} is not grounding-class`);
  }
});

test("restricted topics drop matching entries", () => {
  const withTopic = selectTechniques({
    tier: AccessTier.STEADY,
    activation: 3,
    dissociation: 0,
    text: "i keep thinking about my values and direction, what's the point",
    restrictedTopics: ["values"],
  });
  assert.ok(!withTopic.some((s) => s.technique.id === "act-values-compass"));
});

test("selection is deterministic and capped", () => {
  const inputs = {
    tier: AccessTier.STEADY,
    activation: 4,
    dissociation: 0,
    text: "ashamed of the pattern, part of me torn, small win though, anxious and tight chest",
  };
  const a = selectTechniques(inputs);
  const b = selectTechniques(inputs);
  assert.deepEqual(
    a.map((s) => s.technique.id),
    b.map((s) => s.technique.id)
  );
  assert.ok(a.length <= 3);
});

test("activated member with no signal match still gets a grounding fallback", () => {
  const sel = selectTechniques({
    tier: AccessTier.STABILIZATION,
    activation: 7,
    dissociation: 0,
    text: "zzz nothing matching here",
  });
  assert.equal(sel.length, 1);
  assert.equal(sel[0].technique.category, "grounding");
});

test("technique block renders advisory framing; empty selection renders nothing", () => {
  assert.equal(buildTechniqueBlock([]), "");
  const sel = selectTechniques({
    tier: AccessTier.GROUNDING_ONLY,
    activation: 8,
    dissociation: 0,
    text: "panic heart racing",
  });
  const block = buildTechniqueBlock(sel);
  assert.match(block, /advisory, not a script/);
  assert.match(block, /Never present these as treatment/);
});

test("KB sign-off rules: well-formed, cover globals + every modality, globally unique", () => {
  for (const required of [
    "KB_ADVISORY_ONLY",
    "KB_TIER_GATED",
    "KB_OUTPUT_GUARDED",
    "KB_RESTRICTED_TOPICS",
    "KB_DETERMINISTIC_RETRIEVAL",
  ]) {
    assert.ok(THERAPY_KB_RULES.some((r) => r.id === required), `missing ${required}`);
  }
  for (const m of MODALITIES) {
    assert.ok(
      THERAPY_KB_RULES.some((r) => r.id === `KB_MODALITY_${m.id.toUpperCase()}`),
      `missing sign-off row for modality ${m.id}`
    );
  }
  const all = [...RULES, ...SESSION_RULES, ...EXPERIENCE_RULES, ...THERAPY_KB_RULES].map((r) => r.id);
  assert.equal(new Set(all).size, all.length, "rule ids must be unique across all registers");
});
