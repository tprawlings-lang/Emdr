process.env.EMDR_DATA_DIR = `/tmp/steady-handoff-${process.pid}-${Date.now()}`;

// Handoff of accountability (§26: "Keep accountability through transfer").
//
// THE SCREEN THAT USED TO REFUSE named its own requirement, and the refusal was
// correct: "a handoff — from, to, reason, due, accepted — is not modelled, so
// there is nothing to list… until then this screen would be inferring
// accountability from ownership, and that inference is exactly how people get
// lost between clinicians."
//
// THE INFERENCE IS THE THING UNDER TEST. Ownership is what one clinician
// decides; accountability is what the other accepts. A build that recorded a
// transfer and moved the owner immediately would look identical on the happy
// path and be wrong in the only case that matters — the one where nobody
// answers. So the guards below are mostly about the UNANSWERED state: who holds
// the person while a proposal sits, and whether every surface says so.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import {
  HANDOFF_STATES, MIN_REASON, accountableClinicianId, handoffsFor, handoffsForPerson,
  isOpen, proposeHandoff, resolveHandoff,
} from "../src/lib/clinical/handoff";
import { isEventType } from "../src/lib/events";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const db = getDb();

// BOTH TENANTS EXIST BEFORE ANYBODY DOES. `persons.tenant_id` has a foreign
// key and `users.tenant_id` does not, so a fixture that made only accounts
// worked and one that makes people does not — the constraint is on the half of
// the identity split that the spine actually references.
const OTHER_TENANT = "handoff-other-tenant";
// `kind` IS NOT NULL AND HAS NO DEFAULT, and an `INSERT OR IGNORE` that omits
// it fails silently — so the second tenant did not exist, and the person in it
// failed a foreign key several lines later with an error that named neither.
// The platform tenant is created by the schema and needs no help.
// `kind` is a closed set — 'provider' is not in it — and INSERT OR IGNORE
// swallows the CHECK violation, so the row was never created and the person in
// that tenant failed a foreign key several lines later with an error naming
// neither. Plain INSERT here on purpose: a fixture that cannot build its own
// preconditions should say so loudly rather than fail three assertions later.
db.prepare("INSERT INTO tenants (id, kind, name) VALUES (?, 'organization', ?)")
  .run(OTHER_TENANT, "Elsewhere");

/**
 * A person AND the account that authenticates them.
 *
 * BOTH ROWS, because the spine requires it. `longitudinal_events.person_id`
 * references `persons`, not `users` — a login is deliberately distinct from the
 * person it authenticates — and a fixture that made only the account produced a
 * handoff whose event silently failed its foreign key. `appendEventSafe`
 * swallows that by design, so the proposal succeeded, the audit row landed, and
 * the accountability event did not. The real path syncs the identity spine; a
 * fixture that skips it is testing a shape the product never has.
 */
