import type Database from "better-sqlite3";
import { MANIFEST, MANIFEST_EMAIL_LIKE, checkManifest, type CheckResult } from "./demo-population-manifest";
import { TARGETS } from "./demo-population-generator";

// The data-quality manifest (handoff 07 §2.8, p29).
//
// p29 lists twelve checks and one instruction that gives them teeth:
//
//   THE ADMIN PAGE BLOCKS EXTERNAL DEMONSTRATIONS WHEN THE LATEST RESET OR
//   PROJECTION VERIFICATION FAILED. A PRESENTER MUST NEVER REPAIR THE DEMO BY
//   EDITING DATABASE ROWS DIRECTLY.
//
// So these are computed against the live database, now, rather than recorded
// at build time. A manifest that reports the state of the last good build is a
// manifest that says everything is fine while the thing in front of the room
// is broken.
//
// The balance checks (240, 60 per region, 30 per archetype) live on the
// manifest module and are folded in here, because a presenter should not have
// to know which half of the specification a number came from.

export type { CheckResult };

/** Every check p29 names that can be computed from the database. */
export function runQualityChecks(db: Database.Database): CheckResult[] {
  const one = (sql: string): number =>
    Number((db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0);

  // Scoped to the MANIFEST profiles. Not "everyone with demographic
  // attributes": Alex and Sam were enrolled into NE Care Network A and given
  // attributes of their own, which is correct and makes that set 242.
  const POP = `(SELECT id FROM users WHERE email LIKE '${MANIFEST_EMAIL_LIKE}')`;

  const out: CheckResult[] = [...checkManifest()];

  // ── Orphans ────────────────────────────────────────────────────────────
  // p29: "Orphan events: 0". An event whose person no longer exists is a
  // statement about nobody, and it will still be counted by every aggregate.
  const orphans = one(
    `SELECT COUNT(*) AS n FROM longitudinal_events e
      WHERE NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = e.person_id)`);
  out.push({
    check: "Orphan events", expected: "0", actual: String(orphans), pass: orphans === 0,
  });

  // ── Cross-tenant references ────────────────────────────────────────────
  // p29: "Cross-tenant references: 0". An event filed under a different tenant
  // from its person is read by a query scoped to the wrong tenant and missed
  // by one scoped to the right one. This check found a real defect: the
  // genesis backfill wrote every reconstructed event into the platform tenant
  // regardless of where its person lived, which was invisible for as long as
  // every seeded user happened to be in the platform tenant.
  const crossTenant = one(
    `SELECT COUNT(*) AS n FROM longitudinal_events e
       JOIN persons p ON p.id = e.person_id
      WHERE e.tenant_id <> p.tenant_id`);
  out.push({
    check: "Cross-tenant references", expected: "0", actual: String(crossTenant),
    pass: crossTenant === 0,
  });

  // ── Fabricated flag ────────────────────────────────────────────────────
  // p29: "100 percent on root data, events, projections and exports." Not a
  // banner on a page — a property of the rows, so a CSV that leaves the
  // building still carries it.
  const unmarkedPeople = one(
    `SELECT COUNT(*) AS n FROM persons p
      WHERE p.id IN ${POP}
        AND (p.display_name IS NULL OR p.display_name NOT LIKE '%fabricated%')`);
  out.push({
    check: "Fabricated flag — people", expected: "0 unmarked",
    actual: String(unmarkedPeople), pass: unmarkedPeople === 0,
  });
  const unmarkedEvents = one(
    `SELECT COUNT(*) AS n FROM longitudinal_events
      WHERE source_system = 'demo-generator'
        AND json_extract(provenance, '$.fabricated') IS NOT 1`);
  out.push({
    check: "Fabricated flag — events", expected: "0 unmarked",
    actual: String(unmarkedEvents), pass: unmarkedEvents === 0,
  });

  // ── p14's per-person targets ───────────────────────────────────────────
  // Not in p29's list, and they belong: p14 states a range for every domain,
  // and a generator whose output drifts outside one produces a population that
  // no longer matches the specification it claims to implement. The first
  // version of the generator produced a person with 1 check-in and another
  // with 134 against a stated bound of 18–90, and nothing said so.
  const range = (table: string, label: string, [lo, hi]: readonly [number, number]) => {
    const r = db.prepare(
      `SELECT MIN(n) AS lo, MAX(n) AS hi FROM (
         SELECT user_id, COUNT(*) AS n FROM ${table} WHERE user_id IN ${POP} GROUP BY user_id)`,
    ).get() as { lo: number | null; hi: number | null };
    const ok = r.lo !== null && r.lo >= lo && r.hi !== null && r.hi <= hi;
    out.push({
      check: `Per person — ${label}`, expected: `${lo}–${hi}`,
      actual: r.lo === null ? "none" : `${r.lo}–${r.hi}`, pass: ok,
    });
  };
  range("checkins", "check-ins", TARGETS.checkins);
  range("screenings", "measures", TARGETS.measures);
  range("practice_completions", "modules", TARGETS.modules);

  // ── Missingness carries a reason ───────────────────────────────────────
  // p28: "record why the value is absent." A missing value with no reason is
  // indistinguishable from one that was never due.
  const reasonless = one(
    `SELECT COUNT(*) AS n FROM longitudinal_events
      WHERE event_type = 'measure.not_completed'
        AND (json_extract(payload, '$.reason') IS NULL OR json_extract(payload, '$.reason') = '')`);
  out.push({
    check: "Missingness has a reason", expected: "0 without one",
    actual: String(reasonless), pass: reasonless === 0,
  });

  // ── Corrections supersede rather than edit ─────────────────────────────
  const danglingCorrections = one(
    `SELECT COUNT(*) AS n FROM longitudinal_events e
      WHERE e.supersedes_event_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM longitudinal_events o WHERE o.id = e.supersedes_event_id)`);
  out.push({
    check: "Corrections point at a real event", expected: "0 dangling",
    actual: String(danglingCorrections), pass: danglingCorrections === 0,
  });

  // ── The population is present at all ───────────────────────────────────
  const accounts = one(`SELECT COUNT(*) AS n FROM users WHERE email LIKE '${MANIFEST_EMAIL_LIKE}'`);
  out.push({
    check: "Accounts", expected: `${MANIFEST.length}`, actual: String(accounts),
    pass: accounts === MANIFEST.length,
  });

  return out;
}

export function qualitySummary(results: CheckResult[]): { passed: number; failed: number; ok: boolean } {
  const failed = results.filter((r) => !r.pass).length;
  return { passed: results.length - failed, failed, ok: failed === 0 };
}
