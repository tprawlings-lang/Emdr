// Its own database. Every other test file sets this before the first import,
// and a file that writes locks and reset rows into the served database would
// block a presenter on a screen nobody is testing.
process.env.EMDR_DATA_DIR = `/tmp/steady-director-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

// The demo director (handoff 09 §7.2, §7.3, §9, §10 Package 4).
//
// Package 4's exit evidence is two sentences, and they are the two hardest
// things in this package to keep true by review:
//
//   "NAMED SCENARIOS COMPLETE FROM THE PUBLISHED BASELINE." Not "a launcher
//   exists". Specific stories, written down, that run end to end on the
//   dataset a reset rebuilds. So the guards walk every registered scenario
//   step by step through the real transition rule, and check every href
//   against Package 0's route register — a story pointing at a renamed route
//   is a story that dead-ends in front of an audience.
//
//   "RESET FAILURE NEVER DISPLAYS READY." The failure this rules out is
//   specific and was live in this codebase: the reset action caught its own
//   exception and wrote an audit row nobody read, and the console then
//   recomputed health from the live database. A reset that threw part-way can
//   leave a database that still passes the manifest, and the screen would say
//   ready. The guard reproduces exactly that — a recorded failure over a
//   healthy database — and asserts the state is blocked.
//
// AND §9's REASON FOR THE SCENARIO CONTRACT: "Investor storytelling must not
// add privileges." A scenario has no field a capability could occupy, and the
// walk that proves it runs over every registered scenario rather than over a
// fixture, because the fixture is not what ships.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import {
  PRESENTATION_AUDIENCES, AUDIENCE_LABEL, FORBIDDEN_SCENARIO_FIELDS, hasShorterStory,
  TRANSITIONS, TRANSITION_LABEL,
  assertGrantsNothing, grantViolations, ScenarioError,
  begin, transition, resumable, position, stepsFor, shorterStory, actualMinutes,
  type ScenarioProgress,
} from "../src/lib/experience/scenario";
import { SCENARIOS, scenario, scenariosFor } from "../src/lib/demo/scenario-registry";
import {
  environmentStatus, meetsRequirements, recordReset, readLastReset, PREFLIGHT_STATES,
} from "../src/lib/demo/preflight";
import {
  acquireLock, releaseLock, activeLock, canReset, resetScope, STALE_AFTER_MINUTES,
} from "../src/lib/demo/environment-lock";
import { ROUTE_REGISTER } from "../src/lib/app/route-register";

const db = getDb();
const SRC = path.join(__dirname, "..", "src");
const read = (p: string) => fs.readFileSync(path.join(SRC, p), "utf8");

/**
 * A file with its commentary removed.
 *
 * THREE GUARDS IN THIS FILE FAILED ON THEIR OWN PROSE the first time they ran:
 * a check for "the registry reaches for authorization" matched a comment
 * saying the registry must not; a check for a disabled control matched a
 * comment saying there is deliberately no disabled control; a check that the
 * console no longer calls the reset unbuilt matched the note recording that it
 * used to. This codebase has made that mistake once before and fixed it the
 * same way — a guard over source has to read what RUNS, or a file is punished
 * for explaining itself.
 */
const code = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Reset the singleton tables this file writes, so each test starts level. */
function clearEnvironmentState(): void {
  db.prepare("DELETE FROM demo_environment_lock").run();
  db.prepare("DELETE FROM demo_reset_log").run();
}

// ---------------------------------------------------------------------------
// §9 — a scenario grants nothing
// ---------------------------------------------------------------------------

test("no registered scenario can carry access", () => {
  // The whole reason §9 names the Scenario contract. The obvious
  // implementation of "the investor walkthrough" is a role switcher with a
  // story wrapped round it, and §7.2 rules that out by name.
  for (const s of SCENARIOS) {
    assert.deepEqual(grantViolations(s, s.id), [], `${s.id} carries access`);
  }
  assert.ok(SCENARIOS.length > 0, "an empty registry proves nothing");
});

test("a scenario that tries to carry a role is refused at registration", () => {
  for (const field of FORBIDDEN_SCENARIO_FIELDS) {
    const poisoned = { id: "x", steps: [{ id: "s", [field.name]: "clinician" }] };
    assert.throws(
      () => assertGrantsNothing(poisoned, "scenario"),
      ScenarioError,
      `"${field.name}" was accepted, so a scenario can carry ${field.what}`
    );
  }
});

test("the forbidden list names the fields that actually grant access", () => {
  // THE LOOP ABOVE ITERATES OVER THE LIST IT IS CHECKING, so deleting an entry
  // from the list deletes the test of it — the guard passed with `role`
  // removed. A list-driven check proves the mechanism works and proves nothing
  // about the list's contents, so the contents are named here.
  const names = new Set(FORBIDDEN_SCENARIO_FIELDS.map((f) => f.name));
  for (const required of [
    "role", "roles", "as", "runAs",
    "capability", "capabilities",
    "grant", "grants", "permission", "permissions",
    "elevate", "writeCapable", "impersonate", "tenantId",
  ]) {
    assert.ok(names.has(required), `"${required}" left the forbidden list, so a scenario may carry it`);
  }
});

test("registration is what refuses, not review", () => {
  // Removing `assertGrantsNothing` from the registry passes every other guard
  // in this file, because none of the SHIPPED scenarios carries a grant —
  // which is exactly the state in which somebody deletes the call as dead
  // weight, six months before the scenario that needed it.
  const src = code("lib/demo/scenario-registry.ts");
  assert.match(
    src, /export const SCENARIOS[\s\S]{0,200}assertGrantsNothing\(/,
    "the registry does not pass its scenarios through the refusal"
  );
});

test("the refusal reaches any depth, not just the top level", () => {
  const nested = { id: "x", closeout: { exists: [{ detail: { runAs: "clinician" } }] } };
  const bad = grantViolations(nested, "scenario");
  assert.equal(bad.length, 1);
  assert.match(bad[0].at, /closeout\.exists\[0\]\.detail\.runAs/);
});

test("a presentation audience is not a role name in this system", () => {
  // "investor" here means who the story is told to. If one of these ever
  // matches a real audience with capabilities behind it, the two concepts have
  // started to merge and somebody will wire them together.
  assert.deepEqual(
    [...PRESENTATION_AUDIENCES],
    ["investor", "clinical", "organization", "payer", "security"]
  );
  for (const a of PRESENTATION_AUDIENCES) {
    assert.ok(AUDIENCE_LABEL[a]?.length > 0, `${a} has no label`);
  }
  // And the registry module reaches for no authorization at all — in what it
  // runs, not in what it says about itself.
  const src = code("lib/demo/scenario-registry.ts");
  assert.ok(!/capabilit|requireRole|SessionUser|experienceContextFor|requireUser/i.test(src),
    "the scenario registry reaches for authorization");
});

// ---------------------------------------------------------------------------
// Named scenarios complete from the published baseline
// ---------------------------------------------------------------------------

test("every scenario step opens a route the register knows and calls working", () => {
  // A story pointing at a renamed route is a story that dead-ends in front of
  // an audience. Checked against Package 0's register rather than the
  // filesystem, so a route that EXISTS but is recorded as not working is also
  // refused.
  const byPath = new Map(ROUTE_REGISTER.map((e) => [e.path, e]));
  for (const s of SCENARIOS) {
    for (const step of s.steps) {
      const entry = byPath.get(step.href);
      assert.ok(entry, `${s.id}/${step.id} opens ${step.href}, which the register does not list`);
      assert.equal(
        entry!.state, "working",
        `${s.id}/${step.id} opens ${step.href}, which the register records as ${entry!.state}`
      );
    }
  }
});

test("every scenario runs end to end through the real transition rule", () => {
  // "Named scenarios complete from the published baseline." Walked with the
  // production function rather than by indexing the array, so a rule that
  // refuses a legitimate step fails here rather than in a meeting.
  for (const s of SCENARIOS) {
    let progress = begin(s, "2026-09-09T09:00:00.000Z");
    const total = s.steps.length;
    for (let i = 1; i < total; i++) {
      const result = transition(s, progress, "next", true);
      assert.ok(result.allowed, `${s.id} stopped at step ${i}: ${!result.allowed && result.reason}`);
      progress = result.next;
    }
    assert.equal(position(s, progress).number, total, `${s.id} did not reach its last step`);
    assert.ok(position(s, progress).atEnd);
    // And back out again, which §7.2 requires without qualification.
    for (let i = total - 1; i > 0; i--) {
      const back = transition(s, progress, "back", true);
      assert.ok(back.allowed, `${s.id} could not go back from step ${i + 1}`);
      progress = back.next;
    }
    assert.equal(position(s, progress).number, 1);
  }
});

test("the shorter story exists, is shorter, and keeps the ending", () => {
  // §7.2: "choose a shorter story". A truncation is not a shorter story — the
  // steps that survive are the ones somebody decided were the spine.
  for (const s of SCENARIOS) {
    const short = shorterStory(s);
    assert.ok(short.length > 0, `${s.id} has no shorter story`);
    assert.ok(short.length <= s.steps.length);
    assert.ok(
      actualMinutes(short) <= actualMinutes(s.steps),
      `${s.id}'s shorter story is not shorter`
    );
    // THE CLOSEOUT SURVIVES THE SHORT VERSION. §7.2's honest-limits statement
    // is the one thing a presenter who is out of time must not skip, and the
    // guide renders it at `atEnd` — so the property to check is that the short
    // story HAS an end the guide recognises, whichever step that is.
    const atEndOfShort = position(s, {
      scenarioId: s.id, version: s.version, shortened: true,
      index: short.length - 1, startedAt: "2026-09-09T09:00:00.000Z",
    });
    assert.ok(atEndOfShort.atEnd, `${s.id}'s shorter story has no end, so the closeout never renders`);
    assert.equal(atEndOfShort.total, short.length);
  }
});

