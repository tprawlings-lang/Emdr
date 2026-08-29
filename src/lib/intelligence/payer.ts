import { data } from "@/lib/data";
import { ready, partial, empty, type Envelope, type ProjectionMeta } from "@/lib/presentation/envelope";
import { CLINICAL_POLICY_VERSION } from "@/lib/clinical-policy";
import { assertAggregate } from "@/lib/intelligence/organization";
import type { Count } from "@/components/charts/aggregate";

// Payer projections (§26's ten payer screens, §29's payer charts p82–p83).
//
// Everything the organization projections enforce applies here — no person
// reaches this layer, every proportion carries its denominator — plus one rule
// that belongs to this role alone and is the reason these screens are the
// riskiest in the product:
//
//   OBSERVED AND MODELLED NEVER MIX. §29.1 requires separate surfaces and
//   labels; p69's contract row says it as a prohibition: "Never label
//   estimated value as observed savings." A payer acts on these numbers with
//   money, and an estimate that has quietly become a fact is the single most
//   expensive error this product could help someone make.
//
// The mechanism that makes it hardest to get wrong is CLAIMS LAG. A claim is
// incurred on one date and arrives weeks later, so the most recent months are
// always incomplete. A per-1,000 trend that counts only what has arrived draws
// utilisation falling at the right-hand edge — every time, for every payer —
// and that fall reads exactly like the programme working. `completeness` below
// is what stops the chart from making that claim.

const PROJECTION_VERSION = "payer-projections-2026-08-a";

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

export interface PayerContract {
  id: string;
  name: string;
  cohortVersion: string;
  periodStart: string;
  periodEnd: string;
  claimsLagDays: number;
}

export async function loadContract(tenantId: string): Promise<PayerContract | null> {
  const c = await data();
  const row = (await c.get(
    `SELECT id, name, cohort_version, period_start, period_end, claims_lag_days
       FROM payer_contracts WHERE tenant_id = ? ORDER BY period_start DESC LIMIT 1`,
    [tenantId],
  )) as {
    id: string; name: string; cohort_version: string;
    period_start: string; period_end: string; claims_lag_days: number;
  } | undefined;
  if (!row) return null;
  return {
    id: row.id, name: row.name, cohortVersion: row.cohort_version,
    periodStart: row.period_start, periodEnd: row.period_end, claimsLagDays: row.claims_lag_days,
  };
}

async function eligible(tenantId: string): Promise<number> {
  const c = await data();
  const row = (await c.get("SELECT COUNT(*) AS n FROM persons WHERE tenant_id = ?", [tenantId])) as
    | { n: number } | undefined;
  return row?.n ?? 0;
}

async function reach(tenantId: string, type: string): Promise<number> {
  const c = await data();
  const row = (await c.get(
    `SELECT COUNT(DISTINCT person_id) AS n FROM longitudinal_events
      WHERE tenant_id = ? AND event_type = ?`,
    [tenantId, type],
  )) as { n: number } | undefined;
  return row?.n ?? 0;
}

async function watermark(tenantId: string): Promise<string | null> {
  const c = await data();
  const row = (await c.get(
    "SELECT MAX(received_at) AS w FROM claims WHERE tenant_id = ?", [tenantId],
  )) as { w: string | null } | undefined;
  return row?.w ?? null;
}

// ---------------------------------------------------------------------------
// payer_header.v2 — the standing three
// ---------------------------------------------------------------------------

export interface PayerHeader {
  engaged: Count;
  followUp: Count;
  /** Observed median lag, and what the contract expects. Both, because "60
   *  days" means nothing without knowing whether that is normal here. */
  observedLagDays: number | null;
  expectedLagDays: number;
  generatedAt: string;
}

export async function buildPayerHeader(tenantId: string): Promise<Envelope<PayerHeader>> {
  const m = meta(tenantId, await watermark(tenantId), "payer_header.v2");
  const contract = await loadContract(tenantId);
  const pop = await eligible(tenantId);
  if (!contract || pop === 0) return empty(m, "No contracted population is loaded for this plan.");

  const started = await reach(tenantId, "care.started");
  const followed = await reach(tenantId, "coverage.session_delivered");

  const c = await data();
  const lag = (await c.get(
    `SELECT julianday(received_at) - julianday(incurred_at) AS d FROM claims
      WHERE tenant_id = ? AND status IN ('accepted','corrected')
      ORDER BY d LIMIT 1 OFFSET (
        SELECT COUNT(*) / 2 FROM claims WHERE tenant_id = ? AND status IN ('accepted','corrected')
      )`,
    [tenantId, tenantId],
  )) as { d: number | null } | undefined;

  return ready(m, assertAggregate<PayerHeader>({
    engaged: { n: started, of: pop },
    // Against those who STARTED, not against everyone eligible. Follow-up is
    // a property of care that began; measuring it against the whole plan makes
    // a good follow-up rate look like a bad one.
    followUp: { n: followed, of: started },
    observedLagDays: lag?.d != null ? Math.round(lag.d) : null,
    expectedLagDays: contract.claimsLagDays,
    generatedAt: m.generatedAt,
  }));
}

