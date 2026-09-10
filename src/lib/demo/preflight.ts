// Deterministic preflight and environment status (handoff 09 §7.3, §10
// Package 4).
//
// §7.3: "Lead with environment health and failed preflight… A reset failure
// never displays ready."
//
// THAT LAST SENTENCE IS THE ONE THIS MODULE EXISTS FOR, and it was not true
// before. The reset action caught its own failure and wrote an audit row; the
// admin console then recomputed health from the live database and drew
// whatever it found. A reset that threw part-way can leave a database that
// still passes the manifest — the tables it had already cleared get rebuilt by
// the next boot, or the failure was in a later step — and the console would
// then tell a presenter the environment was ready when their rebuild had not
// happened. Nothing on the screen was wrong; the screen was answering a
// different question from the one being asked.
//
// So `environmentStatus` reads the recorded outcome of the last reset ATTEMPT
// alongside the live checks, and `ready` is unreachable while that outcome is
// a failure. Not a warning banner over a green page: the state itself is
// `blocked`, so every surface that asks gets the same answer.
//
// DETERMINISTIC MEANS THE VERDICT DOES NOT MOVE ON ITS OWN. §10 asks for a
// "deterministic preflight", and the failure it rules out is a check that
// passes at 09:58 and fails at 10:02 because it compared a timestamp to `now`.
// Every check here is a function of database CONTENT. The guard runs the whole
// preflight twice against one database and asserts the results are identical,
// which is a weak property stated strongly: it is the one a clock-dependent
// check cannot satisfy.

import type Database from "better-sqlite3";
import { runQualityChecks, qualitySummary } from "../demo-quality";
import { validateProjections } from "./projection-hashes";
import { replayScenarios } from "../safety/scenarios";
import { DEMO_SEED_VERSION } from "../demo-seed";
import { demoBaseline } from "../demo-reset";

export const PREFLIGHT_STATES = ["ready", "blocked", "unknown"] as const;
export type PreflightState = (typeof PREFLIGHT_STATES)[number];

export interface PreflightCheck {
  id: string;
  label: string;
  /** What the presenter loses if it fails. Written as a consequence rather
   *  than as a rule, because a presenter reading this is deciding whether to
   *  start a meeting, not auditing the system. */
  matters: string;
  pass: boolean;
  actual: string;
}

export interface EnvironmentStatus {
  state: PreflightState;
  checks: PreflightCheck[];
  /** The failures, first, because §7.3 says to lead with them. */
  failures: PreflightCheck[];
  /** The last reset attempt, when one is recorded — WITH THE REASON somebody
   *  typed, or the one the nightly job wrote. p9 requires a typed reason on the
   *  manual control and this shape dropped it, so the console could say a
   *  rebuild succeeded and not what it was for. */
  lastReset: {
    at: string; status: "succeeded" | "failed"; reason: string | null; detail: string | null;
  } | null;
  /** Everything §7.3 moves OUT of the routine header: "dataset hashes,
   *  provider versions, and detailed logs into an environment drawer. A
   *  64-character fingerprint in the routine header is reading burden without
   *  benefit." Carried here so the surface can put it behind a disclosure
   *  rather than compute it separately. */
  drawer: { datasetVersion: string; baselineHash: string; counts: Record<string, number> };
}

/**
 * Every check, and the verdict.
 *
 * ORDER IS SIGNIFICANCE ORDER, not implementation order. The reset outcome is
 * first because it is the one that invalidates the rest: checks computed
 * against a database whose rebuild failed are checks about the wrong database.
 */
export function environmentStatus(db: Database.Database): EnvironmentStatus {
  const checks: PreflightCheck[] = [];

  const lastReset = readLastReset(db);
  checks.push({
    id: "last_reset",
    label: "Last rebuild",
    matters:
      "A rebuild that failed leaves the environment in whatever state it reached. " +
      "Nothing below can be trusted to describe the dataset you meant to show.",
    // No recorded attempt is a PASS. A fresh environment has never been reset
    // and is not thereby unfit — the failure this check exists for is a
    // recorded failure, not an absence.
    pass: lastReset === null || lastReset.status === "succeeded",
    actual:
      lastReset === null
        ? "No rebuild recorded on this environment"
        : lastReset.status === "succeeded"
          ? `Succeeded ${lastReset.at}`
          : `FAILED ${lastReset.at}${lastReset.detail ? ` — ${lastReset.detail}` : ""}`,
  });

  const quality = runQualityChecks(db);
  const q = qualitySummary(quality);
  checks.push({
    id: "data_quality",
    label: "Dataset manifest",
    matters:
      "A failing manifest means a screen in the walkthrough will show a number " +
      "that does not add up, usually the one somebody asks about.",
    pass: q.ok,
    actual: q.ok ? `All ${q.passed} checks pass` : `${q.failed} of ${quality.length} checks fail`,
  });

  const safety = replayScenarios();
  const failingSafety = safety.filter((s) => !s.pass).length;
  checks.push({
    id: "safety_replay",
    label: "Safety replay",
    matters:
      "The gate engine on this build disagrees with its own fixed scenarios. " +
      "Do not demonstrate a safety claim from an environment in that state.",
    pass: failingSafety === 0,
    actual:
      failingSafety === 0
        ? `${safety.length} of ${safety.length} scenarios match`
        : `${failingSafety} scenarios do not match`,
  });

  // p29 NAMES THIS CHECK ALONGSIDE THE RESET: "the admin page blocks external
  // demonstrations when the latest reset or PROJECTION VERIFICATION failed."
  // The reset half was here from the start and this half was not, which made
  // the sentence half-implemented in the one direction that does not announce
  // itself — a dataset that quietly stopped being the published one still read
  // as ready.
  //
  // AN UNRECORDED HASH BLOCKS TOO, and that is the uncomfortable half. A
  // manifest with no hash for a table cannot say the table is right, and a
  // check that treats "I do not know" as "fine" stops covering the dataset one
  // table at a time. The remedy is a generation run, which is a minute's work
  // and is named on the console.
  const projections = validateProjections(db);
  checks.push({
    id: "projection_hashes",
    label: "Projection hashes",
    matters:
      "The dataset does not match the one recorded in the seed manifest. Every screen in " +
      "the walkthrough will show a population nobody rehearsed, and the numbers will be " +
      "internally consistent — which is what makes it hard to notice from the room.",
    pass: projections.ok,
    actual: projections.ok
      ? `All ${projections.checks.length} projected tables match ${projections.datasetVersion}`
      : projections.drifted.length > 0
        ? `${projections.drifted.length} table(s) differ: ${projections.drifted.join(", ")}`
        : `No hash recorded for ${projections.unrecorded.length} table(s) under ${projections.datasetVersion}`,
  });

  const accounts = countDemoAccounts(db);
  checks.push({
    id: "demo_accounts",
    label: "Fabricated personas",
    matters: "A walkthrough that cannot sign in as its persona stops at step one.",
    pass: accounts >= 3,
    actual: `${accounts} demonstration accounts present`,
  });

  const failures = checks.filter((c) => !c.pass);

  return {
    // `ready` requires every check. There is deliberately no "ready with
    // warnings": a presenter who is told the environment is ready has stopped
    // reading, which is the correct behaviour and the reason the word has to
    // mean what it says.
    state: failures.length === 0 ? "ready" : "blocked",
    checks,
    failures,
    lastReset,
    drawer: {
      datasetVersion: DEMO_SEED_VERSION,
      baselineHash: baselineHashOf(db),
      counts: countsOf(db),
    },
  };
}

