import { data } from "@/lib/data";
import {
  ready, partial, empty, type Envelope, type ProjectionMeta,
} from "@/lib/presentation/envelope";
import { CLINICAL_POLICY_VERSION } from "@/lib/clinical-policy";
import type { Count } from "@/components/charts/aggregate";

// Organization projections (§26's nine screens, §30.3's projection services).
//
// Every figure on every organization screen is COUNTED HERE from the event
// ledger. Nothing is stored pre-aggregated and nothing is assembled in the
// browser — §30.1's read path, and the reason a reviewer asking "where does
// 3,555 come from?" gets an answer instead of a shrug.
//
// TWO STRUCTURAL RULES, both enforced rather than documented.
//
// 1. NO PERSON REACHES THIS LAYER. Not a person id, not a display name, not a
//    row that could be joined back to one. §30.6: aggregate access does not
//    create person-level care access. Every query below aggregates inside SQL
//    and returns counts; `assertAggregate` refuses a projection carrying
//    anything that looks like an identifier, and tests/aggregate-boundary
//    fails the build on a query that selects person_id without grouping it
//    away. The covered population has no names in the database either, so this
//    is belt and braces on purpose.
//
// 2. EVERY PROPORTION CARRIES ITS DENOMINATOR. §29.1's first rule. The `Count`
//    type makes a bare percentage unrepresentable, so the rule holds by
//    construction rather than by review.

const PROJECTION_VERSION = "org-projections-2026-08-a";

/** Cohort scope: the organization tenant and every facility under it. A
 *  location is a child tenant, so "the network" is a subtree rather than a
 *  column, and a query that forgets the children silently reports zero. */
async function scopeIds(orgTenantId: string): Promise<string[]> {
  const c = await data();
  const kids = (await c.all(
    "SELECT id FROM tenants WHERE parent_tenant_id = ?", [orgTenantId],
  )) as { id: string }[];
  return [orgTenantId, ...kids.map((k) => k.id)];
}

function meta(tenantId: string, watermark: string | null, schemaVersion: string): ProjectionMeta {
  return {
    schemaVersion,
    projectionVersion: PROJECTION_VERSION,
    generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    tenantId,
    sourceWatermark: watermark,
    policyVersion: CLINICAL_POLICY_VERSION,
  };
}

/** Refuses a projection that carries anything person-shaped.
 *
 *  A cheap check for an expensive mistake: the failure mode it guards is a
 *  well-meaning `SELECT person_id` added to make a chart clickable, which
 *  turns an aggregate surface into a care surface without anyone deciding to.
 */
export function assertAggregate<T>(value: T): T {
  const banned = /(^|_)(person_?id|user_?id|display_?name|email|mrn)($|_)/i;
  const walk = (v: unknown, path: string): void => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (banned.test(k)) {
        throw new Error(
          `aggregate projection carries "${k}" at ${path} — an organization ` +
          `surface reports on a population, never on a person`,
        );
      }
      walk(val, `${path}.${k}`);
    }
  };
  walk(value, "$");
  return value;
}

