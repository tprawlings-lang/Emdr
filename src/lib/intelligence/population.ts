import { data } from "@/lib/data";
import { ready, partial, empty, type Envelope, type ProjectionMeta } from "@/lib/presentation/envelope";
import { CLINICAL_POLICY_VERSION } from "@/lib/clinical-policy";
import { assertAggregate } from "./organization";
import { SMALL_CELL } from "@/components/charts/aggregate";
import { DATASET_VERSION } from "@/lib/demo-population-manifest";
import { loadObservations, metricContext } from "@/lib/metrics/population-metrics";
import { ALL_ELIGIBLE } from "@/lib/metrics/cohorts";
import {
  suppressExternal, computeActivation, computeWeeklyEngagement,
  computeFollowupCompletion, computeObservedChange, computeResponderRate,
  computeSafetyPauseRate, computeTimeToReview, computeRetention,
  type MetricResult,
} from "@/lib/metrics/compute";

/** The envelope's metadata. Every projection carries the schema it satisfies,
 *  the build that produced it, the newest event it reflects and the policy in
 *  force — §30.8's requirement that a screen can always say how old its
 *  numbers are and which contract they answer. */
async function meta(tenantIds: string[], schemaVersion: string): Promise<ProjectionMeta> {
  const c = await data();
  const w = tenantIds.length
    ? ((await c.get(
        `SELECT MAX(occurred_at) AS w FROM longitudinal_events
          WHERE tenant_id IN (${tenantIds.map(() => "?").join(",")})`, tenantIds,
      )) as { w: string | null } | undefined)?.w ?? null
    : null;
  return {
    schemaVersion,
    projectionVersion: DATASET_VERSION,
    generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    tenantId: tenantIds[0] ?? "",
    sourceWatermark: w,
    policyVersion: CLINICAL_POLICY_VERSION,
  };
}

// Six role projections over ONE ledger (handoff 07 §5.1 p46, §6.1 p52).
//
// p52's exit evidence for this wave is the whole claim: "the same events
// produce correct minimum-necessary views." Six roles, one set of facts, and
// the difference between them is what each is allowed to see — never a
// different source of truth.
//
// That matters more than it sounds. The alternative — a per-role table, or a
// per-role query that happens to agree today — produces consoles that
// disagree, and a disagreement between the clinician's number and the
// organization's is indistinguishable from a bug in either. Reading them from
// one place makes a discrepancy impossible rather than unlikely.
//
// WHAT ENFORCES MINIMUM NECESSARY. Two different mechanisms, deliberately:
//
//   PERSON-LEVEL views are scoped by tenant and by relationship. A clinician
//   reads the people in their tenant; a patient reads themselves. The scope is
//   in the SQL, so a caller cannot widen it by passing a different argument.
//
//   AGGREGATE views are laundered through `assertAggregate`, which throws if a
//   person identifier appears anywhere in the returned shape. Not a filter —
//   a refusal. A projection that carries a person id does not render with the
//   id hidden; it does not render.

// ---------------------------------------------------------------------------
// Aggregate: the same ledger, no people
// ---------------------------------------------------------------------------

export interface PopulationOverview {
  /** Every count carries its denominator (§29.1). */
  covered: number;
  active: { n: number; of: number };
  measuredTwice: { n: number; of: number };
  improved: { n: number; of: number };
  /** Measures that came DUE and were not completed, against everything due.
   *
   *  This replaced a "missing follow-up" count derived from people with fewer
   *  than two measures, which read 0 of 242 — correct, and useless. p14 gives
   *  every profile four to eight COMPLETED measures, so nobody can be missing
   *  follow-up by that definition, and the slice §29.1 requires would have
   *  been permanently empty. The missingness is real and it is in the ledger:
   *  455 recorded absences, each carrying one of p28's six reasons. */
  missedMeasures: { n: number; of: number };
  /** The breakdown p28 asks for. Shown separately rather than summed, because
   *  "declined" and "not due" are different facts about a person. */
  missedByReason: Array<{ reason: string; n: number }>;
  byRegion: Array<{ label: string; covered: number; active: string; measured: string }>;
  window: string;
  refreshedAt: string;
}

/**
 * The population view an organization or payer reads.
 *
 * Counted from the SAME rows the panel above reads. A number here and a number
 * there cannot disagree, because there is nothing for them to disagree about.
 */