/** Whether one scenario's named requirements are met. A scenario names check
 *  ids; it cannot introduce a check of its own, so it cannot introduce one
 *  that always passes. */
export function meetsRequirements(
  status: EnvironmentStatus,
  requires: readonly string[]
): { ready: boolean; missing: PreflightCheck[]; unknown: string[] } {
  const byId = new Map(status.checks.map((c) => [c.id, c]));
  const missing: PreflightCheck[] = [];
  const unknown: string[] = [];
  for (const id of requires) {
    const check = byId.get(id);
    // A requirement naming a check that does not exist is NOT treated as met.
    // The alternative is a scenario that passes preflight by asking for
    // something nobody implemented.
    if (!check) unknown.push(id);
    else if (!check.pass) missing.push(check);
  }
  return { ready: missing.length === 0 && unknown.length === 0, missing, unknown };
}

// ---------------------------------------------------------------------------
// The reset log
// ---------------------------------------------------------------------------

export function readLastReset(
  db: Database.Database
): { at: string; status: "succeeded" | "failed"; reason: string | null; detail: string | null } | null {
  try {
    const row = db
      .prepare("SELECT attempted_at, status, reason, detail FROM demo_reset_log WHERE id = 1")
      .get() as {
        attempted_at: string; status: string; reason: string | null; detail: string | null;
      } | undefined;
    if (!row) return null;
    if (row.status !== "succeeded" && row.status !== "failed") return null;
    // THE REASON WAS WRITTEN AND NEVER READ. `recordReset` has always stored
    // it — p9 requires a typed reason on the manual control — and this function
    // dropped the column, so the console could say a rebuild succeeded and not
    // what it was for. That gap stopped being cosmetic when a TIMER became one
    // of the things that can rebuild this environment: an operator arriving on
    // a dataset that changed overnight needs to tell "somebody rebuilt it at
    // 4pm for a reason they typed" from "the nightly job ran".
    return { at: row.attempted_at, status: row.status, reason: row.reason, detail: row.detail };
  } catch {
    // A database without the table is a database that has never recorded one,
    // which is the same answer as no row.
    return null;
  }
}

/** Record what a reset attempt did. Written by the reset action, on both
 *  paths — a failure that goes unrecorded is the whole defect. */
export function recordReset(
  db: Database.Database,
  outcome: { status: "succeeded" | "failed"; reason: string; detail?: string | null }
): void {
  db.prepare(
    `INSERT INTO demo_reset_log (id, attempted_at, status, reason, detail)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       attempted_at = excluded.attempted_at,
       status       = excluded.status,
       reason       = excluded.reason,
       detail       = excluded.detail`
  ).run(
    new Date().toISOString().replace("T", " ").slice(0, 19),
    outcome.status,
    outcome.reason,
    outcome.detail ?? null
  );
}

// ---------------------------------------------------------------------------

function countDemoAccounts(db: Database.Database): number {
  try {
    return Number(
      (db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@steady.local'")
        .get() as { n: number }).n
    );
  } catch {
    return 0;
  }
}

function countsOf(db: Database.Database): Record<string, number> {
  const one = (sql: string): number => {
    try {
      return Number((db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0);
    } catch {
      return 0;
    }
  };
  return {
    tenants: one("SELECT COUNT(*) AS n FROM tenants"),
    persons: one("SELECT COUNT(*) AS n FROM persons"),
    events: one("SELECT COUNT(*) AS n FROM longitudinal_events"),
  };
}

function baselineHashOf(db: Database.Database): string {
  try {
    return demoBaseline(db).hash;
  } catch {
    return "unavailable";
  }
}
