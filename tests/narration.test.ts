import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULES, fillNarrationSlots } from "../src/lib/modules.ts";
import { validateCompanionOutput } from "../src/lib/safety/companion-guard.ts";

test("every module narration beat passes the companion output guard", () => {
  // Session narration is authored, not model-generated — but it must still meet
  // the same "never say" bar (no simulated emotion, no outcome promises, etc.),
  // so the whole system speaks with one safe voice.
  for (const mod of MODULES) {
    for (const step of mod.steps) {
      for (const beat of step.beats ?? []) {
        // Fill slots with realistic values before checking.
        const filled = fillNarrationSlots(beat, { calmPlace: "the shore", name: "Sam" });
        const { ok, violations } = validateCompanionOutput(filled);
        assert.ok(
          ok,
          `${mod.id} beat trips guard: ${violations.map((v) => `${v.kind} ("${v.match}")`).join(", ")} — "${filled}"`
        );
      }
    }
  }
});

test("slot fill: known values substitute; missing values degrade gently", () => {
  assert.equal(
    fillNarrationSlots("We'll call it {calmPlace} from here.", { calmPlace: "pines" }),
    "We'll call it pines from here."
  );
  assert.equal(
    fillNarrationSlots("We'll call it {calmPlace} from here.", {}),
    "We'll call it your calm place from here."
  );
  assert.equal(
    fillNarrationSlots("{name}welcome back.", { name: "Alex" }),
    "Alex, welcome back."
  );
  // Missing name leaves a clean sentence, no dangling comma or literal token.
  assert.equal(fillNarrationSlots("{name}welcome back.", {}), "welcome back.");
  assert.doesNotMatch(fillNarrationSlots("{name}hi {calmPlace}", {}), /\{|\}/);
});

test("EVERY module talks the member through it (all instruction/grounding steps narrated)", () => {
  // The talk-through must be built into all EMDR sessions, not just calm-place.
  // Every instruction and grounding/closure step should carry narration beats;
  // suds/bls/trigger-entry steps have their own interactive UI and are exempt.
  for (const mod of MODULES) {
    const narratable = mod.steps.filter(
      (s) => s.kind === "instruction" || s.kind === "grounding"
    );
    for (const step of narratable) {
      assert.ok(
        (step.beats?.length ?? 0) > 0,
        `${mod.id} step "${step.title}" (${step.kind}) has no guided narration`
      );
    }
    // And each module has at least one narrated step overall.
    assert.ok(
      mod.steps.some((s) => (s.beats?.length ?? 0) > 0),
      `${mod.id} carries no narration at all`
    );
  }
});