test("the investor story keeps its limitations beat in the shorter version", () => {
  // §7.2 names five beats for the five-minute story and the last is the
  // bounded next step with the honest limits on it. The closeout block renders
  // either way; this is the STEP, and a five-minute story that drops it is the
  // pitch this document argues hardest against — "the honest-limitations slide
  // is not a concession; it is the strongest asset in the deck."
  const s = scenario("between-visit")!;
  const limits = s.steps.find((x) => x.id === "limits")!;
  assert.equal(limits.essential, true, "the shorter investor story drops the limitations");
  assert.equal(shorterStory(s).at(-1)!.id, "limits");
});

test("a story's estimate matches the steps it is made of", () => {
  // A five-minute story whose steps total eleven minutes is a promise the
  // presenter breaks in the room.
  for (const s of SCENARIOS) {
    assert.equal(
      actualMinutes(s.steps), s.minutes,
      `${s.id} claims ${s.minutes} minutes and its steps total ${actualMinutes(s.steps)}`
    );
  }
});

test("the investor story follows §7.2's five beats in order", () => {
  // "the between-visit problem, the member action, the clinician review, the
  // aggregate evidence, and a bounded next step." The order IS the argument:
  // the aggregate chart means nothing to somebody who has not just watched one
  // member act and one clinician review it.
  const s = scenario("between-visit");
  assert.ok(s, "the investor story is not registered");
  assert.equal(s!.audience, "investor");
  assert.deepEqual(
    s!.steps.map((x) => x.id),
    ["problem", "member", "clinician", "aggregate", "limits"]
  );
  assert.ok(s!.minutes <= 5, "§7.2 says five minutes");
});

