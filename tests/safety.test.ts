// @safety — CI-blocking test suite (compliance packet 4D). Covers the
// deterministic safety rules: fitness-screener hard stops, SUDs thresholds,
// check-in crisis routing, and the crisis keyword pre-filter. Run with
// `npm run test:safety`; this suite must pass on every release that touches
// session or screening code.

import { strict as assert } from "node:assert";
import test from "node:test";
import { sudsDecision } from "../src/lib/session-safety";
import { classifyFitness, FITNESS_ITEMS } from "../src/lib/fitness-screener";
import { evaluateCheckin } from "../src/lib/gating";
import { detectRisk } from "../src/lib/companion";
import { scoreTrackCandidates, trackSafetyGate } from "../src/lib/track-recommender";
import { collectEnvIssues } from "../src/lib/env-guard";
import { rateLimit, resetRateLimits } from "../src/lib/rate-limit";

function allNo(): Record<string, boolean> {
  return Object.fromEntries(FITNESS_ITEMS.map((i) => [i.id, false]));
}

test("fitness screener: all-no passes", () => {
  assert.equal(classifyFitness(allNo()).outcome, "pass");
});

test("fitness screener: every hard-stop item stops alone", () => {
  for (const item of FITNESS_ITEMS.filter((i) => i.onYes === "hard_stop")) {
    const answers = { ...allNo(), [item.id]: true };
    const { outcome, flags } = classifyFitness(answers);
    assert.equal(outcome, "hard_stop", `expected hard stop for ${item.id}`);
    assert.ok(flags.includes(`hard_stop:${item.id}`));
  }
});

test("fitness screener: soft flags do not stop, and never mask a hard stop", () => {
  const soft = FITNESS_ITEMS.find((i) => i.id === "seizure_disorder")!;
  assert.equal(classifyFitness({ ...allNo(), [soft.id]: true }).outcome, "soft_flag");
  const both = { ...allNo(), [soft.id]: true, selfharm_30d: true };
  assert.equal(classifyFitness(both).outcome, "hard_stop");
});

test("suds: 9+ ends the session", () => {
  assert.equal(sudsDecision([4, 9]), "hard_stop");
  assert.equal(sudsDecision([10]), "hard_stop");
});

test("suds: 8 pauses for grounding and a choice", () => {
  assert.equal(sudsDecision([4, 8]), "pause");
  assert.equal(sudsDecision([8]), "pause");
});

test("suds: a rise of 3+ from session start pauses even below 8", () => {
  assert.equal(sudsDecision([2, 5]), "pause");
  assert.equal(sudsDecision([2, 4]), "continue");
});

test("suds: settling distress continues", () => {
  assert.equal(sudsDecision([6, 4, 3]), "continue");
});

test("check-in: harm urge or feeling unsafe routes to crisis", () => {
  const base = {
    activation: 2,
    shutdown: 2,
    harm_urge: false,
    feels_safe: true,
    dissociation: 1,
    sleep_quality: 7,
    substance_flag: false,
  };
  assert.equal(evaluateCheckin({ ...base, harm_urge: true }), "crisis");
  assert.equal(evaluateCheckin({ ...base, feels_safe: false }), "crisis");
  assert.equal(evaluateCheckin({ ...base, dissociation: 8 }), "grounding_only");
  assert.equal(evaluateCheckin(base), "processing_ok");
});

test("companion crisis pre-filter catches risk phrasing", () => {
  const phrases = [
    "I want to kill myself",
    "i've been thinking about suicide",
    "I might hurt myself tonight",
    "I don't want to be here anymore... I want to end it all",
    "I am not safe at home",
    "i keep cutting myself",
  ];
  for (const p of phrases) assert.ok(detectRisk(p), `should flag: ${p}`);
  assert.equal(detectRisk("today was a calm day, I walked the dog"), false);
});

