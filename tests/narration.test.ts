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

test("calm-place module actually carries narration (regression: it was static)", () => {
  const calm = MODULES.find((m) => m.id === "calm-place");
  assert.ok(calm, "calm-place module exists");
  const narratedSteps = calm.steps.filter((s) => (s.beats?.length ?? 0) > 0);
  assert.ok(narratedSteps.length >= 2, "calm-place has guided narration on multiple steps");
});