export async function buildPopulationOverview(tenantIds: string[]): Promise<Envelope<PopulationOverview>> {
  if (tenantIds.length === 0) {
    return partial(await meta([], "population_overview.v1"), emptyOverview(), [{
      source: "tenant scope",
      reason: "This account is not bound to a tenant holding a demo population, so there " +
        "is nothing to report on. That is a configuration gap, not an empty result.",
    }]);
  }
  const c = await data();
  const marks = tenantIds.map(() => "?").join(",");

  const totals = (await c.get(
    `SELECT COUNT(*) AS covered,
            SUM(CASE WHEN (SELECT COUNT(*) FROM checkins k WHERE k.user_id = u.id) > 0
                     THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN (SELECT COUNT(*) FROM screenings s WHERE s.user_id = u.id) >= 2
                     THEN 1 ELSE 0 END) AS measured
       FROM users u WHERE u.tenant_id IN (${marks}) AND u.role = 'member'`,
    tenantIds,
  )) as { covered: number; active: number; measured: number };

  const missed = (await c.get(
    `SELECT COUNT(*) AS n FROM longitudinal_events e
       JOIN persons p ON p.id = e.person_id
      WHERE p.tenant_id IN (${marks}) AND e.event_type = 'measure.not_completed'`,
    tenantIds,
  )) as { n: number };
  const missedByReason = (await c.all(
    `SELECT COALESCE(json_extract(e.payload, '$.reason'), 'unrecorded') AS reason,
            COUNT(*) AS n
       FROM longitudinal_events e JOIN persons p ON p.id = e.person_id
      WHERE p.tenant_id IN (${marks}) AND e.event_type = 'measure.not_completed'
      GROUP BY 1 ORDER BY 2 DESC`,
    tenantIds,
  )) as { reason: string; n: number }[];
  const completedMeasures = (await c.get(
    `SELECT COUNT(*) AS n FROM screenings s
       JOIN persons p ON p.id = s.user_id WHERE p.tenant_id IN (${marks})`,
    tenantIds,
  )) as { n: number };

  const improved = (await c.get(
    `SELECT COUNT(*) AS n FROM (
       SELECT u.id,
              (SELECT s.total_score FROM screenings s WHERE s.user_id = u.id ORDER BY s.created_at ASC LIMIT 1) AS b,
              (SELECT s.total_score FROM screenings s WHERE s.user_id = u.id ORDER BY s.created_at DESC LIMIT 1) AS l
         FROM users u WHERE u.tenant_id IN (${marks}) AND u.role = 'member')
      WHERE b IS NOT NULL AND l IS NOT NULL AND l < b`,
    tenantIds,
  )) as { n: number };

  const byRegion = (await c.all(
    `SELECT COALESCE(a.census_region, 'Unrecorded') AS label,
            COUNT(*) AS covered,
            SUM(CASE WHEN (SELECT COUNT(*) FROM checkins k WHERE k.user_id = p.id) > 0
                     THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN (SELECT COUNT(*) FROM screenings s WHERE s.user_id = p.id) >= 2
                     THEN 1 ELSE 0 END) AS measured
       FROM persons p
       LEFT JOIN person_attributes a ON a.person_id = p.id
      WHERE p.tenant_id IN (${marks})
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.id AND u.role = 'member')
      GROUP BY 1 ORDER BY 1`,
    tenantIds,
  )) as { label: string; covered: number; active: number; measured: number }[];

  const covered = Number(totals.covered ?? 0);
  const measured = Number(totals.measured ?? 0);

  // Zero covered lives is an EMPTY result, not a ready screen of zeros.
  //
  // The distinction is the whole of §30.8: a console reporting "0 covered, 0
  // active, 0 improved" has told the reader something false with great
  // confidence. This surfaced immediately — the organization account is bound
  // to Northside Behavioral Health, which holds none of the demo population,
  // and the screen rendered a full set of zeros rather than saying so.
  if (covered === 0) {
    return empty(
      await meta(tenantIds, "population_overview.v1"),
      "No demo-population enrolment exists for this organization. The 240 fabricated profiles " +
      "are enrolled with the eight demo care networks; this account reports on a different " +
      "population, and its own screens are under Operating overview.",
    );
  }

  const overview: PopulationOverview = {
    covered,
    active: { n: Number(totals.active ?? 0), of: covered },
    measuredTwice: { n: measured, of: covered },
    improved: { n: Number(improved.n ?? 0), of: measured },
    // Against everything that came DUE — completed plus missed — so the two
    // slices sum to the denominator and a chart cannot silently drop an
    // absence.
    missedMeasures: {
      n: Number(missed.n ?? 0),
      of: Number(missed.n ?? 0) + Number(completedMeasures.n ?? 0),
    },
    missedByReason: missedByReason.map((r) => ({ reason: String(r.reason), n: Number(r.n) })),
    byRegion: byRegion.map((r) => ({
      label: r.label,
      covered: Number(r.covered),
      // Suppressed at the row, not at the rendering. A count that reaches the
      // component is a count that can reach an export.
      active: cellText(Number(r.active), Number(r.covered)),
      measured: cellText(Number(r.measured), Number(r.covered)),
    })),
    window: "Six months to today",
    refreshedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  };

  // The refusal. `assertAggregate` throws if a person identifier appears
  // anywhere in this shape — it does not strip one out, because a projection
  // that carried a person id and rendered without it would still have carried
  // it into every cache and log on the way.
  return ready(await meta(tenantIds, "population_overview.v1"), assertAggregate(overview));
}

