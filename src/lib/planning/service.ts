import { data } from "@/lib/data";
import { getDb } from "@/lib/db";
import { runQualityChecks, qualitySummary } from "@/lib/demo-quality";
import { audit } from "@/lib/audit";
import { ulidFrom } from "@/lib/ids";
import { DATASET_VERSION } from "@/lib/demo-population-manifest";
import {
  ALL_ELIGIBLE, cohort, cohortHash, regionCohorts, type CohortDefinition,
} from "@/lib/metrics/cohorts";
import {
  computeActivation, computeFollowupCompletion, computeObservedChange,
  resolve, type ComputeContext, type MetricResult, type Observation,
} from "@/lib/metrics/compute";
import {
  loadCapacity, loadObservations, loadReviewLoad, metricContext,
  type CapacityReading, type ReviewLoadReading, type Window,
} from "@/lib/metrics/population-metrics";
import type { Role } from "@/lib/roles";
import {
  actionPermitted, isBlockedAction, transition,
  type ReviewAction, type SignalState,
} from "./lifecycle";
import { demoNow, readClock } from "@/lib/demo-clock";
import { loadThresholds, type RuleId } from "./policy";
import { evaluateAll, type RuleContext, type WindowReading } from "./rules";
import { explain, type Explanation } from "./explanations";
import {
  buildSignal, cohortIsProtected, routingFor, signalId,
  type PlanningSignal, type ReviewRecord,
} from "./signal";

// The planning engine's database side (handoff 07 §3.4–3.5, §5.2 p47).
//
// Everything that decides anything lives in `rules.ts`, `lifecycle.ts` and
// `ladder.ts`, and all three are pure. This module reads rows, calls them, and
// writes rows. The split is the same one `metrics/compute.ts` and
// `metrics/population-metrics.ts` already make, for the same reason: a rule
// that runs its own SQL can only be checked against that SQL.
//
// There is no person identifier anywhere below. The subject of every query is
// a cohort; the only individual named is the REVIEWER on a transition, which
// is an accountability record rather than a subject. `tests/planning.test.ts`
// fails the build if that changes.

/** p34 needs "two windows", so the demo's 180 days are cut in half. Ninety
 *  days is long enough that a cohort of forty has a denominator, and short
 *  enough that two of them are two readings rather than one smeared out. */
export const WINDOW_DAYS = 90;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The two windows, oldest first, ending at the DEMO clock's today.
 *
 * `now` is a parameter with a default rather than a read, so the pure callers
 * — the tests, and anything reasoning about a hypothetical date — stay
 * synchronous. `planningWindows()` below is what the service uses, and it is
 * the one that reads the clock.
 */
export function windows(now = new Date()): Window[] {
  const day = 86400000;
  const end2 = now;
  const start2 = new Date(now.getTime() - WINDOW_DAYS * day);
  const start1 = new Date(now.getTime() - 2 * WINDOW_DAYS * day);
  return [
    { start: iso(start1), end: iso(new Date(start2.getTime() - day)) },
    { start: iso(start2), end: iso(end2) },
  ];
}

const label = (w: Window) => `${w.start}..${w.end}`;

/** The windows the engine actually reports on, against the demo clock. When a
 *  presenter moves the clock to a milestone, every window boundary, every
 *  metric refresh time and every signal moves with it. */
export async function planningWindows(): Promise<Window[]> {
  return windows(await demoNow());
}

/** Proportion of due follow-up measures that were not completed, for a cohort
 *  in a window. p34's "missingness high" condition, as a number. */
function missingnessOf(r: MetricResult): number {
  if (r.denominator === 0) return 1;
  return (r.denominator - r.numerator) / r.denominator;
}

/** The cohorts a signal may be raised about. Region cohorts plus the three the
 *  registry declares for language and age — every one of them carries a stated
 *  question, because p33 requires the reason for comparing groups to exist
 *  before the comparison does. */
export function plannedCohorts(): CohortDefinition[] {
  return [
    ...regionCohorts(),
    cohort("south_age_55_64.v1"),
    cohort("spanish_preferred.v1"),
    cohort("mandarin_preferred.v1"),
  ];
}

interface Reading {
  window: Window;
  rows: Observation[];
}

