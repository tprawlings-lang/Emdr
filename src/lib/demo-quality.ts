import type Database from "better-sqlite3";
import { MANIFEST, MANIFEST_EMAIL_LIKE, checkManifest, type CheckResult } from "./demo-population-manifest";
import { TARGETS, OUTCOME_INSTRUMENT, INTAKE_INSTRUMENTS } from "./demo-population-generator";

/** The five instruments `screeningComplete` requires before a member may
 *  reach the product: the outcome instrument plus the intake battery. */
const REQUIRED_INSTRUMENTS = INTAKE_INSTRUMENTS.length + 1;
import { MIN_MEASURES, exposureDaysFor, scaledRange } from "./demo-population-calendar";
import { popPersonId } from "./demo-population-seed";

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
  // SCALED TO EXPOSURE, per person. p14's ranges describe somebody observed
  // for the full six months, and intake is rolling — a profile that enrolled
  // three weeks ago cannot have eighteen check-ins. Checking the flat number
  // would either fail the whole manifest or force every profile to enrol on
  // the same fortnight, which is the constraint that made the planning
  // engine's two-window rules unfirable.
  //
  // The rate is what is checked, so a generator that shortchanged a recent
  // arrival still fails. Reported as the number of profiles OUTSIDE their own
  // bound, because a min and a max across a population with different windows
  // do not mean anything.
  const range = (
    table: string, label: string, target: readonly [number, number], where = "",
  ) => {
    const counts = new Map<string, number>();
    for (const r of db.prepare(
      `SELECT user_id AS id, COUNT(*) AS n FROM ${table}
        WHERE user_id IN ${POP}${where} GROUP BY user_id`,
    ).all() as { id: string; n: number }[]) counts.set(r.id, Number(r.n));

    const offenders: string[] = [];
    let lo = Infinity;
    let hi = 0;
    for (const row of MANIFEST) {
      const n = counts.get(popPersonId(row)) ?? 0;
      const [min, max] = scaledRange(
        target, exposureDaysFor(row), table === "screenings" ? MIN_MEASURES : 1);
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
      if (n < min || n > max) offenders.push(`${row.id} has ${n}, wanted ${min}–${max}`);
    }
    out.push({
      check: `Per person — ${label}`,
      expected: `${target[0]}–${target[1]} at full exposure, scaled pro rata`,
      actual: offenders.length === 0
        ? `${lo === Infinity ? 0 : lo}–${hi} across the population, all inside their own bound`
        : `${offenders.length} outside: ${offenders.slice(0, 3).join("; ")}`,
      pass: offenders.length === 0,
    });
  };
  range("checkins", "check-ins", TARGETS.checkins);
  // THE OUTCOME INSTRUMENT ONLY. p14's 4–8 describes the repeated measure that
  // produces a trajectory, not the one-time intake battery a person completes
  // to open the product at all. Counting both put every profile four over its
  // ceiling and would have been "fixed" by removing the onboarding — which is
  // to say, by making the 240 unable to sign in again.
  range("screenings", "measures", TARGETS.measures,
    ` AND instrument = '${OUTCOME_INSTRUMENT}'`);
  range("practice_completions", "modules", TARGETS.modules);

  // The intake battery itself, checked rather than assumed: a member is
  // refused at /app/today until all five instruments are on file, so a profile
  // missing one is a profile that cannot be demonstrated.
  const battery = db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT user_id FROM screenings WHERE user_id IN ${POP}
        GROUP BY user_id HAVING COUNT(DISTINCT instrument) >= ?)`,
  ).get(REQUIRED_INSTRUMENTS) as { n: number };
  out.push({
    check: "Onboarding — screening battery",
    expected: `all ${REQUIRED_INSTRUMENTS} instruments for each of ${MANIFEST.length}`,
    actual: `${Number(battery.n)} of ${MANIFEST.length} complete`,
    pass: Number(battery.n) === MANIFEST.length,
  });

  // Membership and profile, the other two gates between a seeded person and
  // the product. Without them a presenter signing in as a profile lands on the
  // paywall, which is what happened.
  for (const [table, label, extra] of [
    ["subscriptions", "membership", "AND status IN ('active','trialing')"],
    ["user_profiles", "profile", "AND profile_complete = 1"],
  ] as const) {
    const n = one(
      `SELECT COUNT(*) AS n FROM ${table} WHERE user_id IN ${POP} ${extra}`);
    out.push({
      check: `Onboarding — ${label}`,
      expected: `${MANIFEST.length}`,
      actual: String(n),
      pass: n === MANIFEST.length,
    });
  }

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

  // ── The fabricated/real boundary ───────────────────────────────────────
  //
  // Not one of p29's checks, and it belongs beside them: p29 asks for a
  // fabricated flag on "root data, events, projections and exports" at 100%,
  // and this is the question underneath it — is the boundary intact at all?
  //
  // Three things are counted rather than one, because they fail differently.
  // A person with no provenance is a writer that did not state it. A real
  // person in a demonstration environment is either a human who signed up
  // (fine, and the reason the column exists) or a seed that mislabelled its
  // rows. A fabricated event in a real person's ledger is contamination, and
  // there is no benign reading of it.
  const unstated = one("SELECT COUNT(*) AS n FROM persons WHERE provenance IS NULL");
  out.push({
    check: "Provenance stated", expected: "0 persons without one",
    actual: String(unstated), pass: unstated === 0,
  });

  const contaminated = one(
    `SELECT COUNT(*) AS n FROM longitudinal_events e
       JOIN persons p ON p.id = e.person_id
      WHERE p.provenance = 'real'
        AND json_extract(e.provenance, '$.fabricated') = 1`);
  out.push({
    check: "Fabricated events in a real ledger", expected: "0",
    actual: String(contaminated), pass: contaminated === 0,
  });

  const realPeople = one("SELECT COUNT(*) AS n FROM persons WHERE provenance = 'real'");
  out.push({
    check: "Real people in this environment",
    expected: "reported, not asserted — a human signup is legitimate here",
    actual: String(realPeople), pass: true,
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
