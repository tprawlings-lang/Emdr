process.env.EMDR_DATA_DIR = `/tmp/steady-lockout-${process.pid}-${Date.now()}`;
// Not a demo database: nothing here reads the seeded population, and booting
// one costs two minutes to test a counter.
process.env.EMDR_DEMO = "0";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "auth-lockout-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "auth-lockout-test-secret-not-real";

// The sign-in lockout, and the way back in.
//
// WHAT WAS ACTUALLY DEPLOYED failed three ways at once, and the first is the
// one no test would have caught by reading the code:
//
//   1. "15 minutes" was really "since midnight UTC". The cutoff was written
//      space-separated and compared as text against rows stored with a `T`,
//      so every row sharing the date sorted after it. Ten failures locked an
//      account until the date rolled over, under a banner promising fifteen
//      minutes.
//   2. `loginMobile` wrote `login_failed` and never read it. The API was an
//      unlimited guessing channel while the web form counted to ten.
//   3. Nothing could change an existing password, so locked meant locked and
//      forgotten meant gone.
//
// Every test below fails on the code as it was.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, verifyPassword, hashPassword } from "../src/lib/db";
import {
  failedSignInsAgainst, isLockedOut, LOCKOUT_THRESHOLD, LOCKOUT_WINDOW_MS,
} from "../src/lib/auth-lockout";
import { PILOT_TENANT_ID } from "../src/lib/enrollment/gate";
import { resetParticipantPassword, PilotAccessError, MIN_PASSWORD } from "../src/lib/enrollment/pilot-access";

const ADDR = "locked.person@example.test";
const PERSON = "lock-person";
const OPERATOR = "lock-operator";

/** A failure recorded at a chosen moment, in the format `audit()` writes —
 *  ISO-8601 with a `T` and a `Z`. Writing these by hand is the point: the bug
 *  was a comparison between two timestamp SHAPES, and a test that only ever
 *  wrote "now" could not see it. */
function failureAt(msAgo: number, target = ADDR) {
  getDb().prepare(
    `INSERT INTO audit_log (actor_role, event_family, event_type, target, detail_json, created_at)
     VALUES (NULL, 'identity', 'login_failed', ?, '{}', ?)`,
  ).run(target, new Date(Date.now() - msAgo).toISOString());
}

/** The other shape in the same column: `demo-seed` writes space-separated, and
 *  the schema default is `datetime('now')`. Both must count. */
function failureAtLegacyFormat(msAgo: number, target = ADDR) {
  getDb().prepare(
    `INSERT INTO audit_log (actor_role, event_family, event_type, target, detail_json, created_at)
     VALUES (NULL, 'identity', 'login_failed', ?, '{}', ?)`,
  ).run(target, new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace("T", " "));
}

function clear() {
  const db = getDb();
  db.prepare("DELETE FROM audit_log").run();
  db.prepare("DELETE FROM persons WHERE id IN (?, ?)").run(PERSON, "lock-fabricated");
  db.prepare("DELETE FROM users WHERE id IN (?, ?, ?)").run(PERSON, OPERATOR, "lock-fabricated");
}

function seedPilot() {
  const db = getDb();
  db.prepare(
    "INSERT INTO tenants (id, kind, name) VALUES (?, 'program', 'Steady Pilot') ON CONFLICT(id) DO NOTHING",
  ).run(PILOT_TENANT_ID);
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES (?, ?, 'Pilot Person', 'member', ?, 'active', ?) ON CONFLICT(id) DO NOTHING`,
  ).run(PERSON, ADDR, hashPassword("originalpassword"), PILOT_TENANT_ID);
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Pilot Person', 'real') ON CONFLICT(id) DO NOTHING",
  ).run(PERSON, PILOT_TENANT_ID);
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES (?, 'op@example.test', 'Operator', 'demo_admin', 'x', 'active', ?) ON CONFLICT(id) DO NOTHING`,
  ).run(OPERATOR, PILOT_TENANT_ID);
}

// ---------------------------------------------------------------------------
// 1. The window is fifteen minutes — the bug that made it a whole day
// ---------------------------------------------------------------------------

test("a failure from two hours ago does not count against you", async () => {
  clear();
  for (let i = 0; i < LOCKOUT_THRESHOLD + 5; i++) failureAt(2 * 60 * 60 * 1000);
  assert.equal(await failedSignInsAgainst(ADDR), 0,
    "failures from outside the window were counted — the window is not fifteen minutes");
  assert.equal(await isLockedOut(ADDR), false);
});

test("a failure from ten hours ago, same UTC date, does not count either", async () => {
  // The precise shape of the old defect: same date, so the date prefix
  // matched and the `T` did the rest.
  clear();
  for (let i = 0; i < LOCKOUT_THRESHOLD; i++) failureAt(10 * 60 * 60 * 1000);
  assert.equal(await failedSignInsAgainst(ADDR), 0);
});

test("a failure from one minute ago does count", async () => {
  clear();
  failureAt(60 * 1000);
  assert.equal(await failedSignInsAgainst(ADDR), 1);
});