/**
 * Missingness OF THE METRIC BEING READ, not of follow-up completion.
 *
 * Every reading used to report follow-up missingness whatever metric it
 * carried, which meant ACCESS_GAP — a comparison of stage conversion — was
 * gated on how many follow-up measures were outstanding. Those are different
 * questions, and the wrong one was binding: at 30.5% against a 30% limit the
 * access comparison was refused for incompleteness in a metric it does not
 * read.
 *
 * What "missing" means depends on the metric, so it is computed per metric:
 *
 *   ACTIVATION is a cohort-entry metric derived from events the ledger either
 *   holds or does not. Nobody's activation is unknown. What IS unobservable is
 *   somebody whose seven days have not elapsed, so that exclusion — which the
 *   metric already reports — is its missingness.
 *
 *   FOLLOW-UP COMPLETION is a missingness measure in its own right: the share
 *   of due measures not completed.
 *
 *   PAIRED CHANGE is unobservable for anybody without both measures.
 */
function missingnessFor(r: MetricResult): number {
  const excluded = Object.entries(r.missing)
    .filter(([k]) => k.startsWith("excluded_") || k === "unpaired")
    .reduce((s, [, v]) => s + Number(v), 0);
  if (excluded > 0) {
    const total = r.denominator + excluded;
    return total === 0 ? 1 : excluded / total;
  }
  return missingnessOf(r);
}

async function readingFor(
  c: CohortDefinition, ref: CohortDefinition, r: Reading, runId: string,
  compute: (rows: Observation[], c: CohortDefinition, ctx: ComputeContext) => MetricResult,
): Promise<WindowReading> {
  const ctx = await metricContext(runId, r.window);
  const cohortResult = compute(r.rows, c, ctx);
  const referenceResult = compute(r.rows, ref, ctx);
  return {
    label: label(r.window),
    cohort: cohortResult,
    reference: referenceResult,
    missingness: missingnessFor(cohortResult),
  };
}

/**
 * The data-quality reading, from the manifest that already exists.
 *
 * p29's checks and p34's DATA_QUALITY rule are the same judgement about the
 * same environment, so this reads the manifest rather than recomputing it. A
 * planning screen that said "released" while the admin page said "blocked"
 * would be two answers to one question.
 */
async function dataQualityReading(tenantIds: string[]) {
  // p29's manifest, computed by the module that owns it. Not re-queried here,
  // for two reasons. It is the same judgement about the same environment, and
  // two implementations of it would eventually disagree — a planning screen
  // reporting "released" while the admin page reports "blocked" is worse than
  // either answer alone. And those queries name a person: they count events
  // whose person no longer exists, and events filed under a different tenant
  // from their person. `tests/planning.test.ts` fails the build on a person
  // identifier anywhere under this directory, and the right response to that
  // guard is to move the query rather than to carve an exception into a rule
  // whose whole value is that it has none.
  const checks = runQualityChecks(getDb());
  const summary = qualitySummary(checks);
  const failedNamed = (name: string) =>
    checks.some((c) => c.check === name && !c.pass);

  // Drift is measured on FOLLOW-UP COMPLETION, not on activation. Activation
  // is a cohort-entry metric and this population all entered in one month, so
  // the second window has no entrants and no rate — a difference of "a number"
  // from "no number" is not drift, and the first version of this reported 86.7
  // points of it on a population that had not moved at all.
  const [w1, w2] = await planningWindows();
  const f1 = computeFollowupCompletion(await loadObservations(tenantIds, w1), ALL_ELIGIBLE, await metricContext("q1", w1));
  const f2 = computeFollowupCompletion(await loadObservations(tenantIds, w2), ALL_ELIGIBLE, await metricContext("q2", w2));
  const drift = f1.value === null || f2.value === null ? 0 : (f2.value - f1.value) * 100;

  const all = await loadObservations(tenantIds);
  const followup = computeFollowupCompletion(all, ALL_ELIGIBLE, await metricContext("quality"));

  return {
    missingness: missingnessOf(followup),
    // p29 expects zero for both, and both mean the same thing: a row does not
    // rebuild into the place its own events say it belongs.
    projectionMismatches:
      (failedNamed("Orphan events") ? 1 : 0) + (failedNamed("Cross-tenant references") ? 1 : 0),
    driftPp: drift,
    checksFailed: summary.failed,
    checksTotal: checks.length,
  };
}

