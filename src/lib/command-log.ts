// One user action, one write — even when the answer is lost (17 September
// handoff, P6).
//
//   "Committed action with lost response: retry with the same idempotency key;
//   return the existing command result; do not duplicate a note, approval,
//   contact, access decision, or handoff."
//
// THE KEY WAS ALREADY THERE AND NOTHING CONSULTED IT. `resolveCommand` refuses
// a command with no idempotency key, and the three command-centre row actions
// then carried it into an audit detail and deduplicated on something else:
// `recordContact` compared the NOTE TEXT against the last twenty care actions.
// That is wrong in both directions, and the second direction is the one with a
// victim — a clinician who genuinely attempts contact twice with the same
// words ("Left voicemail") is told "this attempt was already recorded" and the
// second attempt is not written down at all.
//
// So the key gets a table, and the reservation is written BEFORE the work.
//
// ONLY `confirmed` IS REPLAYED. A refusal, a conflict and an unavailable
// capability are answers about the world, and the world moves: replaying a
// refusal would pin somebody to a "no" that is no longer true, and replaying a
// conflict would hide that the version moved again. The only outcome that must
// not happen twice is the one that wrote, so that is the only one kept.
//
// AND A KEY COLLISION IS REFUSED, NOT REPLAYED. If a stored reservation belongs
// to a different intent, target or actor, returning its result would answer one
// command with another command's outcome — a wrong entry in a clinical chart
// rather than a duplicate one. The command is refused with a reason instead.

import { data } from "./data";
import { currentGeneration, generationMatches, GENERATION_REFUSAL } from "./environment-generation";
import type { CommandResult, ResolvedCommand } from "./experience/command";

/**
 * How long a reservation may sit unsettled before a retry may take it over.
 *
 * A DELIBERATE TRADE, AND BOTH SIDES ARE BAD. Below the window a second
 * attempt is told Steady does not know whether the first landed, which is the
 * truth and is unhelpful. Above it, a key whose process died would be poisoned
 * for ever and the person could never retry the action at all — so after a
 * minute a reservation is treated as abandoned. Every command here is a server
 * action measured in milliseconds; a reservation a minute old is not running.
 */
export const RESERVATION_WINDOW_MS = 60_000;

export type Reservation<R = unknown> =
  /** Nothing has run for this key. Do the work, then settle it. */
  | { kind: "reserved" }
  /** It already ran and wrote. Return this instead of doing it again. */
  | { kind: "replay"; result: CommandResult<R> }
  /** Another attempt with this key is still running. */
  | { kind: "in_flight" }
  /** The key belongs to a different command. */
  | { kind: "collision"; reason: string };

function ageMs(reservedAt: string, now: number): number {
  return now - Date.parse(reservedAt);
}

/**
 * Claim a key, or find out what already happened under it.
 *
 * The insert comes first and is the claim: two simultaneous attempts race on
 * the primary key and exactly one wins, which is what makes this work under
 * concurrency rather than only under a retry.
 */
