// The demo clock (handoff 07 §1.5, p9).
//
//   Advance clock — move demo date to a scripted milestone.
//   Guard: demo only; clock shown in shell.
//
// The clock lets a presenter open the same console at two moments in the
// fabricated programme's life. The whole safety argument for it is one
// sentence, and most of this file exists to enforce it:
//
//   IT MOVES THE READING FRAME, NEVER THE RECORD.
//
// A clock that could backdate an audit row would turn a tamper-evident chain
// into a chain of whatever somebody set the date to. One that could move a
// session's expiry would be a privilege escalation with a friendly name — set
// it back, keep a session alive forever; set it forward, end somebody else's.

process.env.EMDR_DATA_DIR = `/tmp/steady-clock-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "clock-test-secret-at-least-32-characters-x";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "clock-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import { CALENDAR_DAYS } from "../src/lib/demo-population-calendar";
import {
  MILESTONES, demoNow, demoToday, milestone, milestoneDate, readClock, setClock,
} from "../src/lib/demo-clock";
import { loadObservations } from "../src/lib/metrics/population-metrics";
import { detectSignals, planningWindows } from "../src/lib/planning/service";
import { PLANNING_TENANT_ID, populationTenantIds } from "../src/lib/planning/scope";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

async function live() {
  await setClock({ milestoneId: null, reason: "test reset to live", actorId: "test" });
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

test("nothing that writes a governance record reads the demo clock", () => {
  // THE LOAD-BEARING GUARD. Checked by what these modules may import, because
  // a rule about what a timestamp means cannot be enforced by reading the
  // timestamps: audit rows, sessions and rate limits are written in a dozen
  // places and the wrong clock in any one of them is invisible until somebody
  // is looking at a forged chain.
  const offenders: string[] = [];
  for (const f of [
    "src/lib/audit.ts",
    "src/lib/auth.ts",
    "src/lib/rate-limit.ts",
    "src/lib/crypto.ts",
  ]) {
    const src = read(f);
    if (/from "\.\/demo-clock"|from "@\/lib\/demo-clock"/.test(src)) {
      offenders.push(`${f} imports the demo clock`);
    }
  }
  assert.deepEqual(offenders, [],
    "a module that writes a governance record can reach the demo clock:\n  " +
    offenders.join("\n  "));
});

test("the audit chain is written on real time even while the clock is moved", async () => {
  getDb();
  await setClock({ milestoneId: "opening", reason: "test the audit boundary", actorId: "test" });
  const clock = await readClock();
  assert.equal(clock.live, false);
  // The clock is nearly a year behind, so a leaked clock would be unmistakable.
  assert.ok(Date.now() - clock.now.getTime() > 200 * 86400000);

  const { audit } = await import("../src/lib/audit");
  await audit({ actorId: "test", actorRole: "demo_admin", family: "security", type: "clock_boundary_probe" });

  const c = await data();
  const row = (await c.get(
    "SELECT created_at FROM audit_log WHERE event_type = 'clock_boundary_probe' ORDER BY id DESC LIMIT 1", [],
  )) as { created_at: string };
  const written = new Date(String(row.created_at)).getTime();
  assert.ok(Math.abs(Date.now() - written) < 60_000,
    `the audit row is dated ${row.created_at}, which is the demo clock rather than the real one`);
  await live();
});

test("moving the clock does not move when the clock itself was set", async () => {
  getDb();
  await setClock({ milestoneId: "opening", reason: "test the set_at boundary", actorId: "test" });
  const c = await data();
  const row = (await c.get("SELECT set_at, viewing_at FROM demo_clock WHERE id = 1", [])) as
    { set_at: string; viewing_at: string };
  // `viewing_at` is the fabricated past; `set_at` is now. Recording when
  // somebody moved the clock on the clock they were moving is circular, and
  // the row would say the change happened before the environment existed.
  assert.ok(Math.abs(Date.now() - new Date(String(row.set_at)).getTime()) < 60_000,
    `set_at is ${row.set_at}, which is not the real clock`);
  assert.ok(new Date(String(row.viewing_at)).getTime() < Date.now() - 200 * 86400000);
  await live();
});

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

test("the milestones are derived from the calendar, not typed as dates", () => {
  assert.ok(MILESTONES.length >= 4);
  const days = MILESTONES.map((m) => m.day);
  assert.deepEqual([...days].sort((a, b) => a - b), days, "the milestones are not in order");
  assert.equal(days[days.length - 1], CALENDAR_DAYS,
    "the last milestone is not the end of the calendar, so 'today' points somewhere else");
  for (const m of MILESTONES) {
    assert.ok(m.day > 0 && m.day <= CALENDAR_DAYS, `${m.id} falls outside the calendar`);
    assert.ok(m.shows.length > 30, `${m.id} does not say what a reader should expect to differ`);
    assert.equal(milestone(m.id)?.id, m.id);
  }
  assert.equal(milestone("no-such-milestone"), null);
  // A milestone at the end of the calendar resolves to about today, which is
  // what makes "Today" and live agree.
  const today = MILESTONES[MILESTONES.length - 1];
  assert.ok(Math.abs(Date.now() - milestoneDate(today).getTime()) < 2 * 86400000);
});

test("the clock refuses an unknown milestone and a missing reason", async () => {
  getDb();
  const unknown = await setClock({ milestoneId: "nope", reason: "a good reason", actorId: "t" });
  assert.equal(unknown.ok, false);
  assert.match((unknown as { reason: string }).reason, /not a scripted milestone/);

  const noReason = await setClock({ milestoneId: "half-year", reason: "  ", actorId: "t" });
  assert.equal(noReason.ok, false);
  assert.match((noReason as { reason: string }).reason, /reason is required/);

  // And the refusals left the clock alone.
  assert.equal((await readClock()).live, true);
});

test("the clock does not exist outside a demonstration environment", async () => {
  getDb();
  const saved = process.env.EMDR_DEMO;
  // Set it first, in a demo environment, so there is a row to ignore.
  await setClock({ milestoneId: "opening", reason: "seed a row to ignore", actorId: "t" });
  assert.equal((await readClock()).live, false);
  try {
    process.env.EMDR_DEMO = "0";
    // READ, not just write. A row surviving an environment change must not
    // take effect — the check belongs on both sides or the one that is missing
    // is the one that matters.
    assert.equal((await readClock()).live, true,
      "a clock row set in a demo environment still moves the reading outside one");
    const refused = await setClock({ milestoneId: "half-year", reason: "should refuse", actorId: "t" });
    assert.equal(refused.ok, false);
    assert.match((refused as { reason: string }).reason, /demonstration environment/);
  } finally {
    process.env.EMDR_DEMO = saved;
  }
  await live();
});

test("the clock is a row, not module state", () => {
  // Next instantiates a module more than once per process — route bundles
  // carry their own copies — so a clock in memory reads differently depending
  // on which bundle served the request, and a presenter watches two screens
  // disagree about what day it is.
  const src = code(read("src/lib/demo-clock.ts"));
  assert.doesNotMatch(src, /^let \w+\s*[:=]/m, "the clock module holds mutable state");
  assert.match(src, /FROM demo_clock/, "the clock is not read from the database");
});

// ---------------------------------------------------------------------------
// What it actually changes
// ---------------------------------------------------------------------------

test("moving the clock moves the windows, the population and the signals", async () => {
  getDb();
  await live();
  const liveWindows = await planningWindows();
  const livePopulation = (await loadObservations(populationTenantIds())).length;

  await setClock({ milestoneId: "first-quarter", reason: "test that the reading moves", actorId: "t" });
  const earlyWindows = await planningWindows();
  const earlyPopulation = (await loadObservations(populationTenantIds())).length;

  assert.notEqual(earlyWindows[1].end, liveWindows[1].end, "the windows did not move");
  assert.ok(earlyPopulation < livePopulation,
    `${earlyPopulation} people are visible at the first quarter and ${livePopulation} today — ` +
    "the loader is showing the reader the future");
  assert.ok(earlyPopulation > 0, "nobody at all is visible at the first quarter");

  // And the enrolment cut-off is the clock's, not the real one.
  const today = await demoToday();
  assert.equal(today, earlyWindows[1].end);
  assert.ok((await demoNow()).getTime() < Date.now());
  await live();
});

test("a milestone reading does not overwrite a live signal, and says which it is", async () => {
  // THE COLLISION THIS FOUND. A signal's id derives from rule, cohort, dataset
  // and tenant, and the insert is conflict-do-nothing with the evidence frozen
  // at detection. Walk the clock to the half year, detect, come back to live,
  // and whichever ran first wins — March's numbers sitting on the list looking
  // like today's, with nothing saying otherwise.
  getDb();
  await live();
  const liveRun = await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  assert.ok(liveRun.signals.length > 0, "nothing fired live, so there is no collision to test");
  for (const s of liveRun.signals) {
    assert.equal(s.reading_point, null, "a live signal claims a reading point");
  }

  await setClock({ milestoneId: "half-year", reason: "test signal identity", actorId: "t" });
  const milestoneRun = await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  for (const s of milestoneRun.signals) {
    assert.equal(s.reading_point, "half-year", "a milestone signal does not say when it was read");
  }
  const liveIds = new Set(liveRun.signals.map((s) => s.signal_id));
  for (const s of milestoneRun.signals) {
    assert.ok(!liveIds.has(s.signal_id),
      `${s.signal_type} on ${s.cohort_ref} reuses the live signal's id, so one of the two ` +
      "readings was silently dropped and the other is mislabelled");
  }
  await live();
});

test("the clock is shown in the shell, and only when it is moved", () => {
  // p9's guard is two things and this is the second: "clock shown in shell".
  const badge = read("src/components/app/DemoClockBadge.tsx");
  assert.match(badge, /if \(clock\.live\) return null/,
    "the badge renders on a live clock, which is a permanent 'the date is today' label " +
    "that teaches people to stop reading the corner the FABRICATED flag lives in");
  assert.match(read("src/components/app/AppShell.tsx"), /<DemoClockBadge \/>/,
    "the shell does not render the clock, so a reader cannot tell which day a screen means");
});

test("a reset returns the clock to live", async () => {
  // A presenter who resets and then wonders why every screen still reads as
  // March has been left a trap. Checked behaviourally rather than by reading
  // the table list: the list is the mechanism, and the mechanism could be
  // right while the reset ordering left the row in place.
  getDb();
  await setClock({ milestoneId: "opening", reason: "test that a reset clears it", actorId: "t" });
  assert.equal((await readClock()).live, false);

  const { resetDemoData } = await import("../src/lib/demo-reset");
  resetDemoData(getDb());
  assert.equal((await readClock()).live, true,
    "the clock survived a reset, so the environment is not back to a known state");
});
