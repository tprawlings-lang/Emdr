// The model's role, and the attention-signal provider (expansion handoff 02,
// Phase 4).
//
// Phase 4's definition of done is one sentence — "AI cannot change statistics
// or causal semantics" — and the whole difficulty is that a prompt saying so is
// a request, not a property.
//
// So these tests do not test the prompt. They drive `checkWording` with the
// sentences a model would plausibly return: the one that rounds a median, the
// one that averages two windows into a friendlier figure, the one that says
// grounding helped, and — the likeliest of all — the concise one that drops the
// difficult half, because dropping it is what makes a summary concise.
//
// The attention provider is tested for the two things §11 asks of it: that one
// difficult session is not a signal, and that a signal made only of exposures a
// safety alert already covered is not raised again in different words.

process.env.EMDR_DATA_DIR = `/tmp/steady-rfa-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "rfa-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "rfa-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { registeredTasks, getTask } from "../src/lib/ai-gateway";
import {
  checkWording, causalWordsIn, numbersIn, permittedNumbers,
  summarizePattern, proposeNormalization, CAUSAL_VOCABULARY,
} from "../src/lib/clinical/response-intelligence";
import { signalsFrom, attentionSignalsFor } from "../src/lib/clinical/response-attention";
import { RESPONSE_POLICY } from "../src/lib/clinical/response-fingerprint-policy";
import type { FingerprintSummary } from "../src/lib/clinical/response-fingerprint";
import { ensureDefinition } from "../src/lib/clinical/interventions";

const db = getDb();
const T = { tenant: "tenant-rfa", clinician: "clin-rfa", patient: "pat-rfa" };
db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(T.tenant, T.tenant);
for (const id of [T.clinician, T.patient]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };

function aSummary(over: Partial<FingerprintSummary> = {}): FingerprintSummary {
  return {
    definition: {
      id: "def-1", canonicalKey: "module.calm_place", displayName: "Calm Place setup",
      interventionClass: "session_intervention", sourceScope: "steady_native",
      active: true, createdAt: "2026-01-01",
    },
    policyVersion: RESPONSE_POLICY.version,
    evidenceCutoff: "2026-09-01T00:00:00.000Z",
    patternState: "favorable_observed_pattern",
    supportCount: 6,
    missingFollowupCount: 0,
    mixedCount: 0,
    recoveryBurdenCount: 0,
    windows: [{
      windowType: "immediate", outcomeType: "within_encounter", observedOn: 6,
      medianChange: -4, range: { min: -5, max: -3 }, iqr: null,
      towardSettled: 6, awayFromSettled: 0, unchanged: 0, unit: "suds_points",
    }],
    strata: [],
    limitations: [],
    evidence: { instanceIds: ["i1", "i2", "i3", "i4", "i5", "i6"], observationIds: ["o1"] },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The registry (§8)
// ---------------------------------------------------------------------------

test("§8's three tasks are registered, versioned, and fall back deterministically", () => {
  for (const id of [
    "response.normalize_intervention", "response.summarize_pattern", "response.match_context",
  ]) {
    const task = getTask(id);
    assert.ok(task, `${id} must be registered`);
    assert.ok(task.version, "a task with no version is a change nobody can attribute");
    assert.equal(
      task.fallback, "deterministic",
      "every response task must have an honest answer to fall back to"
    );
  }
  assert.ok(registeredTasks().some((t) => t.id === "response.summarize_pattern"));
});

test("no response task's purpose line makes an efficacy claim", () => {
  for (const t of registeredTasks().filter((x) => x.id.startsWith("response."))) {
    const causal = causalWordsIn(t.purpose);
    assert.deepEqual(
      causal, [],
      `${t.id}'s purpose must not use causal language: ${causal.join(", ")}`
    );
  }
});

// ---------------------------------------------------------------------------
// The wording guard (§8's "not allowed" column)
// ---------------------------------------------------------------------------

test("a faithful rewording passes", () => {
  const s = aSummary();
  assert.equal(
    checkWording(
      "Across 6 recorded exposures, distress fell by a median of 4 points during the encounter.",
      s
    ),
    null
  );
});

test("causal language is rejected, including the polite kind", () => {
  const s = aSummary();
  for (const bad of [
    "Calm Place setup works well for this person, on 6 exposures.",
    "This is an effective intervention for them across 6 exposures.",
    "The 6 exposures show it caused a reduction in distress.",
    "Distress fell across 6 exposures because of the calm place work.",
    "It helped on 6 of their exposures.",
    "They are a responder — 6 exposures.",
  ]) {
    const reason = checkWording(bad, s);
    assert.ok(reason?.startsWith("causal language"), `"${bad}" must be rejected`);
  }
});

// The likeliest failure: a model that is not lying, only rounding.
test("a number the summary does not contain is rejected", () => {
  const s = aSummary();
  assert.ok(
    checkWording("Across 6 exposures the median fall was 4.5 points.", s)
      ?.startsWith("numbers not in the summary"),
    "a helpfully rounded median is a number nobody can trace to evidence"
  );
  assert.ok(
    checkWording("Across 6 exposures distress fell by about 40 percent.", s)
      ?.startsWith("numbers not in the summary"),
    "a derived percentage is a recalculation"
  );
});

