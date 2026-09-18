// FAILURE-INJECTION EVIDENCE for the failure register's
// `reset.command-from-a-pre-reset-tab` — see src/lib/governance/failure-register.ts.
//
// THE FAILURE INJECTED HERE IS A REBUILD UNDERNEATH AN OPEN TAB. The reset
// deletes every row and recreates the population from the versioned seed, so
// the identifiers on a page loaded a minute earlier now refer to nothing — or,
// worse, to whatever else was given that id. Nothing could detect it: the seed
// version is the same string on both sides of a reset, which is what made it
// look like an identifier and useless as one.
//
// The idempotency key made it worse rather than better. A key is derived from
// the action rather than the moment, deliberately, so the same press produces
// the same key before and after a rebuild.

process.env.EMDR_DATA_DIR = `/tmp/steady-envgen-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "envgen-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "envgen-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { resetDemoData, PRESERVED_TABLES, DEMO_DATA_TABLES } from "../src/lib/demo-reset";
import {
  currentGeneration, rotateGeneration, generationMatches, GENERATION_REFUSAL,
} from "../src/lib/environment-generation";
import { runOnce } from "../src/lib/command-log";
import { confirmed, type ResolvedCommand } from "../src/lib/experience/command";
import { advance } from "../src/lib/experience/task-state";

function command(over: Partial<ResolvedCommand> = {}): ResolvedCommand {
  return {
    intent: "record_contact",
    target: "person-1",
    payload: {},
    idempotencyKey: "record_contact|person-1|clinician-1|press-1",
    expectedVersion: null,
    actorPersonId: "clinician-1",
    tenantId: PLATFORM_TENANT_ID,
    receivedAt: "2026-09-18T10:00:00.000Z",
    ...over,
  };
}

test("a rebuild starts a new generation", async () => {
  const db = getDb();
  const before = await currentGeneration();
  assert.ok(before.generation.length > 0);

  resetDemoData(db);
  const after = await currentGeneration();
  assert.notEqual(after.generation, before.generation, "a reset that keeps the generation is not detectable");
  assert.ok(after.establishedAt >= before.establishedAt);
});

test("a command from a tab that predates the rebuild is refused, with a way forward", async () => {
  const db = getDb();
  const stale = (await currentGeneration()).generation;
  resetDemoData(db);

  let ran = false;
  const result = await runOnce(
    command({ idempotencyKey: "k-stale-tab", environmentGeneration: stale }),
    async () => { ran = true; return confirmed({ recordId: "care-1" }); },
  );

  assert.equal(ran, false, "the work ran against records the reset deleted");
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, GENERATION_REFUSAL);
  // A REFUSAL WITH NO WAY FORWARD is worse than the stale action it prevented:
  // the person is left pressing a button that will never work and told only
  // that it failed.
  assert.match(result.reason!, /Nothing was written/);
  assert.match(result.reason!, /Reload the page/);
  // AND THE RIGHT ONE. The generic refusal affordance is "Change it and try
  // again", which is right for a missing reason and wrong here: nothing in the
  // form can fix a page that predates a rebuild, and that button sends somebody
  // round a loop that cannot end.
  const shown = advance(result);
  assert.equal(shown.retryable, true, "a way forward must be offered");
  assert.equal(shown.reloadRequired, true, "the way forward is a reload, not an edit");
  assert.equal(advance({ outcome: "rejected", reason: "Choose who owns this." }).reloadRequired, undefined);
});

test("a command from the current generation proceeds", async () => {
  // ARMING A CHECK LIKE THIS CAN REJECT EVERY LEGITIMATE ACTION, which would be
  // worse than the defect. Same discipline as the queue's version check.
  const current = (await currentGeneration()).generation;
  let ran = false;
  const result = await runOnce(
    command({ idempotencyKey: "k-current", environmentGeneration: current }),
    async () => { ran = true; return confirmed({ recordId: "care-2" }); },
  );
  assert.ok(ran);
  assert.equal(result.outcome, "confirmed");
});

test("an idempotency key does not cross a rebuild", async () => {
  // THE HANDOFF NAMES THIS SPECIFICALLY: "Do not let idempotency keys cross
  // reset generations." A key is the same string on both sides of a rebuild by
  // construction, so a surviving reservation would let a post-reset press
  // replay a pre-reset result about a record that no longer exists.
  const db = getDb();
  const gen1 = (await currentGeneration()).generation;
  const key = "k-crosses-a-reset";

  const first = await runOnce(
    command({ idempotencyKey: key, environmentGeneration: gen1 }),
    async () => confirmed({ recordId: "care-before" }),
  );
  assert.equal(first.outcome, "confirmed");

  resetDemoData(db);
  const gen2 = (await currentGeneration()).generation;

  let ran = false;
  const after = await runOnce(
    command({ idempotencyKey: key, environmentGeneration: gen2 }),
    async () => { ran = true; return confirmed({ recordId: "care-after" }); },
  );
  assert.ok(ran, "the pre-reset reservation survived and replayed into the new environment");
  assert.deepEqual(after.result, { recordId: "care-after" });
  assert.equal(after.replayed, undefined);
});

test("the generation survives the reset that rotates it", async () => {
  // A ROTATED TABLE MUST NOT BE A CLEARED ONE. Listing it for deletion would
  // throw away the generation the reset had just established, and the next
  // read would mint a third — so the environment would be on its third
  // generation after one reset and no tab would ever match.
  assert.ok(
    (PRESERVED_TABLES as readonly string[]).includes("environment_generation"),
    "the generation table is cleared by a reset, which discards the generation the reset just set",
  );
  assert.ok(!(DEMO_DATA_TABLES as readonly string[]).includes("environment_generation"));

  const db = getDb();
  const rotated = rotateGeneration(db);
  assert.equal((await currentGeneration()).generation, rotated);
  resetDemoData(db);
  const after = await currentGeneration();
  assert.notEqual(after.generation, rotated);
  assert.equal(after.generation.length, 12, "a reset left no generation, so one was minted on read");
});

test("a command that claims no generation is allowed through, and that is a decision", () => {
  // Refusing every command without one would break every action that does not
  // come from a long-lived surface, and would do it by punishing the caller for
  // a field it never had. What closes the gap is the surfaces SENDING one.
  assert.equal(generationMatches(null, "abc"), true);
  assert.equal(generationMatches(undefined, "abc"), true);
  assert.equal(generationMatches("abc", "abc"), true);
  assert.equal(generationMatches("old", "abc"), false);
});

test("the queue actually sends its generation, or the guard is inert", () => {
  // A SOURCE CHECK, AND IT IS THE RIGHT TOOL HERE. The guard above only ever
  // fires on a command that carries a generation, so a surface that stops
  // sending one disables it silently and every test above keeps passing. The
  // value is minted server-side per request and consumed inside a client
  // component's click handler, so there is nothing a unit test can observe —
  // what can be checked is that each command call site carries the field.
  //
  // The queue is the surface that matters: it is the one a clinician leaves
  // open for hours, which is when a reset happens underneath one.
  const src = fs.readFileSync("src/components/experience/RowActions.tsx", "utf8");
  for (const call of ["recordContact({", "assignWork({", "completeReview({"]) {
    const at = src.indexOf(call);
    assert.ok(at > 0, `${call} is no longer called from the queue's row actions`);
    const body = src.slice(at, at + 700);
    assert.match(
      body,
      /environmentGeneration/,
      `${call} does not send the environment generation, so a tab that predates a reset is trusted`,
    );
  }

  const page = fs.readFileSync("src/app/clinician/today/page.tsx", "utf8");
  assert.match(page, /currentGeneration\(\)/,
    "the queue page does not read a generation, so the field it passes down is empty");
});
