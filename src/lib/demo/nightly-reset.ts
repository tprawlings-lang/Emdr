// The nightly reset (handoff 07 Wave 8, p9's G18).
//
// p57 left this as an open question for a human — "do the 240 get a nightly
// reset in production-demo, AND ON WHOSE CLOCK?" — and the two halves have
// different answers, so they are answered separately here rather than decided
// together by a default.
//
// WHETHER: OFF, until somebody says otherwise. This is the only scheduled job
// in the codebase that deletes member data, and it runs at an hour chosen so
// that nobody is watching. `demo-reset.ts` already states the rule it is
// following — "a rebuild-on-boot is a deployment that can destroy data while
// nobody is watching" — and a nightly one is that with a timer on it. So it is
// armed by an explicit environment variable and by nothing else: not by
// EMDR_DEMO alone, not by a deployment flag, and never by its own absence.
//
// ON WHOSE CLOCK: UTC, stated rather than inferred. A demonstration environment
// has reviewers in several places and a timezone of its own in none of them, so
// a local hour would be somebody's local hour and nobody would know whose. The
// default of 09:00 UTC is the trough for both US coasts (4am Eastern, 1am
// Pacific) and it is a DEFAULT, not a decision — `EMDR_DEMO_RESET_HOUR_UTC`
// moves it, and the console prints the hour and the next run so an operator
// never has to guess.
//
// IT REFUSES WHILE A WALKTHROUGH IS HELD, and this is the part that matters
// most. §7.3's lock exists to stop a dataset changing under somebody's investor
// meeting; a robot at 4am is that failure with nobody in the room to interrupt
// it. So a held lock skips the night — never interrupts it. §7.3 allows an
// interruption only when "an authorized operator deliberately interrupts", and
// a timer is the opposite of deliberate. A skipped night is recorded and shown,
// because an environment that quietly stopped resetting is one somebody will
// demonstrate from a week later.
//
// AND IT RECORDS ITS DURATION. p29 targets under 120 seconds. That number is
// currently an assumption — roughly 12 seconds against the demo population,
// roughly 120 against the deployed 17,304 — so every run stores how long it
// took, and the console reports it. A budget nobody measures is a budget that
// is already blown.

import { getDb } from "../db";
import { audit } from "../audit";
import { resetDemoData } from "../demo-reset";
import { enrolledCount } from "../enrollment/gate";
import { runQualityChecks, qualitySummary } from "../demo-quality";
import { activeLock } from "./environment-lock";
import { recordReset } from "./preflight";

/** p29's ceiling for a reset, in milliseconds. Reported against, not enforced:
 *  aborting a rebuild halfway through because it ran long would leave the
 *  environment in the state this job exists to prevent. */
export const RESET_BUDGET_MS = 120_000;

const DEFAULT_HOUR_UTC = 9;

export interface NightlyResetConfig {
  /** Armed only by an explicit "1". */
  enabled: boolean;
  hourUtc: number;
  /** Why it is off, when it is. Rendered on the console: a scheduled job that
   *  is silently disabled is indistinguishable from one that is broken. */
  reason: string | null;
}

export function nightlyResetConfig(): NightlyResetConfig {
  const hourRaw = Number(process.env.EMDR_DEMO_RESET_HOUR_UTC ?? DEFAULT_HOUR_UTC);
  const hourUtc = Number.isFinite(hourRaw)
    ? Math.min(23, Math.max(0, Math.trunc(hourRaw)))
    : DEFAULT_HOUR_UTC;

  if (process.env.EMDR_DEMO !== "1") {
    return { enabled: false, hourUtc, reason: "This is not a demonstration environment." };
  }
  if (process.env.EMDR_DEMO_NIGHTLY_RESET !== "1") {
    return {
      enabled: false,
      hourUtc,
      reason:
        "Not armed. This is the only scheduled job that deletes member data, and it runs at " +
        "an hour chosen so nobody is watching — so it is switched on deliberately with " +
        "EMDR_DEMO_NIGHTLY_RESET=1, never by a deployment flag and never by default.",
    };
  }
  return { enabled: true, hourUtc, reason: null };
}

