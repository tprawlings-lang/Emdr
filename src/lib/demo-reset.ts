// Demo environment operations: reset, baseline, health (Demo-First handoff §5, §7).
//
// The handoff requires that demo data be "deterministic, versioned, and
// reviewable" and that "resets must remove prior synthetic activity and
// recreate the expected baseline." None of that existed: the seed used random
// UUIDs, there was no reset at any level, and the demo banner nonetheless told
// viewers the data "resets periodically."
//
// That gap was not cosmetic. It made the e2e suite unreproducible — one spec
// asserted "1 agreed" in the sign-off register, which held on a freshly seeded
// database and failed on every re-run as other specs' sign-offs accumulated in
// the same file. A demonstration you cannot return to a known state is a
// demonstration whose results mean nothing the second time.
//
// WHAT A RESET GUARANTEES
//
//   * Every row of synthetic activity is removed — not just the seeded rows,
//     but anything a viewer, a test, or a reviewer created since.
//   * The dataset is rebuilt from the same versioned seed, so identifiers are
//     byte-identical to the previous reset.
//   * The identity spine is rebuilt with it, so persons/accounts/roles match.
//
// WHAT IT DOES NOT GUARANTEE
//
//   Wall-clock timestamps move. The dataset is authored as "N days ago" so the
//   demo always looks current, which means `created_at` values differ between
//   resets by design. `demoBaseline()` hashes the time-invariant projection for
//   exactly this reason — see §baseline below.

import type Database from "better-sqlite3";
import crypto from "node:crypto";
import { DEMO_SEED_VERSION } from "./demo-seed";
import { seedDemo, syncIdentitySpine } from "./db";

/** Every table holding data, in an order safe for unconditional deletion.
 *  Children first: SQLite enforces the foreign keys these tables declare, so
 *  deleting `users` before `checkins` would fail. */
/** Tables a reset deliberately PRESERVES.
 *
 *  Reviewer change requests are the output of a review session, not fabricated
 *  member data. A reset exists to return the environment to a reproducible
 *  baseline before the next reviewer walks it — wiping what the last reviewer
 *  told us would destroy the only durable product of their hour, and would do
 *  it silently, at exactly the moment someone is preparing for a demo.
 *
 *  Reviewer ids survive a reset because the seed is deterministic, so the notes
 *  still resolve to a named author afterwards.
 *
 *  Anything added here needs a reason of that kind. The schema guard in
 *  `tests/demo-reset.test.ts` checks that every table is either cleared or
 *  listed here, so a new table cannot escape the reset by being forgotten. */
export const PRESERVED_TABLES = [
  "review_notes",
  // Policy configuration, not fabricated data. p34 requires a threshold to
  // carry an owner and an approval date and to be safe from quiet edits — and
  // a reset that silently rewrites both is exactly a quiet edit, made by a
  // presenter who was only trying to get back to a clean baseline. The table
  // refuses DELETE at the schema level, so listing it here is a statement of
  // intent rather than the mechanism.
  "policy_thresholds",
] as const;

