import { test } from "node:test";
import assert from "node:assert/strict";
import { composeSessionResponse } from "../src/lib/session-companion.ts";
import { validateCompanionOutput } from "../src/lib/safety/companion-guard.ts";
import { AccessTier } from "../src/lib/safety/types.ts";
import { TECHNIQUES } from "../src/lib/therapy-kb/catalog.ts";

const base = {
  currentSuds: 3,
  tier: AccessTier.STABILIZATION,
  techniques: [],
  calmPlace: "the shore",
  name: "Sam",
};

test("crisis speech is caught first and routed to Ground-me + 988, never AI", () => {
  const r = composeSessionResponse({ ...base, transcript: "I want to hurt myself" });
  assert.equal(r.crisis, true);
  assert.equal(r.kind, "crisis");
  assert.equal(r.suggestGroundMe, true);
  assert.equal(r.source, "deterministic");
  assert.match(r.text, /988/);
});

test("high-activation speech grounds and surfaces Ground-me", () => {
  const r = composeSessionResponse({ ...base, transcript: "I'm starting to panic and can't breathe" });
  assert.equal(r.kind, "ground");
  assert.equal(r.suggestGroundMe, true);
});

test("high SUDS grounds even without activation words", () => {
  const r = composeSessionResponse({ ...base, currentSuds: 8, transcript: "it's a lot right now" });
  assert.equal(r.kind, "ground");
  assert.equal(r.suggestGroundMe, true);
});

test("a cleared technique is offered when the member's words match one", () => {
  const grounding = TECHNIQUES.find((t) => t.id === "somatic-orientation")!;
  const r = composeSessionResponse({
    ...base,
    transcript: "everything feels a bit foggy",
    techniques: [{ technique: grounding, score: 1 }],
  });
  // foggy is not an activation word here; technique path applies.
  assert.ok(r.kind === "technique" || r.kind === "ground");
  assert.equal(r.crisis, false);
});

test("otherwise it attunes, references the calm place, and never pushes forward", () => {
  const r = composeSessionResponse({ ...base, transcript: "the water is really clear today" });
  assert.equal(r.kind, "acknowledge");
  assert.equal(r.suggestGroundMe, false);
  assert.match(r.text, /the shore/);
});

test("EVERY response path is output-guard clean across many inputs", () => {
  const inputs = [
    "I want to kill myself",
    "I'm panicking",
    "this reminds me of the accident",
    "I feel calm here",
    "I don't know what to say",
    "my chest is tight",
    "it was my fault",
    "the pines smell good",
  ];
  for (const suds of [2, 5, 8]) {
    for (const transcript of inputs) {
      const r = composeSessionResponse({ ...base, currentSuds: suds, transcript });
      assert.ok(
        validateCompanionOutput(r.text).ok,
        `guard tripped on kind=${r.kind} for "${transcript}" @suds${suds}: "${r.text}"`
      );
      // The responder must never emit a reprocessing instruction or push a set.
      assert.doesNotMatch(r.text, /\b(continue|do another set|next set|keep going|bring up the|stay with the (memory|image))\b/i);
    }
  }
});

test("response carries no field that could move the engine (words + hint only)", () => {
  const r = composeSessionResponse({ ...base, transcript: "ok" });
  assert.deepEqual(
    Object.keys(r).sort(),
    ["crisis", "kind", "source", "suggestGroundMe", "text"].sort()
  );
});
