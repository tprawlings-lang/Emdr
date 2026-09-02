import { OUTCOME_INSTRUMENT } from "@/lib/demo-population-generator";
import { data } from "@/lib/data";
import { DATASET_VERSION } from "@/lib/demo-population-manifest";
import { demoNow, demoToday } from "@/lib/demo-clock";
import type { Observation, ComputeContext } from "./compute";

// Turning rows into observations (handoff 07 §5.3, p48).
//
// This module's ONLY job is to read the database and produce
// `Observation[]`. It computes no metric. The split is what makes p52's exit
// evidence possible: the arithmetic lives in `compute.ts` and is checked
// against hand calculations, and this layer is checked against invariants over
// the real population. A single module doing both could only ever be checked
// against itself.
//
// Everything here is read from the same ledger the clinician's panel and the
// organization's overview read, so a metric and a screen cannot disagree about
// what happened.

/** p57: "responder threshold — configuration fixture only; no clinical claim."
 *  Five points on the PHQ-9. It carries no validation, and the metric's own
 *  `detail` says so beside every value. */
export const RESPONDER_THRESHOLD = 5;

/** How long a week is, in days. Named because "weekly engagement" over a
 *  seven-day week and over a business week are different metrics. */
const WEEK_DAYS = 7;

/** A closed date range, inclusive at both ends. */
export interface Window { start: string; end: string; }

/**
 * Dates are interpolated into the SQL below rather than bound, because the
 * window appears inside six correlated subqueries and threading positional
 * parameters through them in the right order is the kind of thing that works
 * until someone adds a seventh. So the values are checked to be exactly a
 * calendar date first, and nothing else can reach the string.
 */
function assertDate(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`"${d}" is not a calendar date; a metric window must be YYYY-MM-DD`);
  }
  return d;
}

/**
 * Read the population as `Observation[]`, optionally over a WINDOW.
 *
 * The window is what makes p34's repeat-in-two-windows rules evaluable at all:
 * "the gap held for two windows" is a different claim from "the gap is there
 * over six months", and only the first one distinguishes a pattern from a
 * reading. Without a window every subquery counts a person's whole history,
 * which is the right default for a dashboard and useless for a trend.
 *
 * Enrolment is clipped to the window too. Someone who enrolled after the
 * window closed has no observed weeks in it and must not appear in a
 * denominator; someone who enrolled during it is observed for the part of the
 * window they were actually present for, not for all of it.
 */