test("every story says what it does not claim, and names one decision", () => {
  // §7.2: "a concise statement of what exists, what is unfinished, and what
  // decision is being asked for." A story that ends with four asks has no ask.
  for (const s of SCENARIOS) {
    assert.ok(s.limitations.length > 0, `${s.id} claims things and disclaims nothing`);
    assert.ok(s.closeout.exists.length > 0, `${s.id} says nothing exists`);
    assert.ok(s.closeout.unfinished.length > 0, `${s.id} says nothing is unfinished`);
    assert.ok(s.closeout.decision.trim().length > 0, `${s.id} asks for no decision`);
    assert.ok(
      !s.closeout.decision.includes(";"),
      `${s.id} asks for more than one decision: "${s.closeout.decision}"`
    );
    // Every story says the data is fabricated, in its own words rather than
    // relying on the chrome.
    assert.ok(
      s.limitations.some((l) => /fabricat|invent/i.test(l)),
      `${s.id} does not say its data is fabricated`
    );
  }
});

test("a simulated screen is labelled as one", () => {
  // §7.2: "Real working screens with clearly labeled simulations."
  for (const s of SCENARIOS) {
    for (const step of s.steps) {
      assert.equal(typeof step.simulated, "boolean", `${s.id}/${step.id} does not say`);
    }
  }
  const guide = code("components/demo/WalkthroughGuide.tsx");
  assert.match(guide, /step\.simulated &&/, "the guide never renders the simulated label");
  assert.match(guide, /Simulated/);
});

