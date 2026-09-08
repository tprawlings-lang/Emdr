// The therapeutic-load policy engine (expansion handoff 05 §1, §6, §7, §13).
//
// Everything here runs against `assess`, which is pure: evidence in, state out,
// with the cutoff and the policy as arguments. That is what makes §13's first
// acceptance criterion — "safety gate is read first and always outranks
// therapeutic-load output" — something a test can PROVE rather than something
// the code intends. The gate arrives as data, so a test can hand it a blocked
// gate beside a perfect recovery record and check which one wins.
//
// THE FAILURES THIS FILE IS AIMED AT, and every one of them is a plausible
// implementation rather than a strawman:
//
//   SAFETY BECOMING THE STRONGEST INPUT INSTEAD OF THE FIRST ONE. A version
//   that gathered everything and weighted the gate heavily would pass most
//   tests and would, on a good enough recovery record, out-argue a safety stop.
//   §1: "the second can never answer the first or override it."
//
//   ONE GOOD SESSION BECOMING A PROGRESSION SUGGESTION. §7's first rule, and
//   the one a threshold off by one would break silently.
//
//   A MISSING FOLLOW-UP READING AS A GOOD ONE. §7: "missing delayed follow-up
//   prevents the system from assuming good recovery." An unasked question and
//   a good night produce the same absence of a bad answer.
//
//   IMMEDIATE SUDS DROPS OUTWEIGHING DELAYED BURDEN. §13: "repeated delayed
//   recovery can produce stabilize even when immediate session response looks
//   favorable." A session that ends with the person calmer is the most
//   persuasive evidence on the screen and the least complete.
//
//   A READINESS NUMBER APPEARING ANYWHERE. §13: "no readiness number is
//   displayed without explanation; preferred design is categorical
//   evidence-backed state."
//
//   AND THE SYSTEM DOING SOMETHING. §13: "no system action autonomously changes
//   treatment intensity, module access, or trauma-processing status."

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import {
  assess, loadContext,
  type LoadEvidence, type SessionRecovery, type LoadSnapshot,
} from "../src/lib/clinical/therapeutic-load";
import {
  THERAPEUTIC_LOAD_POLICY, LOAD_STATES, LOAD_STATE_LABEL, LOAD_STATE_NOTE,
  LOAD_DIMENSIONS, CAPACITY_DIMENSIONS, LOAD_DECISIONS, BLOCKING_GATE_STATES,
} from "../src/lib/clinical/therapeutic-load-policy";
import { selectLoadSignals } from "../src/lib/clinical/attention-providers/therapeutic-load";
import type { TrajectorySet } from "../src/lib/clinical/recovery-trajectory";

const CUTOFF = "2026-09-01T00:00:00.000Z";
const DAY = 86_400_000;

function day(n: number): string {
  return new Date(Date.parse(CUTOFF) - n * DAY).toISOString();
}

/** A session with a follow-up that went well. */
function goodSession(n: number, over: Partial<SessionRecovery> = {}): SessionRecovery {
  return {
    sessionId: `s-${n}`, moduleId: "calm-place", status: "completed",
    startedAt: day(n * 7), endedAt: day(n * 7),
    preSuds: 6, peakSuds: 5, postSuds: 3, hardStop: false,
    check: {
      id: `chk-${n}`, distress: 3, oriented: true, safeTonight: true,
      delayedRisk: 2, recoveryConfirmed: true, escalated: false, at: day(n * 7),
    },
    nextDay: { sleepQuality: 7, dissociation: 2, at: day(n * 7 - 1).slice(0, 10) },
    baseline: { sleepQuality: 7, dissociation: 2, at: day(n * 7 + 1).slice(0, 10) },
    ...over,
  };
}

/** A session whose evening went badly, whatever happened in the room. */
function hardEvening(n: number, over: Partial<SessionRecovery> = {}): SessionRecovery {
  return goodSession(n, {
    check: {
      id: `chk-${n}`, distress: 3, oriented: true, safeTonight: true,
      // The reading the room would not have told you: settled at the end of the
      // session, expecting a hard night.
      delayedRisk: 8, recoveryConfirmed: false, escalated: false, at: day(n * 7),
    },
    nextDay: { sleepQuality: 3, dissociation: 6, at: day(n * 7 - 1).slice(0, 10) },
    ...over,
  });
}

function emptyTrajectory(): TrajectorySet {
  return {
    personId: "p", evidenceCutoff: CUTOFF,
    policyVersion: "recovery-trajectory.1.0.0", snapshots: [], unavailable: [],
  };
}