function cellText(n: number, of: number): string {
  // A group SMALLER than the threshold is withheld whole. Reporting "under 11
  // of 2" — which is what the first version produced for a two-person group —
  // suppresses nothing: the reader already knows the count is at most two, and
  // the phrasing implies a larger number than the truth. When the denominator
  // itself is a small cell, the row says so.
  if (of > 0 && of < SMALL_CELL) return `withheld — group of ${of}`;
  if (n > 0 && n < SMALL_CELL) return `under ${SMALL_CELL} of ${of.toLocaleString()}`;
  return `${n.toLocaleString()} of ${of.toLocaleString()}`;
}

function emptyOverview(): PopulationOverview {
  return {
    covered: 0,
    active: { n: 0, of: 0 },
    measuredTwice: { n: 0, of: 0 },
    improved: { n: 0, of: 0 },
    missedMeasures: { n: 0, of: 0 },
    missedByReason: [],
    byRegion: [],
    window: "Six months to today",
    refreshedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  };
}

/**
 * The metric dictionary, computed for a tenant scope.
 *
 * Returned as p48's typed responses rather than as numbers, so a screen reads
 * `numerator`, `denominator`, `missing`, `status` and the four versions rather
 * than dividing anything itself. p48: "the client does not calculate clinical
 * or business metrics from raw records."
 *
 * Suppression is applied HERE, on the way out, because this is the boundary
 * where a result becomes an external aggregate view. The computation returns
 * true values so an internal check can read the answer.
 */
export async function buildMetricPanel(tenantIds: string[]): Promise<MetricResult[]> {
  if (tenantIds.length === 0) return [];
  const rows = await loadObservations(tenantIds);
  const ctx = metricContext(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
  return [
    computeActivation(rows, ALL_ELIGIBLE, ctx),
    computeWeeklyEngagement(rows, ALL_ELIGIBLE, ctx),
    computeFollowupCompletion(rows, ALL_ELIGIBLE, ctx),
    computeObservedChange(rows, ALL_ELIGIBLE, ctx),
    computeResponderRate(rows, ALL_ELIGIBLE, ctx),
    computeSafetyPauseRate(rows, ALL_ELIGIBLE, ctx),
    computeTimeToReview(rows, ALL_ELIGIBLE, ctx),
    computeRetention(rows, ALL_ELIGIBLE, ctx, 30),
    computeRetention(rows, ALL_ELIGIBLE, ctx, 90),
    computeRetention(rows, ALL_ELIGIBLE, ctx, 180),
  ].map(suppressExternal);
}

/** Every organization tenant holding demo-population people. The organization
 *  console reads its OWN; demo administration reads all of them. */
export async function populationTenants(): Promise<string[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT DISTINCT p.tenant_id AS id FROM persons p
       JOIN person_attributes a ON a.person_id = p.id ORDER BY 1`, [],
  )) as { id: string }[];
  return rows.map((r) => r.id);
}
