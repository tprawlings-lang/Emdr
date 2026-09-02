import crypto from "crypto";
import type Database from "better-sqlite3";
import { PLATFORM_TENANT_ID } from "./db";
import {
  MANIFEST, DATASET_VERSION, REGION_SEED_OFFSET, seedFor,
  type ManifestRow, type Region,
} from "./demo-population-manifest";
import { CALENDAR_DAYS, demoEpoch, enrolmentDayFor } from "./demo-population-calendar";
import { displayName, pick, MEMBER_NOTES } from "./demo-population-dictionaries";
import { ALEX_ID, SAM_ID, DEMO_CLINICIAN_ID } from "./demo-seed";

// The 240-profile demo population (handoff 07 §2, pp10–29).
//
// WHY THIS IS A THIRD SEED, beside the 4,820 and the 12,480.
//
// The existing populations give aggregate SCALE with no person-level story:
// `display_name` is NULL for all 4,820, deliberately, so an organization
// drilldown is impossible rather than refused. The 240 give a person-level
// story that must ALSO roll up — the same people appear in a clinician's panel
// and in an organization's outcome chart, and p6's promise is that "every
// patient has a plausible six-month story that stays internally consistent
// across patient, clinician, organization and payer views."
//
// One consequence has to be stated because it looks like a contradiction:
// THESE PEOPLE HAVE NAMES AND THE OTHER 4,820 DO NOT. The rule is per-dataset,
// not global. A clinician's panel is meaningless without names; an
// organization's population is safer without them. Both are true at once, and
// the aggregate guards enforce the second without weakening for the first —
// no organization or payer projection may return a display name from ANY
// dataset.
//
// WAVE 2 IS THE MANIFEST, NOT THE HISTORY. This file creates tenants,
// clinicians, people and their attributes from the fixed manifest, and stops
// there. The six months of events per person are Wave 3's generator, which
// reads these rows. p52's exit evidence for this wave is "counts and balance
// checks pass" — not "the demo tells a story yet".

export const POPULATION_SEED_VERSION = DATASET_VERSION;

/** Deterministic id within a dataset version (p15's "stable ids" rule). The
 *  version is IN the hash, so bumping it produces an entirely new population
 *  rather than mutating the old one in place. */