test("scenariosFor filters by presentation audience and nothing else", () => {
  assert.ok(scenariosFor("investor").every((s) => s.audience === "investor"));
  assert.equal(scenariosFor("payer").length, scenariosFor("payer").filter((s) => s.audience === "payer").length);
});

// ---------------------------------------------------------------------------
// §7.2 — permitted transitions
// ---------------------------------------------------------------------------

const S = SCENARIOS[0];
const start = (): ScenarioProgress => begin(S, "2026-09-09T09:00:00.000Z");

test("back is always permitted and forward is one step at a time", () => {
  let p = start();
  assert.equal(transition(S, p, "back", true).allowed, false, "step one has nowhere back");
  const next = transition(S, p, "next", true);
  assert.ok(next.allowed);
  p = next.next;
  assert.ok(transition(S, p, "back", true).allowed);
  // And forward moves exactly one, never two.
  const onwards = transition(S, p, "next", true);
  assert.ok(onwards.allowed);
  assert.equal(onwards.next.index, 2);
});

test("next is refused while the environment is not ready", () => {
  // §7.3's rule reaching the audience rather than the operator: a walkthrough
  // that advances into a screen the environment cannot serve.
  const p = start();
  const blocked = transition(S, p, "next", false);
  assert.equal(blocked.allowed, false);
  assert.match(!blocked.allowed ? blocked.reason : "", /not ready/i);
  // Back still works. A presenter whose environment broke can still retreat.
  const q = transition(S, p, "next", true);
  assert.ok(q.allowed);
  assert.ok(transition(S, q.next, "back", false).allowed, "a broken environment trapped the presenter");
});

test("a walkthrough cannot cross a version boundary", () => {
  // §7.2: "Claims and limitations stay attached to the scenario version." The
  // alternative is a presenter picking up at step 4 of a story whose claims
  // changed at step 2.
  const stale: ScenarioProgress = { ...start(), version: "between-visit.0.9.0" };
  const moved = transition(S, stale, "next", true);
  assert.equal(moved.allowed, false);
  assert.match(!moved.allowed ? moved.reason : "", /changed since/i);
  assert.equal(resumable(S, stale).ok, false);
  assert.match(resumable(S, stale).reason ?? "", /began under/);
});

test("the shorter story restarts rather than guessing an equivalent position", () => {
  // Against a scenario that HAS one — see the guard below for the case where
  // there is nothing shorter to offer.
  const T = SCENARIOS.find(hasShorterStory);
  assert.ok(T, "no registered scenario has a shorter story, so the feature is untested");
  let p = begin(T!, "2026-09-09T09:00:00.000Z");
  p = (transition(T!, p, "next", true) as { next: ScenarioProgress }).next;
  const short = transition(T!, p, "shorter", true);
  assert.ok(short.allowed);
  assert.equal(short.next.shortened, true);
  assert.equal(short.next.index, 0);
  // And it cannot be chosen twice.
  assert.equal(transition(T!, short.next, "shorter", true).allowed, false);
  assert.equal(stepsFor(T!, short.next).length, shorterStory(T!).length);
});

