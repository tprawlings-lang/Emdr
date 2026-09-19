// What a clinician did between visits, on the record where they would look.
//
// THE ACTIONS WERE WRITTEN AND NEVER READ BACK. `recordContact` writes a care
// action and `assignWork` writes another, and the only surface reading the care
// ledger filtered it to reviews — so a clinician could record three contact
// attempts and find nothing about them anywhere on the person's record. The
// rows were in the database the whole time.
//
// And underneath that, a sharper one: the ledger asked for the newest FIVE care
// actions of any kind and then kept the reviews among them. Five recent contact
// attempts pushed a real review out of the window, and the record then said
// nobody had reviewed this person.

process.env.EMDR_DATA_DIR = `/tmp/steady-carehist-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "carehist-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "carehist-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import { careActionsForPerson, recordCareAction } from "../src/lib/clinical/attention-signals";
import {
  careHistory, CONTACT_LEDGER_ACTIONS, CARE_ACTION_LABEL, CONTACT_MEANING, NO_CARE_HISTORY,
} from "../src/lib/clinical/care-history";
import { CARE_ACTIONS, type CareActionRecord } from "../src/lib/clinical/attention-vocabulary";

const PERSON = "ch-person";
const CLINICIAN = "ch-clinician";

async function seed(): Promise<{ tenantId: string }> {
  const db = getDb();
  const c = await data();
  const tenantId = ((await c.get("SELECT id FROM tenants LIMIT 1", [])) as { id: string }).id;
  for (const [id, role] of [[PERSON, "member"], [CLINICIAN, "clinician"]] as const) {
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
       VALUES (?, ?, ?, ?, 'x', 'active', ?) ON CONFLICT(id) DO NOTHING`,
    ).run(id, `${id}@example.test`, id, role, tenantId);
    db.prepare(
      "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated') ON CONFLICT(id) DO NOTHING",
    ).run(id, tenantId, id);
  }
  return { tenantId };
}

test("a review is not hidden by the contact attempts in front of it", async () => {
  const { tenantId } = await seed();
  const ctx = { tenantId } as never;

  // The review first, then five contacts on top of it — which is the ordinary
  // shape: somebody reviews a person, then spends a week trying to reach them.
  await recordCareAction(ctx, {
    personId: PERSON, clinicianId: CLINICIAN, action: "review",
    note: "Reviewed the trajectory and the open alert.", sourceSurface: "test",
  });
  for (let i = 0; i < 5; i++) {
    await recordCareAction(ctx, {
      personId: PERSON, clinicianId: CLINICIAN, action: "contact",
      note: `Left a voicemail (${i + 1}).`, sourceSurface: "test",
    });
  }

  // THE OLD READ: newest five of anything. The review is the sixth and is gone.
  const newestFiveOfAnything = await careActionsForPerson(ctx, PERSON, 5);
  assert.equal(
    newestFiveOfAnything.filter((r) => r.action === "review").length, 0,
    "the fixture does not reproduce the window that hid the review",
  );

  // THE FIX: the kind is filtered in the query, so the limit applies to
  // reviews rather than to everything that happened since.
  const reviews = await careActionsForPerson(ctx, PERSON, { limit: 5, actions: ["review"] });
  assert.equal(reviews.length, 1, "the review is still hidden behind the contact attempts");
  assert.match(reviews[0].note ?? "", /Reviewed the trajectory/);
});

test("the contact attempts are readable, and they are not reviews", async () => {
  const { tenantId } = await seed();
  const ctx = { tenantId } as never;

  const records = await careActionsForPerson(ctx, PERSON, { limit: 10, actions: CONTACT_LEDGER_ACTIONS });
  const entries = careHistory(records);

  assert.ok(entries.length >= 5, "the contact attempts are still invisible");
  assert.ok(entries.every((e) => e.action !== "review"), "a review leaked into the between-visit ledger");
  assert.equal(entries[0].label, CARE_ACTION_LABEL.contact);
  // Newest first, so the most recent attempt is the one a clinician reads.
  assert.ok(entries[0].at >= entries[entries.length - 1].at);
});

test("an assignment reads as an owner recorded, never as somebody told", async () => {
  const { tenantId } = await seed();
  const ctx = { tenantId } as never;
  await recordCareAction(ctx, {
    personId: PERSON, clinicianId: CLINICIAN, action: "add_followup",
    note: "Assigned to a colleague.", outcomeState: `owner:${CLINICIAN}`, sourceSurface: "test",
  });

  const entries = careHistory(await careActionsForPerson(ctx, PERSON, { limit: 20, actions: CONTACT_LEDGER_ACTIONS }));
  const assignment = entries.find((e) => e.action === "add_followup")!;
  assert.equal(assignment.owner, CLINICIAN);

  // A STATE THAT DOES NOT NAME AN OWNER IS NOT AN ASSIGNMENT. Inventing one
  // would put a name beside work nobody claimed.
  const plain = careHistory([
    { id: "x", action: "contact", note: null, completedAt: "2026-09-19 09:00:00",
      outcomeState: "something_else", supersedesId: null, correctionReason: null } as CareActionRecord,
  ]);
  assert.equal(plain[0].owner, null);
});

test("the ledger says an attempt is not a delivery, above the list", () => {
  // `recordContact` says it in its own result; a list of attempts that dropped
  // the sentence would let a reader count rows and conclude somebody was
  // reached.
  assert.match(CONTACT_MEANING, /Not proof that anybody was reached/);
  assert.match(CONTACT_MEANING, /no delivery path/);
  assert.match(NO_CARE_HISTORY, /not a judgement/);
});

test("every action in the closed vocabulary has a label, and the ledger takes a subset", () => {
  for (const action of CARE_ACTIONS) {
    assert.ok(CARE_ACTION_LABEL[action], `${action} has no label, so a screen would print the column name`);
  }
  // The split is deliberate and is asserted rather than assumed: a review has a
  // currency and a contact attempt does not, so the two ledgers must not
  // overlap.
  assert.ok(!CONTACT_LEDGER_ACTIONS.includes("review"));
  assert.ok(CONTACT_LEDGER_ACTIONS.includes("contact"));
});

test("an unknown action kind cannot reach the query", async () => {
  const { tenantId } = await seed();
  const ctx = { tenantId } as never;
  // The vocabulary is closed, so a kind that is not in it is dropped rather
  // than interpolated — and dropping every kind means no filter, not an empty
  // IN () that no dialect accepts.
  const rows = await careActionsForPerson(ctx, PERSON, {
    limit: 5, actions: ["'; DROP TABLE users; --"] as never,
  });
  assert.ok(Array.isArray(rows));
  const stillThere = await (await data()).get("SELECT id FROM users LIMIT 1", []);
  assert.ok(stillThere, "the users table is gone");
});