/** When the next run falls, given the configured hour. */
export function nextRunAt(now = new Date(), hourUtc = nightlyResetConfig().hourUtc): Date {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export type NightlyOutcome =
  | { ran: true; ms: number; rowsRemoved: number; checksFailed: number; overBudget: boolean }
  // `enrolled_present` is a THIRD reason to skip, not a variant of the lock:
  // a held walkthrough means somebody is mid-demonstration, and this means
  // real people would lose their answers. A caller reading the outcome should
  // be able to tell those apart.
  | { ran: false; skipped: "walkthrough_held" | "enrolled_present" | "disabled"; detail: string };

/**
 * One night's run.
 *
 * Exported and callable so the behaviour can be tested without a timer, which
 * is the difference between a scheduled job that is verified and one that is
 * only ever observed in production at four in the morning.
 */
export async function runNightlyReset(now = new Date()): Promise<NightlyOutcome> {
  const config = nightlyResetConfig();
  if (!config.enabled) {
    return { ran: false, skipped: "disabled", detail: config.reason ?? "not enabled" };
  }

  // A HELD LOCK SKIPS THE NIGHT. Never interrupts: §7.3 permits an
  // interruption only when an authorized operator deliberately makes one, and
  // a timer cannot be deliberate. A stale lock is still a lock here — the
  // console offers a human the judgement call about whether somebody has
  // really finished, and a scheduled job should not be making it at 4am.
  const lock = activeLock(now);
  if (lock) {
    const detail =
      `A walkthrough held by ${lock.heldByName ?? lock.heldBy} has been running for ` +
      `${lock.minutesHeld} minutes${lock.stale ? " (stale)" : ""}. Skipped rather than ` +
      "interrupted: an interruption is a decision a person makes, not one a timer makes.";
    await audit({
      actorRole: "system", family: "security",
      type: "demo_nightly_reset_skipped", target: "environment",
      detail: { reason: "walkthrough_held", heldBy: lock.heldBy, minutesHeld: lock.minutesHeld },
    });
    return { ran: false, skipped: "walkthrough_held", detail };
  }

  // ENROLLED PEOPLE SKIP THE NIGHT, for the same reason a held walkthrough
  // does and with more at stake. `resetDemoData` deletes users, persons,
  // consents, checkins and screenings unconditionally — for a pilot that is
  // every answer anybody gave, deleted at an hour chosen so nobody is
  // watching, by a job that then reports success.
  //
  // SKIPPED, NEVER OVERRIDDEN. The console lets an operator proceed
  // deliberately with a tick that is recorded against their account; a timer
  // cannot be deliberate, so this has no equivalent and should not. If a pilot
  // is running, the nightly reset simply does not run.
  const enrolled = await enrolledCount();
  if (enrolled > 0) {
    const detail =
      `${enrolled} enrolled ${enrolled === 1 ? "person has" : "people have"} accounts here, ` +
      "and a reset would delete them and everything they entered. Skipped: discarding real " +
      "people's answers is a decision a person makes on the console, not one a timer makes.";
    await audit({
      actorRole: "system", family: "security",
      type: "demo_nightly_reset_skipped", target: "environment",
      detail: { reason: "enrolled_present", enrolled },
    });
    return { ran: false, skipped: "enrolled_present", detail };
  }

  const db = getDb();
  const started = Date.now();
  try {
    const result = resetDemoData(db);
    const ms = Date.now() - started;
    const summary = qualitySummary(runQualityChecks(db));

    // Written after the reset, because the reset clears this table — a row
    // written before it would not survive its own success.
    recordReset(db, {
      status: "succeeded",
      reason: `Nightly reset at ${config.hourUtc}:00 UTC (${Math.round(ms / 1000)}s)`,
    });
    await audit({
      actorRole: "system", family: "security",
      type: "demo_nightly_reset", target: "environment",
      detail: {
        ms,
        overBudget: ms > RESET_BUDGET_MS,
        rowsRemoved: result.totalDeleted,
        baseline: result.baseline.hash,
        checksPassed: summary.passed,
        checksFailed: summary.failed,
      },
    });
    return {
      ran: true, ms, rowsRemoved: result.totalDeleted,
      checksFailed: summary.failed, overBudget: ms > RESET_BUDGET_MS,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // RECORDED IN TWO PLACES, the same as the manual reset: §7.3's "a reset
    // failure never displays ready" only holds if the failure is where the
    // console reads it, and the audit chain alone was not.
    recordReset(db, { status: "failed", reason: `Nightly reset failed: ${message}` });
    await audit({
      actorRole: "system", family: "security",
      type: "demo_nightly_reset_failed", target: "environment",
      detail: { message },
    });
    throw err;
  }
}

// ---------- In-process scheduler ----------

declare global {
  // Survives dev hot reloads, so the timer is armed once per process.
  var __steadyNightlyDemoReset: boolean | undefined;
}

/**
 * Arm the timer.
 *
 * Mirrors the nightly backup scheduler deliberately: same in-process shape,
 * same `unref` so it never holds the process open, same re-arm in a `finally`
 * so one bad night does not stop every night after it. The reason both live in
 * the web service rather than a cron container is the same too — the SQLite
 * file is on this service's disk and nothing else can mount it.
 */
export function scheduleNightlyDemoReset(): void {
  if (globalThis.__steadyNightlyDemoReset) return;
  globalThis.__steadyNightlyDemoReset = true;

  const config = nightlyResetConfig();
  if (!config.enabled) {
    console.log(`demo nightly reset: OFF — ${config.reason}`);
    return;
  }

  const arm = () => {
    const delay = nextRunAt(new Date(), config.hourUtc).getTime() - Date.now();
    console.log(
      `demo nightly reset: armed for ${config.hourUtc}:00 UTC, ` +
      `next run in ${Math.round(delay / 60000)} min`
    );
    const timer = setTimeout(async () => {
      try {
        const outcome = await runNightlyReset();
        if (outcome.ran) {
          console.log(
            `demo nightly reset: rebuilt in ${Math.round(outcome.ms / 1000)}s, ` +
            `${outcome.rowsRemoved} rows removed, ${outcome.checksFailed} checks failing` +
            (outcome.overBudget ? ` — OVER p29's ${RESET_BUDGET_MS / 1000}s budget` : "")
          );
        } else {
          console.log(`demo nightly reset: skipped — ${outcome.detail}`);
        }
      } catch (err) {
        console.error("demo nightly reset: FAILED:", err);
      } finally {
        arm();
      }
    }, delay);
    timer.unref?.();
  };
  arm();
}