export async function reserveCommand<R>(
  command: ResolvedCommand, now: number = Date.now()
): Promise<Reservation<R>> {
  const c = await data();
  const reservedAt = new Date(now).toISOString();
  const res = await c.run(
    `INSERT INTO command_results
       (tenant_id, idempotency_key, intent, target, actor_person_id, outcome, result_json, reserved_at, settled_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
    [
      command.tenantId, command.idempotencyKey, command.intent, command.target,
      command.actorPersonId, reservedAt,
    ],
  );
  if (res.changes > 0) return { kind: "reserved" };

  const row = (await c.get(
    `SELECT intent, target, actor_person_id, outcome, result_json, reserved_at, settled_at
       FROM command_results WHERE tenant_id = ? AND idempotency_key = ?`,
    [command.tenantId, command.idempotencyKey],
  )) as Record<string, unknown> | undefined;
  // Gone between the insert and the read — a reset, or a concurrent cleanup.
  // Treat it as ours: the alternative is telling somebody Steady does not know,
  // about a key that no longer exists.
  if (!row) return { kind: "reserved" };

  if (
    String(row.intent) !== command.intent ||
    String(row.target) !== command.target ||
    String(row.actor_person_id) !== command.actorPersonId
  ) {
    return {
      kind: "collision",
      reason:
        "This action reused an identifier that belongs to a different action, so Steady refused it " +
        "rather than answering with the other one's result. Reload the page and try again.",
    };
  }

  if (row.outcome === null || row.outcome === undefined) {
    if (ageMs(String(row.reserved_at), now) < RESERVATION_WINDOW_MS) return { kind: "in_flight" };
    // Abandoned. Take it over by re-dating the reservation, so two retries
    // arriving together do not both decide it is theirs.
    const taken = await c.run(
      `UPDATE command_results SET reserved_at = ?
        WHERE tenant_id = ? AND idempotency_key = ? AND outcome IS NULL AND reserved_at = ?`,
      [reservedAt, command.tenantId, command.idempotencyKey, String(row.reserved_at)],
    );
    return taken.changes > 0 ? { kind: "reserved" } : { kind: "in_flight" };
  }

  // Settled. Only a write is kept (see the header), so anything stored here is
  // a confirmed result.
  return {
    kind: "replay",
    result: { ...(JSON.parse(String(row.result_json)) as CommandResult<R>), replayed: true },
  };
}

/**
 * Record what happened under a key.
 *
 * A non-confirmed outcome RELEASES the key rather than storing it, so the next
 * attempt re-evaluates against the world as it is then.
 */
export async function settleCommand(
  command: ResolvedCommand, result: CommandResult, now: number = Date.now()
): Promise<void> {
  const c = await data();
  if (result.outcome !== "confirmed") {
    await releaseCommand(command);
    return;
  }
  await c.run(
    `UPDATE command_results SET outcome = ?, result_json = ?, settled_at = ?
      WHERE tenant_id = ? AND idempotency_key = ?`,
    [
      result.outcome, JSON.stringify(result), new Date(now).toISOString(),
      command.tenantId, command.idempotencyKey,
    ],
  );
}

/** Drop a reservation, so the key is free for a genuine retry. */
export async function releaseCommand(command: ResolvedCommand): Promise<void> {
  const c = await data();
  await c.run(
    "DELETE FROM command_results WHERE tenant_id = ? AND idempotency_key = ? AND outcome IS NULL",
    [command.tenantId, command.idempotencyKey],
  );
}

/**
 * Run a command's work at most once per key.
 *
 * ONE CALL SITE PER ACTION, which is the point. The bookkeeping is five steps
 * and the fourth action somebody writes is the one that forgets step three —
 * so there is a single function that cannot be half-applied, and the actions
 * read the same as they did before.
 *
 * A THROW RELEASES THE KEY. An unexpected failure is not an answer: if the
 * reservation survived it, the person's retry would be told another attempt is
 * running for a minute, and then that nothing happened. The throw is
 * re-raised, and the caller's own handler turns it into `indeterminate` with
 * the key to reconcile by.
 */
export async function runOnce<R>(
  command: ResolvedCommand,
  work: () => Promise<CommandResult<R>>,
  clock: { now?: number } = {},
): Promise<CommandResult<R>> {
  const now = clock.now ?? Date.now();

  // BEFORE THE RESERVATION, not after. A command from a tab that predates a
  // rebuild must not even claim a key: the key is derived from the action, so
  // it is the same string it was before the reset, and reserving it would let
  // a stale tab take the key a live one is about to need.
  const { generation } = await currentGeneration();
  if (!generationMatches(command.environmentGeneration, generation)) {
    return { outcome: "rejected", reason: GENERATION_REFUSAL, reloadRequired: true };
  }

  const reservation = await reserveCommand<R>(command, now);

  if (reservation.kind === "replay") return reservation.result;
  if (reservation.kind === "collision") {
    return { outcome: "rejected", reason: reservation.reason };
  }
  if (reservation.kind === "in_flight") {
    return {
      outcome: "indeterminate",
      reason:
        "Another attempt at this same action is still running, so Steady cannot say yet whether it " +
        "landed. Do not repeat it — reload in a moment and read what is recorded.",
      reconcileBy: command.idempotencyKey,
    };
  }

  let result: CommandResult<R>;
  try {
    result = await work();
  } catch (err) {
    await releaseCommand(command);
    throw err;
  }
  await settleCommand(command, result, now);
  return result;
}
