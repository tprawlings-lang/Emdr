// The environment lock (handoff 09 §7.3, Package 4).
//
// §7.3: "Before reset, show scope, active sessions, and effect; prevent a
// reset during another walkthrough unless an authorized operator deliberately
// interrupts. An environment lock is sufficient for the first implementation;
// isolated scenario datasets need separate scope approval."
//
// THE FAILURE THIS PREVENTS HAS A SHAPE. Two people share one demonstration
// environment. One is forty minutes into an investor meeting. The other opens
// the admin console, sees a manifest they want clean before their own session,
// types a reason, and resets — and the first presenter's screen, mid-sentence,
// becomes a different dataset. Nothing was misused; the console simply never
// mentioned that anybody else was there.
//
// SO THE REFUSAL IS THE DEFAULT AND THE INTERRUPTION IS DELIBERATE. `canReset`
// returns a refusal while a walkthrough is held, and the only way past it is
// an explicit interrupt carrying its own reason — which is recorded against
// the lock, so the interrupted presenter can find out what happened to their
// environment rather than guessing.
//
// AND AN INTERRUPT IS NOT A SECOND KIND OF PERMISSION. Everyone who can reach
// the reset control is already a demo administrator; §7.3's "authorized
// operator" is that same role acting deliberately, not a higher one. Adding a
// privilege tier here would be inventing an authorization concept to solve a
// coordination problem, which is how a demo surface grows a security model
// nobody reviewed.
//
// A held lock is also NOT a claim that the other session is alive. Nothing
// heartbeats. `staleAfterMinutes` is what stops an abandoned walkthrough
// holding the environment forever, and a stale lock reports itself as stale
// rather than quietly disappearing — a presenter deserves to know they are
// stepping over somebody, even when that somebody left an hour ago.

import { getDb } from "../db";

/** How long a walkthrough may hold the environment before it is reported as
 *  stale. Longer than §7.2's five-minute story by a wide margin, because a
 *  presenter answering questions is still presenting. */
export const STALE_AFTER_MINUTES = 90;

export interface EnvironmentLock {
  scenarioId: string;
  scenarioVersion: string;
  heldBy: string;
  heldByName: string | null;
  acquiredAt: string;
  /** Held longer than STALE_AFTER_MINUTES. Still a lock; just an old one. */
  stale: boolean;
  minutesHeld: number;
}

function nowStamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function minutesSince(stamp: string, now: Date): number {
  const t = new Date(`${stamp.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 60_000));
}

/** The live walkthrough, if there is one. */
export function activeLock(now = new Date()): EnvironmentLock | null {
  const row = getDb()
    .prepare(
      `SELECT scenario_id, scenario_version, held_by, held_by_name, acquired_at
         FROM demo_environment_lock WHERE id = 1 AND released_at IS NULL`
    )
    .get() as
    | {
        scenario_id: string;
        scenario_version: string;
        held_by: string;
        held_by_name: string | null;
        acquired_at: string;
      }
    | undefined;
  if (!row) return null;
  const minutesHeld = minutesSince(row.acquired_at, now);
  return {
    scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version,
    heldBy: row.held_by,
    heldByName: row.held_by_name,
    acquiredAt: row.acquired_at,
    stale: minutesHeld > STALE_AFTER_MINUTES,
    minutesHeld,
  };
}

export interface AcquireResult {
  ok: boolean;
  /** The lock now in force — the caller's on success, somebody else's on
   *  refusal. Returned either way so a surface can say who has it. */
  lock: EnvironmentLock | null;
  reason?: string;
}

/**
 * Take the environment for a walkthrough.
 *
 * TAKING IT TWICE IS NOT AN ERROR. A presenter who reloads the guide, or who
 * restarts the same story, is the same walkthrough — refusing them their own
 * lock would teach them to interrupt, which is the habit this whole mechanism
 * is trying not to build.
 */
export function acquireLock(args: {
  scenarioId: string;
  scenarioVersion: string;
  personId: string;
  personName?: string | null;
}): AcquireResult {
  const held = activeLock();
  if (held && held.heldBy !== args.personId) {
    return {
      ok: false,
      lock: held,
      reason:
        `${held.heldByName ?? "Another operator"} has been running "${held.scenarioId}" for ` +
        `${held.minutesHeld} minutes.`,
    };
  }
  getDb()
    .prepare(
      `INSERT INTO demo_environment_lock
         (id, scenario_id, scenario_version, held_by, held_by_name, acquired_at, released_at, released_reason)
       VALUES (1, ?, ?, ?, ?, ?, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET
         scenario_id      = excluded.scenario_id,
         scenario_version = excluded.scenario_version,
         held_by          = excluded.held_by,
         held_by_name     = excluded.held_by_name,
         acquired_at      = excluded.acquired_at,
         released_at      = NULL,
         released_reason  = NULL`
    )
    .run(
      args.scenarioId,
      args.scenarioVersion,
      args.personId,
      args.personName ?? null,
      // Re-acquiring your own lock keeps the ORIGINAL acquisition time, so a
      // presenter who reloads twice does not reset their own staleness clock.
      held && held.heldBy === args.personId ? held.acquiredAt : nowStamp()
    );
  return { ok: true, lock: activeLock() };
}

/** Give the environment back. Idempotent: releasing an unheld environment is
 *  what an "end the walkthrough" button does when somebody already ended it. */
export function releaseLock(reason: string): void {
  getDb()
    .prepare(
      `UPDATE demo_environment_lock
          SET released_at = ?, released_reason = ?
        WHERE id = 1 AND released_at IS NULL`
    )
    .run(nowStamp(), reason);
}

export interface ResetPermission {
  allowed: boolean;
  /** Present when a walkthrough is in the way. */
  blockedBy: EnvironmentLock | null;
  reason?: string;
}

/**
 * Whether a reset may proceed.
 *
 * `interrupt` IS A REQUIRED ARGUMENT, not an option with a default. A caller
 * that has not thought about the walkthrough in progress cannot accidentally
 * be treated as having decided to end it, which is exactly what a default of
 * `false` would look like at the call site — indistinguishable from a caller
 * who considered it.
 */
export function canReset(args: { interrupt: boolean; interruptReason: string }): ResetPermission {
  const held = activeLock();
  if (!held) return { allowed: true, blockedBy: null };

  if (!args.interrupt) {
    return {
      allowed: false,
      blockedBy: held,
      reason:
        `A walkthrough is running: ${held.heldByName ?? held.heldBy} started "${held.scenarioId}" ` +
        `${held.minutesHeld} minutes ago. Resetting now changes the dataset under their screen.`,
    };
  }
  if (args.interruptReason.trim().length < 4) {
    // The same floor the reset's own reason uses, and for the same reason: an
    // interruption nobody explained is one the interrupted presenter cannot
    // find out about.
    return {
      allowed: false,
      blockedBy: held,
      reason: "An interruption needs a reason the other operator can read.",
    };
  }
  return { allowed: true, blockedBy: held };
}

/** What a reset is about to affect. §7.3: "Before reset, show scope, active
 *  sessions, and effect." Assembled here so the console states it rather than
 *  composing its own description of a destructive operation. */
export interface ResetScope {
  /** What goes. */
  clears: string[];
  /** What survives, and why somebody would care. */
  preserves: string[];
  activeWalkthrough: EnvironmentLock | null;
}

export function resetScope(): ResetScope {
  return {
    clears: [
      "Every fabricated account, session, check-in and clinical record",
      "Every projection, attention signal and review decision derived from them",
      "The demonstration clock, which returns to live",
      "Any walkthrough lock currently held",
    ],
    preserves: [
      "Reviewer change requests — the durable product of somebody's review hour",
      "Approved planning thresholds, which carry an owner and an approval date",
      "Per-tenant feature decisions, which an organization made about itself",
    ],
    activeWalkthrough: activeLock(),
  };
}
