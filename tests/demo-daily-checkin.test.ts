process.env.EMDR_DATA_DIR = `/tmp/steady-daily-${process.pid}-${Date.now()}`;
// Booted WITHOUT the demo population: this needs two users and a tenant, and
// none of the 240 seeded profiles. `refreshDemoDaily` reads EMDR_DEMO at call
// time, so it can be switched on for the calls themselves.
process.env.EMDR_DEMO = "0";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "demo-daily-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "demo-daily-test-secret-not-real";

// "Alex and Sam have a check-in dated today" — and what that must NOT do to
// the published dataset.
//
// THE ID CARRIED THE DATE, `checkin:<member>:<today>`, which made this one row
// different on every calendar day and therefore made the whole `checkins`
// table hash differently every day. `projection-validation` records an
// expected hash per dataset version, so it passed only on the date the hashes
// were generated and failed for everybody afterwards — including on `main`,
// where it went unnoticed only because nothing had pushed since.
//
// A check whose red means "it is tomorrow" teaches people that red means
// nothing. That is the failure this file exists to prevent, and no source-level
// grep can see it: the old code was correct-looking, deterministic, and
// commented as deliberate.

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, refreshDemoDaily } from "../src/lib/db";
import { tableFingerprint } from "../src/lib/demo-reset";

const ALEX_EMAIL = "patient.demo@steady.local";
const SAM_EMAIL = "patient2.demo@steady.local";

/** Run `fn` as though the wall clock read `iso`. */
function atDate<T>(iso: string, fn: () => T): T {
  const RealDate = Date;
  const realNow = RealDate.now;
  const offset = Date.parse(iso) - realNow();
  globalThis.Date = class extends RealDate {
    constructor(...a: unknown[]) {
      // @ts-expect-error - forwarding
      if (a.length === 0) super(realNow() + offset); else super(...a);
    }
    static now() { return realNow() + offset; }
  } as DateConstructor;
  try { return fn(); } finally { globalThis.Date = RealDate; }
}

/**
 * An empty `checkins` table and the two demo members' ids.
 *
 * The members are NOT created here. `reconcileDemoAccounts` writes them on
 * every boot, demo flag or not, and they carry dependent rows that make
 * deleting and re-creating them a foreign-key failure — so the test uses the
 * accounts the product actually reconciles rather than look-alikes, which is
 * also the more honest fixture.
 */
function seed() {
  const db = getDb();
  db.prepare("DELETE FROM checkins").run();
  const idFor = (email: string) => {
    const found = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
    if (found) return found.id;
    // Not every demo member is reconciled on a lean boot — only some are. The
    // missing one is CREATED rather than the existing one replaced: the
    // reconciled row carries dependent records that make deleting it a
    // foreign-key failure, and `refreshDemoDaily` looks members up by these
    // exact addresses, so a look-alike would test nothing.
    const tenant = (db.prepare("SELECT tenant_id FROM users WHERE tenant_id IS NOT NULL LIMIT 1")
      .get() as { tenant_id: string }).tenant_id;
    const id = `daily-${email.split("@")[0]}`;
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
       VALUES (?, ?, ?, 'member', 'x', 'active', ?)`,
    ).run(id, email, id, tenant);
    return id;
  };
  return { db, alex: idFor(ALEX_EMAIL), sam: idFor(SAM_EMAIL) };
}

/** `refreshDemoDaily` reads the flag at call time. */
function daily(db: ReturnType<typeof getDb>, iso: string) {
  process.env.EMDR_DEMO = "1";
  try { atDate(iso, () => refreshDemoDaily(db)); }
  finally { process.env.EMDR_DEMO = "0"; }
}

test("the daily check-in's id does not move with the calendar", () => {
  const { db, sam } = seed();
  daily(db, "2026-09-11T12:00:00Z");
  const first = db.prepare("SELECT id, checkin_date FROM checkins WHERE user_id = ?").get(sam) as
    { id: string; checkin_date: string };
  assert.equal(first.checkin_date, "2026-09-11");

  daily(db, "2026-12-25T03:00:00Z");
  const rows = db.prepare("SELECT id, checkin_date FROM checkins WHERE user_id = ?").all(sam) as
    { id: string; checkin_date: string }[];

  assert.equal(rows.length, 1, "the daily top-up accumulated a row per day instead of moving one");
  assert.equal(rows[0].id, first.id, "the id moved with the date — every day's dataset hashes differently");
  assert.equal(rows[0].checkin_date, "2026-12-25", "the row did not move to today");
});

test("the checkins fingerprint is identical on two different dates", () => {
  // The property the projection guard actually depends on, asserted directly
  // rather than inferred from the id. A future writer could reintroduce the
  // drift through any column; this notices whichever one they choose.
  const a = (() => { const { db } = seed(); daily(db, "2026-09-11T12:00:00Z"); return tableFingerprint(db, "checkins"); })();
  const b = (() => { const { db } = seed(); daily(db, "2027-03-02T21:00:00Z"); return tableFingerprint(db, "checkins"); })();

  assert.deepEqual(a, b,
    "the seeded checkins table fingerprints differently on a different date, so the recorded " +
    "projection hash expires and the guard goes red for a reason that is not drift");
});

test("a second run on the same day changes nothing", () => {
  const { db } = seed();
  daily(db, "2026-09-11T08:00:00Z");
  const before = tableFingerprint(db, "checkins");
  daily(db, "2026-09-11T23:00:00Z");
  assert.deepEqual(tableFingerprint(db, "checkins"), before, "a second boot the same day rewrote the row");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM checkins").get() as { n: number }).n, 2,
    "a second boot the same day duplicated a check-in",
  );
});