// ---------------------------------------------------------------------------
// payer_utilization.v4 — per 1,000, with completeness
// ---------------------------------------------------------------------------

export interface UtilizationMonth {
  month: string;
  edPer1000: number | null;
  inpatientPer1000: number | null;
  /** Share of that month's claims that have actually arrived. Below the
   *  threshold the rates are withheld rather than drawn low. */
  completeness: number;
  complete: boolean;
}

export interface PayerUtilization {
  months: UtilizationMonth[];
  eligible: number;
  expectedLagDays: number;
  /** Months withheld because their claims have not arrived. Named, so the
   *  chart's short right-hand edge is explained rather than noticed. */
  incompleteMonths: string[];
}

/** A month is reportable when most of its claims have arrived. Below this the
 *  rate is not "low", it is unknown — and the difference is the whole point.  */
export const COMPLETENESS_FLOOR = 0.85;

export async function buildPayerUtilization(tenantId: string): Promise<Envelope<PayerUtilization>> {
  const m = meta(tenantId, await watermark(tenantId), "payer_utilization.v4");
  const contract = await loadContract(tenantId);
  const pop = await eligible(tenantId);
  if (!contract || pop === 0) return empty(m, "No contracted population is loaded for this plan.");

  const c = await data();
  const rows = (await c.all(
    `SELECT substr(incurred_at, 1, 7) AS month,
            claim_type,
            COUNT(*) AS total,
            SUM(CASE WHEN status IN ('accepted','corrected') THEN 1 ELSE 0 END) AS arrived
       FROM claims
      WHERE tenant_id = ?
      GROUP BY month, claim_type
      ORDER BY month`,
    [tenantId],
  )) as { month: string; claim_type: string; total: number; arrived: number }[];

  const byMonth = new Map<string, { ed: number; ip: number; total: number; arrived: number }>();
  for (const r of rows) {
    const e = byMonth.get(r.month) ?? { ed: 0, ip: 0, total: 0, arrived: 0 };
    if (r.claim_type === "ed_visit") e.ed = r.arrived;
    if (r.claim_type === "inpatient_admit") e.ip = r.arrived;
    e.total += r.total;
    e.arrived += r.arrived;
    byMonth.set(r.month, e);
  }

  const per1000 = (n: number) => Math.round((n / pop) * 1000 * 100) / 100;
  const months: UtilizationMonth[] = [...byMonth.keys()].sort().slice(-12).map((mo) => {
    const e = byMonth.get(mo)!;
    const completeness = e.total === 0 ? 0 : e.arrived / e.total;
    const complete = completeness >= COMPLETENESS_FLOOR;
    return {
      month: mo,
      // WITHHELD, not zero and not the partial count. A partial month drawn
      // as a value is a fall that reads as an improvement.
      edPer1000: complete ? per1000(e.ed) : null,
      inpatientPer1000: complete ? per1000(e.ip) : null,
      completeness: Math.round(completeness * 100) / 100,
      complete,
    };
  });

  const incompleteMonths = months.filter((x) => !x.complete).map((x) => x.month);
  const payload = assertAggregate<PayerUtilization>({
    months, eligible: pop, expectedLagDays: contract.claimsLagDays, incompleteMonths,
  });

  if (incompleteMonths.length === 0) return ready(m, payload);
  return partial(m, payload, [{
    source: `Claims incurred in the last ${contract.claimsLagDays} days`,
    reason:
      `${incompleteMonths.length} month(s) have too few claims received to report a rate. ` +
      `They are withheld rather than drawn low — a partial month plotted as a value falls, ` +
      `and a fall at the right-hand edge reads as the programme working.`,
  }]);
}

// ---------------------------------------------------------------------------
// cost_model_view.v2 — modelled, and never called observed
// ---------------------------------------------------------------------------

export interface CostScenario {
  scenario: string;
  low: number;
  point: number;
  high: number;
  unit: string;
}

export interface CostModel {
  modelVersion: string;
  status: "draft" | "approved" | "superseded";
  approvedBy: string | null;
  approvedAt: string | null;
  scenarios: CostScenario[];
  assumptions: string[];
  /** Older versions, kept readable so an earlier report can be reproduced. */
  supersededVersions: string[];
}