test("a sentence without the support count is rejected", () => {
  const s = aSummary();
  assert.equal(
    checkWording("Distress tended to fall during the encounter.", s),
    "the support count is missing"
  );
});

// The concise summary that drops the difficult half. §8: not allowed to
// "suppress adverse observations."
test("dropping the adverse, mixed or missing counts is rejected", () => {
  const withBurden = aSummary({ recoveryBurdenCount: 3, patternState: "recovery_burden_observed" });
  assert.equal(
    checkWording("Across 6 exposures distress fell by a median of 4 during the encounter.", withBurden),
    "the adverse count was dropped"
  );
  assert.equal(
    checkWording(
      "Across 6 exposures distress fell by a median of 4, with difficulty afterwards on 3.",
      withBurden
    ),
    null,
    "keeping it passes"
  );

  const withMixed = aSummary({ mixedCount: 2, patternState: "mixed" });
  assert.equal(
    checkWording("Across 6 exposures distress fell by a median of 4.", withMixed),
    "the mixed count was dropped"
  );

  // The case that forced the word check as well as the number: this summary's
  // missing count is 4 and its median is -4, so a numeric-only guard would call
  // the median a mention of the missing follow-ups.
  const withMissing = aSummary({ missingFollowupCount: 4 });
  assert.equal(
    checkWording("Across 6 exposures distress fell by a median of 4.", withMissing),
    "the missing-follow-up count was dropped"
  );
  assert.equal(
    checkWording(
      "Across 6 exposures distress fell by a median of 4; 4 had a window nobody recorded.",
      withMissing
    ),
    null,
    "naming it passes"
  );
});

test("the permitted numbers come from the summary object, not from its sentence", () => {
  const s = aSummary({ limitations: ["3 recorded exposures — under the 5 this needs."] });
  const permitted = permittedNumbers(s);
  for (const n of ["6", "-4", "-5", "-3", "0", "3", "5"]) {
    assert.ok(permitted.has(n), `${n} should be permitted`);
  }
  assert.ok(!permitted.has("42"), "a number nowhere in the summary is not permitted");
  assert.deepEqual(numbersIn("median -4 across 6"), ["-4", "6"]);
});

test("the deterministic sentence is what ships when no provider is configured", async () => {
  const s = aSummary();
  const r = await summarizePattern(ctx, T.patient, s);
  assert.equal(r.origin, "deterministic");
  assert.ok(r.text.includes("recorded exposure"));
  assert.deepEqual(causalWordsIn(r.text), []);
  assert.ok(r.rejectedFor.length > 0, "why the model's answer was not used is stated");
});

test("the deterministic sentence passes its own guard", async () => {
  // If the sentence the code ships could not survive the check applied to a
  // model's, the check is describing a standard the product does not meet.
  for (const s of [
    aSummary(),
    aSummary({ recoveryBurdenCount: 2, patternState: "recovery_burden_observed" }),
    aSummary({ mixedCount: 3, patternState: "mixed" }),
  ]) {
    const r = await summarizePattern(ctx, T.patient, s);
    assert.deepEqual(causalWordsIn(r.text), [], `"${r.text}" must not use causal language`);
    assert.ok(numbersIn(r.text).includes(String(s.supportCount)), "the denominator is in the sentence");
  }
});

test("the causal vocabulary covers §6's four named words", () => {
  const joined = CAUSAL_VOCABULARY.join(" ");
  for (const w of ["works", "effective", "caused", "contraindicated"]) {
    assert.ok(joined.includes(w), `§6 names "${w}" and the guard must know it`);
  }
});

// ---------------------------------------------------------------------------
// Normalization proposes, never decides (§8)
// ---------------------------------------------------------------------------

test("normalization returns candidates and writes nothing", async () => {
  await ensureDefinition(ctx, {
    canonicalKey: "cold_water", displayName: "Cold water", interventionClass: "grounding",
  });
  await ensureDefinition(ctx, {
    canonicalKey: "cold_water_at_the_sink", displayName: "Cold water at the sink",
    interventionClass: "grounding",
  });

  const before = db.prepare(
    "SELECT COUNT(*) AS n FROM intervention_definitions WHERE tenant_id = ?"
  ).get(T.tenant) as { n: number };

  const candidates = await proposeNormalization(ctx, "cold water");
  assert.ok(candidates.length >= 2, "both existing spellings are candidates");
  assert.equal(candidates[0].canonicalKey, "cold_water", "the exact match ranks first");
  assert.ok(candidates.every((c) => c.reason.length > 0), "a candidate a person cannot judge is a score");

  const after = db.prepare(
    "SELECT COUNT(*) AS n FROM intervention_definitions WHERE tenant_id = ?"
  ).get(T.tenant) as { n: number };
  assert.equal(after.n, before.n, "proposing must not mint a canonical identity");
});