export const DEMO_DATA_TABLES = [
  // Planning first: a signal review points at its signal, and a signal is
  // derived entirely from the fabricated population it is about.
  //
  // The reviews go WITH the signals rather than surviving like review_notes,
  // and the difference is what the record means. A review note is a reviewer's
  // request about the product; a signal review is their judgement about a
  // specific set of numbers. Rebuilding the numbers and keeping the judgement
  // would attach a human's decision to evidence they never saw.
  // The clock goes back to live. p9 makes reset the control that returns the
  // environment to a known state, and a presenter who resets and then wonders
  // why every screen still reads as March has been left a trap.
  "demo_clock",
  "planning_signal_reviews",
  "planning_signals",
  // Operational feeds, rebuilt with the population they describe.
  "capacity_slots",
  "review_coverage",
  // Payer domain next: claims reference persons, and contract measures
  // reference their contract. Ordered for, not disabled — a mistake in this
  // list fails loudly instead of leaving orphans.
  "export_jobs",
  // Before persons: person_attributes references them.
  "person_attributes",
  "claims",
  "cost_model_versions",
  "contract_measures",
  "payer_contracts",
  // Spine — references persons and tenants.
  "longitudinal_events",
  "external_identifiers",
  "enrollments",
  "role_assignments",
  "accounts",
  "persons",
  // Leaf records referencing users/sessions.
  "screening_progress",
  "post_session_checks",
  "ai_messages",
  "ai_conversations",
  "ai_memory_items",
  "ai_companion_preferences",
  "lesson_reads",
  "practice_completions",
  "upsell_events",
  "autopilot_events",
  "autopilot_plans",
  "autonomous_signoffs",
  "payments",
  "subscriptions",
  "program_plans",
  "care_track_intake",
  "care_tracks",
  "readiness_assessments",
  "safety_plans",
  "early_warning_signs",
  "user_triggers",
  "user_profiles",
  "alerts",
  "module_unlocks",
  "therapy_sessions",
  "checkins",
  "screenings",
  "consents",
  "audit_log",
  "users",
  // Tenants last — everything above may reference the platform tenant.
  "tenants",
] as const;

export interface ResetResult {
  version: string;
  deleted: Record<string, number>;
  totalDeleted: number;
  baseline: BaselineResult;
}

/** Remove all synthetic activity and rebuild the versioned baseline.
 *
 *  Refuses to run outside a demo environment. This is the one operation in the
 *  codebase that deletes member data unconditionally, so it does not rely on the
 *  caller having checked — a reset pointed at anything real is the failure this
 *  guard exists to prevent. */
export function resetDemoData(db: Database.Database): ResetResult {
  if (process.env.EMDR_DEMO !== "1") {
    throw new Error(
      "resetDemoData refused: EMDR_DEMO is not 1. This deletes every row in the " +
      "database and may only run against a demonstration environment."
    );
  }

  const deleted: Record<string, number> = {};
  const run = db.transaction(() => {
    // Foreign keys are ordered for, not disabled — leaving them on means a
    // mistake in DEMO_DATA_TABLES fails loudly instead of leaving orphans.
    for (const table of DEMO_DATA_TABLES) {
      const before = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      db.prepare(`DELETE FROM ${table}`).run();
      if (before > 0) deleted[table] = before;
    }
    // Autoincrement counters survive DELETE, so `audit_log.id` would keep
    // climbing across resets and the environment would never actually return to
    // a fresh state. Clearing the sequence is part of "recreate the expected
    // baseline", not an optimisation.
    try { db.prepare("DELETE FROM sqlite_sequence").run(); } catch { /* table absent until first AUTOINCREMENT */ }
  });
  run();

  // Rebuild through the normal boot path so a reset produces exactly what a
  // fresh environment produces — not a second, subtly different seeding path.
  seedDemo(db);
  syncIdentitySpine(db);

  const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);
  return { version: DEMO_SEED_VERSION, deleted, totalDeleted, baseline: demoBaseline(db) };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface BaselineResult {
  version: string;
  counts: Record<string, number>;
  /** sha256 over the time-invariant projection. Stable across resets. */
  hash: string;
}

/** Columns excluded from the baseline hash, and why. Wall-clock values move
 *  between resets by design (the dataset is authored relative to "now"), so
 *  including them would produce a hash that changes daily and proves nothing. */
const VOLATILE_COLUMN = /_at$|^created$|^updated$|^plan_date$|^checkin_date$|^effective_from$|^effective_to$/;

/** A reviewable fingerprint of the seeded dataset.
 *
 *  Covers identifiers, structural relationships, and every coded clinical value
 *  — the things a reset must reproduce exactly. Deliberately excludes
 *  timestamps and encrypted ciphertext: the former move, and the latter differs
 *  on every write because AES-GCM uses a fresh nonce, so hashing it would make
 *  the baseline unstable for a reason unrelated to the data. */
