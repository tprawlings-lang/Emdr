process.env.EMDR_DATA_DIR = `/tmp/steady-nightly-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

// The nightly rebuild (handoff 07 Wave 8, p9's G18).
//
// p57 left this as an open question for a human — "do the 240 get a nightly
// reset in production-demo, AND ON WHOSE CLOCK?" — and the guards below are
// mostly about the answers being the safe ones rather than the convenient ones.
//
// THE FAILURE THIS JOB COULD CAUSE is worse than the one it prevents. It is the
// only scheduled job in the product that deletes member data, it runs at an
// hour chosen so that nobody is watching, and the environment lock exists
// because a dataset changing under somebody's meeting is a real thing that
// happens. A timer that interrupted a walkthrough would be that failure with
// nobody in the room to stop it.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import { resetDemoData } from "../src/lib/demo-reset";
import { acquireLock, releaseLock } from "../src/lib/demo/environment-lock";
import { readLastReset } from "../src/lib/demo/preflight";
import {
  RESET_BUDGET_MS, nextRunAt, nightlyResetConfig, runNightlyReset,
} from "../src/lib/demo/nightly-reset";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const db = getDb();
resetDemoData(db);

/** Run something with the job armed, and disarm afterwards however it ends. */
async function armed<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.EMDR_DEMO_NIGHTLY_RESET;
  process.env.EMDR_DEMO_NIGHTLY_RESET = "1";
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.EMDR_DEMO_NIGHTLY_RESET;
    else process.env.EMDR_DEMO_NIGHTLY_RESET = before;
  }
}

// ---------------------------------------------------------------------------
// Whether: off until somebody says otherwise
// ---------------------------------------------------------------------------

test("the job is off unless it is explicitly armed", () => {
  // Not by EMDR_DEMO, not by a deployment flag, and never by its own absence.
  // `demo-reset.ts` states the rule already — a rebuild that runs unattended
  // is a deployment that can destroy data while nobody is watching — and a
  // nightly one is that with a timer on it.
  delete process.env.EMDR_DEMO_NIGHTLY_RESET;
  const off = nightlyResetConfig();
  assert.equal(off.enabled, false, "the nightly reset is armed by default");
  assert.ok(off.reason && off.reason.length > 40, "a disabled job does not say why it is off");

  for (const wrong of ["0", "true", "yes", "on", ""]) {
    process.env.EMDR_DEMO_NIGHTLY_RESET = wrong;
    assert.equal(
      nightlyResetConfig().enabled, false,
      `"${wrong}" armed a destructive scheduled job; only "1" may`
    );
  }
  delete process.env.EMDR_DEMO_NIGHTLY_RESET;

  process.env.EMDR_DEMO_NIGHTLY_RESET = "1";
  assert.equal(nightlyResetConfig().enabled, true, "an explicit 1 does not arm it");
  delete process.env.EMDR_DEMO_NIGHTLY_RESET;
});

test("it will not arm outside a demonstration environment", async () => {
  const before = process.env.EMDR_DEMO;
  process.env.EMDR_DEMO = "0";
  process.env.EMDR_DEMO_NIGHTLY_RESET = "1";
  try {
    const c = nightlyResetConfig();
    assert.equal(c.enabled, false, "a destructive nightly job armed outside a demo environment");
    const outcome = await runNightlyReset();
    assert.equal(outcome.ran, false);
  } finally {
    process.env.EMDR_DEMO = before;
    delete process.env.EMDR_DEMO_NIGHTLY_RESET;
  }
});

// ---------------------------------------------------------------------------
// On whose clock: UTC, stated
// ---------------------------------------------------------------------------

test("the hour is UTC, defaulted, bounded, and movable", () => {
  delete process.env.EMDR_DEMO_RESET_HOUR_UTC;
  const d = nightlyResetConfig().hourUtc;
  assert.ok(d >= 0 && d <= 23, "the default hour is not a real hour");

  process.env.EMDR_DEMO_RESET_HOUR_UTC = "2";
  assert.equal(nightlyResetConfig().hourUtc, 2, "the hour cannot be moved");

  // Nonsense is clamped rather than crashing a boot: a scheduler that throws
  // on a typo takes the whole service with it.
  for (const [raw, want] of [["99", 23], ["-4", 0], ["banana", d], ["3.7", 3]] as const) {
    process.env.EMDR_DEMO_RESET_HOUR_UTC = raw;
    assert.equal(nightlyResetConfig().hourUtc, want, `"${raw}" produced a bad hour`);
  }
  delete process.env.EMDR_DEMO_RESET_HOUR_UTC;
});

test("the next run is the next occurrence of that UTC hour, never one in the past", () => {
  const before = new Date("2026-03-10T08:00:00Z");
  assert.equal(nextRunAt(before, 9).toISOString(), "2026-03-10T09:00:00.000Z");

  // After the hour, tomorrow — including across a month boundary, which is
  // where a hand-rolled date calculation usually goes wrong.
  const after = new Date("2026-03-10T09:00:01Z");
  assert.equal(nextRunAt(after, 9).toISOString(), "2026-03-11T09:00:00.000Z");
  assert.equal(nextRunAt(new Date("2026-03-31T23:00:00Z"), 9).toISOString(), "2026-04-01T09:00:00.000Z");

  // Exactly on the hour counts as past, or a run at 09:00:00 would re-arm for
  // the same instant and spin.
  assert.equal(nextRunAt(new Date("2026-03-10T09:00:00Z"), 9).toISOString(), "2026-03-11T09:00:00.000Z");
});

// ---------------------------------------------------------------------------
// It skips a held environment; it never interrupts one
// ---------------------------------------------------------------------------

test("a walkthrough in progress skips the night rather than being interrupted", async () => {
  const user = db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string };
  acquireLock({
    scenarioId: "between-visit", scenarioVersion: "between-visit.1.0.0",
    personId: user.id, personName: "A presenter",
  });

  try {
    const outcome = await armed(() => runNightlyReset());
    assert.equal(outcome.ran, false, "a nightly reset ran over a live walkthrough");
    assert.equal((outcome as { skipped: string }).skipped, "walkthrough_held");
    assert.match(
      (outcome as { detail: string }).detail, /interrupt/i,
      "the skip does not explain that it declined to interrupt"
    );

    // AND THE LOCK IS STILL HELD. A "skip" that released the lock would be an
    // interruption wearing a politer word.
    const still = db.prepare(
      "SELECT released_at FROM demo_environment_lock WHERE id = 1"
    ).get() as { released_at: string | null };
    assert.equal(still.released_at, null, "the nightly job released somebody else's lock");
  } finally {
    releaseLock("test cleanup");
  }

  // A STALE LOCK IS STILL A LOCK, checked by holding one. The console offers a
  // human the judgement call about whether somebody has really finished; a job
  // at 4am should not be making it.
  //
  // ASSERTED BY RUNNING IT rather than by reading the source. The first version
  // of this matched `lock.stale` against a boolean operator, and the only
  // occurrence in the file is the word "(stale)" in the message it prints — so
  // the guard failed on correct code and would have passed on code that
  // branched on staleness some other way.
  acquireLock({
    scenarioId: "between-visit", scenarioVersion: "between-visit.1.0.0",
    personId: user.id, personName: "A presenter who left",
  });
  const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
    .replace("T", " ").slice(0, 19);
  db.prepare("UPDATE demo_environment_lock SET acquired_at = ? WHERE id = 1").run(longAgo);
  try {
    const stale = await armed(() => runNightlyReset());
    assert.equal(stale.ran, false, "a nightly reset ran over a stale walkthrough lock");
    assert.match(
      (stale as { detail: string }).detail, /stale/,
      "a stale lock is skipped without saying it was stale"
    );
  } finally {
    releaseLock("test cleanup");
  }

  const src = code("src/lib/demo/nightly-reset.ts");
  assert.doesNotMatch(src, /interruptReason|canReset\(/, "the nightly job can interrupt a walkthrough");
});

// ---------------------------------------------------------------------------
// A run that happens is recorded where the console reads it
// ---------------------------------------------------------------------------

test("a run rebuilds, records its outcome, and reports its duration", async () => {
  releaseLock("test cleanup");
  const outcome = await armed(() => runNightlyReset());
  assert.equal(outcome.ran, true, "an armed, unheld environment did not rebuild");
  const ran = outcome as { ms: number; rowsRemoved: number; overBudget: boolean };
  assert.ok(ran.rowsRemoved > 0, "the rebuild removed nothing");
  assert.ok(ran.ms >= 0, "no duration was measured");

  // §7.3: "A reset failure never displays ready." That only holds if the
  // outcome is where the console reads it, which is this table — not the audit
  // chain, which nothing on the preflight path reads.
  const last = readLastReset(db);
  assert.ok(last, "the nightly run recorded no reset outcome");
  assert.equal(last!.status, "succeeded");
  assert.match(
    last!.reason ?? "", /Nightly/,
    "the recorded reset does not say it was the nightly one — an operator arriving on a " +
    "dataset that changed overnight cannot tell a person's rebuild from the timer's"
  );

  // p29's ceiling is reported against, never enforced.
  assert.equal(ran.overBudget, ran.ms > RESET_BUDGET_MS);
  const src = code("src/lib/demo/nightly-reset.ts");
  assert.doesNotMatch(src, /abort|throw new Error\(".*budget/i, "the job aborts a rebuild for running long");
});

test("a failed rebuild is recorded in the place the console reads, not only the audit chain", () => {
  // The same defect the manual reset had: the audit chain held the failure and
  // nothing read it, so the console recomputed health against whatever the
  // database happened to contain and displayed ready.
  const src = code("src/lib/demo/nightly-reset.ts");
  const at = src.indexOf("catch (err)");
  assert.ok(at > 0, "the nightly run has no failure path");
  const body = src.slice(at, at + 700);
  assert.match(body, /recordReset\(db, \{ status: "failed"/, "a failed nightly run is not recorded");
  assert.match(body, /type: "demo_nightly_reset_failed"/, "a failed nightly run is not audited");
  assert.match(body, /throw err/, "a failed nightly run is swallowed");
});

// ---------------------------------------------------------------------------
// The scheduler, and the screen
// ---------------------------------------------------------------------------

test("the timer is armed once, never holds the process open, and re-arms after a bad night", () => {
  const src = code("src/lib/demo/nightly-reset.ts");
  assert.match(src, /__steadyNightlyDemoReset/, "the timer can be armed twice by a hot reload");
  assert.match(src, /timer\.unref\?\.\(\)/, "the timer holds the process open");
  // In a `finally`, so one bad night does not stop every night after it.
  assert.match(src, /\} finally \{\s*arm\(\);/, "a failing run stops the schedule");

  const instrumentation = code("src/instrumentation.ts");
  assert.match(instrumentation, /scheduleNightlyDemoReset\(\)/, "the job is never armed at boot");
});

test("the console says whether it is armed, when it next runs, and that it will not interrupt", () => {
  // An armed destructive scheduled job that is invisible on the console is
  // worse than not having one: the environment changes overnight and nothing
  // on the screen explains why.
  const page = code("src/app/admin/demo/page.tsx");
  assert.match(page, /nightly\.enabled \?/, "the console never says whether the job is armed");
  assert.match(page, /nightly\.reason/, "the console never says why the job is off");
  assert.match(page, /nextNightly/, "the console never says when it next runs");
  assert.match(page, /skips the night/, "the console never says it declines to interrupt");
  assert.match(page, /RESET_BUDGET_MS/, "the console never names the duration ceiling");
});