test("track recommender: never recommends through an incomplete or flagged safety screen", () => {
  // Unanswered program-fit screen blocks recommendation.
  const noScreen = trackSafetyGate({ fitnessStatus: "none", screeningComplete: true, checkinAction: null });
  assert.equal(noScreen.proceed, false);

  // Fit cooldown routes to crisis support, not a pathway.
  const cooldown = trackSafetyGate({ fitnessStatus: "cooldown", screeningComplete: true, checkinAction: null });
  assert.equal(cooldown.proceed, false);
  if (!cooldown.proceed) assert.equal(cooldown.safety.action, "crisis");

  // Incomplete baseline measures block recommendation.
  const noBaseline = trackSafetyGate({ fitnessStatus: "passed", screeningComplete: false, checkinAction: null });
  assert.equal(noBaseline.proceed, false);

  // A check-in that flagged crisis blocks recommendation.
  const crisis = trackSafetyGate({ fitnessStatus: "passed", screeningComplete: true, checkinAction: "crisis" });
  assert.equal(crisis.proceed, false);
  if (!crisis.proceed) assert.equal(crisis.safety.level, "blocked");

  // All clear proceeds.
  assert.equal(
    trackSafetyGate({ fitnessStatus: "passed", screeningComplete: true, checkinAction: "processing_ok" }).proceed,
    true
  );
});

test("track recommender: scoring maps intake tags to the right pathways and caps at three", () => {
  const panic = scoreTrackCandidates(["panic"]);
  assert.equal(panic[0].trackId, "anxiety_panic", "panic tag should rank Anxiety & Panic first");

  // "numb / losing time" routes to the complex-trauma readiness lane, which is
  // referral-only — it must never be presented as self-guided processing.
  const numb = scoreTrackCandidates(["numb"]);
  assert.equal(numb[0].trackId, "complex_readiness");
  assert.equal(numb[0].referralOnly, true);

  // No tags -> no candidates (never guess a pathway).
  assert.equal(scoreTrackCandidates([]).length, 0);

  // Unknown tags are ignored, not crashed on.
  assert.equal(scoreTrackCandidates(["not_a_real_tag"]).length, 0);

  // At most three candidates are ever returned.
  const many = scoreTrackCandidates(["intrusions", "panic", "specific_fear", "grief", "low_mood", "cravings"]);
  assert.ok(many.length <= 3, "candidates are capped at three");
});

test("env-guard: production refuses missing/default secrets, accepts strong config", () => {
  const strong = "a".repeat(48);
  // Missing session secret in production is fatal.
  const missing = collectEnvIssues({ NODE_ENV: "production", EMDR_DATA_KEY: strong } as NodeJS.ProcessEnv);
  assert.ok(missing.some((i) => i.key === "EMDR_SESSION_SECRET" && i.level === "fatal"));

  // Dev-default session secret in production is fatal.
  const devDefault = collectEnvIssues({
    NODE_ENV: "production",
    EMDR_SESSION_SECRET: "dev-only-secret-change-me",
    EMDR_DATA_KEY: strong,
  } as NodeJS.ProcessEnv);
  assert.ok(devDefault.some((i) => i.key === "EMDR_SESSION_SECRET" && i.level === "fatal"));

  // Missing data key in production is fatal (would store PII as plaintext).
  const noKey = collectEnvIssues({ NODE_ENV: "production", EMDR_SESSION_SECRET: strong } as NodeJS.ProcessEnv);
  assert.ok(noKey.some((i) => i.key === "EMDR_DATA_KEY" && i.level === "fatal"));

  // A fully-configured production env has no fatal issues.
  const good = collectEnvIssues({
    NODE_ENV: "production",
    EMDR_SESSION_SECRET: strong,
    EMDR_DATA_KEY: strong,
    R2_ACCOUNT_ID: "x",
    R2_ACCESS_KEY_ID: "x",
    R2_SECRET_ACCESS_KEY: "x",
    R2_BUCKET: "x",
    BACKUP_AGE_RECIPIENT: "x",
  } as NodeJS.ProcessEnv);
  assert.equal(good.filter((i) => i.level === "fatal").length, 0);

  // In development, the same gaps are warnings, never fatal.
  const dev = collectEnvIssues({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
  assert.equal(dev.filter((i) => i.level === "fatal").length, 0);
});

test("rate-limit: allows up to the limit then blocks, and resets after the window", () => {
  resetRateLimits();
  const key = "test:user";
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(key, 3, 60_000).ok, true, `call ${i} should pass`);
  assert.equal(rateLimit(key, 3, 60_000).ok, false, "4th call should be blocked");
  // A different key is independent.
  assert.equal(rateLimit("test:other", 3, 60_000).ok, true);
  // A zero-length window means every call starts a fresh window (immediate reset).
  resetRateLimits();
  assert.equal(rateLimit(key, 1, 0).ok, true);
  assert.equal(rateLimit(key, 1, 0).ok, true);
});
