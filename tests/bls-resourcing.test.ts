// Phase-4a resourcing core — the deterministic content + gating.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESOURCING_STEPS,
  RESOURCING_CUES,
  RESOURCING_BETWEEN,
  RESOURCING_PARAMS,
  resourceTurnedUnpleasant,
  personalizedCues,
  personalizedBetween,
  sanitizeResource,
  BORDERLINE_STOP_REMINDER,
} from "../src/lib/safety/resourcing.ts";
import { resourcingBlsAvailable } from "../src/lib/gating.ts";
import { validateCompanionOutput } from "../src/lib/safety/companion-guard.ts";
import { blsResourcingEnabled } from "../src/lib/safety/config.ts";
import { blsDisabled } from "../src/lib/safety/governance.ts";

// Every deterministic spoken line must pass the output guard (no reprocessing
// instructions, simulated feelings, monitoring claims, etc.).
test("resourcing: every cue, between-set prompt, and step prompt passes the output guard", () => {
  const lines = [
    ...RESOURCING_CUES,
    ...RESOURCING_BETWEEN,
    ...RESOURCING_STEPS.map((s) => s.prompt),
  ];
  for (const line of lines) {
    assert.equal(validateCompanionOutput(line).ok, true, `blocked: ${line}`);
  }
});

// Personalized cues weave the member's OWN words into fixed templates and must
// STILL pass the output guard (incl. the borderline stop reminder), and must fall
// back to the generic wording when nothing (or only junk) is provided.
test("resourcing: personalized cues + prompts + reminder pass the output guard", () => {
  const samples = ["the beach", "my grandmother's garden", "a quiet forest", "home"];
  const words = ["calm", "safe", "here"];
  const lines: string[] = [BORDERLINE_STOP_REMINDER];
  for (const place of samples) {
    for (const word of words) {
      lines.push(...personalizedCues(place, word), ...personalizedBetween(place));
    }
  }
  lines.push(...personalizedCues(), ...personalizedBetween()); // generic fallback
  for (const line of lines) {
    assert.equal(validateCompanionOutput(line).ok, true, `blocked: ${line}`);
  }
});

test("resourcing: personalization uses the member's place, falls back when empty", () => {
  assert.ok(personalizedCues("the beach")[0].includes("the beach"));
  assert.equal(personalizedCues("")[0], RESOURCING_CUES[0]); // empty → generic
  assert.equal(personalizedCues("   ")[0], RESOURCING_CUES[0]); // whitespace → generic
  assert.equal(personalizedBetween("the beach")[0], "How does the beach feel now?");
});

test("resourcing: sanitizeResource strips control chars/markup and caps length", () => {
  assert.equal(sanitizeResource("the\nbeach"), "the beach");
  assert.equal(sanitizeResource("  a   quiet  place  "), "a quiet place");
  assert.equal(sanitizeResource("<script>x</script>"), "script x /script");
  assert.equal(sanitizeResource("x".repeat(100)).length, 40);
  assert.equal(sanitizeResource(null), "");
});

test("resourcing: params are short + slow (resourcing, not desensitization)", () => {
  assert.ok(RESOURCING_PARAMS.hz <= 1.0, "slow speed");
  assert.ok(RESOURCING_PARAMS.passesPerSet >= 4 && RESOURCING_PARAMS.passesPerSet <= 8, "short set");
  assert.ok(RESOURCING_PARAMS.maxSets <= 6, "few sets");
});

test("resourcing: an unpleasant resource stops (never push a distressing resource)", () => {
  assert.equal(resourceTurnedUnpleasant(false), true);
  assert.equal(resourceTurnedUnpleasant(true), false);
});

test("resourcing: closure step is always present in the sequence", () => {
  assert.ok(RESOURCING_STEPS.some((s) => s.phase === "closure"));
});

// ── Gating: flag off / kill switch → not available (short-circuits before DB) ──
test("resourcing availability: OFF by default", async () => {
  const prev = process.env.EMDR_BLS_RESOURCING;
  delete process.env.EMDR_BLS_RESOURCING;
  assert.equal(blsResourcingEnabled(), false);
  assert.equal(await resourcingBlsAvailable("u1"), false);
  if (prev !== undefined) process.env.EMDR_BLS_RESOURCING = prev;
});

test("resourcing availability: BLS kill switch overrides the flag", async () => {
  const prevFlag = process.env.EMDR_BLS_RESOURCING;
  const prevKill = process.env.EMDR_KILL_BLS;
  process.env.EMDR_BLS_RESOURCING = "1";
  process.env.EMDR_KILL_BLS = "1";
  assert.equal(blsDisabled(), true);
  assert.equal(await resourcingBlsAvailable("u1"), false); // killed → false before any DB read
  if (prevFlag === undefined) delete process.env.EMDR_BLS_RESOURCING; else process.env.EMDR_BLS_RESOURCING = prevFlag;
  if (prevKill === undefined) delete process.env.EMDR_KILL_BLS; else process.env.EMDR_KILL_BLS = prevKill;
});