/**
 * Build the rule context for one cohort.
 *
 * Four of p34's seven rules can be evaluated from what this deployment holds.
 * Three cannot, and the context says so with a null rather than with a
 * plausible substitute:
 *
 *   REGION_CAPACITY has no open-slot feed. The organization capacity screen
 *   already renders in the partial state for this reason and names the missing
 *   source above the chart; a planning rule that invented the denominator
 *   would undo that.
 *
 *   SAFETY_REVIEW_LOAD has no staffed coverage schedule. The events are
 *   counted and the capacity they would be measured against does not exist as
 *   data.
 *
 *   MODULE_SIGNAL needs a confidence interval, and observed change reports an
 *   observed range — which `computeObservedChange` says in its own comment,
 *   because calling a range an interval estimate promotes the finding a rung
 *   on p36's ladder.
 *
 * Each of those is one of p34's own "no output when" conditions, so the rules
 * withhold rather than fail. Three silent rules with a stated reason is a
 * truer demonstration of the engine than seven firing on invented inputs.
 */
/** The single region a cohort is defined by, or null when it spans several.
 *  A regional rule about a cross-regional cohort is a category error. */
function soleRegion(c: CohortDefinition): string | null {
  const r = c.filters.region;
  return r && r.length === 1 ? r[0] : null;
}

function capacityFor(c: CohortDefinition, readings: CapacityReading[]): CapacityReading | null {
  const region = soleRegion(c);
  return region === null ? null : readings.find((x) => x.region === region) ?? null;
}

function reviewLoadFor(c: CohortDefinition, readings: ReviewLoadReading[]): ReviewLoadReading | null {
  const region = soleRegion(c);
  return region === null ? null : readings.find((x) => x.region === region) ?? null;
}

interface OperationalReadings {
  capacity: CapacityReading[];
  reviewLoad: ReviewLoadReading[];
}

async function contextFor(
  c: CohortDefinition, readings: Reading[], runId: string,
  quality: Awaited<ReturnType<typeof dataQualityReading>>,
  ops: OperationalReadings,
): Promise<RuleContext> {
  const ref = ALL_ELIGIBLE;
  const access = await Promise.all(readings.map((r) => readingFor(c, ref, r, runId, computeActivation)));
  const followup = await Promise.all(readings.map((r) => readingFor(c, ref, r, runId, computeFollowupCompletion)));
  const change = await Promise.all(readings.map((r) => readingFor(c, ref, r, runId, computeObservedChange)));

  // The fairness reading uses the most recent window's follow-up completion —
  // p34 permits outcome, access or error-rate disparity, and follow-up
  // completion is the access measure this population actually varies on.
  const last = readings[readings.length - 1];
  const lastCtx = await metricContext(runId, last.window);
  const group = resolve(last.rows, c);
  const groupFollowup = computeFollowupCompletion(last.rows, c, lastCtx);
  const refFollowup = computeFollowupCompletion(last.rows, ref, lastCtx);
  const recorded = group.filter((r) => {
    if (c.filters.language?.length) return r.language !== null;
    if (c.filters.race?.length) return r.race.length > 0;
    if (c.filters.ethnicity?.length) return r.ethnicity !== null;
    if (c.filters.accessNeed?.length) return r.accessNeeds.length > 0;
    // A region or age cohort is not a protected-attribute cohort; the
    // completeness question is about the attribute that defines the group, and
    // there is none to be incomplete.
    return true;
  }).length;

  return {
    cohortId: c.id,
    cohortHash: cohortHash(c),
    referenceId: ref.id,
    access,
    followup,
    change,
    // FAIRNESS_ALERT is evaluated only for cohorts DEFINED BY A PROTECTED
    // ATTRIBUTE. A region or an age band is a reporting dimension, and raising
    // a fairness alert on one would put "the Midwest" in the same sentence as
    // p34's protected-group completeness condition, which is a category error
    // in both directions: it dilutes the alert and it implies the region is a
    // protected class. The rule withholds with that reason rather than being
    // skipped, so the screen can say why.
    fairness: !cohortIsProtected(c) || groupFollowup.value === null || refFollowup.value === null ? null : {
      measure: "follow-up completion",
      disparityPp: (groupFollowup.value - refFollowup.value) * 100,
      completeness: group.length === 0 ? 0 : recorded / group.length,
      groupSize: group.length,
    },
    // The operational feeds, matched to this cohort's region. A cohort that is
    // not defined by a region has no regional capacity to speak of, and the
    // rules withhold on the null rather than being handed the network total —
    // which would report the whole network's backlog as a finding about forty
    // Spanish-speaking members.
    capacity: capacityFor(c, ops.capacity),
    reviewLoad: reviewLoadFor(c, ops.reviewLoad),
    dataQuality: quality,
    followupDueLogicDiffers: false,
    exposureDefinitionChanged: false,
    // `computeObservedChange` now reports a 95% interval on the mean paired
    // difference alongside the observed range, so p34's condition is
    // evaluable. Below thirty pairs it reports none, and MODULE_SIGNAL says so
    // rather than guessing.
    changeIntervalIsConfidence: true,
  };
}

