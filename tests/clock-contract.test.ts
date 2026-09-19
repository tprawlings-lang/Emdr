// RELEASE DEFINITION EVIDENCE for `time.windows-and-freshness` — see
// src/lib/review/release-definition.ts. That checklist names this file, and its
// verifier requires this file to name the line back: a test that does not say
// what it is evidence for can be rewritten into something else while the
// checklist keeps its tick.

// The clock contract (17 September handoff, UX 003).
//
//   "Observed. The demo clock showed December 2025 while clinical evidence used
//   September 2026. Define and apply one explicit clock contract. Acceptance: a
//   scenario date change updates every dependent read consistently."
//
// There are two clocks. The READING FRAME is what "now" means for anything a
// person reads as an age, a window, a due date or a freshness label, and the
// demo control moves it. REAL TIME is what "now" means for anything written —
// audit rows, sessions, rate limits, a closed alert's `reviewed_at`, a
// recording's `recorded_at`.
//
// tests/demo-clock.test.ts guards the writing side and has since the clock
// existed. This file guards the side that was missing: that the reading path
// actually reads the frame, that all of it reads the SAME frame, and that the
// contract module has not quietly become reachable from a write.

process.env.EMDR_DATA_DIR = `/tmp/steady-clockc-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "clock-contract-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "clock-contract-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import { setClock, readClock } from "../src/lib/demo-clock";
import { readingFrame, readingNow } from "../src/lib/clock";
import { buildCaseload } from "../src/lib/clinical/caseload";
import { buildWorkQueue, clinicianQueueProjection } from "../src/lib/clinical/work-queue";
import { buildCaseloadState } from "../src/lib/clinical/caseload-state";
import { activePolicy } from "../src/lib/clinical-policy";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
/** Source with comments stripped.
 *
 *  Because this file's guards look for phrases that its own subject matter
 *  discusses in prose. A module that explains why it does not call `new Date()`
 *  contains the string `new Date()`, and a guard that matched the explanation
 *  would be reading the thing next to the thing. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const T = {
  tenant: "tenant-clockc",
  clinician: "clin-clockc",
  person: "pat-clockc",
};

const db = getDb();
db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)")
  .run(T.tenant, T.tenant);
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'Dr Clock', 'clinician', 'x')"
).run(T.clinician, "clin-clockc@example.test");
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'Cleo', 'member', 'x')"
).run(T.person, "pat-clockc@example.test");
for (const [id, name] of [[T.person, "Cleo"], [T.clinician, "Dr Clock"]] as const) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')")
    .run(id, T.tenant, name);
}
db.prepare("UPDATE users SET tenant_id = ?, status = 'active' WHERE id IN (?, ?)")
  .run(T.tenant, T.clinician, T.person);

// One check-in, three hundred days back. Far enough that it is in the past at
// every milestone the clock can be set to, so "last used Steady N days ago" is a
// real number at both readings and the two readings differ by the distance the
// clock moved. A fixture dated near today would make the difference a rounding
// argument rather than a fact.
const ACTIVITY_DAYS_AGO = 300;
const activityAt = new Date(Date.now() - ACTIVITY_DAYS_AGO * 86400000);
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
db.prepare(
  `INSERT OR REPLACE INTO checkins
     (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
      dissociation, sleep_quality, substance_flag, recommended_action, created_at)
   VALUES (?, ?, ?, ?, 4, 2, 0, 1, 1, 5, 0, 'practice', ?)`
).run("ci-clockc", T.person, T.tenant, activityAt.toISOString().slice(0, 10), stamp(activityAt));

// One open alert, so the work queue always carries a row for Cleo and the row's
// age is something a test can read. Left open for the life of the file; the
// closure test below raises and closes its own.
db.prepare(
  "INSERT OR REPLACE INTO alerts (id, user_id, alert_type, severity, detail, status, created_at) " +
  "VALUES (?, ?, 'harm_urge', 'urgent', 'fixture', 'open', ?)"
).run("al-clockc-open", T.person, stamp(new Date(Date.now() - 2 * 86400000)));
async function live() {
  await setClock({ milestoneId: null, reason: "clock contract test back to live", actorId: "t" });
}

// ---------------------------------------------------------------------------
// The contract itself
// ---------------------------------------------------------------------------

test("the reading frame follows the demo clock, and says which frame it is", async () => {
  await live();
  const liveFrame = await readingFrame();
  assert.equal(liveFrame.live, true);
  assert.equal(liveFrame.label, null,
    "a live frame carries a label, which is a permanent 'the date is today' badge");
  assert.ok(Math.abs(Date.now() - liveFrame.now.getTime()) < 60_000);

  await setClock({ milestoneId: "first-quarter", reason: "move the reading frame", actorId: "t" });
  const moved = await readingFrame();
  assert.equal(moved.live, false);
  assert.ok(moved.label && moved.label.includes("First quarter"),
    `a moved frame does not say where it is: ${moved.label}`);
  assert.ok(Date.now() - moved.now.getTime() > 100 * 86400000,
    "the frame did not move with the clock");
  assert.equal((await readingNow()).getTime(), moved.now.getTime());
  await live();
});

// ---------------------------------------------------------------------------
// The acceptance condition: one date change, every dependent read
// ---------------------------------------------------------------------------

test("a scenario date change moves every dependent read, together", async () => {
  // THE DEFECT, REPRODUCED. Before the contract these four reads answered from
  // `new Date()` by default, so moving the clock moved the badge in the shell
  // and nothing underneath it. Each one is asserted separately because each one
  // defaulted separately — that is how half a screen ends up in one year and
  // half in another.
  const policy = activePolicy();
  const args = { clinicianId: T.clinician, tenantId: T.tenant, policy };

  await live();
  const liveCaseload = await buildCaseload(args);
  const liveQueue = await clinicianQueueProjection(args);
  const liveDays = liveCaseload.rows.find((r) => r.personId === T.person)?.daysSinceActivity;
  assert.ok(typeof liveDays === "number", "the fixture has no activity, so there is no age to move");

  await setClock({ milestoneId: "first-quarter", reason: "test every dependent read", actorId: "t" });
  const frame = await readingFrame();
  const day = frame.now.toISOString().slice(0, 10);

  const movedCaseload = await buildCaseload(args);
  const movedQueue = await clinicianQueueProjection(args);
  const movedWork = await buildWorkQueue(args);
  const movedState = await buildCaseloadState(args);

  assert.equal(movedQueue.meta.generatedAt.slice(0, 10), day,
    `the queue projection is stamped ${movedQueue.meta.generatedAt} while the clock reads ${day}`);
  assert.notEqual(movedQueue.meta.generatedAt, liveQueue.meta.generatedAt,
    "the queue projection did not move with the clock");

  // The caseload publishes no stamp of its own, so it is checked on the number
  // a clinician actually reads: "last used Steady N days ago". That is the
  // figure UX 003 reports as wrong, and it is the one that has to move.
  const movedDays = movedCaseload.rows.find((r) => r.personId === T.person)?.daysSinceActivity;
  assert.ok(typeof movedDays === "number");
  assert.ok(movedDays < liveDays,
    `the row reads ${movedDays} days at the first quarter and ${liveDays} days today — ` +
    "the age did not move with the clock");

  assert.equal(movedWork.computedAt.slice(0, 10), day,
    `the work queue is stamped ${movedWork.computedAt} while the clock reads ${day}`);
  assert.equal(movedState.computedAt.slice(0, 10), day,
    `the caseload state is stamped ${movedState.computedAt} while the clock reads ${day}`);
  await live();
});

test("one projection carries one clock, all the way down", async () => {
  // THE BUG THIS IS HERE FOR. `buildWorkQueue` took a `now`, used it for its own
  // windows, and then called `buildCaseload` WITHOUT PASSING IT — so a caller
  // supplying an explicit reading got a queue header on that reading and row
  // ages on whatever `new Date()` said. One projection, two clocks, no error.
  const asOf = new Date("2026-03-04T12:00:00Z");
  const queue = await buildWorkQueue({
    clinicianId: T.clinician, tenantId: T.tenant, policy: activePolicy(), now: asOf,
  });
  assert.equal(queue.computedAt.slice(0, 10), "2026-03-04",
    `an explicit reading was ignored: ${queue.computedAt}`);

  // And the nested read is on the same instant, not merely on the same frame:
  // an explicit `now` must beat the ambient one or the parameter is decorative.
  await setClock({ milestoneId: "opening", reason: "the ambient frame must lose", actorId: "t" });
  const still = await buildWorkQueue({
    clinicianId: T.clinician, tenantId: T.tenant, policy: activePolicy(), now: asOf,
  });
  assert.equal(still.computedAt.slice(0, 10), "2026-03-04",
    "the ambient reading frame overrode an explicit one");

  // AND THE ROWS, not just the header. `computedAt` comes from the queue's own
  // `now` and would have read correctly throughout the bug; the row ages came
  // from the caseload the queue forgot to pass it to. So the assertion is on
  // the number underneath: at this reading Cleo's last check-in is the distance
  // from the fixture to the as-of date, not to today.
  const expected = Math.floor((asOf.getTime() - activityAt.getTime()) / 86400000);
  const row = still.items.find((i) => i.personId === T.person);
  assert.ok(row, "the fixture produced no work item, so there is no row age to check");
  assert.equal(row.lastActivityDays, expected,
    `the row reads ${row.lastActivityDays} days at an as-of of 2026-03-04, and ${expected} is ` +
    "the distance from the check-in to that date — the nested read used a different clock");
  await live();
});

// ---------------------------------------------------------------------------
// The boundary: the frame must not reach a written record
// ---------------------------------------------------------------------------

test("nothing that writes can reach the reading frame", () => {
  // COMPUTED, NOT LISTED. A list of forbidden modules only covers the modules
  // somebody remembered; this asks every file that imports the contract whether
  // it also writes, so a write added to a reading module tomorrow fails here
  // rather than silently dating a row to a demo milestone.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(process.cwd(), "src"));

  const importsClock = /from "(?:\.{1,2}\/)*(?:lib\/)?clock"|from "@\/lib\/clock"/;
  const writes = /INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.insert\(|\.remove\(/i;

  // ONE MODULE HOLDS BOTH, and the entry says why rather than the guard being
  // loosened. Splitting alerts.ts would export three private helpers — a band
  // map, a formatter and a row type — to satisfy a source rule, which widens a
  // module's surface to make a test pass. The claim is instead checked
  // directly: the behavioural test below closes an alert while the clock is
  // most of a year back and reads the stored date, which is the thing the rule
  // is a proxy for.
  const MIXED: Record<string, string> = {
    "src/lib/clinical/alerts.ts":
      "alertQueue reads deadlines through the frame; closeAlert takes no clock and stamps " +
      "reviewed_at from new Date() on the line that writes it.",
  };

  const offenders: string[] = [];
  const unused = new Set(Object.keys(MIXED));
  let reached = 0;
  for (const f of files) {
    const rel = path.relative(process.cwd(), f);
    const src = code(fs.readFileSync(f, "utf8"));
    if (!importsClock.test(src)) continue;
    reached++;
    const hit = src.match(writes);
    if (!hit) continue;
    if (MIXED[rel]) { unused.delete(rel); continue; }
    offenders.push(`${rel} writes (${hit[0].trim()})`);
  }

  assert.ok(reached > 5, `only ${reached} modules import the clock contract — this guard found nothing to guard`);
  assert.deepEqual(offenders, [],
    "a module that writes a record can reach the reading frame:\n  " + offenders.join("\n  "));
  // A permission nobody needs is a permission nobody checks.
  assert.deepEqual([...unused], [],
    "an exemption is recorded for a module that no longer reads the frame or no longer writes");
});

test("the write path takes no clock, so none can be handed to it", () => {
  // Two functions used to accept `now?: Date` and stamp a record with it.
  // Neither had a caller that passed one, so the parameter was pure hazard: a
  // door into a governance row for whatever a caller happened to be holding.
  const alerts = code(read("src/lib/clinical/alerts.ts"));
  const closeAlert = alerts.slice(alerts.indexOf("export async function closeAlert"));
  const signature = closeAlert.slice(0, closeAlert.indexOf("{", closeAlert.indexOf(")")));
  assert.doesNotMatch(signature, /\bnow\b/,
    "closeAlert takes a clock again, and reviewed_at is a governance record");

  const thoughts = code(read("src/lib/clinical/thought-store.ts"));
  const begin = thoughts.slice(thoughts.indexOf("export async function beginThought"));
  assert.doesNotMatch(begin.slice(0, begin.indexOf("): Promise")), /\bnow\b/,
    "beginThought takes a clock again, and recorded_at is when somebody pressed Record");
});

test("a record written while the clock is moved is dated in real time", async () => {
  // Behavioural, because the source guards above describe a mechanism and a
  // mechanism can be right while the behaviour is wrong. The clock is most of a
  // year back here, so a leak would be unmistakable.
  await setClock({ milestoneId: "opening", reason: "test the write boundary", actorId: "t" });
  const clock = await readClock();
  assert.ok(Date.now() - clock.now.getTime() > 200 * 86400000);

  const { beginThought } = await import("../src/lib/clinical/thought-store");
  const thought = await beginThought(
    { tenantId: T.tenant, personId: T.clinician },
    { personId: T.person }
  );

  const c = await data();
  const row = (await c.get(
    "SELECT recorded_at FROM clinician_thoughts WHERE id = ?", [thought.id]
  )) as { recorded_at: string };
  const written = new Date(String(row.recorded_at).replace(" ", "T") + "Z").getTime();
  assert.ok(Math.abs(Date.now() - written) < 120_000,
    `the recording is dated ${row.recorded_at}, which is the demo clock rather than the real one`);

  // And the closure of a safety alert, which is the write inside the one module
  // that also reads the frame. This is the check the exemption above rests on.
  db.prepare(
    "INSERT OR REPLACE INTO alerts (id, user_id, alert_type, severity, detail, status, created_at) " +
    "VALUES (?, ?, 'harm_urge', 'urgent', 'fixture', 'open', ?)"
  ).run("al-clockc", T.person, stamp(new Date(Date.now() - 3600_000)));

  const { closeAlert } = await import("../src/lib/clinical/alerts");
  await closeAlert({
    alertId: "al-clockc", clinicianId: T.clinician, tenantId: T.tenant,
    resolution: "Called and confirmed safe; follow-up booked for Thursday.",
  });
  const closed = (await c.get(
    "SELECT reviewed_at FROM alerts WHERE id = 'al-clockc'", []
  )) as { reviewed_at: string };
  const at = new Date(String(closed.reviewed_at).replace(" ", "T") + "Z").getTime();
  assert.ok(Math.abs(Date.now() - at) < 120_000,
    `the alert closure is dated ${closed.reviewed_at}, which is the demo clock rather than the real one`);

  await live();
});

// ---------------------------------------------------------------------------
// The default that caused it
// ---------------------------------------------------------------------------

test("no read on the clinician or member path defaults to real time", () => {
  // THE SHAPE OF THE DEFECT, not an instance of it. Twenty-seven functions were
  // written as `const now = args.now ?? new Date()`, which is a default that
  // answers with real time in a product whose data is read through a moved
  // frame. Nothing fails and nothing is logged; the number is simply wrong, and
  // plausible. Every module named here is a read: a write belongs on real time
  // and is guarded above instead.
  const READS = [
    "src/lib/clinical/caseload.ts",
    "src/lib/clinical/caseload-state.ts",
    "src/lib/clinical/work-queue.ts",
    "src/lib/clinical/recent-activity.ts",
    "src/lib/clinical/followups.ts",
    "src/lib/clinical/session-prep.ts",
    "src/lib/clinical/alerts.ts",
    "src/lib/member/today.ts",
    "src/lib/member/progress.ts",
    "src/lib/member/day-read.ts",
  ];
  const offenders: string[] = [];
  for (const f of READS) {
    const src = code(read(f));
    if (/\?\?\s*new Date\(\)/.test(src)) offenders.push(`${f} falls back to real time`);
    if (!/readingNow\(\)|readingFrame\(\)/.test(src)) offenders.push(`${f} never reads the frame`);
  }
  assert.deepEqual(offenders, [],
    "a read defaults to a clock the demo control cannot move:\n  " + offenders.join("\n  "));
});

test("the pages that render an age read the frame once and pass it down", () => {
  // Per page rather than per component: a page that reads the frame twice can
  // still straddle midnight, and a page that reads it not at all is the defect.
  const PAGES = [
    "src/app/clinician/today/page.tsx",
    "src/app/clinician/caseload/page.tsx",
    "src/app/clinician/member/[id]/note/page.tsx",
    "src/app/clinician/member/[id]/thoughts/page.tsx",
    // The trajectory pair. `computeTrajectory` takes an `asOf` and defaults to
    // the wall clock when nobody passes one, and these two passed nothing — so
    // a moved clock changed every other age on the record and left the
    // trajectory cutoff where it was. The Course landing counts those same
    // domains from the frame, which is how the disagreement surfaced.
    "src/app/clinician/member/[id]/trajectory/page.tsx",
    "src/app/clinician/member/[id]/page.tsx",
    "src/app/clinician/member/[id]/course/page.tsx",
  ];
  for (const f of PAGES) {
    const src = code(read(f));
    assert.match(src, /readingFrame\(\)/, `${f} renders ages without reading the frame`);
    assert.doesNotMatch(src, /new Date\(\)|Date\.now\(\)/,
      `${f} still reads a clock of its own, so half the screen can disagree with the other half`);
  }
});