export async function buildCostModel(tenantId: string): Promise<Envelope<CostModel>> {
  const m = meta(tenantId, await watermark(tenantId), "cost_model_view.v2");
  const c = await data();

  const rows = (await c.all(
    `SELECT model_version, scenario, low, point, high, unit, status, assumptions_json,
            approved_by, approved_at
       FROM cost_model_versions WHERE tenant_id = ? ORDER BY scenario`,
    [tenantId],
  )) as {
    model_version: string; scenario: string; low: number; point: number; high: number;
    unit: string; status: string; assumptions_json: string;
    approved_by: string | null; approved_at: string | null;
  }[];

  if (rows.length === 0) return empty(m, "No cost model has been built for this contract.");

  // Only an APPROVED version is shown as the model. A draft rendered beside an
  // approved one, in the same shape, is how a working estimate leaves the
  // building as a finding.
  const approved = rows.filter((r) => r.status === "approved");
  if (approved.length === 0) {
    return empty(m, "No cost model version has been approved. Draft estimates are not shown here.");
  }

  const version = approved[0].model_version;
  return ready(m, assertAggregate<CostModel>({
    modelVersion: version,
    status: "approved",
    approvedBy: approved[0].approved_by,
    approvedAt: approved[0].approved_at,
    scenarios: approved
      .filter((r) => r.model_version === version)
      .map((r) => ({ scenario: r.scenario, low: r.low, point: r.point, high: r.high, unit: r.unit })),
    assumptions: JSON.parse(approved[0].assumptions_json) as string[],
    supersededVersions: [...new Set(rows.filter((r) => r.status === "superseded").map((r) => r.model_version))],
  }));
}

// ---------------------------------------------------------------------------
// payer_contract.v3 — observed against target
// ---------------------------------------------------------------------------

export interface MeasureResult {
  metric: string;
  label: string;
  target: number;
  unit: string;
  better: "lower" | "higher";
  /** Null when the measure cannot be computed from complete data. A blank is
   *  the honest answer; a number computed from a partial month is not. */
  observed: number | null;
  /** Why it could not be computed, when it could not. */
  withheld?: string;
  met: boolean | null;
}

export interface ContractReport {
  contract: PayerContract;
  measures: MeasureResult[];
}

export async function buildContractReport(tenantId: string): Promise<Envelope<ContractReport>> {
  const m = meta(tenantId, await watermark(tenantId), "payer_contract.v3");
  const contract = await loadContract(tenantId);
  const pop = await eligible(tenantId);
  if (!contract || pop === 0) return empty(m, "No contract is loaded for this plan.");

  const c = await data();
  const defs = (await c.all(
    "SELECT metric, label, target_value, unit, better FROM contract_measures WHERE contract_id = ?",
    [contract.id],
  )) as { metric: string; label: string; target_value: number; unit: string; better: string }[];

  const started = await reach(tenantId, "care.started");
  const followed = await reach(tenantId, "coverage.session_delivered");

  // Utilisation measures use only COMPLETE months, so a contract report never
  // reports a rate flattered by claims that have not arrived.
  const util = await buildPayerUtilization(tenantId);
  const completeMonths =
    util.state === "ready" || util.state === "partial"
      ? (util.data as PayerUtilization).months.filter((x) => x.complete)
      : [];
  const meanOf = (pick: (x: UtilizationMonth) => number | null) => {
    const vs = completeMonths.map(pick).filter((v): v is number => v !== null);
    return vs.length === 0 ? null : Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 100) / 100;
  };

  // Computed before the map: the callback is synchronous, and the alternative
  // is an await inside it.
  const timeToCare = await medianTimeToCare(tenantId);

  const measures: MeasureResult[] = defs.map((d) => {
    let observed: number | null = null;
    let withheld: string | undefined;
    switch (d.metric) {
      case "engaged_rate":
        observed = Math.round((started / Math.max(1, pop)) * 1000) / 10;
        break;
      case "followup_rate":
        observed = Math.round((followed / Math.max(1, started)) * 1000) / 10;
        break;
      case "ed_per_1000":
        observed = meanOf((x) => x.edPer1000);
        if (observed === null) withheld = "No month has enough claims received to report a rate.";
        break;
      case "inpatient_per_1000":
        observed = meanOf((x) => x.inpatientPer1000);
        if (observed === null) withheld = "No month has enough claims received to report a rate.";
        break;
      case "time_to_care_days":
        observed = timeToCare;
        if (observed === null) withheld = "Too few completed pathways to report a median.";
        break;
      default:
        withheld = "This measure is not computed from any source in this deployment.";
    }
    const better = d.better as "lower" | "higher";
    return {
      metric: d.metric, label: d.label, target: d.target_value, unit: d.unit, better,
      observed, withheld,
      met: observed === null ? null : better === "lower" ? observed <= d.target_value : observed >= d.target_value,
    };
  });

  return ready(m, assertAggregate<ContractReport>({ contract, measures }));
}