export async function loadObservations(tenantIds: string[], window?: Window): Promise<Observation[]> {
  if (tenantIds.length === 0) return [];
  const c = await data();
  const marks = tenantIds.map(() => "?").join(",");
  // WITH NO WINDOW, the window is everything up to the demo clock.
  //
  // Not "everything". The clock lets a presenter read the environment as it
  // stood at a milestone, and a loader that quietly included every row would
  // show them the future — a population still checking in three months after
  // the date on the screen. Expressing it as a window rather than as a special
  // case means the clock gets the same enrolment cut-off, the same as-of and
  // the same observed-weeks arithmetic as any other window, instead of a
  // second code path that has to be kept in step.
  const bound = window ?? { start: "1970-01-01", end: await demoToday() };
  const w = { start: assertDate(bound.start), end: assertDate(bound.end) };
  // `checkin_date` is already a calendar date; the rest are ISO timestamps, so
  // they are truncated before comparison rather than compared as strings —
  // "2026-05-31T22:00:00Z" is not BETWEEN "2026-03-01" AND "2026-05-31".
  const inWin = (col: string) => ` AND substr(${col}, 1, 10) BETWEEN '${w.start}' AND '${w.end}'`;
  const kWin = ` AND k.checkin_date BETWEEN '${w.start}' AND '${w.end}'`;
  // NOT applied to `first_action`, and the exception is the whole of what a
  // window means for a COHORT-ENTRY metric. Activation asks whether a person
  // acted within seven days OF ENROLLING; clipping their first action to a
  // window that opened months later reports everyone who enrolled before it as
  // having failed to activate. The first version of this did exactly that and
  // reported an 86.7-point drift between two windows of the same stable
  // population — the number that found the bug.
  //
  // So a window selects the ENROLMENT COHORT for activation, and the activity
  // for everything else. `enrolledInWindow` below is what carries that.
  const sWin = inWin("s.created_at");
  const pWin = inWin("pc.created_at");
  const eWin = inWin("e.occurred_at");
  // Somebody who enrolled after the window closed was not observed in it, and
  // counting them as a person who failed to activate is the same censoring
  // error retention has.
  const enrolWin = ` AND substr(u.created_at, 1, 10) <= '${w.end}'`;

  const rows = (await c.all(
    `SELECT
        u.id                                        AS person_id,
        u.tenant_id                                 AS tenant_id,
        p.provenance                                AS provenance,
        a.census_region                             AS region,
        a.state                                     AS state,
        a.age_band                                  AS age_band,
        a.preferred_language                        AS language,
        a.race_json                                 AS race_json,
        a.ethnicity                                 AS ethnicity,
        a.access_needs_json                         AS access_needs_json,
        a.interpreter_needed                        AS interpreter_needed,
        u.created_at                                AS enrolled_at,
        (SELECT MIN(k.checkin_date) FROM checkins k WHERE k.user_id = u.id)      AS first_action,
        (SELECT MAX(k.checkin_date) FROM checkins k WHERE k.user_id = u.id${kWin})      AS last_action,
        (SELECT COUNT(DISTINCT strftime('%Y-%W', k.checkin_date))
           FROM checkins k WHERE k.user_id = u.id${kWin})                        AS active_weeks,
        (SELECT COUNT(*) FROM practice_completions pc WHERE pc.user_id = u.id${pWin})  AS modules_completed,
        -- THE OUTCOME INSTRUMENT, named. A person also has an intake battery
        -- taken once at enrolment, and taking the first and last row of
        -- the screenings table whatever they are compares a PC-PTSD-5 (max 5)
        -- against a PHQ-9 (max 27) and reports the difference as change.
        (SELECT COUNT(*) FROM screenings s WHERE s.user_id = u.id
           AND s.instrument = '${OUTCOME_INSTRUMENT}'${sWin})                   AS measures_complete,
        (SELECT s.total_score FROM screenings s WHERE s.user_id = u.id
           AND s.instrument = '${OUTCOME_INSTRUMENT}'${sWin}
          ORDER BY s.created_at ASC LIMIT 1)                                    AS baseline,
        (SELECT s.total_score FROM screenings s WHERE s.user_id = u.id
           AND s.instrument = '${OUTCOME_INSTRUMENT}'${sWin}
          ORDER BY s.created_at DESC LIMIT 1)                                   AS follow_up,
        (SELECT COUNT(*) FROM longitudinal_events e
          WHERE e.person_id = u.id AND e.event_type = 'safety_state.changed'
            AND json_extract(e.payload, '$.state') = 'paused'${eWin})           AS pauses
       FROM users u
       JOIN persons p ON p.id = u.id
       LEFT JOIN person_attributes a ON a.person_id = u.id
      WHERE u.tenant_id IN (${marks}) AND u.role = 'member'${enrolWin}`,
    tenantIds,
  )) as Record<string, unknown>[];

  // Missingness, by person and by reason. Read as EVENTS rather than inferred
  // from an absence of rows — p28 records why a value is missing, and an
  // absence carries no reason.
  const missing = (await c.all(
    `SELECT e.person_id AS person_id,
            COALESCE(json_extract(e.payload, '$.reason'), 'unrecorded') AS reason,
            COALESCE(json_extract(e.payload, '$.partial'), 0)           AS partial,
            COALESCE(json_extract(e.payload, '$.cause'), 'person')      AS cause,
            COUNT(*) AS n
       FROM longitudinal_events e JOIN persons p ON p.id = e.person_id
      WHERE p.tenant_id IN (${marks}) AND e.event_type = 'measure.not_completed'${eWin}
      GROUP BY 1, 2, 3, 4`,
    tenantIds,
  )) as { person_id: string; reason: string; partial: number; cause: string; n: number }[];

  type Miss = {
    partial: number; declined: number; unavailable: number; skipped: number;
    interrupted: number; notDue: number; undelivered: number;
  };
  const byPerson = new Map<string, Miss>();
  for (const m of missing) {
    const acc: Miss = byPerson.get(m.person_id)
      ?? { partial: 0, declined: 0, unavailable: 0, skipped: 0, interrupted: 0, notDue: 0, undelivered: 0 };
    const n = Number(m.n);
    // Counted ALONGSIDE the reason, not instead of it. Reason and cause are
    // two different questions about the same event — what happened, and whose
    // failure it was — and a fairness review needs the second while p28's
    // taxonomy answers the first.
    if (m.cause === "service") acc.undelivered += n;
    // ONE TO ONE with p28's six reasons. The first version folded skipped,
    // failed and interrupted into "unavailable" so that five buckets would
    // hold six reasons — which relabelled a person's omission as a system
    // outage, and made "unavailable" the largest category by construction.
    // Losing that distinction loses the only information that says whether
    // you have a delivery problem or a consent one.
    if (Number(m.partial) === 1) acc.partial += n;
    else if (m.reason === "declined") acc.declined += n;
    else if (m.reason === "not_due") acc.notDue += n;
    else if (m.reason === "skipped") acc.skipped += n;
    else if (m.reason === "interrupted") acc.interrupted += n;
    else acc.unavailable += n;  // "unavailable" and "failed" — the system's side
    byPerson.set(m.person_id, acc);
  }

  const reviews = (await c.all(
    `SELECT e.person_id AS person_id,
            (julianday(e2.occurred_at) - julianday(e.occurred_at)) * 24 AS hours
       FROM longitudinal_events e
       JOIN persons p ON p.id = e.person_id
       JOIN longitudinal_events e2
         ON e2.person_id = e.person_id AND e2.event_type = 'clinician.reviewed'
        -- The response to THIS gate, matched by reference rather than by
        -- "the next review of any kind". The first version paired a pause
        -- with whatever clinician action came next, which is scattered across
        -- six months: the median read 593 hours, which is not a latency but
        -- the average distance between two unrelated things.
        AND json_extract(e2.payload, '$.respondsTo') = e.id
      WHERE p.tenant_id IN (${marks})
        AND e.event_type = 'safety_state.changed'
        AND json_extract(e.payload, '$.state') = 'paused'${eWin}
      GROUP BY e.id`,
    tenantIds,
  )) as { person_id: string; hours: number }[];
  const latencies = new Map<string, number[]>();
  for (const r of reviews) {
    latencies.set(r.person_id, [...(latencies.get(r.person_id) ?? []), Math.round(Number(r.hours))]);
  }

  // The window's end, not the clock. A metric over a window that closed in
  // May must not have its denominators grow every day afterwards.
  const asOf = new Date(`${w.end}T23:59:59Z`).getTime();
  // Null when the bound is the open-ended one, so "weeks observed" still runs
  // from a person's enrolment rather than from 1970.
  const windowOpened = window ? new Date(`${w.start}T00:00:00Z`).getTime() : null;
  const days = (from: unknown, to: unknown): number | null => {
    if (!from || !to) return null;
    return Math.round(
      (new Date(String(to)).getTime() - new Date(String(from)).getTime()) / 86400000,
    );
  };

  return rows.map((r) => {
    const enrolled = String(r.enrolled_at);
    const enrolledAt = new Date(enrolled).getTime();
    const daysEnrolled = Math.max(0, Math.round((asOf - enrolledAt) / 86400000));
    // Weeks OBSERVED inside the window: from whichever is later, the window
    // opening or the person's enrolment, to the window's close.
    const observedFrom = windowOpened === null ? enrolledAt : Math.max(windowOpened, enrolledAt);
    const observedDays = Math.max(0, Math.round((asOf - observedFrom) / 86400000));
    const miss = byPerson.get(String(r.person_id))
      ?? { partial: 0, declined: 0, unavailable: 0, skipped: 0, interrupted: 0, notDue: 0, undelivered: 0 };
    return {
      personId: String(r.person_id),
      region: r.region ? String(r.region) : null,
      ageBand: r.age_band ? String(r.age_band) : null,
      language: r.language ? String(r.language) : null,
      race: r.race_json ? (JSON.parse(String(r.race_json)) as string[]) : [],
      ethnicity: r.ethnicity ? String(r.ethnicity) : null,
      tenantId: String(r.tenant_id),
      accessNeeds: r.access_needs_json ? (JSON.parse(String(r.access_needs_json)) as string[]) : [],
      interpreterNeeded: Number(r.interpreter_needed ?? 0) === 1,
      state: r.state ? String(r.state) : null,
      hasAccount: true,
      // An INNER join above, so a user with no person row does not silently
      // arrive with an undefined provenance and get counted as real.
      provenance: String(r.provenance) === "fabricated" ? "fabricated" : "real",
      daysEnrolled,
      daysToFirstAction: days(enrolled, r.first_action),
      activeWeeks: Number(r.active_weeks ?? 0),
      // Every week since enrolment is OBSERVED, including the ones with
      // nothing in them. p33: never remove non-users from the denominator of
      // an engagement rate — and a week with no activity is exactly such a
      // week.
      observedWeeks: Math.max(1, Math.ceil(observedDays / WEEK_DAYS)),
      // Whether this person ENTERED in the window. True when there is no
      // window, so an unwindowed load behaves exactly as before.
      enrolledInWindow: windowOpened === null || enrolledAt >= windowOpened,
      daysToLastAction: days(enrolled, r.last_action),
      // Every module completion in this dataset is a completed instance; the
      // generator writes no abandoned ones, so starts equals completions and
      // the abandonment figure is honestly zero rather than invented.
      modulesStarted: Number(r.modules_completed ?? 0),
      modulesCompleted: Number(r.modules_completed ?? 0),
      measuresComplete: Number(r.measures_complete ?? 0),
      measuresPartial: miss.partial,
      measuresDeclined: miss.declined,
      measuresUnavailable: miss.unavailable,
      measuresSkipped: miss.skipped,
      measuresInterrupted: miss.interrupted,
      measuresNotDue: miss.notDue,
      measuresUndelivered: miss.undelivered,
      baseline: r.baseline === null || r.baseline === undefined ? null : Number(r.baseline),
      followUp: r.follow_up === null || r.follow_up === undefined ? null : Number(r.follow_up),
      hadFixedPause: Number(r.pauses ?? 0) > 0,
      reviewLatencyHours: latencies.get(String(r.person_id)) ?? [],
    } as Observation;
  });
}