function popId(kind: string, key: string): string {
  return crypto.createHash("sha256")
    .update(`${DATASET_VERSION}:${kind}:${key}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}

export const REGION_NAMES: Record<Region, string> = {
  NE: "Northeast", MW: "Midwest", SO: "South", WE: "West",
};

/** p11: eight demo organizations, two per region. */
export function orgTenantId(region: Region, arm: "A" | "B"): string {
  return popId("tenant", `${region}-${arm}`);
}

/** Which of its region's two organizations a clinician belongs to.
 *
 *  p11 names three clinicians and two organizations per region and does not
 *  say how they divide, so this is our rule and it is stated rather than
 *  incidental: C1 and C2 to arm A, C3 to arm B. The uneven split is
 *  deliberate — two organizations of identical size make every cross-org
 *  comparison trivially equal, which would hide exactly the kind of difference
 *  the organization console exists to surface. */
export function armFor(clinician: string): "A" | "B" {
  return clinician.endsWith("C3") ? "B" : "A";
}

export function tenantForRow(row: ManifestRow): string {
  return orgTenantId(row.region, armFor(row.clinician));
}

/**
 * The person id behind a manifest clinician code.
 *
 * NE-C1 resolves to the DEMO CLINICIAN ACCOUNT rather than to a person of its
 * own, so that `clinician.demo@steady.local` is one of p11's twelve rather
 * than a thirteenth standing beside them. The consequence is the point: the
 * `clinician.reviewed` events the generator authors for NE-C1 are attributed
 * to the account a presenter signs in as, so the console shows "my reviews"
 * rather than someone else's.
 *
 * The other eleven are persons with no account. Nobody signs in as them, and
 * eleven unused logins would be eleven more credentials to rotate for no
 * demonstration value.
 */
export const DEMO_CLINICIAN_CODE = "NE-C1";

/** The person id behind a manifest row. Exported so the quality manifest can
 *  check a per-person bound without re-deriving the hash and drifting from it. */
export function popPersonId(row: ManifestRow): string {
  return popId("person", row.id);
}

export function clinicianPersonId(code: string): string {
  return code === DEMO_CLINICIAN_CODE ? DEMO_CLINICIAN_ID : popId("clinician", code);
}

export function seedPopulationData(db: Database.Database) {
  // Wrapped here rather than trusting the caller: better-sqlite3 gives every
  // unwrapped statement its own transaction, and the organization seed
  // measured 24.6 seconds unwrapped against 292 ms wrapped. Nested
  // transactions use a savepoint, so this is safe inside an outer one.
  db.transaction(() => seedPopulationInner(db))();
}

function seedPopulationInner(db: Database.Database) {
  // Idempotent, so boot and reset can both call it unconditionally.
  const first = orgTenantId("NE", "A");
  const existing = db.prepare("SELECT COUNT(*) AS n FROM tenants WHERE id = ?").get(first) as { n: number };
  if (existing.n > 0) return;

  // The platform tenant is created by the identity-spine backfill, which runs
  // AFTER seeding during a reset. Depending on it existing made the
  // organization seed a silent no-op on every reset while working fine at
  // boot, so it is created here the same way and the order cannot matter.
  db.prepare(
    "INSERT INTO tenants (id, kind, name) VALUES (?, 'platform', 'Steady Platform') ON CONFLICT(id) DO NOTHING",
  ).run(PLATFORM_TENANT_ID);

  const at = (daysAgo: number, hour = 9) => {
    const t = new Date(Date.now() - daysAgo * 86400000);
    t.setUTCHours(hour, 0, 0, 0);
    // Never a future instant — the same trap the other seeds document.
    while (t.getTime() > Date.now()) t.setUTCDate(t.getUTCDate() - 1);
    return t;
  };
  const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
  // p14: "All timestamps derive from demo_epoch plus seeded offsets."
  //
  // EPOCH_DAYS is the age of the fabricated SERVICE, not of any one person.
  // The two were the same number until intake became rolling, which is exactly
  // the confusion the calendar module exists to end. A person's own enrolment
  // date comes from `enrolmentDayFor`, and it has to be the same function the
  // generator uses or a profile's first check-in can precede their account.
  const EPOCH_DAYS = CALENDAR_DAYS;

  const insertTenant = db.prepare(
    "INSERT INTO tenants (id, kind, name, parent_tenant_id, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const region of Object.keys(REGION_NAMES) as Region[]) {
    for (const arm of ["A", "B"] as const) {
      insertTenant.run(
        orgTenantId(region, arm), "organization",
        `${region} Care Network ${arm}`, PLATFORM_TENANT_ID, sql(at(EPOCH_DAYS + 30)),
      );
    }
  }

  const insertPerson = db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance, created_at) VALUES (?, ?, ?, 'fabricated', ?)",
  );
  const insertRole = db.prepare(
    "INSERT INTO role_assignments (id, person_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertAttributes = db.prepare(
    `INSERT INTO person_attributes
       (person_id, tenant_id, birth_year, age_band, race_json, ethnicity,
        preferred_language, interpreter_needed, access_needs_json,
        census_region, state, socioeconomic_context, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'self_reported', ?)`,
  );
  const insertEnrollment = db.prepare(
    `INSERT INTO enrollments (id, person_id, tenant_id, program_id, eligibility, effective_from, created_at)
     VALUES (?, ?, ?, 'behavioral-health', 'covered', ?, ?)`,
  );

  // The narrative personas move first: NE-C1's role assignment below points at
  // the demo clinician's person row, which does not exist until this runs.
  bindNarrativePersonas(db);

  // The twelve clinicians (p11). PERSONS with a role assignment, not accounts:
  // nobody signs in as them, and creating twelve logins that no one uses would
  // be twelve more credentials to rotate for no demonstration value.
  for (const region of Object.keys(REGION_NAMES) as Region[]) {
    for (const n of [1, 2, 3]) {
      const code = `${region}-C${n}`;
      const id = clinicianPersonId(code);
      const tenant = orgTenantId(region, armFor(code));
      // NE-C1 is the demo clinician's own account, seeded already. It gets a
      // role assignment in this tenant below, not a second person row.
      if (code === DEMO_CLINICIAN_CODE) {
        insertRole.run(popId("role", code), id, tenant, "clinician", sql(at(EPOCH_DAYS + 20)));
        continue;
      }
      // A clinician's own seed, from the region offset plus 900 + n, so it
      // cannot collide with any of the 240 profile seeds (which end 001–060).
      const clinicianSeed = REGION_SEED_OFFSET[region] + 900 + n;
      insertPerson.run(
        id, tenant, `${displayName(clinicianSeed)} · ${code}`, sql(at(EPOCH_DAYS + 20)),
      );
      insertRole.run(popId("role", code), id, tenant, "clinician", sql(at(EPOCH_DAYS + 20)));
    }
  }

  const nowSql = sql(new Date());
  for (const row of MANIFEST) {
    const seed = seedFor(row);
    const id = popId("person", row.id);
    const tenant = tenantForRow(row);
    // Enrolment is spread across the whole calendar: a founding cohort in the
    // first half and continuing intake since. A population that all enrolled
    // inside one fortnight makes retention meaningless AND makes every
    // cohort-entry comparison unfirable, because the recent windows contain
    // nobody to convert.
    const enrolledDaysAgo = EPOCH_DAYS - enrolmentDayFor(row);

    insertPerson.run(id, tenant, displayName(seed), sql(at(enrolledDaysAgo)));
    insertAttributes.run(
      id, tenant,
      // Stored as a birth YEAR rather than a date. p13 says store the exact
      // fabricated birth date and display the band; a year is exact enough to
      // reproduce the age and carries no false precision about a person who
      // does not exist.
      new Date().getUTCFullYear() - row.age,
      row.ageBand,
      JSON.stringify([row.race]),
      row.ethnicity === "Hisp." ? "Hispanic/Latino" : "Not Hispanic/Latino",
      row.language,
      // Interpreter need is authored INDEPENDENTLY of language (p11: "state,
      // urbanicity, broadband access and language are authored
      // independently"). Assuming every non-English speaker needs an
      // interpreter is the stereotype p11 forbids the generator from encoding.
      row.language !== "English" && seed % 3 === 0 ? 1 : 0,
      JSON.stringify(seed % 11 === 0 ? ["screen-reader"] : seed % 13 === 0 ? ["captions"] : []),
      REGION_NAMES[row.region],
      row.state,
      // Authored insurance and access-barrier context (p13). NOT a deprivation
      // score: it is a label with a stated meaning, and nothing routes on it.
      row.archetype === "Access barrier" ? "transport-and-scheduling" : "standard",
      nowSql,
    );
    insertEnrollment.run(
      popId("enrollment", row.id), id, tenant, sql(at(enrolledDaysAgo)), sql(at(enrolledDaysAgo)),
    );
  }
}

/**
 * Move the demo clinician and the two narrative members into NE Care Network A.
 *
 * The caseload is TENANT-scoped, so a clinician in the platform tenant has an
 * empty panel over a population that lives in organization tenants. Three
 * options were open and two were wrong: a cross-tenant panel would break the
 * scoping every other guard in this project enforces, and leaving the demo
 * clinician where they were would mean the 240 could be aggregated but never
 * opened.
 *
 * Alex and Sam move with them because they are the two people with a full
 * hand-authored story — consent, safety plan, companion memory, an urgent
 * queue entry — and a clinician console that shows forty generated profiles
 * and neither of them is a worse demonstration than one that shows both.
 *
 * Their two rows join NE Care Network A's counts. That is a real effect on the
 * organization console's denominators, and it is correct: they are enrolled
 * there now.
 */
function bindNarrativePersonas(db: Database.Database) {
  const tenant = orgTenantId("NE", "A");
  const moveUser = db.prepare("UPDATE users SET tenant_id = ? WHERE id = ?");
  // The person row may not exist yet. `backfillIdentitySpine` mirrors users
  // onto persons AFTER seeding in both the boot and the reset path, so an
  // UPDATE here would be a silent no-op on a fresh database and would work
  // fine on an existing one — the most expensive kind of bug, because it only
  // appears on the path nobody runs locally.
  //
  // Inserting with ON CONFLICT DO NOTHING creates it if the backfill has not
  // yet, and defers to the backfill if it has. Same pattern and same reason as
  // the platform tenant above.
  const ensurePerson = db.prepare(
    `INSERT INTO persons (id, tenant_id, display_name, provenance)
       SELECT id, ?, name, 'fabricated' FROM users WHERE id = ?
     ON CONFLICT(id) DO NOTHING`);
  const movePerson = db.prepare("UPDATE persons SET tenant_id = ? WHERE id = ?");
  const attrs = db.prepare(
    `INSERT INTO person_attributes
       (person_id, tenant_id, age_band, race_json, ethnicity, preferred_language,
        census_region, state, socioeconomic_context, source)
     VALUES (?, ?, ?, '[]', NULL, 'English', 'Northeast', ?, 'standard', 'self_reported')
     ON CONFLICT(person_id) DO NOTHING`);
  for (const id of [DEMO_CLINICIAN_ID, ALEX_ID, SAM_ID]) {
    moveUser.run(tenant, id);
    ensurePerson.run(tenant, id);
    movePerson.run(tenant, id);
  }
  // Alex and Sam get attributes because they are now enrolled in a real
  // organization and appear in its counts. Without them they fell into an
  // "Unrecorded" region bucket of two people, which the regional breakdown
  // then had to suppress — a two-person row that exists only because two
  // people were left half-described.
  //
  // Race and ethnicity are left NULL rather than invented. p13 requires these
  // to be SELF-DESCRIBED and to show unknown separately from missing; guessing
  // them for a persona in order to tidy a chart is the exact inference the
  // rule forbids. The clinician is deliberately not given attributes at all —
  // they are staff, not a member of the reported population.
  attrs.run(ALEX_ID, tenant, "25-34", "MA");
  attrs.run(SAM_ID, tenant, "35-44", "NY");
  // Their existing records move too, or a tenant-scoped read of a person's own
  // history returns nothing while the person themselves is visible — the worst
  // of both, and exactly the shape of the cross-tenant defect the backfill had.
  for (const table of [
    "consents", "screenings", "checkins", "therapy_sessions", "practice_completions",
    "lesson_reads", "module_unlocks", "alerts", "safety_plans", "user_profiles",
    "readiness_assessments", "post_session_checks", "program_plans", "care_tracks",
  ]) {
    try {
      db.prepare(`UPDATE ${table} SET tenant_id = ? WHERE user_id IN (?, ?, ?)`)
        .run(tenant, DEMO_CLINICIAN_ID, ALEX_ID, SAM_ID);
    } catch {
      // A table without a user_id column is not an error here: this list is
      // deliberately generous, and a miss would be caught by the cross-tenant
      // quality check rather than by hoping the list is complete.
    }
  }
}

/** One member note per profile, deterministic. Exposed for the Wave 3
 *  generator so the text a person "wrote" is stable across rebuilds. */
export function memberNoteFor(row: ManifestRow): string {
  return pick(MEMBER_NOTES, seedFor(row), 1);
}

/**
 * The operational feeds (handoff 07 §3.4, p34).
 *
 * Open first-visit slots and staffed review capacity, by site and week. Two
 * of p34's seven rules compare against these and produced nothing without
 * them, and the reason they produced nothing was honest: no scheduling system
 * and no rota existed anywhere in the schema, so the organization capacity
 * screen drew demand alone and named the missing source above the chart.
 *
 * THESE ARE FABRICATED STAND-INS for integrations this deployment does not
 * have, and they are shaped to behave like the real thing rather than to make
 * a rule fire:
 *
 *   Capacity varies by site and drifts week to week, because a rota does. Two
 *   of the eight organizations are deliberately under-resourced relative to
 *   their demand and the rest are not, so REGION_CAPACITY has something to
 *   find and somewhere to find nothing.
 *
 *   Every row carries an `as_of`. p34 refuses to evaluate stale slot data, and
 *   a feed with no age would make that condition unevaluable — the same defect
 *   as having no feed, wearing a number.
 *
 *   One site's feed is deliberately STALE. A capacity rule that has never met
 *   an out-of-date input has not been tested against the condition p34 spends
 *   a column on.
 */
export function seedOperationalFeeds(db: Database.Database) {
  const epoch = demoEpoch();
  const day = (n: number) => new Date(epoch.getTime() + n * 86400000);
  const date = (d: Date) => d.toISOString().slice(0, 10);
  const PERIOD = 28;

  const insSlots = db.prepare(
    `INSERT INTO capacity_slots
       (id, tenant_id, census_region, period_start, period_days, open_first_visit_slots, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, period_start) DO NOTHING`);
  const insCoverage = db.prepare(
    `INSERT INTO review_coverage
       (id, tenant_id, census_region, period_start, period_days, staffed_review_capacity,
        coverage_schedule, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, period_start) DO NOTHING`);

  // SIZED TO THE POPULATION IT SERVES. 240 profiles across a year is roughly
  // three first-visit referrals per region per four-week period, so a site
  // meeting its share offers two or three slots and one falling behind offers
  // one. Numbers borrowed from a real network would make every ratio 0.01 and
  // the rule unfirable in the other direction — the units have to match the
  // fixture, not the ambition.
  // ONE REGION IS GENUINELY STRAINED, and one is close enough to be worth
  // watching. That is the authored story, and it is authored at the region
  // level rather than the site level because a rule about regional capacity
  // reads a region: making one site of two thin leaves the region comfortable
  // and the finding invisible.
  //
  //   West   — under-resourced on both feeds. Demand runs ahead of slots and
  //            fixed reviews run ahead of the rota. It should fire.
  //   South  — thin on slots and adequately staffed. It should come close and
  //            not fire, because a console where the only two states are
  //            "fine" and "alarm" gets read as an alarm system.
  const THIN_CAPACITY = new Set<Region>(["WE", "SO"]);
  const THIN_REVIEW = new Set<Region>(["WE"]);
  // The site whose scheduling feed stopped updating. p34's staleness condition
  // needs something to be stale.
  const STALE_FEED = "MW-B";

  db.transaction(() => {
    for (const region of Object.keys(REGION_NAMES) as Region[]) {
      for (const arm of ["A", "B"] as const) {
        const key = `${region}-${arm}`;
        const tenant = orgTenantId(region, arm);
        // Arm A carries two thirds of each region's panel (see armFor), so it
        // needs the larger share of the slots. The under-resourced sites are
        // given a share that does not keep up with it.
        const baseline = THIN_CAPACITY.has(region) ? 1 : (arm === "A" ? 3 : 2);
        const reviewBase = THIN_REVIEW.has(region) ? 1 : (arm === "A" ? 3 : 2);

        for (let period = 0; period * PERIOD < CALENDAR_DAYS; period++) {
          const periodStart = day(period * PERIOD);
          // A deterministic wobble: a rota moves, and a feed reporting the
          // identical number every period for a year is not a feed.
          const wobble = ((period * 7919) % 3) - 1;
          // WHEN THE FEED LAST REPORTED, which is the END of the period it
          // describes, not the beginning. Dating it to the period start made
          // every reading look four weeks old the moment it was written, and
          // the newest row in a window was 24 days stale — so p34's staleness
          // condition refused a feed that was working perfectly.
          const asOf = key === STALE_FEED
            // Frozen months ago. The rows still arrive; they stopped meaning
            // anything, which is the failure a staleness check exists for and
            // is far more common than a feed that stops entirely.
            ? day(Math.min(period * PERIOD, CALENDAR_DAYS - 120))
            : day(Math.min((period + 1) * PERIOD, CALENDAR_DAYS));

          insSlots.run(
            popId("slots", `${key}:${period}`), tenant, REGION_NAMES[region],
            date(periodStart), PERIOD, Math.max(1, baseline + wobble), date(asOf),
          );
          insCoverage.run(
            popId("coverage", `${key}:${period}`), tenant, REGION_NAMES[region],
            // No bonus period for a stretched rota. Everywhere else a good
            // month adds a slot; a site running one reviewer does not get a
            // second one because the month was quiet.
            date(periodStart), PERIOD,
            Math.max(1, reviewBase + (THIN_REVIEW.has(region) ? 0 : wobble > 0 ? 1 : 0)),
            "business hours, weekdays", date(asOf),
          );
        }
      }
    }
  })();
}