test("a story with nothing to cut does not offer a shorter version", () => {
  // FOUND BY LOOKING AT THE LAUNCHER. The investor story is five minutes and
  // all five of §7.2's beats are essential, so its "shorter story" was the same
  // five steps — advertised on the card as "5 minutes · 5 screens · 5 minutes
  // short". A presenter reaching for that mid-meeting because they are out of
  // time gets nothing and loses the seconds they were trying to save.
  for (const s of SCENARIOS) {
    const equal = shorterStory(s).length === s.steps.length;
    assert.equal(hasShorterStory(s), !equal, `${s.id} disagrees about whether it can be shortened`);
    if (equal) {
      const refused = transition(s, begin(s, "2026-09-09T09:00:00.000Z"), "shorter", true);
      assert.equal(refused.allowed, false, `${s.id} offers a shorter story identical to itself`);
      assert.match(!refused.allowed ? refused.reason : "", /no shorter version/i);
    }
  }
  // And the card only prints the short duration when there is one.
  const page = code("app/demo/scenarios/page.tsx");
  assert.match(page, /hasShorterStory\(s\) &&/);
});

test("progress from another story is refused", () => {
  const foreign: ScenarioProgress = { ...start(), scenarioId: "not-a-story" };
  assert.equal(transition(S, foreign, "next", true).allowed, false);
  assert.equal(resumable(S, foreign).ok, false);
});

test("every transition has a label a presenter can read", () => {
  for (const t of TRANSITIONS) {
    assert.ok(TRANSITION_LABEL[t]?.length > 0, `${t} has no label`);
  }
});

// ---------------------------------------------------------------------------
// Preflight — deterministic, and a reset failure never displays ready
// ---------------------------------------------------------------------------

test("preflight is deterministic against one database", () => {
  // §10 asks for a "deterministic preflight". The failure it rules out is a
  // check that passes at 09:58 and fails at 10:02 because it compared a
  // timestamp to `now`. Every check is a function of database content, and
  // this is the property a clock-dependent one cannot satisfy.
  clearEnvironmentState();
  const a = environmentStatus(db);
  const b = environmentStatus(db);
  assert.deepEqual(
    a.checks.map((c) => [c.id, c.pass, c.actual]),
    b.checks.map((c) => [c.id, c.pass, c.actual]),
    "two reads of the same database disagreed"
  );
  assert.equal(a.state, b.state);
});

test("a recorded reset failure blocks the environment even when everything else passes", () => {
  // THE EXIT-EVIDENCE SENTENCE, reproduced exactly. A reset that threw
  // part-way can leave a database that still passes the manifest; before this
  // the console recomputed health from that database and said ready.
  clearEnvironmentState();
  const healthy = environmentStatus(db);
  const otherFailures = healthy.checks.filter((c) => c.id !== "last_reset" && !c.pass);

  recordReset(db, { status: "failed", reason: "rebuild before the 3pm session", detail: "disk full" });
  const after = environmentStatus(db);

  assert.equal(after.state, "blocked", "a failed rebuild displayed ready");
  const resetCheck = after.checks.find((c) => c.id === "last_reset");
  assert.ok(resetCheck && !resetCheck.pass);
  assert.match(resetCheck!.actual, /FAILED/);
  assert.match(resetCheck!.actual, /disk full/);
  // And it is the reset that blocked it, not something incidental.
  assert.equal(
    after.failures.filter((f) => f.id !== "last_reset").length, otherFailures.length,
    "the test proved something other than the reset failure"
  );
});

