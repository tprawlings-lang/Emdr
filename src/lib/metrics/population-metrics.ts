import { data } from "@/lib/data";
import { DATASET_VERSION } from "@/lib/demo-population-manifest";
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

export async function loadObservations(tenantIds: string[]): Promise<Observation[]> {
  if (tenantIds.length === 0) return [];
  const c = await data();
  const marks = tenantIds.map(() => "?").join(",");

  const rows = (await c.all(
    `SELECT
        u.id                                        AS person_id,
        u.tenant_id                                 AS tenant_id,
        a.census_region                             AS region,
        a.age_band                                  AS age_band,
        a.preferred_language                        AS language,
        a.race_json                                 AS race_json,
        a.ethnicity                                 AS ethnicity,
        a.access_needs_json                         AS access_needs_json,
        u.created_at                                AS enrolled_at,
        (SELECT MIN(k.checkin_date) FROM checkins k WHERE k.user_id = u.id)      AS first_action,
        (SELECT MAX(k.checkin_date) FROM checkins k WHERE k.user_id = u.id)      AS last_action,
        (SELECT COUNT(DISTINCT strftime('%Y-%W', k.checkin_date))
           FROM checkins k WHERE k.user_id = u.id)                              AS active_weeks,
        (SELECT COUNT(*) FROM practice_completions pc WHERE pc.user_id = u.id)  AS modules_completed,
        (SELECT COUNT(*) FROM screenings s WHERE s.user_id = u.id)              AS measures_complete,
        (SELECT s.total_score FROM screenings s WHERE s.user_id = u.id
          ORDER BY s.created_at ASC LIMIT 1)                                    AS baseline,
        (SELECT s.total_score FROM screenings s WHERE s.user_id = u.id
          ORDER BY s.created_at DESC LIMIT 1)                                   AS follow_up,
        (SELECT COUNT(*) FROM longitudinal_events e
          WHERE e.person_id = u.id AND e.event_type = 'safety_state.changed'
            AND json_extract(e.payload, '$.state') = 'paused')                  AS pauses
       FROM users u
       LEFT JOIN person_attributes a ON a.person_id = u.id
      WHERE u.tenant_id IN (${marks}) AND u.role = 'member'`,
    tenantIds,
  )) as Record<string, unknown>[];

  // Missingness, by person and by reason. Read as EVENTS rather than inferred
  // from an absence of rows — p28 records why a value is missing, and an
  // absence carries no reason.
  const missing = (await c.all(
    `SELECT e.person_id AS person_id,
            COALESCE(json_extract(e.payload, '$.reason'), 'unrecorded') AS reason,
            COALESCE(json_extract(e.payload, '$.partial'), 0)           AS partial,
            COUNT(*) AS n
       FROM longitudinal_events e JOIN persons p ON p.id = e.person_id
      WHERE p.tenant_id IN (${marks}) AND e.event_type = 'measure.not_completed'
      GROUP BY 1, 2, 3`,
    tenantIds,
  )) as { person_id: string; reason: string; partial: number; n: number }[];

  type Miss = { partial: number; declined: number; unavailable: number; skipped: number; interrupted: number; notDue: number };
  const byPerson = new Map<string, Miss>();
  for (const m of missing) {
    const acc: Miss = byPerson.get(m.person_id)
      ?? { partial: 0, declined: 0, unavailable: 0, skipped: 0, interrupted: 0, notDue: 0 };
    const n = Number(m.n);
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
        AND json_extract(e.payload, '$.state') = 'paused'
      GROUP BY e.id`,
    tenantIds,
  )) as { person_id: string; hours: number }[];
  const latencies = new Map<string, number[]>();
  for (const r of reviews) {
    latencies.set(r.person_id, [...(latencies.get(r.person_id) ?? []), Math.round(Number(r.hours))]);
  }

  const today = Date.now();
  const days = (from: unknown, to: unknown): number | null => {
    if (!from || !to) return null;
    return Math.round(
      (new Date(String(to)).getTime() - new Date(String(from)).getTime()) / 86400000,
    );
  };

  return rows.map((r) => {
    const enrolled = String(r.enrolled_at);
    const daysEnrolled = Math.max(0, Math.round((today - new Date(enrolled).getTime()) / 86400000));
    const miss = byPerson.get(String(r.person_id))
      ?? { partial: 0, declined: 0, unavailable: 0, skipped: 0, interrupted: 0, notDue: 0 };
    return {
      personId: String(r.person_id),
      region: r.region ? String(r.region) : null,
      ageBand: r.age_band ? String(r.age_band) : null,
      language: r.language ? String(r.language) : null,
      race: r.race_json ? (JSON.parse(String(r.race_json)) as string[]) : [],
      ethnicity: r.ethnicity ? String(r.ethnicity) : null,
      tenantId: String(r.tenant_id),
      accessNeeds: r.access_needs_json ? (JSON.parse(String(r.access_needs_json)) as string[]) : [],
      hasAccount: true,
      daysEnrolled,
      daysToFirstAction: days(enrolled, r.first_action),
      activeWeeks: Number(r.active_weeks ?? 0),
      // Every week since enrolment is OBSERVED, including the ones with
      // nothing in them. p33: never remove non-users from the denominator of
      // an engagement rate — and a week with no activity is exactly such a
      // week.
      observedWeeks: Math.max(1, Math.ceil(daysEnrolled / WEEK_DAYS)),
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
export function metricContext(runId: string): ComputeContext {
  const now = new Date();
  const start = new Date(now.getTime() - 180 * 86400000);
  return {
    window: { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) },
    dataVersion: DATASET_VERSION,
    projectionVersion: "population_metrics.v2",
    refreshedAt: now.toISOString().slice(0, 19) + "Z",
    lineageRef: `lineage://metric-run-${runId}`,
    responderThreshold: RESPONDER_THRESHOLD,
  };
}
