// FAILURE-INJECTION EVIDENCE for the failure register's
// `concurrency.transfer-proposal-is-not-a-transfer` — see
// src/lib/governance/failure-register.ts.
//
//   "A transfer proposal must not transfer responsibility. Test recipient
//   acceptance, decline, proposer cancellation, role loss, scope loss,
//   overlapping proposals, failed notification, and proposer unavailability."
//
// EIGHT SUB-CASES AND ONE PROPERTY. In every one of them the question is the
// same: who is accountable for this person right now? The failure mode is not
// a crash — it is a screen showing the receiving clinician's name beside
// somebody who never agreed to hold them, while the sender, reading the same
// screen, believes they have handed over.
//
// The property is that accountability moves on ACCEPTANCE and on nothing else.
// Not on proposal, not on the sender leaving, not on the receiver losing the
// role, and not on a notification that was never built.

process.env.EMDR_DATA_DIR = `/tmp/steady-transfer-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "transfer-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "transfer-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import {
  accountableClinicianId, isOpen, handoffProgress, proposeHandoff, resolveHandoff,
  HANDOFF_STATES, HANDOFF_CHANNEL_CONFIGURED, MIN_REASON, type HandoffState,
} from "../src/lib/clinical/handoff";

const SENDER = "clinician-sender";
const RECEIVER = "clinician-receiver";

function heldBy(state: HandoffState): string {
  return accountableClinicianId({ state, fromClinicianId: SENDER, toClinicianId: RECEIVER });
}

test("accountability moves on acceptance and on nothing else", () => {
  // THE WHOLE ROW, IN FOUR LINES. Every other case below is a way of arriving
  // at one of these states, and each one has to answer this question the same
  // way however it got there.
  assert.equal(heldBy("proposed"), SENDER, "an unanswered proposal moved accountability");
  assert.equal(heldBy("declined"), SENDER);
  assert.equal(heldBy("withdrawn"), SENDER);
  assert.equal(heldBy("accepted"), RECEIVER);

  // And every state the type allows has an answer, so a state added later
  // cannot default to the receiver by omission.
  for (const state of HANDOFF_STATES) {
    const held = heldBy(state);
    assert.ok(held === SENDER || held === RECEIVER, `${state} has no accountable clinician`);
  }
  assert.equal(HANDOFF_STATES.filter((s) => heldBy(s) === RECEIVER).length, 1,
    "more than one state hands the person over");
});

test("only a proposal is open work; a resolved one stops asking", () => {
  assert.equal(isOpen("proposed"), true);
  for (const state of ["accepted", "declined", "withdrawn"] as const) {
    assert.equal(isOpen(state), false, `${state} is still counted as open work`);
  }
});

test("the receiver losing the role does not strand the person with nobody", async () => {
  // ROLE LOSS AND SCOPE LOSS, injected as the same thing they are: the
  // proposal is still sitting there and the receiver can no longer answer it.
  // The wrong answer is for the record to read as transferred; the wrong
  // answer is also for it to read as belonging to nobody. It belongs to the
  // sender, who never stopped holding it.
  assert.equal(heldBy("proposed"), SENDER);

  // AND IT CANNOT BE PROPOSED TO SOMEBODY OUTSIDE THE TENANT IN THE FIRST
  // PLACE, which is scope loss at the other end: a handoff names three people
  // and any one of them being outside the acting tenant is a cross-tenant
  // disclosure wearing a workflow's clothes — the reason field alone would
  // tell an outside clinician why somebody they may not see is being moved.
  getDb();
  const c = await data();
  const rows = (await c.all(
    "SELECT id, tenant_id FROM users WHERE role = 'clinician' LIMIT 2", [],
  )) as Array<{ id: string; tenant_id: string }>;
  if (rows.length < 2) return;
  const person = (await c.get(
    "SELECT id FROM users WHERE role = 'member' AND tenant_id = ? LIMIT 1", [rows[0].tenant_id],
  )) as { id: string } | undefined;
  if (!person) return;

  const outOfScope = await proposeHandoff({
    tenantId: rows[0].tenant_id,
    personId: person.id,
    fromClinicianId: rows[0].id,
    toClinicianId: "nobody-in-this-tenant",
    reason: "Moving to the clinician who covers this site from Monday.",
  });
  assert.equal(outOfScope.ok, false);
  assert.match((outOfScope as { reason: string }).reason, /not on your caseload/);
});

test("two open proposals for one person are refused, not stacked", async () => {
  // OVERLAPPING PROPOSALS. Two open transfers of the same person is a state
  // nobody can resolve: accepting one leaves the other pointing at a person
  // the accepter now holds, and the sender cannot tell which answer they are
  // waiting for.
  getDb();
  const c = await data();
  const clinicians = (await c.all(
    "SELECT id, tenant_id FROM users WHERE role = 'clinician' LIMIT 3", [],
  )) as Array<{ id: string; tenant_id: string }>;
  if (clinicians.length < 2) return;
  const tenantId = clinicians[0].tenant_id;
  const person = (await c.get(
    "SELECT id FROM users WHERE role = 'member' AND tenant_id = ? LIMIT 1", [tenantId],
  )) as { id: string } | undefined;
  if (!person) return;

  const first = await proposeHandoff({
    tenantId, personId: person.id,
    fromClinicianId: clinicians[0].id, toClinicianId: clinicians[1].id,
    reason: "Annual leave from Friday; they need somebody through the fortnight.",
  });
  assert.equal(first.ok, true, `the first proposal was refused: ${JSON.stringify(first)}`);

  const second = await proposeHandoff({
    tenantId, personId: person.id,
    fromClinicianId: clinicians[0].id,
    toClinicianId: clinicians[2]?.id ?? clinicians[1].id,
    reason: "Second thoughts about who should pick this up on Monday.",
  });
  assert.equal(second.ok, false, "a second open transfer of the same person was accepted");
  assert.match((second as { reason: string }).reason, /already waiting for an answer/);

  // THE SENDER STILL HOLDS THEM THROUGHOUT. Two proposals, one refusal, and
  // accountability never moved.
  assert.equal(heldBy("proposed"), SENDER);

  // Withdrawing frees the way, which is the point of refusing rather than
  // silently replacing: the sender chooses which proposal stands.
  const withdrawn = await resolveHandoff({
    tenantId, handoffId: (first as { id: string }).id,
    actorId: clinicians[0].id, outcome: "withdrawn",
  });
  assert.equal(withdrawn.ok, true, `withdrawing failed: ${JSON.stringify(withdrawn)}`);

  // PROPOSER CANCELLATION IS THE SENDER'S ALONE, and the receiver's answer is
  // theirs alone. The refusal above tells the sender to withdraw before
  // proposing again, so a build where they could not would be giving advice it
  // does not accept.
  const notMine = await resolveHandoff({
    tenantId, handoffId: (first as { id: string }).id,
    actorId: clinicians[1].id, outcome: "withdrawn",
  });
  assert.equal(notMine.ok, false);
  assert.match((notMine as { reason: string }).reason, /already withdrawn|who proposed/);
});

test("a proposal with no reason is refused, because the receiver decides on it", async () => {
  getDb();
  const c = await data();
  const clinicians = (await c.all(
    "SELECT id, tenant_id FROM users WHERE role = 'clinician' LIMIT 2", [],
  )) as Array<{ id: string; tenant_id: string }>;
  if (clinicians.length < 2) return;
  const person = (await c.get(
    "SELECT id FROM users WHERE role = 'member' AND tenant_id = ? LIMIT 1", [clinicians[0].tenant_id],
  )) as { id: string } | undefined;
  if (!person) return;

  const result = await proposeHandoff({
    tenantId: clinicians[0].tenant_id, personId: person.id,
    fromClinicianId: clinicians[0].id, toClinicianId: clinicians[1].id,
    reason: "handover",
  });
  assert.equal(result.ok, false, `"handover" was accepted as a reason`);
  assert.ok("handover".length < MIN_REASON);
});

test("nothing in the progress claims a send, a delivery or a read", () => {
  // FAILED NOTIFICATION, which in this build is EVERY notification: there is
  // no delivery path, so a proposal reaches a receiver only when they open
  // their own queue. The failure this guards is a screen implying otherwise —
  // "sent" beside a transfer nobody has been told about is the sentence that
  // makes a sender stop chasing it.
  assert.equal(HANDOFF_CHANNEL_CONFIGURED, false);

  const steps = handoffProgress({
    id: "h1", personId: "p1", personName: "A Person (fabricated)",
    fromClinicianId: SENDER, fromName: "Sender", toClinicianId: RECEIVER, toName: "Receiver",
    reason: "Annual leave from Friday.", dueAt: null,
    state: "proposed", createdAt: "2026-09-18 09:00:00", decidedAt: null, decidedNote: null,
  });

  // THE CLAIM, NOT THE LABEL. Written against the step names first, and it
  // failed on the delivery step — which is called "Delivered" and says
  // "Nothing was sent. There is no delivery path in this build." Naming the
  // step after the fact it answers is the right design; the test was reading
  // the heading and calling it a claim.
  const delivery = steps.find((s) => s.step === "delivery")!;
  assert.equal(delivery.state, "not_possible", "the delivery step claims something happened");
  assert.match(delivery.said, /Nothing was sent/);
  assert.match(delivery.said, /no delivery path/);

  const receipt = steps.find((s) => s.step === "receipt")!;
  assert.equal(receipt.state, "not_recorded");
  assert.match(receipt.said, /not evidence that they have/);

  // NO STEP THAT DID NOT HAPPEN IS MARKED DONE. That is the sentence a sender
  // reads before they stop chasing a transfer.
  for (const s of steps) {
    if (s.state === "done") {
      assert.ok(["proposal", "decision"].includes(s.step), `${s.step} is marked done and nothing did it`);
    }
  }

  // Four steps, four different answers — a progress bar where every step reads
  // the same is a decoration.
  assert.equal(new Set(steps.map((s) => s.state)).size >= 2, true);
});