test("a successful reset clears the block, and no recorded reset is not a failure", () => {
  clearEnvironmentState();
  // A fresh environment has never been reset and is not thereby unfit.
  assert.equal(readLastReset(db), null);
  assert.ok(environmentStatus(db).checks.find((c) => c.id === "last_reset")!.pass);

  recordReset(db, { status: "failed", reason: "x", detail: "boom" });
  assert.equal(environmentStatus(db).state, "blocked");
  recordReset(db, { status: "succeeded", reason: "rebuilt" });
  assert.ok(environmentStatus(db).checks.find((c) => c.id === "last_reset")!.pass);
  clearEnvironmentState();
});

test("the reset outcome is recorded on both paths", () => {
  // The defect was that only the audit chain held it and nothing read that.
  const src = code("lib/demo-reset-actions.ts");
  const body = src.slice(src.indexOf("export async function resetDemoEnvironment"));
  const tryAt = body.indexOf("try {");
  const catchAt = body.indexOf("} catch (err)");
  assert.ok(tryAt > 0 && catchAt > tryAt);
  assert.match(body.slice(tryAt, catchAt), /recordReset\([\s\S]*?"succeeded"/);
  assert.match(body.slice(catchAt), /recordReset\([\s\S]*?"failed"/);
});

test("ready has no qualifier", () => {
  // A presenter who reads "ready" has stopped reading, which is correct
  // behaviour and the reason the word has to mean it.
  assert.deepEqual([...PREFLIGHT_STATES], ["ready", "blocked", "unknown"]);
  const src = code("lib/demo/preflight.ts");
  const verdict = src.slice(src.indexOf("state: failures.length"), src.indexOf("checks,\n    failures"));
  assert.match(verdict, /failures\.length === 0 \? "ready" : "blocked"/);
  assert.ok(!/warn/i.test(verdict), "the verdict has a warning tier");
});

test("a scenario cannot pass preflight by naming a check nobody implemented", () => {
  clearEnvironmentState();
  const status = environmentStatus(db);
  const made_up = meetsRequirements(status, ["a_check_that_does_not_exist"]);
  assert.equal(made_up.ready, false);
  assert.deepEqual(made_up.unknown, ["a_check_that_does_not_exist"]);
});

test("every scenario's requirements name real checks", () => {
  clearEnvironmentState();
  const ids = new Set(environmentStatus(db).checks.map((c) => c.id));
  for (const s of SCENARIOS) {
    assert.ok(s.requires.length > 0, `${s.id} requires nothing of the environment`);
    for (const r of s.requires) {
      assert.ok(ids.has(r), `${s.id} requires "${r}", which no check provides`);
    }
  }
});

// ---------------------------------------------------------------------------
// §7.3 — the environment lock
// ---------------------------------------------------------------------------

test("a second operator cannot take a held environment", () => {
  clearEnvironmentState();
  const first = acquireLock({
    scenarioId: "between-visit", scenarioVersion: "v1", personId: "op-1", personName: "Dana",
  });
  assert.ok(first.ok);
  const second = acquireLock({
    scenarioId: "clinical-walkthrough", scenarioVersion: "v1", personId: "op-2", personName: "Sam",
  });
  assert.equal(second.ok, false);
  assert.equal(second.lock?.heldBy, "op-1");
  assert.match(second.reason ?? "", /Dana/);
  clearEnvironmentState();
});

test("taking your own lock again is not an error", () => {
  // A presenter who reloads the guide is the same walkthrough. Refusing them
  // would teach them to interrupt, which is the habit this prevents.
  clearEnvironmentState();
  acquireLock({ scenarioId: "between-visit", scenarioVersion: "v1", personId: "op-1" });
  const held = activeLock()!;
  const again = acquireLock({ scenarioId: "between-visit", scenarioVersion: "v1", personId: "op-1" });
  assert.ok(again.ok);
  // And it does not reset their own staleness clock.
  assert.equal(again.lock?.acquiredAt, held.acquiredAt);
  clearEnvironmentState();
});

test("a reset is refused during a walkthrough, and an interrupt needs a reason", () => {
  // §7.3: "prevent a reset during another walkthrough unless an authorized
  // operator deliberately interrupts."
  clearEnvironmentState();
  assert.equal(canReset({ interrupt: false, interruptReason: "" }).allowed, true, "an idle environment refused");

  acquireLock({ scenarioId: "between-visit", scenarioVersion: "v1", personId: "op-1", personName: "Dana" });

  const plain = canReset({ interrupt: false, interruptReason: "" });
  assert.equal(plain.allowed, false);
  assert.equal(plain.blockedBy?.heldBy, "op-1");
  assert.match(plain.reason ?? "", /walkthrough is running/i);

  const unexplained = canReset({ interrupt: true, interruptReason: "x" });
  assert.equal(unexplained.allowed, false, "an interruption nobody explained was allowed");

  const deliberate = canReset({ interrupt: true, interruptReason: "Manifest failing before the 3pm session" });
  assert.equal(deliberate.allowed, true);
  assert.ok(deliberate.blockedBy, "an interrupt did not report whom it interrupted");
  clearEnvironmentState();
});

test("releasing is idempotent and clears the block", () => {
  clearEnvironmentState();
  acquireLock({ scenarioId: "between-visit", scenarioVersion: "v1", personId: "op-1" });
  releaseLock("ended");
  assert.equal(activeLock(), null);
  releaseLock("ended again");
  assert.equal(activeLock(), null);
  assert.equal(canReset({ interrupt: false, interruptReason: "" }).allowed, true);
});

test("a stale lock reports itself rather than vanishing", () => {
  // A presenter deserves to know they are stepping over somebody, even when
  // that somebody left an hour ago.
  clearEnvironmentState();
  acquireLock({ scenarioId: "between-visit", scenarioVersion: "v1", personId: "op-1" });
  const old = new Date(Date.now() - (STALE_AFTER_MINUTES + 10) * 60_000)
    .toISOString().replace("T", " ").slice(0, 19);
  db.prepare("UPDATE demo_environment_lock SET acquired_at = ? WHERE id = 1").run(old);

  const held = activeLock();
  assert.ok(held, "a stale lock disappeared");
  assert.equal(held!.stale, true);
  assert.ok(held!.minutesHeld > STALE_AFTER_MINUTES);
  // Still a lock: a reset still has to interrupt it deliberately.
  assert.equal(canReset({ interrupt: false, interruptReason: "" }).allowed, false);
  clearEnvironmentState();
});

test("the reset action checks the lock before it destroys anything", () => {
  const src = code("lib/demo-reset-actions.ts");
  const body = src.slice(src.indexOf("export async function resetDemoEnvironment"));
  const check = body.indexOf("canReset(");
  const destroy = body.indexOf("resetDemoData(");
  assert.ok(check > 0, "the reset never asks whether a walkthrough is running");
  assert.ok(check < destroy, "the lock is checked after the data is gone");
});

test("reset scope names what goes and what survives", () => {
  // §7.3: "Before reset, show scope, active sessions, and effect."
  clearEnvironmentState();
  const scope = resetScope();
  assert.ok(scope.clears.length > 0 && scope.preserves.length > 0);
  assert.equal(scope.activeWalkthrough, null);
  // The console states it from here rather than writing its own description of
  // a destructive operation.
  const page = read("app/admin/demo/page.tsx");
  assert.match(page, /scope\.clears\.map/);
  assert.match(page, /scope\.preserves\.map/);
});

// ---------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------

test("environment health leads the admin console", () => {
  // §7.3: "Lead with environment health and failed preflight." It sat below a
  // role warning, three summary cards and a safety row.
  const page = code("app/admin/demo/page.tsx");
  const health = page.indexOf("<EnvironmentHealth");
  const cards = page.indexOf("<SummaryCards");
  const quality = page.indexOf('title="Data quality"');
  assert.ok(health > 0, "the console does not render environment health");
  assert.ok(health < cards, "the summary cards come before health");
  assert.ok(health < quality, "the data-quality panel comes before health");
});

test("the hash is in the drawer, not the header", () => {
  // §7.3: "A 64-character fingerprint in the routine header is reading burden
  // without benefit."
  const src = code("components/demo/EnvironmentHealth.tsx");
  const drawerAt = src.indexOf("<details");
  const hashAt = src.indexOf("drawer.baselineHash");
  assert.ok(drawerAt > 0, "there is no environment drawer");
  assert.ok(hashAt > drawerAt, "the baseline hash renders above the drawer");
  // Failures render above it, because that is what a presenter is deciding on.
  assert.ok(src.indexOf("status.failures.map") < drawerAt);
});

test("a blocked environment offers no start button", () => {
  // §1.1's rule about navigation applies to a control: a greyed-out "Begin"
  // three minutes before a meeting is a promise with a lock on it.
  const page = code("app/demo/scenarios/page.tsx");
  assert.match(page, /!met\.ready \? \(/);
  assert.ok(!/disabled/.test(page), "the launcher renders a disabled control");
  // And the start action refuses independently of the screen.
  const actions = code("lib/demo/scenario-actions.ts");
  const startBody = actions.slice(actions.indexOf("export async function startWalkthrough"));
  assert.match(startBody.slice(0, startBody.indexOf("acquireLock")), /meetsRequirements/,
    "the action starts a walkthrough without checking preflight");
});

test("every advance re-reads preflight rather than trusting the start", () => {
  // The environment can change under a running walkthrough — somebody else can
  // interrupt and reset — so the check is per-transition.
  const actions = code("lib/demo/scenario-actions.ts");
  const moveBody = actions.slice(actions.indexOf("export async function moveWalkthrough"));
  assert.match(moveBody, /environmentStatus\(getDb\(\)\)/);
  assert.match(moveBody, /transition\(s, progress, to, ready\)/);
});

test("walkthrough position is not stored where anything clinical is", () => {
  // §9's view-state rule: presentation position is stored apart from clinical
  // drafts, and it belongs to one presenter at one keyboard.
  const actions = code("lib/demo/scenario-actions.ts");
  assert.match(actions, /cookies\(\)/);
  assert.ok(
    !/INSERT INTO|CREATE TABLE|repo\(/.test(actions.replace(/\/\/.*$/gm, "")),
    "walkthrough progress is written to the database"
  );
});

test("the guide asks the rule which controls to render", () => {
  // A component with its own `index > 0` condition is a second implementation
  // of the transition rule, and the two drift the first time somebody adds a
  // state.
  const guide = code("components/demo/WalkthroughGuide.tsx");
  assert.match(guide, /transition\(scenario, progress, to, ready\)/);
  assert.match(guide, /if \(!result\.allowed\)/);
  assert.ok(
    !/progress\.index [<>]/.test(guide),
    "the guide decides for itself whether a move is allowed"
  );
});

test("the closeout renders where a presenter cannot skip it", () => {
  const guide = code("components/demo/WalkthroughGuide.tsx");
  assert.match(guide, /at\.atEnd &&/);
  assert.match(guide, /closeout\.decision/);
  assert.match(guide, /closeout\.unfinished/);
});

test("the walkthrough surfaces carry no section marks", () => {
  for (const file of [
    "components/demo/WalkthroughGuide.tsx",
    "components/demo/EnvironmentHealth.tsx",
    "app/demo/scenarios/page.tsx",
  ]) {
    const visible = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    assert.ok(!/§/.test(visible), `${file} renders a section mark`);
  }
});

test("the admin console no longer says the reset control is not built", () => {
  // It said "not exposed here yet" directly below the control. A screen that
  // describes itself out of date is a screen nobody trusts about anything else
  // on it.
  const page = code("app/admin/demo/page.tsx");
  assert.ok(!/not exposed here yet/.test(page));
  const pending = page.slice(page.indexOf("const PENDING"));
  assert.ok(!/Reset dataset/.test(pending), "reset is listed as unbuilt and is built");
});

test("the scenario contract pulls no database into the browser bundle", () => {
  const src = code("lib/experience/scenario.ts");
  const imports = [
    ...[...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/^import "([^"]+)"/gm)].map((m) => m[1]),
  ];
  assert.deepEqual(imports, [], "the scenario contract imports something; it is meant to be standalone");
});
