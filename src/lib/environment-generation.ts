// Which rebuild of this environment a tab belongs to (17 September handoff, P6).
//
//   "Environment resets: introduce or reuse an environment-generation
//   identifier. Reject commands from a tab opened before a synthetic reset and
//   give the user a clear refresh path. Do not let idempotency keys cross reset
//   generations."
//
// NOTHING COULD TELL. `DEMO_SEED_VERSION` is the version of the seed and is the
// same string before and after a rebuild, so a tab left open across a reset
// looked exactly like a fresh one — and its buttons still worked. The rows it
// was showing had been deleted and recreated under new identifiers, so a
// command from it either failed on a foreign key, or, worse, succeeded against
// whatever now held that id.
//
// AND THE IDEMPOTENCY KEY MADE IT WORSE, not better. A key is derived from the
// action rather than the moment — deliberately, so a retry is a retry — which
// means the same press produces the same key before and after a rebuild. A
// surviving reservation would let a post-reset press replay a pre-reset result
// about a record that no longer exists. Two defences: the reset clears the
// reservations, and the command carrying an old generation is refused before it
// gets that far.
//
// ONE ROW, for the reason the demo clock has one: Next.js instantiates a module
// more than once per process, so a generation held in memory would differ
// between route bundles and two screens would disagree about which environment
// they were in.

import type Database from "better-sqlite3";
import crypto from "crypto";
import { data } from "./data";

/** What a refused command tells the person. A refusal with no way forward is
 *  worse than the stale action it prevented. */
export const GENERATION_REFUSAL =
  "This page was loaded before the demonstration environment was rebuilt, so the records it is " +
  "showing no longer exist. Nothing was written. Reload the page and try again.";

export interface EnvironmentGeneration {
  generation: string;
  establishedAt: string;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * The generation this process is serving, read from the database.
 *
 * ASYNC AND UNCACHED. A cached value is a value that survives the reset it is
 * supposed to notice, and the read is a single-row primary-key lookup.
 */
export async function currentGeneration(): Promise<EnvironmentGeneration> {
  const c = await data();
  const row = (await c.get(
    "SELECT generation, established_at FROM environment_generation WHERE id = 1",
    [],
  )) as { generation: string; established_at: string } | undefined;
  if (row) return { generation: row.generation, establishedAt: row.established_at };

  // First boot. Established rather than defaulted: a fixed fallback string
  // would be shared by every environment that had never reset, which is the
  // one case where two tabs from different databases would agree.
  const established = { generation: newId(), establishedAt: new Date().toISOString() };
  await c.run(
    `INSERT INTO environment_generation (id, generation, established_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [established.generation, established.establishedAt],
  );
  return currentGeneration();
}

/**
 * Start a new generation. Called by the reset, synchronously, inside its
 * transaction — so an environment is never briefly rebuilt and still claiming
 * the old generation.
 */
export function rotateGeneration(db: Database.Database, now = new Date()): string {
  const generation = newId();
  db.prepare(
    `INSERT INTO environment_generation (id, generation, established_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET generation = excluded.generation, established_at = excluded.established_at`,
  ).run(generation, now.toISOString());
  return generation;
}

/**
 * Whether a command from a page claiming this generation may proceed.
 *
 * A COMMAND THAT CLAIMS NOTHING IS ALLOWED THROUGH, and that is a decision
 * rather than an oversight. Refusing every command without a generation would
 * break every action that does not come from a long-lived surface, and would
 * do it by punishing the caller for a field it never had. What closes that gap
 * is the surfaces sending one — which the guard test asserts for the queue,
 * where a tab actually does sit open for hours.
 */
export function generationMatches(claimed: string | null | undefined, current: string): boolean {
  return !claimed || claimed === current;
}