async function watermark(ids: string[]): Promise<string | null> {
  const c = await data();
  const row = (await c.get(
    `SELECT MAX(occurred_at) AS w FROM longitudinal_events WHERE tenant_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  )) as { w: string | null } | undefined;
  return row?.w ?? null;
}

/** How many DISTINCT people in scope have at least one event of this type.
 *  Distinct, because a funnel counting events rather than people reports more
 *  contacts than there are humans the moment anyone is called twice. */
async function reach(ids: string[], type: string, sinceDays?: number): Promise<number> {
  const c = await data();
  const params: unknown[] = [...ids, type];
  let sql =
    `SELECT COUNT(DISTINCT person_id) AS n FROM longitudinal_events
      WHERE tenant_id IN (${ids.map(() => "?").join(",")}) AND event_type = ?`;
  if (sinceDays !== undefined) {
    sql += ` AND occurred_at >= datetime('now', ?)`;
    params.push(`-${sinceDays} days`);
  }
  const row = (await c.get(sql, params)) as { n: number } | undefined;
  return row?.n ?? 0;
}

async function population(ids: string[]): Promise<number> {
  const c = await data();
  const row = (await c.get(
    `SELECT COUNT(*) AS n FROM persons WHERE tenant_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  )) as { n: number } | undefined;
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// The access pathway — shared by the overview, the pipeline and locations
// ---------------------------------------------------------------------------

export interface FunnelStage { label: string; count: Count; attention?: boolean }

const PATHWAY: { type: string; label: string }[] = [
  { type: "referral.received", label: "Referred" },
  { type: "contact.attempted", label: "Contact attempted" },
  { type: "contact.made", label: "Contacted" },
  { type: "visit.scheduled", label: "Scheduled" },
  { type: "care.started", label: "Care started" },
];

/** The funnel, each stage against the SAME denominator (referrals). Staging
 *  each against the step before it flatters the pipeline: four 80% steps read
 *  as healthy and end at 41% of the people who were referred. */
async function pathway(ids: string[]): Promise<FunnelStage[]> {
  const counts: number[] = [];
  for (const s of PATHWAY) counts.push(await reach(ids, s.type));
  const referred = counts[0] || 1;

  // The largest single drop, named rather than left to be spotted.
  let worst = 1;
  let worstDrop = -1;
  for (let i = 1; i < counts.length; i++) {
    const d = counts[i - 1] - counts[i];
    if (d > worstDrop) { worstDrop = d; worst = i; }
  }

  return PATHWAY.map((s, i) => ({
    label: s.label,
    count: { n: counts[i], of: referred },
    attention: i === worst,
  }));
}

// ---------------------------------------------------------------------------
// org_overview.v6 — the operating picture
// ---------------------------------------------------------------------------

export interface OrgOverview {
  organization: string;
  population: number;
  firstContactDays: number | null;
  engaged: Count;
  measureCoverage: Count;
  funnel: FunnelStage[];
  /** What moved, computed. Null when nothing did — an empty "what changed" is
   *  more honest than a sentence manufactured to fill the space. */
  changed: string | null;
}

export async function buildOrgOverview(orgTenantId: string): Promise<Envelope<OrgOverview>> {
  const ids = await scopeIds(orgTenantId);
  const m = meta(orgTenantId, await watermark(ids), "org_overview.v6");

  const pop = await population(ids);
  if (pop === 0) {
    return empty(m, "No covered population is enrolled for this organization.");
  }

  const c = await data();
  const org = (await c.get("SELECT name FROM tenants WHERE id = ?", [orgTenantId])) as
    | { name: string } | undefined;

  const funnel = await pathway(ids);
  const started = funnel[funnel.length - 1].count.n;
  const measured = await reach(ids, "coverage.measure_recorded");

  // Median days from referral to first successful contact, per person. Median
  // rather than mean: one person contacted after a year moves a mean and tells
  // a reader something false about the typical wait.
  const gaps = (await c.all(
    `SELECT CAST(julianday(mad.occurred_at) - julianday(ref.occurred_at) AS REAL) AS d
       FROM longitudinal_events ref
       JOIN longitudinal_events mad
         ON mad.person_id = ref.person_id AND mad.event_type = 'contact.made'
      WHERE ref.event_type = 'referral.received'
        AND ref.tenant_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  )) as { d: number | null }[];
  const days = gaps.map((g) => g.d).filter((d): d is number => d !== null && d >= 0).sort((a, b) => a - b);
  const firstContactDays = days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : null;

  // The one location whose contact rate is furthest below the network's.
  const perLoc = await byLocation(ids, "contact.made");
  const netRate = funnel[2].count.n / Math.max(1, funnel[0].count.n);
  let changed: string | null = null;
  let gapPts = 0;
  for (const l of perLoc) {
    const rate = l.count.n / Math.max(1, l.count.of);
    const d = (netRate - rate) * 100;
    if (d > gapPts) { gapPts = d; changed = `${l.label} contact rate is ${Math.round(d)} points below the network.`; }
  }
  if (gapPts < 2) changed = null;

  return ready(m, assertAggregate<OrgOverview>({
    organization: org?.name ?? "This organization",
    population: pop,
    firstContactDays,
    engaged: { n: started, of: pop },
    // Against people who STARTED CARE, not against covered lives. Coverage of
    // the whole covered population reads as 40% and sounds like a measurement
    // failure; it is mostly the funnel, since half the population never
    // reached care and was never going to be measured. Denominators chosen to
    // flatter are a familiar sin, but a denominator chosen carelessly can
    // condemn just as wrongly, and this screen is read by people who allocate
    // budget on it.
    measureCoverage: { n: measured, of: started },
    funnel,
    changed,
  }));
}

// ---------------------------------------------------------------------------
// Per-location reach, used by several screens
// ---------------------------------------------------------------------------

export interface LocationCount { label: string; count: Count }

async function byLocation(ids: string[], type: string): Promise<LocationCount[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT t.name AS label,
            COUNT(DISTINCT p.id) AS denom,
            COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN p.id END) AS n
       FROM persons p
       JOIN tenants t ON t.id = p.tenant_id
       LEFT JOIN longitudinal_events e
              ON e.person_id = p.id AND e.event_type = ?
      WHERE p.tenant_id IN (${ids.map(() => "?").join(",")})
      GROUP BY t.name
      ORDER BY t.name`,
    [type, ...ids],
  )) as { label: string; denom: number; n: number }[];
  return rows.map((r) => ({ label: r.label, count: { n: r.n, of: r.denom } }));
}

// ---------------------------------------------------------------------------
// org_access.v4 — the pipeline
// ---------------------------------------------------------------------------

export interface OrgAccess {
  funnel: FunnelStage[];
  byLocation: LocationCount[];
  /** Median days referral → contact, by month. A null is a month with no
   *  completed contacts and is drawn as a gap, not bridged. */
  waitTrend: { x: string; y: number | null }[];
}

export async function buildOrgAccess(orgTenantId: string): Promise<Envelope<OrgAccess>> {
  const ids = await scopeIds(orgTenantId);
  const m = meta(orgTenantId, await watermark(ids), "org_access.v4");
  if ((await population(ids)) === 0) {
    return empty(m, "No covered population is enrolled for this organization.");
  }

  const c = await data();
  const rows = (await c.all(
    `SELECT substr(ref.occurred_at, 1, 7) AS month,
            CAST(julianday(mad.occurred_at) - julianday(ref.occurred_at) AS REAL) AS d
       FROM longitudinal_events ref
       JOIN longitudinal_events mad
         ON mad.person_id = ref.person_id AND mad.event_type = 'contact.made'
      WHERE ref.event_type = 'referral.received'
        AND ref.tenant_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  )) as { month: string; d: number | null }[];

  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    if (r.d === null || r.d < 0) continue;
    if (!buckets.has(r.month)) buckets.set(r.month, []);
    buckets.get(r.month)!.push(r.d);
  }
  const months = [...buckets.keys()].sort().slice(-6);
  const waitTrend = months.map((mo) => {
    const v = buckets.get(mo)!.sort((a, b) => a - b);
    // A month below the suppression threshold reports no value rather than a
    // median computed from four people.
    if (v.length < 11) return { x: mo.slice(5), y: null };
    return { x: mo.slice(5), y: Math.round(v[Math.floor(v.length / 2)] * 10) / 10 };
  });

  return ready(m, assertAggregate<OrgAccess>({
    funnel: await pathway(ids),
    byLocation: await byLocation(ids, "contact.made"),
    waitTrend,
  }));
}

// ---------------------------------------------------------------------------
// org_capacity.v4 — deliberately partial
// ---------------------------------------------------------------------------

export interface OrgCapacity {
  demand: { label: string; value: number }[];
}

/**
 * Demand is observable; supply is not.
 *
 * Referrals awaiting a first visit can be counted from the ledger. Open
 * first-visit SLOTS cannot: there is no scheduling model in this deployment,
 * no calendar and no slot record. §30.8's `partial` is exactly this case —
 * "show present values and list missing sources; do not calculate a clean
 * total from incomplete inputs" — so the screen shows demand and names what is
 * missing, rather than drawing an empty bar beside it that reads as zero
 * capacity.
 */
export async function buildOrgCapacity(orgTenantId: string): Promise<Envelope<OrgCapacity>> {
  const ids = await scopeIds(orgTenantId);
  const m = meta(orgTenantId, await watermark(ids), "org_capacity.v4");

  const c = await data();
  const rows = (await c.all(
    `SELECT t.name AS label, COUNT(DISTINCT sched.person_id) AS n
       FROM longitudinal_events sched
       JOIN persons p ON p.id = sched.person_id
       JOIN tenants t ON t.id = p.tenant_id
      WHERE sched.event_type = 'visit.scheduled'
        AND sched.tenant_id IN (${ids.map(() => "?").join(",")})
        AND NOT EXISTS (
          SELECT 1 FROM longitudinal_events started
           WHERE started.person_id = sched.person_id AND started.event_type = 'care.started'
        )
      GROUP BY t.name ORDER BY t.name`,
    ids,
  )) as { label: string; n: number }[];

  if (rows.length === 0) return empty(m, "No scheduled visits are awaiting a care start.");

  return partial(
    m,
    assertAggregate<OrgCapacity>({ demand: rows.map((r) => ({ label: r.label, value: r.n })) }),
    [{
      source: "Scheduling system — open first-visit slots",
      reason:
        "No calendar, slot or clinician-availability record exists in this deployment, so " +
        "supply cannot be counted. Demand is shown alone; the ratio this screen exists to " +
        "give is not computed from half of it.",
    }],
  );
}

// ---------------------------------------------------------------------------
// org_outcomes.v5 — with missing follow-up inside the denominator
// ---------------------------------------------------------------------------

export interface OrgOutcomes {
  total: number;
  slices: { label: string; n: number; tone: "safe" | "info" | "caution" | "unknown" }[];
}

export async function buildOrgOutcomes(orgTenantId: string): Promise<Envelope<OrgOutcomes>> {
  const ids = await scopeIds(orgTenantId);
  const m = meta(orgTenantId, await watermark(ids), "org_outcomes.v5");

  const started = await reach(ids, "care.started");
  if (started === 0) return empty(m, "Nobody in this organization has started care yet.");

  const c = await data();
  const rows = (await c.all(
    `SELECT json_extract(e.payload, '$.status') AS status, COUNT(DISTINCT e.person_id) AS n
       FROM longitudinal_events e
      WHERE e.event_type = 'outcome.classified'
        AND e.tenant_id IN (${ids.map(() => "?").join(",")})
      GROUP BY status`,
    ids,
  )) as { status: string | null; n: number }[];

  const get = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  const improved = get("improved");
  const stable = get("stable");
  const worsened = get("worsened");
  // Missing is what is LEFT, against the people who started care. It is a
  // slice of the same bar rather than a footnote, because a footnote is what
  // gets dropped when the chart is pasted into a board pack.
  const missing = Math.max(0, started - (improved + stable + worsened));

  return ready(m, assertAggregate<OrgOutcomes>({
    total: started,
    slices: [
      { label: "Improved", n: improved, tone: "safe" },
      { label: "Stable", n: stable, tone: "info" },
      { label: "Worsened", n: worsened, tone: "caution" },
      { label: "Missing follow-up", n: missing, tone: "unknown" },
    ],
  }));
}

// ---------------------------------------------------------------------------
// org_care_delivery.v3
// ---------------------------------------------------------------------------

export interface OrgCareDelivery {
  started: number;
  sessions: number;
  reviewed: Count;
  measured: Count;
}

export async function buildOrgCareDelivery(orgTenantId: string): Promise<Envelope<OrgCareDelivery>> {
  const ids = await scopeIds(orgTenantId);
  const m = meta(orgTenantId, await watermark(ids), "org_care_delivery.v3");

  const started = await reach(ids, "care.started");
  if (started === 0) return empty(m, "Nobody in this organization has started care yet.");

  const c = await data();
  const row = (await c.get(
    `SELECT COUNT(*) AS n FROM longitudinal_events
      WHERE event_type = 'coverage.session_delivered' AND tenant_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  )) as { n: number } | undefined;

  return ready(m, assertAggregate<OrgCareDelivery>({
    started,
    sessions: row?.n ?? 0,
    reviewed: { n: await reach(ids, "coverage.reviewed"), of: started },
    measured: { n: await reach(ids, "coverage.measure_recorded"), of: started },
  }));
}

// ---------------------------------------------------------------------------
// org_safety_ops.v4 — volume and response, never a risk score
// ---------------------------------------------------------------------------

export interface OrgSafetyOps {
  triggered: number;
  responded: Count;
  /** Gate volume by month. Counts of a FIXED rule firing — §29.1 forbids
   *  turning this into a predictive score, and nothing here is one. */
  byMonth: { x: string; y: number | null }[];
}

export async function buildOrgSafetyOps(orgTenantId: string): Promise<Envelope<OrgSafetyOps>> {
  const ids = await scopeIds(orgTenantId);
  const m = meta(orgTenantId, await watermark(ids), "org_safety_ops.v4");

  const triggered = await reach(ids, "coverage.gate_recorded");
  if (triggered === 0) return empty(m, "No safety gate has fired for this organization.");

  const c = await data();
  const rows = (await c.all(
    `SELECT substr(occurred_at, 1, 7) AS month, COUNT(*) AS n
       FROM longitudinal_events
      WHERE event_type = 'coverage.gate_recorded' AND tenant_id IN (${ids.map(() => "?").join(",")})
      GROUP BY month ORDER BY month`,
    ids,
  )) as { month: string; n: number }[];

  const last = rows.slice(-6);
  return ready(m, assertAggregate<OrgSafetyOps>({
    triggered,
    responded: { n: await reach(ids, "coverage.gate_responded"), of: triggered },
    byMonth: last.map((r) => ({ x: r.month.slice(5), y: r.n < 11 ? null : r.n })),
  }));
}

// ---------------------------------------------------------------------------
// org_locations.v4
// ---------------------------------------------------------------------------

export interface OrgLocations {
  rows: {
    label: string;
    population: number;
    contacted: Count;
    started: Count;
    medianWaitDays: number | null;
  }[];
}

export async function buildOrgLocations(orgTenantId: string): Promise<Envelope<OrgLocations>> {
  const ids = await scopeIds(orgTenantId);
  const m = meta(orgTenantId, await watermark(ids), "org_locations.v4");
  if ((await population(ids)) === 0) {
    return empty(m, "No covered population is enrolled for this organization.");
  }

  const c = await data();
  const contacted = await byLocation(ids, "contact.made");
  const started = await byLocation(ids, "care.started");

  const waits = (await c.all(
    `SELECT t.name AS label,
            CAST(julianday(mad.occurred_at) - julianday(ref.occurred_at) AS REAL) AS d
       FROM longitudinal_events ref
       JOIN longitudinal_events mad
         ON mad.person_id = ref.person_id AND mad.event_type = 'contact.made'
       JOIN persons p ON p.id = ref.person_id
       JOIN tenants t ON t.id = p.tenant_id
      WHERE ref.event_type = 'referral.received'
        AND ref.tenant_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  )) as { label: string; d: number | null }[];

  const byLabel = new Map<string, number[]>();
  for (const w of waits) {
    if (w.d === null || w.d < 0) continue;
    if (!byLabel.has(w.label)) byLabel.set(w.label, []);
    byLabel.get(w.label)!.push(w.d);
  }

  return ready(m, assertAggregate<OrgLocations>({
    rows: contacted.map((row) => {
      const v = (byLabel.get(row.label) ?? []).sort((a, b) => a - b);
      return {
        label: row.label,
        population: row.count.of,
        contacted: row.count,
        started: started.find((s) => s.label === row.label)?.count ?? { n: 0, of: row.count.of },
        medianWaitDays: v.length >= 11 ? Math.round(v[Math.floor(v.length / 2)] * 10) / 10 : null,
      };
    }),
  }));
}