export interface DetectionResult {
  signals: PlanningSignal[];
  /** Rules that produced nothing, and p34's reason. Reported rather than
   *  dropped: "no signal" and "the rule was withheld because the cell is
   *  suppressed" look identical on a screen that only lists what fired. */
  withheld: { ruleId: RuleId; cohortId: string; reason: string }[];
  /** True when DATA_QUALITY fired. p34's output for it is "Block planning
   *  release", so nothing else was evaluated. */
  releaseBlocked: boolean;
}

/**
 * Evaluate every rule over every planned cohort, and persist what fired.
 *
 * The insert is `ON CONFLICT DO NOTHING`, and that is the freeze: a signal's
 * evidence is what it was when the signal was raised. Re-running detection
 * against a moved window does not rewrite a row a reviewer has already read
 * and acted on — a later reading that disagrees is a new signal under a new
 * dataset version, which is also why the id is derived from the dataset rather
 * than from the clock.
 */
export async function detectSignals(
  dataTenantIds: string[], storeTenantId: string, role: Role = "reviewer",
): Promise<DetectionResult> {
  const tenantIds = dataTenantIds;
  if (tenantIds.length === 0) return { signals: [], withheld: [], releaseBlocked: false };
  const t = await loadThresholds();
  const wins = await planningWindows();
  const readings: Reading[] = [];
  for (const w of wins) readings.push({ window: w, rows: await loadObservations(tenantIds, w) });
  const quality = await dataQualityReading(tenantIds);
  const recent = wins[wins.length - 1];
  const ops: OperationalReadings = {
    capacity: await loadCapacity(tenantIds, recent),
    reviewLoad: await loadReviewLoad(tenantIds, recent),
  };

  // THE CLOCK's now, not the real one. `detected_at` sits beside the window on
  // every signal, and a signal whose window ends in March and whose detection
  // is stamped September reads as a stale finding nobody refreshed. It is part
  // of the reading, not part of the record: the audit entry saying a human ran
  // detection is written by `audit()` and stays on real time.
  const clock = await readClock();
  const detectedAt = clock.now.toISOString().slice(0, 19) + "Z";
  // Null when the clock is live. It becomes part of every signal's id, so a
  // milestone walk produces its own set rather than colliding with the live
  // one and freezing whichever ran first.
  const readingPoint = clock.live ? null : clock.milestone?.id ?? clock.now.toISOString().slice(0, 10);
  const signals: PlanningSignal[] = [];
  const withheld: DetectionResult["withheld"] = [];
  let releaseBlocked = false;

  for (const c of plannedCohorts()) {
    const ctx = await contextFor(c, readings, `${c.id}`, quality, ops);
    const outcomes = evaluateAll(ctx, t);
    for (const o of outcomes) {
      if (o.withheld) {
        withheld.push({ ruleId: o.ruleId, cohortId: c.id, reason: o.withheld });
        continue;
      }
      if (!o.fired) continue;
      if (o.ruleId === "DATA_QUALITY") releaseBlocked = true;
      signals.push(buildSignal({
        outcome: o,
        cohort: c,
        cohortHash: ctx.cohortHash,
        referenceId: ctx.referenceId,
        tenantId: storeTenantId,
        dataVersion: DATASET_VERSION,
        detectedAt,
        readingPoint,
        role,
      }));
    }
    // DATA_QUALITY blocks the whole release, so there is nothing to learn from
    // the remaining cohorts.
    if (releaseBlocked) break;
  }

  await persistSignals(storeTenantId, signals);
  return { signals, withheld, releaseBlocked };
}