export function demoBaseline(db: Database.Database): BaselineResult {
  const counts: Record<string, number> = {};
  const hash = crypto.createHash("sha256");
  hash.update(`version=${DEMO_SEED_VERSION}\n`);

  for (const table of [...DEMO_DATA_TABLES].sort()) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
    counts[table] = rows.length;
    if (rows.length === 0) continue;

    const cols = Object.keys(rows[0])
      .filter((c) => !VOLATILE_COLUMN.test(c))
      // Ciphertext differs per write (fresh GCM nonce); hash its presence, not
      // its value, so "a note exists here" is still covered.
      .sort();

    hash.update(`table=${table} cols=${cols.join(",")}\n`);
    const lines = rows.map((r) =>
      cols.map((c) => {
        const v = r[c];
        if (v === null || v === undefined) return `${c}=`;
        const s = String(v);
        // Values that are non-deterministic BY DESIGN are recorded as present
        // rather than by content: AES-GCM ciphertext uses a fresh nonce per
        // write, and password hashes use a fresh salt. Hashing either would
        // make the baseline unstable for a reason that has nothing to do with
        // whether the dataset was reproduced correctly — and a baseline that
        // fails for the wrong reason is one people learn to ignore.
        return isCiphertext(s) || SALTED_COLUMN.test(c)
          ? `${c}=<opaque:${s.length > 0 ? "present" : "empty"}>`
          : `${c}=${s}`;
      }).join("|")
    );
    for (const line of lines.sort()) hash.update(line + "\n");
  }

  return { version: DEMO_SEED_VERSION, counts, hash: hash.digest("hex") };
}

/** Columns whose value is randomised on every write by design. */
const SALTED_COLUMN = /^password_hash$|^entry_hash$|^prev_hash$/;

/** The envelope produced by lib/crypto.ts encryptField. */
function isCiphertext(v: string): boolean {
  return v.startsWith("enc:") || /^v\d+:[A-Za-z0-9+/=]+:/.test(v);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface HealthResult {
  ok: boolean;
  checks: HealthCheck[];
}

/** Is this environment in the state a demonstration expects?
 *
 *  Written to be run before a demo rather than discovered during one. Each check
 *  states what it found, not merely pass/fail, so a failure is actionable
 *  without a second investigation. */
export function demoHealth(db: Database.Database): HealthResult {
  const checks: HealthCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add("demo mode", process.env.EMDR_DEMO === "1",
    process.env.EMDR_DEMO === "1" ? "EMDR_DEMO=1" : "EMDR_DEMO is not set — this is not a demo environment");

  const missing = DEMO_DATA_TABLES.filter((t) => {
    try { db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get(); return false; } catch { return true; }
  });
  add("schema", missing.length === 0,
    missing.length === 0 ? `all ${DEMO_DATA_TABLES.length} tables present` : `missing: ${missing.join(", ")}`);

  const users = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  add("seeded", users > 0, `${users} user(s)`);

  // The identity spine must cover every user, or event appends fail the FK.
  const orphans = (db.prepare(
    "SELECT COUNT(*) AS n FROM users u LEFT JOIN persons p ON p.id = u.id WHERE p.id IS NULL"
  ).get() as { n: number }).n;
  add("identity spine", orphans === 0,
    orphans === 0 ? "every user has a person" : `${orphans} user(s) without a person row`);

  // Every row must carry a tenant.
  const nullTenant = (db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE tenant_id IS NULL OR tenant_id = ''"
  ).get() as { n: number }).n;
  add("tenancy", nullTenant === 0,
    nullTenant === 0 ? "all users carry a tenant" : `${nullTenant} user(s) with no tenant`);

  const events = (db.prepare("SELECT COUNT(*) AS n FROM longitudinal_events").get() as { n: number }).n;
  add("event spine", true, `${events} event(s) — 0 is expected until the backfill runs`);

  const key = Boolean(process.env.EMDR_DATA_KEY);
  add("encryption key", key, key ? "EMDR_DATA_KEY set" : "EMDR_DATA_KEY missing — encrypted fields will fail");

  return { ok: checks.every((c) => c.ok), checks };
}