function user(role: string, name: string, tenantId = PLATFORM_TENANT_ID): string {
  const id = newId();
  // FABRICATED, STATED AT THE INSERT. A trigger refuses a person row whose
  // provenance is neither fabricated nor real, which is the schema holding the
  // rule that a real person appearing in a test or demo environment is a stop
  // condition rather than a cleanup task.
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, tenantId, name);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, role, name)
     VALUES (?, ?, ?, 'x', ?, ?)`
  ).run(id, tenantId, `${id}@handoff.test`, role, name);
  return id;
}

const alice = user("clinician", "Alice");
const bob = user("clinician", "Bob");
const member = user("member", "A member");
const outsider = user("clinician", "Outsider", OTHER_TENANT);
const outsideMember = user("member", "Outside member", OTHER_TENANT);

const REASON = "Going on leave from the 14th and she has a session booked that week";

// ---------------------------------------------------------------------------
// Accountability does not move until it is accepted
// ---------------------------------------------------------------------------

test("a proposed transfer leaves the sender accountable", async () => {
  // The whole reason this is modelled rather than read off an owner column.
  const out = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: alice, toClinicianId: bob, reason: REASON,
  });
  assert.ok(out.ok, `proposing failed: ${(out as { reason?: string }).reason}`);

  const [h] = handoffsForPerson({ personId: member, tenantId: PLATFORM_TENANT_ID });
  assert.equal(h.state, "proposed");
  assert.equal(
    accountableClinicianId(h), alice,
    "an unanswered proposal already moved accountability to the receiver"
  );
  assert.ok(isOpen(h.state));

  // AND THE PROPOSAL SAYS SO, in the second person. A confirmation that reads
  // "transferred" is the sender's cue to stop thinking about this person.
  assert.match((out as { note: string }).note, /STILL ACCOUNTABLE/i,
    "the proposal does not tell the sender they still hold the person");
  assert.match((out as { note: string }).note, /notified/i,
    "the proposal does not say that nobody was told");
});

test("accepting moves accountability, and declining or withdrawing does not", async () => {
  const [open] = handoffsForPerson({ personId: member, tenantId: PLATFORM_TENANT_ID })
    .filter((h) => isOpen(h.state));
  const accepted = await resolveHandoff({
    handoffId: open.id, actorId: bob, tenantId: PLATFORM_TENANT_ID, outcome: "accepted",
  });
  assert.ok(accepted.ok);

  const [h] = handoffsForPerson({ personId: member, tenantId: PLATFORM_TENANT_ID });
  assert.equal(h.state, "accepted");
  assert.equal(accountableClinicianId(h), bob, "accepting did not move accountability");

  // The other two outcomes leave it where it was, which is the property that
  // makes a decline safe: nobody is dropped by saying no.
  for (const state of ["declined", "withdrawn", "proposed"] as const) {
    assert.equal(
      accountableClinicianId({ state, fromClinicianId: alice, toClinicianId: bob }), alice,
      `a ${state} transfer moved accountability`
    );
  }
});

test("only a proposal is open; an answered transfer never waits again", () => {
  // `isOpen` is what puts a transfer in the two WAITING sections. An
  // implementation that asked "not accepted" rather than "is proposed" reads
  // identically on the happy path and leaves every DECLINED and WITHDRAWN
  // transfer in the inbox forever — a receiver who said no would keep being
  // asked, and a sender who withdrew would still see it out for an answer.
  assert.equal(isOpen("proposed"), true, "a proposal is not open");
  for (const done of ["accepted", "declined", "withdrawn"] as const) {
    assert.equal(isOpen(done), false, `a ${done} transfer is still waiting for an answer`);
  }

  // And the screen's own split agrees: an answered transfer belongs to the
  // history, never to either waiting list.
  const mine = handoffsFor({ clinicianId: alice, tenantId: PLATFORM_TENANT_ID });
  const answered = mine.filter((h) => h.state !== "proposed");
  assert.ok(answered.length > 0, "no answered transfer exists to check");
  for (const h of answered) {
    assert.equal(isOpen(h.state), false, `a ${h.state} transfer would render as waiting`);
  }
});

test("nothing outside 'accepted' is ever treated as a completed transfer", () => {
  // Belt and braces on the one function every surface asks. A future state
  // added to the union must be considered here rather than defaulting to the
  // receiver.
  for (const state of HANDOFF_STATES) {
    const who = accountableClinicianId({ state, fromClinicianId: alice, toClinicianId: bob });
    assert.equal(who, state === "accepted" ? bob : alice, `${state} resolved to the wrong holder`);
  }
});

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

test("only the receiver answers, and only the sender withdraws", async () => {
  const out = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: alice, toClinicianId: bob, reason: REASON,
  });
  assert.ok(out.ok);
  const id = (out as { id: string }).id;

  // The sender cannot accept their own proposal — that would be a transfer
  // nobody agreed to, recorded as one somebody did.
  const selfAccept = await resolveHandoff({
    handoffId: id, actorId: alice, tenantId: PLATFORM_TENANT_ID, outcome: "accepted",
  });
  assert.equal(selfAccept.ok, false, "a clinician accepted a transfer they proposed");

  // The receiver cannot withdraw somebody else's proposal.
  const receiverWithdraws = await resolveHandoff({
    handoffId: id, actorId: bob, tenantId: PLATFORM_TENANT_ID, outcome: "withdrawn",
  });
  assert.equal(receiverWithdraws.ok, false, "the receiver withdrew the sender's proposal");

  // A third party can do neither.
  const stranger = await resolveHandoff({
    handoffId: id, actorId: outsider, tenantId: PLATFORM_TENANT_ID, outcome: "accepted",
  });
  assert.equal(stranger.ok, false, "an unrelated clinician answered a transfer");

  const ok = await resolveHandoff({
    handoffId: id, actorId: alice, tenantId: PLATFORM_TENANT_ID, outcome: "withdrawn",
  });
  assert.ok(ok.ok, "the sender could not withdraw their own proposal");
});

test("a transfer cannot be answered twice", async () => {
  const out = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: alice, toClinicianId: bob, reason: REASON,
  });
  const id = (out as { id: string }).id;
  assert.ok((await resolveHandoff({
    handoffId: id, actorId: bob, tenantId: PLATFORM_TENANT_ID, outcome: "accepted",
  })).ok);

  const again = await resolveHandoff({
    handoffId: id, actorId: bob, tenantId: PLATFORM_TENANT_ID,
    outcome: "declined", note: "changing my mind after the fact",
  });
  assert.equal(again.ok, false, "an answered transfer was answered again");
  assert.match((again as { reason: string }).reason, /already/, "the refusal does not say why");
});

// ---------------------------------------------------------------------------
// The tenant boundary
// ---------------------------------------------------------------------------

test("a transfer cannot name anybody outside the acting tenant", async () => {
  // A handoff names three people, and any of them being outside the tenant is
  // a cross-tenant disclosure wearing a workflow's clothes: the reason field
  // alone tells an outside clinician why somebody they cannot see is moving.
  const cases: Array<[string, Parameters<typeof proposeHandoff>[0]]> = [
    ["the subject", {
      tenantId: PLATFORM_TENANT_ID, personId: outsideMember,
      fromClinicianId: alice, toClinicianId: bob, reason: REASON,
    }],
    ["the receiver", {
      tenantId: PLATFORM_TENANT_ID, personId: member,
      fromClinicianId: alice, toClinicianId: outsider, reason: REASON,
    }],
    ["the sender", {
      tenantId: PLATFORM_TENANT_ID, personId: member,
      fromClinicianId: outsider, toClinicianId: bob, reason: REASON,
    }],
  ];
  for (const [who, args] of cases) {
    const out = await proposeHandoff(args);
    assert.equal(out.ok, false, `${who} was allowed to be outside the tenant`);
    // Absent rather than forbidden: "not permitted" confirms the id exists.
    assert.doesNotMatch(
      (out as { reason: string }).reason, /permitt|forbidden|denied/i,
      `the refusal for ${who} confirms the id exists`
    );
  }

  // And a resolution scoped to the wrong tenant finds nothing.
  const mine = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: alice, toClinicianId: bob, reason: REASON,
  });
  const crossed = await resolveHandoff({
    handoffId: (mine as { id: string }).id, actorId: bob,
    tenantId: OTHER_TENANT, outcome: "accepted",
  });
  assert.equal(crossed.ok, false, "a transfer was resolved from another tenant");

  await resolveHandoff({
    handoffId: (mine as { id: string }).id, actorId: alice,
    tenantId: PLATFORM_TENANT_ID, outcome: "withdrawn",
  });
});

test("the list is scoped to the tenant and to the clinician on either end", () => {
  const forAlice = handoffsFor({ clinicianId: alice, tenantId: PLATFORM_TENANT_ID });
  assert.ok(forAlice.length > 0, "alice sees none of her own transfers");
  for (const h of forAlice) {
    assert.ok(
      h.fromClinicianId === alice || h.toClinicianId === alice,
      "the list shows a transfer this clinician is not on either end of"
    );
  }
  assert.deepEqual(
    handoffsFor({ clinicianId: outsider, tenantId: OTHER_TENANT }), [],
    "a clinician in another tenant sees transfers from this one"
  );
});

// ---------------------------------------------------------------------------
// Refusals that keep the record usable
// ---------------------------------------------------------------------------

test("a transfer states a reason, and a decline states one too", async () => {
  const thin = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: alice, toClinicianId: bob, reason: "handover",
  });
  assert.equal(thin.ok, false, "a one-word reason produced a transfer");
  assert.ok(MIN_REASON >= 12, "the reason floor is short enough to be a word");

  const out = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: alice, toClinicianId: bob, reason: REASON,
  });
  const id = (out as { id: string }).id;

  const bareDecline = await resolveHandoff({
    handoffId: id, actorId: bob, tenantId: PLATFORM_TENANT_ID, outcome: "declined",
  });
  assert.equal(bareDecline.ok, false, "a transfer was declined with no reason");

  // Accepting needs none, and that asymmetry is deliberate: accepting says "I
  // have them" and the state carries it, while declining sends a person back
  // to somebody who now has to decide what to do instead.
  const accept = await resolveHandoff({
    handoffId: id, actorId: bob, tenantId: PLATFORM_TENANT_ID, outcome: "accepted",
  });
  assert.ok(accept.ok, "accepting was refused for want of a note");
});

test("two open transfers of one person are refused", async () => {
  const first = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: bob, toClinicianId: alice, reason: REASON,
  });
  assert.ok(first.ok);

  const second = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: bob, toClinicianId: alice, reason: REASON,
  });
  assert.equal(second.ok, false, "a person had two open transfers at once");
  assert.match((second as { reason: string }).reason, /already waiting/i);

  await resolveHandoff({
    handoffId: (first as { id: string }).id, actorId: bob,
    tenantId: PLATFORM_TENANT_ID, outcome: "withdrawn",
  });
});

test("a clinician cannot transfer a person to themselves", async () => {
  const out = await proposeHandoff({
    tenantId: PLATFORM_TENANT_ID, personId: member,
    fromClinicianId: alice, toClinicianId: alice, reason: REASON,
  });
  assert.equal(out.ok, false, "a clinician transferred a person to themselves");
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

test("both ends of a transfer reach the event spine and the audit trail", async () => {
  for (const t of ["care_handoff.proposed", "care_handoff.resolved"]) {
    assert.ok(isEventType(t), `${t} is not a registered event type`);
  }
  const events = db.prepare(
    "SELECT event_type FROM longitudinal_events WHERE event_type LIKE 'care_handoff.%'"
  ).all() as Array<{ event_type: string }>;
  const kinds = new Set(events.map((e) => e.event_type));
  assert.ok(kinds.has("care_handoff.proposed"), "a proposal writes no event");
  assert.ok(kinds.has("care_handoff.resolved"), "a resolution writes no event");

  const audits = db.prepare(
    "SELECT event_type FROM audit_log WHERE event_type LIKE 'care_handoff%'"
  ).all() as Array<{ event_type: string }>;
  assert.ok(audits.some((a) => a.event_type === "care_handoff_proposed"), "a proposal is not audited");
  assert.ok(audits.some((a) => a.event_type === "care_handoff_resolved"), "a resolution is not audited");
});

test("a withdrawn transfer is kept, never deleted", () => {
  // "I asked and thought better of it" is part of the record of who was
  // looking after somebody.
  const all = handoffsForPerson({ personId: member, tenantId: PLATFORM_TENANT_ID });
  assert.ok(all.some((h) => h.state === "withdrawn"), "no withdrawn transfer survived");
  const src = code("src/lib/clinical/handoff.ts");
  assert.doesNotMatch(src, /DELETE FROM care_handoffs/, "a transfer can be deleted");
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

test("the screen asks who is accountable rather than reading the destination", () => {
  // The inference the old screen refused to make, and the reason this one is
  // allowed to exist.
  const page = code("src/app/clinician/handoffs/page.tsx");
  assert.match(page, /still accountable/i, "the screen never says who holds the person");
  assert.match(page, /accepted/i, "the screen never mentions acceptance");
  assert.match(page, /notified|delivery path/i, "the screen implies somebody was told");

  // Waiting-for-you comes before the form. It is the only section that asks
  // the reader to do something.
  const incoming = page.indexOf("Waiting for your answer");
  const propose = page.indexOf("Propose a transfer");
  assert.ok(incoming > 0 && propose > incoming, "the proposal form comes before the inbox");

  // And it no longer says the capability is missing.
  assert.ok(!page.includes("is not modelled"), "the screen still says handoffs are not modelled");
});

test("a refusal reaches the clinician instead of a page that redraws blank", () => {
  // FOUND BY DRIVING IT. The domain refuses carefully and the action discarded
  // every refusal, so a clinician who typed "handover" got a page that redrew
  // with nothing on it — a worse failure than the one being prevented, because
  // they would reasonably conclude the transfer had gone through.
  const actions = code("src/lib/clinical/handoff-actions.ts");
  assert.match(actions, /redirect\(said\(outcome\)\)/, "an action discards its outcome");
  assert.match(actions, /const outcome = await proposeHandoff\(/, "the proposal's outcome is thrown away");
  assert.match(actions, /const outcome = await resolveHandoff\(/, "the resolution's outcome is thrown away");
  // A refusal and a confirmation are different keys, so the screen can render
  // them in different registers rather than parsing prose to decide.
  assert.match(actions, /outcome\.ok \? "done" : "refused"/, "a refusal is indistinguishable from a success");

  const page = code("src/app/clinician/handoffs/page.tsx");
  assert.match(page, /\{refused && \(/, "the screen never shows a refusal");
  assert.match(page, /role="alert"/, "a refusal is not announced");
  assert.match(page, /\{done && \(/, "the screen never confirms what happened");
});

test("the actor comes from the session, never from the form", () => {
  // A hidden field would let anybody who can post a form transfer a person out
  // of somebody else's caseload, or accept on their behalf — and the audit
  // trail would record the impersonation as legitimate.
  const actions = code("src/lib/clinical/handoff-actions.ts");
  const supplied = [...actions.matchAll(/formData\.get\("([^"]+)"\)/g)].map((m) => m[1]);
  for (const forbidden of ["fromClinicianId", "actorId", "tenantId"]) {
    assert.ok(!supplied.includes(forbidden),
      `the action reads "${forbidden}" from the request instead of the session`);
  }
  assert.match(actions, /await requireClinician\(\)/, "the action has no role guard");
});

test("a recipient must be able to answer, which an assignee need not be", () => {
  // The distinction from the queue's assignee list. Assignment goes to a
  // PERSON — owning work has never required an account — but a transfer
  // proposed to somebody who cannot sign in can never be resolved and would
  // sit in "waiting" forever.
  const page = code("src/app/clinician/handoffs/page.tsx");
  const at = page.indexOf("const recipients");
  assert.ok(at > 0, "the screen offers no recipient list");
  const q = page.slice(at, at + 400);
  assert.match(q, /FROM users/, "recipients are not accounts, so they could never accept");
  assert.match(q, /role = 'clinician'/, "the recipient list is not scoped to clinicians");
  assert.match(q, /tenant_id = \?/, "the recipient list is not tenant-scoped");
});