function evidence(over: Partial<LoadEvidence> = {}): LoadEvidence {
  return {
    safety: {
      blocked: false, gateState: "open", moduleTitle: null, headline: null,
      safeAlternative: null, openAlerts: [], ref: null, evidenceIds: [],
    },
    sessions: [],
    fingerprints: [],
    trajectory: emptyTrajectory(),
    functional: { moving: 0, losingGround: 0, goalCount: 0, evidenceIds: [] },
    clinician: { uncertain: false, quote: null, thoughtId: null },
    unavailable: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §1 and §13: the authority boundary
// ---------------------------------------------------------------------------

test("a blocked gate short-circuits everything, however good the record is", () => {
  // The record here is as favourable as it gets: six clean sessions, goals
  // moving, nothing unresolved. A version that weighted the gate heavily rather
  // than reading it first would let this out-argue the block.
  const perfect = evidence({
    sessions: [1, 2, 3, 4, 5, 6].map((n) => goodSession(n)),
    functional: { moving: 3, losingGround: 0, goalCount: 3, evidenceIds: ["g1", "g2"] },
    safety: {
      blocked: true, gateState: "safety_stop", moduleTitle: "Recent trigger desensitization",
      headline: "Safety stop", safeAlternative: "Grounding and regulation practices",
      openAlerts: [], ref: "gate:desens:safety_stop", evidenceIds: [],
    },
  });
  const a = assess(perfect, { asOf: CUTOFF });
  assert.equal(a.state, "blocked_by_safety");
  // §1: "displays that external constraint and stops. It does not compute a
  // workaround." Nothing was computed, so there is nothing stored that argues
  // with the gate.
  assert.deepEqual(a.load, [], "dimensions were computed past a safety block");
  assert.deepEqual(a.capacity, []);
  assert.equal(a.safetyConstraint?.ref, "gate:desens:safety_stop");
  assert.ok(a.explanation.some((l) => /Safety stop/.test(l)), a.explanation.join(" | "));
  assert.ok(
    a.explanation.some((l) => /can(not|.{0,12}) change, weaken, or work around/i.test(l)),
    "the boundary must be said, not implied"
  );
});

test("the gate is read before any dimension is computed", () => {
  // Structural, not behavioural: the safety branch must come before the first
  // dimension call. A version that computed dimensions and then discarded them
  // would pass the test above and would still have a code path where a
  // recovery record was weighed against a safety stop.
  const src = fs.readFileSync("src/lib/clinical/therapeutic-load.ts", "utf8");
  const body = src.slice(src.indexOf("export function assess"));
  const gateAt = body.indexOf("evidence.safety.blocked");
  const firstDimensionAt = body.indexOf("acuteLoad(sessions");
  assert.ok(gateAt > 0 && firstDimensionAt > 0, "the assessment was not found");
  assert.ok(
    gateAt < firstDimensionAt,
    "a dimension is computed before the safety gate is read — §6 step 1 is 'if blocked, STOP'"
  );
});

test("an unreadable gate blocks rather than opens", () => {
  // §7: "any unresolved existing safety state prevents progression
  // suggestion", and unconfirmable is unresolved. The failure direction matters:
  // a gate Steady could not read must not default to open.
  assert.ok((BLOCKING_GATE_STATES as readonly string[]).includes("unknown"));
  assert.ok(
    !(BLOCKING_GATE_STATES as readonly string[]).includes("caution"),
    "caution is an open state with gentler framing; blocking on it would make every stabilization day read as a safety stop"
  );
});

test("nothing in the engine writes to a gate, a plan, or an unlock", () => {
  // §13: "no system action autonomously changes treatment intensity, module
  // access, or trauma-processing status." The safest way to keep that promise
  // is for the capability not to exist.
  const src = fs.readFileSync("src/lib/clinical/therapeutic-load.ts", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const table of ["module_unlocks", "alerts", "program_plans", "care_tracks", "therapy_sessions"]) {
    assert.ok(
      !new RegExp(`insert\\([\\s\\S]{0,40}${table}|update[\\s\\S]{0,20}${table}`, "i").test(code),
      `the load engine writes to ${table}`
    );
  }
  // Only the three tables this feature owns.
  const inserts = [...code.matchAll(/insert\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(inserts)].sort(),
    ["therapeutic_load_evidence", "therapeutic_load_reviews", "therapeutic_load_snapshots"]
  );
});

// ---------------------------------------------------------------------------
// §7: the conservative rules
// ---------------------------------------------------------------------------

test("one good session cannot produce a progression suggestion", () => {
  const a = assess(evidence({ sessions: [goodSession(1), goodSession(2)] }), { asOf: CUTOFF });
  assert.notEqual(a.state, "consider_progression");
  assert.ok(
    a.progressionBlockers.some((b) => /One good session is not a pattern/.test(b)),
    a.progressionBlockers.join(" | ")
  );
});

test("a missing follow-up is missing evidence, not good recovery", () => {
  // Five clean sessions and one nobody asked about. §7: "missing delayed
  // follow-up prevents the system from assuming good recovery."
  const sessions = [
    ...[1, 2, 3, 4, 5].map((n) => goodSession(n)),
    goodSession(6, { check: null }),
  ];
  const a = assess(evidence({
    sessions,
    functional: { moving: 2, losingGround: 0, goalCount: 2, evidenceIds: ["g1"] },
  }), { asOf: CUTOFF });
  assert.notEqual(a.state, "consider_progression");
  assert.ok(
    a.progressionBlockers.some((b) => /cannot assume the recovery went well/.test(b)),
    a.progressionBlockers.join(" | ")
  );
  assert.ok(
    a.limitations.some((l) => /nobody ask/.test(l) && /not good recovery/.test(l)),
    a.limitations.join(" | ")
  );
});

test("repeated delayed burden outweighs a favourable in-session response", () => {
  // §13's acceptance criterion: "repeated delayed recovery can produce
  // stabilize even when immediate session response looks favorable." Every one
  // of these sessions ended with the person calmer than they started.
  const sessions = [1, 2, 3, 4].map((n) => hardEvening(n));
  for (const s of sessions) {
    assert.ok(s.postSuds! < s.preSuds!, "the fixture must look favourable in the room");
  }
  const a = assess(evidence({ sessions }), { asOf: CUTOFF });
  assert.equal(a.state, "stabilize");
  const high = a.load.filter((d) => d.reading === "high").map((d) => d.key);
  assert.ok(high.includes("recovery_time"), high.join(", "));
});

test("functional deterioration rules out progression whatever the sessions did", () => {
  // §7: "functional deterioration or multi-domain trajectory reversal prevents
  // a favorable progression suggestion... even if immediate session SUDS
  // decreases."
  const a = assess(evidence({
    sessions: [1, 2, 3, 4, 5].map((n) => goodSession(n)),
    functional: { moving: 0, losingGround: 2, goalCount: 2, evidenceIds: ["g1", "g2"] },
  }), { asOf: CUTOFF });
  assert.notEqual(a.state, "consider_progression");
  assert.ok(
    a.progressionBlockers.some((b) => /lost ground/.test(b)),
    a.progressionBlockers.join(" | ")
  );
});

test("an open safety alert rules out progression", () => {
  const a = assess(evidence({
    sessions: [1, 2, 3, 4, 5].map((n) => goodSession(n)),
    functional: { moving: 2, losingGround: 0, goalCount: 2, evidenceIds: ["g1"] },
    safety: {
      blocked: false, gateState: "open", moduleTitle: null, headline: null,
      safeAlternative: null, ref: null, evidenceIds: ["a1"],
      openAlerts: [{ id: "a1", status: "open" }] as never,
    },
  }), { asOf: CUTOFF });
  assert.notEqual(a.state, "consider_progression");
  assert.ok(
    a.progressionBlockers.some((b) => /unresolved safety state/i.test(b)),
    a.progressionBlockers.join(" | ")
  );
});

test("a clinician's own recorded uncertainty holds the state, and says it did", () => {
  // §7 allows this "if configured" and warns it "should not be silently
  // treated as a deterministic safety rule". So: it is a named flag, it only
  // ever moves the state down, and it is reported.
  const base = {
    sessions: [1, 2, 3, 4, 5].map((n) => goodSession(n)),
    functional: { moving: 2, losingGround: 0, goalCount: 2, evidenceIds: ["g1"] },
    fingerprints: [{
      definition: { id: "d1", displayName: "Container" },
      patternState: "favorable_observed_pattern",
      evidence: { instanceIds: ["i1"], observationIds: [] },
    }] as never,
  };
  const open = assess(evidence(base), { asOf: CUTOFF });
  assert.equal(open.state, "consider_progression", "the fixture must reach progression without the note");

  const held = assess(evidence({
    ...base,
    clinician: { uncertain: true, quote: "Not sure she is ready for more.", thoughtId: "t1" },
  }), { asOf: CUTOFF });
  assert.equal(held.state, "maintain", "the clinician's own note did not hold it");
  assert.ok(
    held.progressionBlockers.some((b) => /Your own note/.test(b) && /not a rule Steady applied to you/.test(b)),
    held.progressionBlockers.join(" | ")
  );

  // And it is a flag with a name, not an unconditional rule.
  const ignored = assess(evidence({
    ...base,
    clinician: { uncertain: true, quote: "Not sure.", thoughtId: "t1" },
  }), { asOf: CUTOFF, policy: { ...THERAPEUTIC_LOAD_POLICY, clinicianUncertaintyHolds: false } });
  assert.equal(ignored.state, "consider_progression");
});

test("progression is reachable when the record actually supports it", () => {
  // A negative-only suite would pass with an engine that never says
  // consider_progression, which would be useless rather than safe.
  const a = assess(evidence({
    sessions: [1, 2, 3, 4, 5].map((n) => goodSession(n)),
    functional: { moving: 2, losingGround: 0, goalCount: 2, evidenceIds: ["g1"] },
    fingerprints: [{
      definition: { id: "d1", displayName: "Container" },
      patternState: "favorable_observed_pattern",
      evidence: { instanceIds: ["i1"], observationIds: [] },
    }] as never,
  }), { asOf: CUTOFF });
  assert.equal(a.state, "consider_progression");
  assert.deepEqual(a.progressionBlockers, []);
  // §1: an invitation to review, never an instruction.
  const words = [a.stateLabel, LOAD_STATE_NOTE[a.state], ...a.explanation].join(" ");
  assert.ok(/review/i.test(words));
  assert.ok(
    !/is ready|should progress|progress the patient|proceed with|begin processing/i.test(words),
    `the state reads as an instruction: ${words}`
  );
  assert.ok(
    a.explanation.some((l) => /Nothing has been unlocked, scheduled, or changed/.test(l)),
    "every non-blocked state must say the system did not act"
  );
});

// ---------------------------------------------------------------------------
// §3 and §13: absence, and no numbers
// ---------------------------------------------------------------------------

test("too little recovery evidence is insufficient_data, not maintain", () => {
  const a = assess(evidence({ sessions: [goodSession(1)] }), { asOf: CUTOFF });
  assert.equal(a.state, "insufficient_data");
  assert.ok(
    a.explanation.some((l) => /not a reassuring answer/.test(l)),
    "an absence must say what it is not: " + a.explanation.join(" | ")
  );
  assert.deepEqual(a.load, [], "dimensions were computed below the evidence threshold");
});

test("not established is never rendered as clear", () => {
  // A person with sessions and follow-ups but nothing else: most dimensions
  // cannot be established, and the reading must say so rather than reading as
  // a clean bill.
  const a = assess(evidence({ sessions: [1, 2, 3].map((n) => goodSession(n)) }), { asOf: CUTOFF });
  const unestablished = [...a.load, ...a.capacity].filter((d) => d.reading === "not_established");
  assert.ok(unestablished.length > 0, "the fixture must leave something unestablished");
  assert.ok(
    a.limitations.some((l) => /Not established is not the same as clear/.test(l)),
    a.limitations.join(" | ")
  );
  for (const d of unestablished) {
    assert.ok(d.detail.length > 20, `${d.key} says nothing about why it could not be established`);
    assert.ok(
      !/\bno concerns\b|\bfine\b|\bclear\b|\bnormal\b/i.test(d.detail),
      `${d.key} reads as clear: ${d.detail}`
    );
  }
});

test("there is no readiness number anywhere in the output", () => {
  // §13: "no readiness number is displayed without explanation; preferred
  // design is categorical evidence-backed state." The surest way to keep a
  // number off the screen is for there not to be one in the object.
  const a = assess(evidence({
    sessions: [1, 2, 3, 4].map((n) => hardEvening(n)),
  }), { asOf: CUTOFF });
  const numeric = Object.entries(a).filter(([, v]) => typeof v === "number");
  assert.deepEqual(numeric, [], `a numeric field on the assessment: ${numeric.map(([k]) => k).join(", ")}`);
  for (const d of [...a.load, ...a.capacity]) {
    const dimNumeric = Object.entries(d).filter(([, v]) => typeof v === "number");
    assert.deepEqual(dimNumeric, [], `${d.key} carries a number`);
  }
  // And no score-shaped word in the engine's own code.
  const src = fs.readFileSync("src/lib/clinical/therapeutic-load.ts", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const word of ["readinessScore", "loadScore", "weighted", "totalScore"]) {
    assert.ok(!new RegExp(word, "i").test(code), `the engine computes a ${word}`);
  }
});

test("every state, dimension and decision has words, and none is an order", () => {
  for (const state of LOAD_STATES) {
    assert.ok(LOAD_STATE_LABEL[state].length > 0, `${state} has no label`);
    assert.ok(LOAD_STATE_NOTE[state].length > 40, `${state} has no note`);
    const words = `${LOAD_STATE_LABEL[state]} ${LOAD_STATE_NOTE[state]}`;
    assert.ok(
      !/you should|you must|progress the patient|begin reprocessing|start processing|increase the dose/i.test(words),
      `${state} reads as an instruction: ${words}`
    );
  }
  assert.equal(LOAD_DIMENSIONS.length, 7, "§4 lists seven load dimensions");
  assert.equal(CAPACITY_DIMENSIONS.length, 4);
  assert.equal(LOAD_DECISIONS.length, 6, "§8 lists six clinician actions");
});

// ---------------------------------------------------------------------------
// §9: what reaches the Command Center
// ---------------------------------------------------------------------------

function snapshotOf(a: ReturnType<typeof assess>): LoadSnapshot {
  return { ...a, id: "snap-1", personId: "p", unavailable: [] };
}

test("a blocked reading never becomes a work item", () => {
  // §1's authority boundary at the queue: the safety engine has already raised
  // whatever it raises, and a second row saying "this person is blocked" would
  // be this feature borrowing the authority it is explicitly denied.
  const blocked = assess(evidence({
    safety: {
      blocked: true, gateState: "safety_stop", moduleTitle: "M", headline: "Safety stop",
      safeAlternative: "Grounding", openAlerts: [], ref: "gate:m:safety_stop", evidenceIds: [],
    },
  }), { asOf: CUTOFF });
  assert.deepEqual(selectLoadSignals(snapshotOf(blocked)), []);
});

test("maintain and insufficient_data never become work items", () => {
  const thin = assess(evidence({ sessions: [goodSession(1)] }), { asOf: CUTOFF });
  assert.deepEqual(selectLoadSignals(snapshotOf(thin)), []);
  const maintain = assess(evidence({ sessions: [1, 2, 3].map((n) => goodSession(n)) }), { asOf: CUTOFF });
  assert.equal(maintain.state, "maintain");
  assert.deepEqual(selectLoadSignals(snapshotOf(maintain)), []);
});

test("stabilize reaches the queue as review_today, and never claims safety", () => {
  const a = assess(evidence({ sessions: [1, 2, 3, 4].map((n) => hardEvening(n)) }), { asOf: CUTOFF });
  assert.equal(a.state, "stabilize");
  const [row] = selectLoadSignals(snapshotOf(a));
  assert.ok(row, "a stabilize reading produced no row");
  assert.equal(row.band, "review_today");
  assert.equal(row.dedupeKey, "therapeutic_load", "one lineage for the whole feature");
  assert.ok(
    !/urgent|immediately|escalate|crisis|unsafe/i.test(row.statement),
    `the statement claims safety authority: ${row.statement}`
  );
  assert.ok(
    row.limitations.some((l) => /Decision support, not a treatment decision/.test(l)),
    row.limitations.join(" | ")
  );
  assert.ok(row.evidenceIds.length > 0, "a row asserting repeated burden cited nothing");
});

test("an open safety alert suppresses the row rather than doubling it", () => {
  // §9: "deduplicate against existing safety hard stops and unresolved
  // post-session alerts." A person whose safety picture is already producing
  // work does not need a second, quieter row about the same week.
  const a = assess(evidence({
    sessions: [1, 2, 3, 4].map((n) => hardEvening(n)),
    safety: {
      blocked: false, gateState: "open", moduleTitle: null, headline: null,
      safeAlternative: null, ref: null, evidenceIds: ["a1"],
      openAlerts: [{ id: "a1", status: "open" }] as never,
    },
  }), { asOf: CUTOFF });
  assert.equal(a.state, "stabilize", "the fixture must still reach stabilize");
  assert.deepEqual(
    selectLoadSignals(snapshotOf(a)), [],
    "a second row was raised beside an open safety alert"
  );
});

// ---------------------------------------------------------------------------
// The compact shape
// ---------------------------------------------------------------------------

test("the compact context carries at most four named bullets and no number", () => {
  const a = assess(evidence({ sessions: [1, 2, 3, 4].map((n) => hardEvening(n)) }), { asOf: CUTOFF });
  const context = loadContext(snapshotOf(a));
  assert.ok(context.bullets.length > 0 && context.bullets.length <= 4, `${context.bullets.length} bullets`);
  for (const b of context.bullets) assert.match(b, /: /, `a bullet with no label: ${b}`);
  assert.deepEqual(Object.entries(context).filter(([, v]) => typeof v === "number"), []);
  assert.equal(context.blockedBySafety, false);
});