/** Median days from referral to care start. Median rather than mean: one
 *  person who started a year later moves a mean and tells a reader something
 *  false about the typical wait. */
export async function medianTimeToCare(tenantId: string): Promise<number | null> {
  const c = await data();
  const rows = (await c.all(
    `SELECT CAST(julianday(s.occurred_at) - julianday(r.occurred_at) AS REAL) AS d
       FROM longitudinal_events r
       JOIN longitudinal_events s
         ON s.person_id = r.person_id AND s.event_type = 'care.started'
      WHERE r.event_type = 'referral.received' AND r.tenant_id = ?`,
    [tenantId],
  )) as { d: number | null }[];
  const v = rows.map((r) => r.d).filter((d): d is number => d !== null && d >= 0).sort((a, b) => a - b);
  if (v.length < 11) return null;
  return Math.round(v[Math.floor(v.length / 2)] * 10) / 10;
}

// ---------------------------------------------------------------------------
// payer_pathway.v3 — eligibility to active use
// ---------------------------------------------------------------------------

export interface PayerPathway {
  stages: { label: string; count: Count; attention?: boolean }[];
  outcomes: { label: string; n: number; tone: "safe" | "info" | "caution" | "unknown" }[];
  outcomeTotal: number;
  medianTimeToCareDays: number | null;
}

export async function buildPayerPathway(tenantId: string): Promise<Envelope<PayerPathway>> {
  const m = meta(tenantId, await watermark(tenantId), "payer_pathway.v3");
  const pop = await eligible(tenantId);
  if (pop === 0) return empty(m, "No contracted population is loaded for this plan.");

  const referred = await reach(tenantId, "referral.received");
  const contacted = await reach(tenantId, "contact.made");
  const started = await reach(tenantId, "care.started");

  const counts = [
    { label: "Eligible", n: pop },
    { label: "Referred", n: referred },
    { label: "Contacted", n: contacted },
    { label: "Started care", n: started },
  ];
  let worst = 1;
  let worstDrop = -1;
  for (let i = 1; i < counts.length; i++) {
    const d = counts[i - 1].n - counts[i].n;
    if (d > worstDrop) { worstDrop = d; worst = i; }
  }

  const classified = await reach(tenantId, "outcome.classified");
  return ready(m, assertAggregate<PayerPathway>({
    // Every stage against ELIGIBLE, the contract's own denominator. Staging
    // each against the step before it flatters the pipeline.
    stages: counts.map((x, i) => ({ label: x.label, count: { n: x.n, of: pop }, attention: i === worst })),
    outcomes: [
      { label: "Outcome recorded", n: classified, tone: "safe" },
      { label: "No outcome recorded", n: Math.max(0, started - classified), tone: "unknown" },
    ],
    outcomeTotal: started,
    medianTimeToCareDays: await medianTimeToCare(tenantId),
  }));
}

// ---------------------------------------------------------------------------
// payer_data_quality.v3 — the feed, judged
// ---------------------------------------------------------------------------

export interface DataQuality {
  total: number;
  byStatus: { status: string; n: number; of: number }[];
  observedLagDays: number | null;
  expectedLagDays: number;
  incompleteMonths: string[];
  cohortVersion: string;
}

export async function buildDataQuality(tenantId: string): Promise<Envelope<DataQuality>> {
  const m = meta(tenantId, await watermark(tenantId), "payer_data_quality.v3");
  const contract = await loadContract(tenantId);
  if (!contract) return empty(m, "No contract is loaded for this plan.");

  const c = await data();
  const rows = (await c.all(
    "SELECT status, COUNT(*) AS n FROM claims WHERE tenant_id = ? GROUP BY status",
    [tenantId],
  )) as { status: string; n: number }[];
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (total === 0) return empty(m, "No claims have been received for this contract.");

  const header = await buildPayerHeader(tenantId);
  const util = await buildPayerUtilization(tenantId);

  return ready(m, assertAggregate<DataQuality>({
    total,
    byStatus: rows.map((r) => ({ status: r.status, n: r.n, of: total })),
    observedLagDays: header.state === "ready" ? (header.data as PayerHeader).observedLagDays : null,
    expectedLagDays: contract.claimsLagDays,
    incompleteMonths:
      util.state === "ready" || util.state === "partial"
        ? (util.data as PayerUtilization).incompleteMonths
        : [],
    cohortVersion: contract.cohortVersion,
  }));
}
