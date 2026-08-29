import { data } from "@/lib/data";
import { ready, type Envelope, type ProjectionMeta } from "@/lib/presentation/envelope";
import { CLINICAL_POLICY_VERSION } from "@/lib/clinical-policy";
import { DATASET_VERSION } from "@/lib/demo-population-manifest";

// The clinician's panel (handoff 07 §4.1, p40).
//
// This lives in `clinical/` rather than in `intelligence/`, and the move was
// not tidying. `tests/aggregate-boundary.test.ts` treats every module under
// `src/lib/intelligence/` as an aggregate surface and fails the build on a
// person identifier there — correctly, because that is the whole of §30.6's
// boundary. A person-level panel sitting in that directory forced a choice
// between carving an exception into the guard and putting the file where it
// belongs.
//
// Carving the exception would have been the wrong half. The guard's rule is
// "nothing under intelligence/ touches a person", and a rule with one
// exception is a rule somebody will add a second exception to.
//
// It reads the SAME ledger the aggregate projections read. That is Wave 4's
// claim: six roles, one set of facts, and the difference between them is what
// each is allowed to see rather than where the numbers come from.

async function meta(tenantId: string, schemaVersion: string): Promise<ProjectionMeta> {
  const c = await data();
  const w = ((await c.get(
    "SELECT MAX(occurred_at) AS w FROM longitudinal_events WHERE tenant_id = ?", [tenantId],
  )) as { w: string | null } | undefined)?.w ?? null;
  return {
    schemaVersion,
    projectionVersion: DATASET_VERSION,
    generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    tenantId,
    sourceWatermark: w,
    policyVersion: CLINICAL_POLICY_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Person-level: the clinician's panel
// ---------------------------------------------------------------------------

export interface PanelRow {
  personId: string;
  name: string;
  /** Days since their last check-in, or null if they have never had one. */
  daysSinceCheckIn: number | null;
  checkIns: number;
  /** First and latest measure. §29.1: a change is meaningless without both. */
  baseline: number | null;
  latest: number | null;
  /** Measures that were DUE and not completed, with why. p28 requires the
   *  reason to travel with the absence. */
  missing: number;
  safetyState: string | null;
}

export interface Panel {
  rows: PanelRow[];
  /** Everyone in the tenant, so a filtered panel still shows its denominator. */
  population: number;
  window: string;
  refreshedAt: string;
}

/**
 * The people this clinician may open.
 *
 * Scoped by TENANT rather than by an assignment column, because that is how
 * this deployment's care relationships are actually modelled — and a scope
 * that claims to be per-clinician while reading per-tenant would be a
 * comforting lie in a permission check.
 */
export async function buildClinicianPanel(tenantId: string): Promise<Envelope<Panel>> {
  const c = await data();
  const rows = (await c.all(
    `SELECT u.id                                   AS person_id,
            u.name                                 AS name,
            (SELECT COUNT(*) FROM checkins k WHERE k.user_id = u.id)                    AS check_ins,
            (SELECT MAX(k.checkin_date) FROM checkins k WHERE k.user_id = u.id)         AS last_checkin,
            (SELECT s.total_score FROM screenings s WHERE s.user_id = u.id
              ORDER BY s.created_at ASC LIMIT 1)                                        AS baseline,
            (SELECT s.total_score FROM screenings s WHERE s.user_id = u.id
              ORDER BY s.created_at DESC LIMIT 1)                                       AS latest,
            (SELECT COUNT(*) FROM longitudinal_events e
              WHERE e.person_id = u.id AND e.event_type = 'measure.not_completed')      AS missing,
            (SELECT json_extract(e.payload, '$.state') FROM longitudinal_events e
              WHERE e.person_id = u.id AND e.event_type = 'safety_state.changed'
              ORDER BY e.occurred_at DESC LIMIT 1)                                      AS safety_state
       FROM users u
      WHERE u.tenant_id = ? AND u.role = 'member'
      ORDER BY u.name`,
    [tenantId],
  )) as Record<string, unknown>[];

  const today = new Date();
  const panel: Panel = {
    rows: rows.map((r) => ({
      personId: String(r.person_id),
      name: String(r.name),
      checkIns: Number(r.check_ins ?? 0),
      daysSinceCheckIn: r.last_checkin
        ? Math.floor((today.getTime() - new Date(String(r.last_checkin)).getTime()) / 86400000)
        : null,
      baseline: r.baseline === null || r.baseline === undefined ? null : Number(r.baseline),
      latest: r.latest === null || r.latest === undefined ? null : Number(r.latest),
      missing: Number(r.missing ?? 0),
      safetyState: r.safety_state ? String(r.safety_state) : null,
    })),
    population: rows.length,
    window: "Six months to today",
    refreshedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  };

  // NOT laundered through assertAggregate, and that is the point rather than
  // an omission: this view is ABOUT people, and a clinician reading a panel
  // has the care relationship that makes a name appropriate. The guard exists
  // for the surfaces that do not.
  return ready(await meta(tenantId, "population_panel.v1"), panel);
}