test("normalization never merges two definitions on its own", async () => {
  const candidates = await proposeNormalization(ctx, "cold water");
  const keys = candidates.map((c) => c.canonicalKey);
  assert.ok(keys.includes("cold_water") && keys.includes("cold_water_at_the_sink"));
  const rows = db.prepare(
    "SELECT canonical_key FROM intervention_definitions WHERE tenant_id = ?"
  ).all(T.tenant) as { canonical_key: string }[];
  assert.ok(
    rows.some((r) => r.canonical_key === "cold_water") &&
    rows.some((r) => r.canonical_key === "cold_water_at_the_sink"),
    "a wrong merge is evidence nobody can pull apart again"
  );
});

// ---------------------------------------------------------------------------
// The attention provider (§11)
// ---------------------------------------------------------------------------

test("one difficult session is not a signal", () => {
  const s = aSummary({ recoveryBurdenCount: 1, patternState: "limited_observed_pattern" });
  assert.deepEqual(signalsFrom([s], T.patient), []);
});

test("repeated recovery burden is a signal that opens its evidence", () => {
  const s = aSummary({ recoveryBurdenCount: 3, patternState: "recovery_burden_observed" });
  const [signal] = signalsFrom([s], T.patient);
  assert.ok(signal);
  assert.equal(signal.kind, "repeated_recovery_burden");
  assert.equal(signal.occurrences, 3);
  assert.equal(signal.supportCount, 6);
  assert.ok(signal.evidenceIds.length > 0, "a signal that cannot open its evidence is a nudge");
  assert.equal(signal.policyVersion, RESPONSE_POLICY.version);
  assert.ok(signal.key.includes(RESPONSE_POLICY.version), "the key survives a policy change");
});

// §11: "do not duplicate existing hard-stop or urgent safety alerts as
// response-fingerprint signals."
test("a signal made only of already-alerted exposures is not raised again", () => {
  const s = aSummary({ recoveryBurdenCount: 3, patternState: "recovery_burden_observed" });
  assert.deepEqual(
    signalsFrom([s], T.patient, { alreadyAlertedInstanceIds: s.evidence.instanceIds }),
    [],
    "the clinician has already been told"
  );
  assert.equal(
    signalsFrom([s], T.patient, { alreadyAlertedInstanceIds: ["i1", "i2"] }).length, 1,
    "a partly-alerted pattern still has something new in it"
  );
});

test("no attention signal is worded as a recommendation or a safety claim", () => {
  const s = aSummary({ recoveryBurdenCount: 3, patternState: "recovery_burden_observed" });
  const [signal] = signalsFrom([s], T.patient);
  const text = signal.reason.toLowerCase();
  assert.deepEqual(causalWordsIn(text), []);
  for (const word of ["stop ", "avoid", "should not", "unsafe", "risk of", "contraindicat", "urgent"]) {
    assert.ok(!text.includes(word), `an attention signal must not say "${word}"`);
  }
  assert.ok(numbersIn(text).includes("3") && numbersIn(text).includes("6"), "with its denominator");
});

test("the threshold is the policy's, so the signal and the label cannot disagree", () => {
  const atThreshold = aSummary({ recoveryBurdenCount: RESPONSE_POLICY.recoveryBurdenThreshold });
  const below = aSummary({ recoveryBurdenCount: RESPONSE_POLICY.recoveryBurdenThreshold - 1 });
  assert.equal(signalsFrom([atThreshold], T.patient).length, 1);
  assert.equal(signalsFrom([below], T.patient).length, 0);
});

test("signals are ordered stably and load for a person with no evidence", async () => {
  const a = aSummary({ recoveryBurdenCount: 2 });
  const b = aSummary({
    recoveryBurdenCount: 5,
    definition: { ...aSummary().definition, id: "def-2", displayName: "Body scan" },
  });
  const ordered = signalsFrom([a, b], T.patient);
  assert.deepEqual(ordered.map((s) => s.occurrences), [5, 2]);
  assert.deepEqual(await attentionSignalsFor(ctx, T.patient), []);
});

// The cross-feature invariant: "safety authority stays deterministic" and these
// features "cannot clear, weaken, bypass or replace the safety engine." Checked
// on the IMPORTS rather than on the prose — a module that cannot reach the
// safety engine cannot read or change it, whatever its comments say.
test("the attention provider cannot reach the safety engine at all", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/lib/clinical/response-attention.ts", "utf8");
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(
      !/safety|crisis|alert/i.test(spec),
      `the provider imports ${spec} — safety authority stays deterministic and separate`
    );
  }
  // Which exposures a safety alert already covered arrives as an ARGUMENT, from
  // the consumer that knows. This module is never in a position to look it up.
  assert.ok(src.includes("alreadyAlertedInstanceIds?: string[]"));
  assert.ok(!/createAlert|safetyState|readSafety/i.test(src));
});