test("both timestamp formats in the column are counted", async () => {
  // `audit()` writes ISO with T/Z; `demo-seed` writes space-separated. A
  // comparison correct for one and wrong for the other is the original bug
  // with the operands swapped.
  clear();
  failureAt(60 * 1000);
  failureAtLegacyFormat(60 * 1000);
  assert.equal(await failedSignInsAgainst(ADDR), 2);
});

test("a failure just inside the window counts and just outside does not", async () => {
  clear();
  failureAt(LOCKOUT_WINDOW_MS - 30 * 1000);
  assert.equal(await failedSignInsAgainst(ADDR), 1, "a failure inside the window was dropped");
  clear();
  failureAt(LOCKOUT_WINDOW_MS + 30 * 1000);
  assert.equal(await failedSignInsAgainst(ADDR), 0, "a failure outside the window was counted");
});

// ---------------------------------------------------------------------------
// 2. The threshold
// ---------------------------------------------------------------------------

test("nine failures is not locked out; ten is", async () => {
  // THE LITERAL TEN, not `LOCKOUT_THRESHOLD`. Compliance 1.5 names the number,
  // so the test has to name it too — written against the constant, this moved
  // with it and stayed green when the threshold was changed underneath it.
  assert.equal(LOCKOUT_THRESHOLD, 10, "compliance 1.5 sets the threshold at ten");
  clear();
  for (let i = 0; i < 9; i++) failureAt(60 * 1000);
  assert.equal(await isLockedOut(ADDR), false, "locked out at nine failures");
  failureAt(60 * 1000);
  assert.equal(await isLockedOut(ADDR), true, "not locked out at ten failures");
});

test("failures against another address do not lock this one", async () => {
  clear();
  for (let i = 0; i < LOCKOUT_THRESHOLD + 2; i++) failureAt(60 * 1000, "someone.else@example.test");
  assert.equal(await isLockedOut(ADDR), false);
});

// ---------------------------------------------------------------------------
// 3. A password reset is the way back in
// ---------------------------------------------------------------------------

test("a reset clears the failures that were counting, and unlocks the account", async () => {
  clear(); seedPilot();
  for (let i = 0; i < LOCKOUT_THRESHOLD + 2; i++) failureAt(60 * 1000);
  assert.equal(await isLockedOut(ADDR), true, "precondition: locked out");

  const done = await resetParticipantPassword({
    operatorId: OPERATOR, personId: PERSON, newPassword: "a-new-one-they-can-use",
  });

  assert.equal(done.email, ADDR);
  assert.equal(done.clearedFailures, LOCKOUT_THRESHOLD + 2,
    "the operator was not told how many attempts stopped counting");
  assert.equal(await isLockedOut(ADDR), false, "still locked out after a reset — there is no way back in");
  assert.equal(await failedSignInsAgainst(ADDR), 0);
});

test("the new password works and the old one does not", async () => {
  clear(); seedPilot();
  await resetParticipantPassword({
    operatorId: OPERATOR, personId: PERSON, newPassword: "a-new-one-they-can-use",
  });
  const row = getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(PERSON) as { password_hash: string };
  assert.equal(verifyPassword("a-new-one-they-can-use", row.password_hash), true);
  assert.equal(verifyPassword("originalpassword", row.password_hash), false);
});

test("failures AFTER a reset count again — the reset is not an exemption", async () => {
  clear(); seedPilot();
  await resetParticipantPassword({
    operatorId: OPERATOR, personId: PERSON, newPassword: "a-new-one-they-can-use",
  });
  // A REAL SECOND, not a backdated row. Timestamps are compared at second
  // precision, so a failure written in the same second as the reset is not
  // strictly after it — waiting is what makes "after" mean after. The first
  // version of this test wrote failures thirty seconds OLD and asserted they
  // counted, which would only have passed if the reset bound did nothing.
  await new Promise((r) => setTimeout(r, 1100));
  for (let i = 0; i < LOCKOUT_THRESHOLD; i++) failureAt(0);
  assert.equal(await isLockedOut(ADDR), true,
    "a reset permanently disabled the lockout for this address");
});