async function persistSignals(tenantId: string, signals: PlanningSignal[]): Promise<void> {
  if (signals.length === 0) return;
  const c = await data();
  for (const s of signals) {
    await c.run(
      `INSERT INTO planning_signals
         (id, tenant_id, signal_type, state, rule_version, evidence_level, statement,
          cohort_ref, cohort_hash, reference_ref, threshold_json, observed_json,
          metric_refs_json, limitations_json, detected_at, data_version, reading_point)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        s.signal_id, tenantId, s.signal_type, s.rule_version, s.evidence_level, s.statement,
        s.cohort_ref, s.cohort_hash, s.reference_ref,
        JSON.stringify(s.threshold), JSON.stringify(s.observed),
        JSON.stringify(s.metric_refs), JSON.stringify(s.limitations),
        s.detected_at, s.data_version, s.reading_point,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface SignalRow {
  id: string; signal_type: string; state: string; rule_version: string;
  evidence_level: number; statement: string; cohort_ref: string; cohort_hash: string;
  reference_ref: string; threshold_json: string; observed_json: string;
  metric_refs_json: string; limitations_json: string; clinical_review_json: string | null;
  fairness_review_json: string | null; detected_at: string; data_version: string;
  reading_point: string | null;
}

function hydrate(row: SignalRow, role: Role): PlanningSignal {
  const ruleId = row.signal_type as RuleId;
  let c: CohortDefinition | null = null;
  try { c = cohort(row.cohort_ref); } catch { c = null; }
  const routing = c
    ? routingFor(ruleId, c)
    // A cohort that has left the registry cannot be re-read, so the signal is
    // routed as if both review gates applied. Erring the other way would let a
    // signal skip a review because its definition was deleted.
    : { affectsProgramContent: true, protectedGroupImpact: true };
  const state = row.state as SignalState;
  const parse = <T,>(s: string, fallback: T): T => {
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  const built = buildSignal({
    outcome: {
      ruleId, fired: true, withheld: null, statement: row.statement, output: "",
      observed: parse(row.observed_json, {}),
      threshold: parse(row.threshold_json, {}),
      metricRefs: parse<string[]>(row.metric_refs_json, []),
      limitations: parse<string[]>(row.limitations_json, []),
    },
    cohort: c ?? { id: row.cohort_ref, version: "unknown", label: row.cohort_ref, question: "", eligibility: {}, filters: {} },
    cohortHash: row.cohort_hash,
    referenceId: row.reference_ref,
    tenantId: "",
    dataVersion: row.data_version,
    detectedAt: row.detected_at,
    readingPoint: row.reading_point,
    state,
    clinicalReview: row.clinical_review_json ? (JSON.parse(row.clinical_review_json) as ReviewRecord) : null,
    fairnessReview: row.fairness_review_json ? (JSON.parse(row.fairness_review_json) as ReviewRecord) : null,
    role,
    // Passed explicitly rather than left to be re-derived. When the cohort has
    // left the registry the stub above has no filters, so a derived routing
    // would report no protected-group impact — and the object a screen reads
    // would offer an advance straight past fairness review because the
    // definition was deleted. The transition itself is guarded separately, in
    // `recordReview`, which resolves the cohort again and defaults the same
    // way; this keeps the two consistent.
    routing,
  });
  // The stored id wins. `buildSignal` derives one from the rule, cohort and
  // dataset, and a signal whose cohort has since been re-versioned would
  // otherwise be handed back under an id nothing links to.
  return { ...built, signal_id: row.id, audit_ref: `audit://${row.id}` };
}

export async function listSignals(tenantIds: string[], role: Role): Promise<PlanningSignal[]> {
  if (tenantIds.length === 0) return [];
  const c = await data();
  const marks = tenantIds.map(() => "?").join(",");
  const rows = (await c.all(
    `SELECT * FROM planning_signals WHERE tenant_id IN (${marks})
      ORDER BY detected_at DESC, id ASC`,
    tenantIds,
  )) as unknown as SignalRow[];
  return rows.map((r) => hydrate(r, role));
}

export async function getSignal(id: string, tenantIds: string[], role: Role): Promise<PlanningSignal | null> {
  if (tenantIds.length === 0) return null;
  const c = await data();
  const marks = tenantIds.map(() => "?").join(",");
  const row = (await c.get(
    `SELECT * FROM planning_signals WHERE id = ? AND tenant_id IN (${marks})`,
    [id, ...tenantIds],
  )) as unknown as SignalRow | undefined;
  return row ? hydrate(row, role) : null;
}

export interface TransitionRow {
  id: string; fromState: string; toState: string; action: string;
  actorRole: string; comment: string | null; limits: string | null; createdAt: string;
}

export async function signalHistory(id: string, tenantIds: string[]): Promise<TransitionRow[]> {
  if (tenantIds.length === 0) return [];
  const c = await data();
  const marks = tenantIds.map(() => "?").join(",");
  const rows = (await c.all(
    `SELECT id, from_state, to_state, action, actor_role, comment, limits, created_at
       FROM planning_signal_reviews
      WHERE signal_id = ? AND tenant_id IN (${marks})
      ORDER BY created_at ASC, id ASC`,
    [id, ...tenantIds],
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    fromState: String(r.from_state),
    toState: String(r.to_state),
    action: String(r.action),
    actorRole: String(r.actor_role),
    comment: r.comment === null ? null : String(r.comment),
    limits: r.limits === null ? null : String(r.limits),
    createdAt: String(r.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type ReviewRefusal =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "blocked"; detail: string }
  | { ok: false; reason: "not_allowed"; detail: string };

export type ReviewOutcome = { ok: true; from: SignalState; to: SignalState } | ReviewRefusal;

/**
 * Record a state change (p47's POST /api/planning/signals/:id/review).
 *
 * The action is re-checked against `allowedActions` here, on the server, with
 * the signal's own state and the caller's own role — p49's rule is that the
 * client never invents or widens the action set, and the only way to mean that
 * is to not trust the set the client was given.
 *
 * A BLOCKED action is refused separately and audited separately. "You may not
 * do that here yet" and "this system does not route people" are different
 * answers, and an attempt at the second is a security event rather than a
 * validation error.
 */
export async function recordReview(args: {
  signalId: string;
  tenantIds: string[];
  actorId: string;
  role: Role;
  action: string;
  comment?: string | null;
  limits?: string | null;
}): Promise<ReviewOutcome> {
  const signal = await getSignal(args.signalId, args.tenantIds, args.role);
  if (!signal) return { ok: false, reason: "not_found" };

  if (isBlockedAction(args.action)) {
    await audit({
      actorId: args.actorId, actorRole: args.role, family: "security",
      type: "planning_blocked_action", target: args.signalId,
      detail: { action: args.action, state: signal.state },
    });
    return {
      ok: false, reason: "blocked",
      detail: `"${args.action}" is a blocked action: this subsystem does not route people, change gates or deny access.`,
    };
  }

  const c = cohort_or_null(signal.cohort_ref);
  const routing = c
    ? routingFor(signal.signal_type, c)
    : { affectsProgramContent: true, protectedGroupImpact: true };
  const from = signal.state;
  if (!actionPermitted(from, args.role, routing, args.action)) {
    await audit({
      actorId: args.actorId, actorRole: args.role, family: "security",
      type: "planning_action_refused", target: args.signalId,
      detail: { action: args.action, state: from, allowed: signal.allowed_actions },
    });
    return {
      ok: false, reason: "not_allowed",
      detail: `"${args.action}" is not an exit from ${from} for this role.`,
    };
  }

  const to = transition(from, args.action as ReviewAction, routing);
  if (to === null) {
    return { ok: false, reason: "not_allowed", detail: `"${args.action}" leads nowhere from ${from}.` };
  }

  const conn = await data();
  const tenantId = args.tenantIds[0];
  await conn.run(
    `INSERT INTO planning_signal_reviews
       (id, signal_id, tenant_id, from_state, to_state, action, actor_id, actor_role, comment, limits)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ulidFrom(Date.now(), `planning_review:${args.signalId}:${args.action}:${Date.now()}`),
      args.signalId, tenantId, from, to, args.action, args.actorId, args.role,
      args.comment ?? null, args.limits ?? null,
    ],
  );

  // The review record on the signal, so p49's `clinical_review` and
  // `fairness_review` fields say who signed rather than staying null forever.
  const record: ReviewRecord = {
    // REAL time. When a named person signed a review is a fact about the
    // world, and the demo clock does not get to move it — a review dated to
    // whenever somebody set the clock is not a review anybody can rely on.
    by: args.actorId, role: args.role, at: new Date().toISOString(),
    comment: args.comment ?? null, limits: args.limits ?? null,
  };
  const column = from === "clinical_review" ? "clinical_review_json"
    : from === "fairness_review" ? "fairness_review_json" : null;

  if (column) {
    await conn.run(
      `UPDATE planning_signals SET state = ?, ${column} = ? WHERE id = ?`,
      [to, JSON.stringify(record), args.signalId],
    );
  } else {
    await conn.run("UPDATE planning_signals SET state = ? WHERE id = ?", [to, args.signalId]);
  }

  await audit({
    actorId: args.actorId, actorRole: args.role, family: "security",
    type: "planning_signal_state_changed", target: args.signalId,
    detail: { action: args.action, from, to, comment: args.comment ?? null, limits: args.limits ?? null },
  });

  return { ok: true, from, to };
}

function cohort_or_null(id: string): CohortDefinition | null {
  try { return cohort(id); } catch { return null; }
}

/**
 * p44's "Alternative explanations", computed against the live population.
 *
 * Recomputed at read time rather than frozen with the signal, and that is the
 * one place this subsystem deliberately does not freeze. The signal's own
 * numbers are its evidence and must not move under a reviewer; the alternatives
 * are the reviewer's own analysis, and running it against a stale snapshot
 * would answer a question about last month.
 */
export async function signalExplanations(
  signal: PlanningSignal, dataTenantIds: string[],
): Promise<Explanation[]> {
  const c = cohort_or_null(signal.cohort_ref);
  if (!c) return [];
  const t = await loadThresholds();
  const w = (await planningWindows())[1];
  const rows = await loadObservations(dataTenantIds, w);
  const ctx = await metricContext(`explain-${signal.signal_id}`, w);
  return explain({
    cohort: c,
    reference: ALL_ELIGIBLE,
    rows,
    ctx,
    minDenominator: t.get("analysis.min_denominator"),
    minGroup: t.get("analysis.min_group_size"),
  });
}

/** p47's GET /api/planning/signals/:id/lineage — "return definitions and
 *  evidence", at minimum-necessary output. The definitions and the numbers
 *  behind the signal, and nothing about anybody. */
export async function signalLineage(id: string, tenantIds: string[], role: Role) {
  const s = await getSignal(id, tenantIds, role);
  if (!s) return null;
  const c = cohort_or_null(s.cohort_ref);
  return {
    signal_id: s.signal_id,
    required_phrase: s.required_phrase,
    rule_version: s.rule_version,
    evidence_level: s.evidence_level,
    cohort: c ? {
      id: c.id, version: c.version, label: c.label, question: c.question,
      eligibility: c.eligibility, filters: c.filters, hash: s.cohort_hash,
    } : { id: s.cohort_ref, hash: s.cohort_hash, note: "this cohort is no longer in the registry" },
    reference_cohort: s.reference_ref,
    threshold: s.threshold,
    observed: s.observed,
    metric_refs: s.metric_refs,
    limitations: s.limitations,
    data_version: s.data_version,
    detected_at: s.detected_at,
    history: await signalHistory(id, tenantIds),
  };
}

/** Deterministic id, re-exported so a screen can link to a signal it has not
 *  loaded yet. */
export { signalId };