/** The context every metric result carries (p48). Built once per run so every
 *  metric in a view shares one refresh time and one lineage reference — two
 *  numbers refreshed a second apart are not comparable and must not look it. */
export async function metricContext(runId: string, window?: Window): Promise<ComputeContext> {
  // The DEMO clock. A context built from the real one while the reader is
  // looking at a milestone would stamp every result with a refresh time
  // months after the data it describes.
  const now = await demoNow();
  const start = new Date(now.getTime() - 180 * 86400000);
  return {
    // The window travels in the result (p48). A context built for one window
    // and used to compute another would produce a result that names dates its
    // numbers do not come from, which is worse than an unlabelled one.
    window: window ?? { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) },
    dataVersion: DATASET_VERSION,
    projectionVersion: "population_metrics.v2",
    refreshedAt: now.toISOString().slice(0, 19) + "Z",
    lineageRef: `lineage://metric-run-${runId}`,
    responderThreshold: RESPONDER_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// The operational feeds
// ---------------------------------------------------------------------------

/** Demand and supply for a first visit, by region, over a window. */
export interface CapacityReading {
  region: string;
  /** REFERRALS RECEIVED in the window — everybody who needs a first visit,
   *  not the residue who never got one.
   *
   *  The backlog is the more intuitive number and it is the wrong one: slots
   *  are consumed by everyone who is seen, so comparing a period's supply
   *  against only the people it failed reports a service at capacity as one
   *  with nothing to do. Measured on the first version: demand of 0 to 2
   *  against a supply of 141 to 219. */
  demand: number;
  /** Open first-visit slots across the window, or null when no feed exists. */
  openFirstVisitSlots: number | null;
  slotDataAsOf: string | null;
  /** How old the newest reading is, in days, at the window's close. p34
   *  refuses to evaluate a stale feed and this is the number it refuses on. */
  asOfAgeDays: number | null;
}

export interface ReviewLoadReading {
  region: string;
  fixedReviewEvents: number;
  staffedCapacity: number | null;
  coverageScheduleKnown: boolean;
  /** Whether every review event in the window carries a classification. p34
   *  produces nothing when the classification is missing, because then the
   *  count is of something undefined. */
  classificationComplete: boolean;
}

/**
 * These live here rather than in the planning engine, and the reason is a
 * guard rather than a preference: `tests/planning.test.ts` fails the build on
 * a person identifier anywhere under `src/lib/planning`, and counting people
 * who are waiting for a visit names one. The planning rules take the readings
 * and compare them; they do not go and get them.
 */
export async function loadCapacity(tenantIds: string[], window: Window): Promise<CapacityReading[]> {
  if (tenantIds.length === 0) return [];
  const c = await data();
  const marks = tenantIds.map(() => "?").join(",");
  const w = { start: assertDate(window.start), end: assertDate(window.end) };

  const demand = (await c.all(
    `SELECT a.census_region AS region, COUNT(*) AS n
       FROM longitudinal_events e
       JOIN persons p ON p.id = e.person_id
       JOIN person_attributes a ON a.person_id = p.id
      WHERE p.tenant_id IN (${marks})
        AND e.event_type = 'referral.received'
        AND substr(e.occurred_at, 1, 10) BETWEEN '${w.start}' AND '${w.end}'
      GROUP BY 1`,
    tenantIds,
  )) as { region: string; n: number }[];

  const slots = (await c.all(
    // HOW STALE IS THE STALEST SITE, which is neither MAX nor MIN of the raw
    // rows.
    //
    // MAX across the region hides a site whose feed froze months ago behind
    // one that is still reporting, and a total assembled from a frozen
    // component is wrong in a way p34's staleness condition exists to catch.
    // MIN across the region is worse in the other direction: the oldest row in
    // a ninety-day window is ninety days old by construction, so every feed
    // reads as stale however well it is working.
    //
    // What matters is whether each site is STILL reporting: take each one's
    // latest reading, then the oldest of those.
    `SELECT census_region AS region, SUM(n) AS n, MIN(latest) AS as_of FROM (
       SELECT tenant_id, census_region,
              SUM(open_first_visit_slots) AS n, MAX(as_of) AS latest
         FROM capacity_slots
        WHERE tenant_id IN (${marks}) AND period_start BETWEEN '${w.start}' AND '${w.end}'
        GROUP BY tenant_id, census_region
     ) GROUP BY census_region`,
    tenantIds,
  )) as { region: string; n: number; as_of: string }[];

  const byRegion = new Map<string, CapacityReading>();
  for (const s of slots) {
    const asOf = String(s.as_of);
    byRegion.set(s.region, {
      region: s.region,
      demand: 0,
      openFirstVisitSlots: Number(s.n),
      slotDataAsOf: asOf,
      // `as_of` is a calendar date, so it is parsed as one. Appending a time
      // would be inventing precision the feed never reported.
      asOfAgeDays: Math.round(
        (new Date(`${w.end}T23:59:59Z`).getTime() - new Date(`${asOf.slice(0, 10)}T00:00:00Z`).getTime())
        / 86400000),
    });
  }
  for (const d of demand) {
    const existing = byRegion.get(d.region);
    if (existing) existing.demand = Number(d.n);
    // A region with demand and no feed at all. Reported with a null supply
    // rather than dropped, because "we have not counted the slots" and "there
    // are no slots" are different answers and only one of them is a capacity
    // finding.
    else byRegion.set(d.region, {
      region: d.region, demand: Number(d.n),
      openFirstVisitSlots: null, slotDataAsOf: null, asOfAgeDays: null,
    });
  }
  return [...byRegion.values()];
}

export async function loadReviewLoad(tenantIds: string[], window: Window): Promise<ReviewLoadReading[]> {
  if (tenantIds.length === 0) return [];
  const c = await data();
  const marks = tenantIds.map(() => "?").join(",");
  const w = { start: assertDate(window.start), end: assertDate(window.end) };

  const events = (await c.all(
    `SELECT a.census_region AS region,
            COUNT(*) AS n,
            SUM(CASE WHEN json_extract(e.payload, '$.reason') IS NULL THEN 1 ELSE 0 END) AS unclassified
       FROM longitudinal_events e
       JOIN persons p ON p.id = e.person_id
       JOIN person_attributes a ON a.person_id = p.id
      WHERE p.tenant_id IN (${marks})
        AND e.event_type = 'safety_state.changed'
        AND json_extract(e.payload, '$.state') = 'paused'
        AND substr(e.occurred_at, 1, 10) BETWEEN '${w.start}' AND '${w.end}'
      GROUP BY 1`,
    tenantIds,
  )) as { region: string; n: number; unclassified: number }[];

  const cover = (await c.all(
    `SELECT census_region AS region, SUM(staffed_review_capacity) AS n,
            MAX(coverage_schedule) AS schedule
       FROM review_coverage
      WHERE tenant_id IN (${marks}) AND period_start BETWEEN '${w.start}' AND '${w.end}'
      GROUP BY 1`,
    tenantIds,
  )) as { region: string; n: number; schedule: string }[];

  const byRegion = new Map<string, ReviewLoadReading>();
  for (const r of cover) {
    byRegion.set(r.region, {
      region: r.region, fixedReviewEvents: 0,
      staffedCapacity: Number(r.n),
      coverageScheduleKnown: Boolean(r.schedule),
      classificationComplete: true,
    });
  }
  for (const e of events) {
    const existing = byRegion.get(e.region) ?? {
      region: e.region, fixedReviewEvents: 0, staffedCapacity: null,
      coverageScheduleKnown: false, classificationComplete: true,
    };
    existing.fixedReviewEvents = Number(e.n);
    existing.classificationComplete = Number(e.unclassified) === 0;
    byRegion.set(e.region, existing);
  }
  return [...byRegion.values()];
}