test("an old reset does not widen the window back to itself", async () => {
  // THE BOUND IS THE LATER OF THE TWO, and this is the half that says so.
  // Failures two hours old sit AFTER a reset from last week and OUTSIDE the
  // fifteen-minute window; taking the reset as the bound unconditionally would
  // count them and lock somebody out for attempts made this morning.
  //
  // The first version of this test put the failures one minute ago, where both
  // rules agree — so it asserted the right thing about the wrong pair of rows
  // and could not tell them apart.
  clear(); seedPilot();
  getDb().prepare(
    `INSERT INTO audit_log (actor_role, event_family, event_type, target, detail_json, created_at)
     VALUES (NULL, 'identity', 'password_reset', ?, '{}', ?)`,
  ).run(ADDR, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  for (let i = 0; i < LOCKOUT_THRESHOLD + 5; i++) failureAt(2 * 60 * 60 * 1000);
  assert.equal(await failedSignInsAgainst(ADDR), 0,
    "an old reset widened the window back to itself");
  assert.equal(await isLockedOut(ADDR), false);
});

// ---------------------------------------------------------------------------
// 4. What the reset control may reach, and what it records
// ---------------------------------------------------------------------------

test("it refuses a password weaker than enrollment's own floor", async () => {
  clear(); seedPilot();
  await assert.rejects(
    () => resetParticipantPassword({ operatorId: OPERATOR, personId: PERSON, newPassword: "short" }),
    (e: Error) => e instanceof PilotAccessError && new RegExp(String(MIN_PASSWORD)).test(e.message),
  );
  const row = getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(PERSON) as { password_hash: string };
  assert.equal(verifyPassword("originalpassword", row.password_hash), true, "the password changed despite the refusal");
});

test("it does not reach a fabricated person, even inside the pilot tenant", async () => {
  clear(); seedPilot();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES ('lock-fabricated', 'fab@example.test', 'Fabricated', 'member', ?, 'active', ?)`,
  ).run(hashPassword("originalpassword"), PILOT_TENANT_ID);
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES ('lock-fabricated', ?, 'Fabricated', 'fabricated')",
  ).run(PILOT_TENANT_ID);

  await assert.rejects(
    () => resetParticipantPassword({ operatorId: OPERATOR, personId: "lock-fabricated", newPassword: "a-new-one-they-can-use" }),
    (e: Error) => e instanceof PilotAccessError,
  );
});

test("it does not reach a clinician", async () => {
  clear(); seedPilot();
  const db = getDb();
  db.prepare("UPDATE users SET role = 'clinician' WHERE id = ?").run(PERSON);
  await assert.rejects(
    () => resetParticipantPassword({ operatorId: OPERATOR, personId: PERSON, newPassword: "a-new-one-they-can-use" }),
    (e: Error) => e instanceof PilotAccessError,
  );
});

test("it does not reach an account outside the pilot tenant", async () => {
  clear(); seedPilot();
  getDb().prepare("UPDATE users SET tenant_id = 'SOMEWHERE0000000000000000000' WHERE id = ?").run(PERSON);
  await assert.rejects(
    () => resetParticipantPassword({ operatorId: OPERATOR, personId: PERSON, newPassword: "a-new-one-they-can-use" }),
    (e: Error) => e instanceof PilotAccessError,
  );
});

test("the audit row names the operator and the address, and never the password", async () => {
  clear(); seedPilot();
  await resetParticipantPassword({
    operatorId: OPERATOR, personId: PERSON, newPassword: "a-new-one-they-can-use",
  });
  const row = getDb().prepare(
    "SELECT actor_id, target, detail_json FROM audit_log WHERE event_type = 'password_reset'",
  ).get() as { actor_id: string; target: string; detail_json: string };

  assert.equal(row.actor_id, OPERATOR, "the audit row does not say who did it");
  // The TARGET is the address, not the person id: the lockout counts by
  // address, so a row targeting the id would record the reset and lift nothing.
  assert.equal(row.target, ADDR);
  assert.equal(/a-new-one-they-can-use/.test(row.detail_json), false,
    "the new password was written into the audit log");
});

// ---------------------------------------------------------------------------
// 5. Both doors, not one
// ---------------------------------------------------------------------------

test("the mobile API refuses a CORRECT password while the account is locked", async () => {
  // The correct password is the point. A test using a wrong one would pass
  // against the old code, which refused it for the ordinary reason and never
  // consulted the lockout at all.
  clear(); seedPilot();
  const { loginMobile } = await import("../src/lib/mobile/service");

  assert.notEqual(await loginMobile(ADDR, "originalpassword"), null,
    "precondition: the credentials are good");

  for (let i = 0; i < LOCKOUT_THRESHOLD; i++) failureAt(60 * 1000);
  assert.equal(await loginMobile(ADDR, "originalpassword"), null,
    "the mobile door let a locked-out account in — the lockout is enforced on one door of two");
});

test("both sign-in doors consult the shared lockout rather than counting for themselves", async () => {
  // A door that grew its own copy of the query would pass the test above on
  // the day it was written and drift from the other afterwards. There is one
  // implementation and this is how many callers it has.
  const ROOT = path.join(__dirname, "..");
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  for (const door of ["src/lib/actions.ts", "src/lib/mobile/service.ts"]) {
    const src = read(door);
    assert.ok(/isLockedOut\(/.test(src), `${door} does not call isLockedOut`);
    assert.equal(/FROM audit_log[\s\S]{0,200}login_failed/.test(src), false,
      `${door} counts login failures itself instead of asking auth-lockout`);
  }
});

test("the pilot console wires the reset action to a form, not just imports it", async () => {
  // An import satisfies a grep and reaches no user. The earlier version of
  // this guard matched the import statement and would have stayed green with
  // the control deleted from the page.
  const page = fs.readFileSync(path.join(__dirname, "..", "src/app/admin/pilot/page.tsx"), "utf8");
  assert.ok(/action=\{resetParticipantPasswordAction\}/.test(page),
    "no form on the pilot console submits to the reset action");
  assert.ok(/name="personId"/.test(page) && /name="newPassword"/.test(page),
    "the form does not carry the fields the action reads");
});
