// FAILURE-INJECTION EVIDENCE for the failure register's
// `uncertain.retry-returns-existing-result` and
// `uncertain.indeterminate-invites-reconcile-not-retry`
// — see src/lib/governance/failure-register.ts.
//
// THE FAILURE INJECTED HERE IS A LOST ANSWER, not a lost write. The request
// arrived, the server did the work, and the response never came back. From the
// caller's side that is indistinguishable from nothing having happened, and the
// action that feels safe — press it again — is the one that writes twice.
//
// The handoff names the records this must not duplicate: "a note, approval,
// contact, access decision, or handoff."

process.env.EMDR_DATA_DIR = `/tmp/steady-idem-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "idem-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "idem-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { data } from "../src/lib/data";
import {
  runOnce, reserveCommand, settleCommand, releaseCommand, RESERVATION_WINDOW_MS,
} from "../src/lib/command-log";
import { confirmed, rejected, stale, type ResolvedCommand } from "../src/lib/experience/command";
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

test("a retry after a lost answer returns the first result and does not write again", async () => {
  getDb();
  const c = command({ idempotencyKey: "k-lost-answer" });
  let writes = 0;

  const first = await runOnce(c, async () => {
    writes++;
    return confirmed({ recordId: "care-1", summary: "Recorded that you attempted contact." });
  });
  assert.equal(first.outcome, "confirmed");
  assert.equal(writes, 1);

  // The answer never reached the caller. They press it again.
  const second = await runOnce(c, async () => {
    writes++;
    return confirmed({ recordId: "care-2", summary: "Recorded that you attempted contact." });
  });

  assert.equal(writes, 1, "the second press ran the work again — this is the duplicate record");
  assert.equal(second.outcome, "confirmed");
  assert.deepEqual(second.result, first.result, "the retry must return the EXISTING result");
  assert.equal(second.replayed, true);
});

test("the screen says 'Already saved', not 'Saved', on a replay", async () => {
  // A SECOND PRESS THAT READS LIKE THE FIRST is how somebody comes to believe
  // they recorded two contact attempts when one exists. The task state is what
  // the surface renders, so the distinction has to survive into it.
  getDb();
  const c = command({ idempotencyKey: "k-label" });
  await runOnce(c, async () => confirmed({ recordId: "care-1" }));
  const replayed = await runOnce(c, async () => confirmed({ recordId: "care-2" }));

  assert.equal(advance(replayed).label, "Already saved");
  assert.equal(advance(replayed).replayed, true);
  assert.equal(advance(confirmed({})).label, "Saved");
  assert.equal(advance(confirmed({})).replayed, undefined);
});

test("only a write is replayed — a refusal is re-evaluated against the world as it is now", async () => {
  getDb();
  const c = command({ idempotencyKey: "k-refusal" });

  const first = await runOnce(c, async () => rejected("Choose who owns this."));
  assert.equal(first.outcome, "rejected");

  // THE WORLD MOVED. Replaying the refusal would pin this person to a "no"
  // that is no longer true, and they would have no way to act at all.
  let ran = false;
  const second = await runOnce(c, async () => {
    ran = true;
    return confirmed({ recordId: "care-9" });
  });
  assert.ok(ran, "a refusal was replayed, so the same action can never succeed later");
  assert.equal(second.outcome, "confirmed");
  assert.equal(second.replayed, undefined);
});

test("a conflict releases the key, so a later attempt reads the current version", async () => {
  getDb();
  const c = command({ idempotencyKey: "k-conflict" });
  const first = await runOnce(c, async () => stale("Somebody else changed this.", "v2"));
  assert.equal(first.outcome, "stale");

  let ran = false;
  await runOnce(c, async () => {
    ran = true;
    return confirmed({ recordId: "care-10" });
  });
  assert.ok(ran, "a stale result was stored, so the row could never be acted on again");
});

test("a second attempt while the first is still running is indeterminate, not a second write", async () => {
  // THE CONCURRENT CASE, which a retry-only design gets wrong. Both presses are
  // in flight; the second must not be told the action failed, because the
  // honest answer is that Steady does not know yet — and "failed" is what
  // produces the third press.
  getDb();
  const c = command({ idempotencyKey: "k-in-flight" });

  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  let writes = 0;

  const slow = runOnce(c, async () => {
    writes++;
    await held;
    return confirmed({ recordId: "care-slow" });
  });
  // Let the reservation land before the second attempt starts.
  await new Promise((r) => setTimeout(r, 10));

  const second = await runOnce(c, async () => {
    writes++;
    return confirmed({ recordId: "care-second" });
  });
  assert.equal(second.outcome, "indeterminate");
  assert.equal(second.reconcileBy, c.idempotencyKey, "an indeterminate result must say what to reconcile by");
  assert.equal(writes, 1);

  // And the surface must not offer a retry button on it.
  const shown = advance(second);
  assert.equal(shown.retryable, false);
  assert.equal(shown.reconcileBy, c.idempotencyKey);

  release();
  assert.equal((await slow).outcome, "confirmed");
});

test("a key that belongs to a different action is refused, never answered with the other result", async () => {
  // WORSE THAN A DUPLICATE. Replaying one command's result for another is a
  // wrong entry in a clinical record rather than a repeated one, so this is a
  // refusal with a reason rather than a best effort.
  getDb();
  const first = command({ idempotencyKey: "k-collide", intent: "record_contact", target: "person-1" });
  await runOnce(first, async () => confirmed({ recordId: "care-1" }));

  const other = command({ idempotencyKey: "k-collide", intent: "complete_review", target: "person-2" });
  let ran = false;
  const result = await runOnce(other, async () => {
    ran = true;
    return confirmed({ recordId: "care-2" });
  });
  assert.equal(result.outcome, "rejected");
  assert.match(result.reason ?? "", /belongs to a different action/);
  assert.equal(ran, false, "the colliding command must not run either");
});

test("an unexpected failure releases the key rather than poisoning it", async () => {
  getDb();
  const c = command({ idempotencyKey: "k-throw" });
  await assert.rejects(
    () => runOnce(c, async () => { throw new Error("connection lost"); }),
    /connection lost/,
  );
  // The throw is re-raised for the caller's own handler to turn into an
  // indeterminate result — and the key is free, because a reservation that
  // survived would tell the person's retry that another attempt is running.
  let ran = false;
  await runOnce(c, async () => { ran = true; return confirmed({ recordId: "care-11" }); });
  assert.ok(ran);
});

test("an abandoned reservation is taken over, so a key is never poisoned for good", async () => {
  getDb();
  const c = command({ idempotencyKey: "k-abandoned" });
  const t0 = Date.parse("2026-09-18T10:00:00.000Z");

  assert.deepEqual(await reserveCommand(c, t0), { kind: "reserved" });
  assert.deepEqual(await reserveCommand(c, t0 + 1_000), { kind: "in_flight" });

  // BOTH SIDES OF THIS TRADE ARE BAD, and the comment on the window says so.
  // Inside it Steady refuses to guess. Past it, the process that held the
  // reservation is gone and the alternative is a person who can never retry.
  assert.deepEqual(
    await reserveCommand(c, t0 + RESERVATION_WINDOW_MS + 1),
    { kind: "reserved" },
  );
});

test("a reservation is a row, so two attempts race on the database rather than in memory", async () => {
  getDb();
  const c = command({ idempotencyKey: "k-row" });
  await reserveCommand(c);
  const db = await data();
  const row = (await db.get(
    "SELECT intent, target, actor_person_id, outcome FROM command_results WHERE tenant_id = ? AND idempotency_key = ?",
    [c.tenantId, c.idempotencyKey],
  )) as Record<string, unknown>;
  assert.equal(row.intent, "record_contact");
  assert.equal(row.target, "person-1");
  assert.equal(row.actor_person_id, "clinician-1");
  assert.equal(row.outcome, null, "an unsettled reservation reads as in flight, not as a result");

  await settleCommand(c, confirmed({ recordId: "care-12" }));
  const settled = (await db.get(
    "SELECT outcome, settled_at FROM command_results WHERE tenant_id = ? AND idempotency_key = ?",
    [c.tenantId, c.idempotencyKey],
  )) as Record<string, unknown>;
  assert.equal(settled.outcome, "confirmed");
  assert.ok(settled.settled_at);

  await releaseCommand(c);
  const afterRelease = (await db.get(
    "SELECT outcome FROM command_results WHERE tenant_id = ? AND idempotency_key = ?",
    [c.tenantId, c.idempotencyKey],
  )) as Record<string, unknown> | undefined;
  assert.ok(afterRelease, "release must not delete a SETTLED result — that would re-enable the duplicate");
});

test("two commands in different tenants may share a key without seeing each other", async () => {
  getDb();
  const db = await data();
  const other = (await db.get(
    "SELECT id FROM tenants WHERE id <> ? LIMIT 1", [PLATFORM_TENANT_ID],
  )) as { id: string } | undefined;
  if (!other) return; // single-tenant database; nothing to prove here.

  const a = command({ idempotencyKey: "k-shared", tenantId: PLATFORM_TENANT_ID });
  const b = command({ idempotencyKey: "k-shared", tenantId: other.id });
  await runOnce(a, async () => confirmed({ recordId: "care-a" }));
  let ran = false;
  const result = await runOnce(b, async () => { ran = true; return confirmed({ recordId: "care-b" }); });
  assert.ok(ran, "a key in one tenant blocked a command in another");
  assert.deepEqual(result.result, { recordId: "care-b" });
});
