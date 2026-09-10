// Personalized Recovery Trajectory (expansion handoff 04).
//
// The longitudinal chart already answers "what did these numbers do". This
// answers the question a clinician actually asks in front of it: HAS THE COURSE
// CHANGED, and on what evidence — separately, per domain, in each domain's own
// units, with the disagreements left in.
//
// FOUR THINGS THIS IS NOT, and each of them is a real temptation the handoff
// names:
//
//   IT IS NOT A RECOVERY SCORE. §1: "do not replace that chart with one
//   composite recovery score. Add a domain-analysis layer above it." There is
//   no arithmetic anywhere in this file that combines two domains, and §4's
//   "a patient can improve in one domain and worsen in another. Preserve the
//   disagreement" is why — a single number would have to pick a winner between
//   sleeping better and going out less, and no such exchange rate exists.
//
//   IT IS NOT A PREDICTION. Nothing here says what will happen. Every state is
//   a statement about observations that have already been recorded, which is
//   what makes it checkable: a clinician can open the evidence and disagree.
//   §13: "no predictive risk or treatment-outcome claim is introduced."
//
//   IT IS NOT A CAUSAL CLAIM. §4: "do not infer causation from co-occurring
//   thread/intervention data." Concurrent context is displayed as context and
//   never joined to a state by a sentence containing "because".
//
//   IT IS NOT A COMPARISON TO ANYONE ELSE. §7: "the first version should
//   compare the person to their own prior course, not to a population norm."
//   Every window in this file is that person's own.
//
// AND THE RULE THAT MAKES THE REST REPRODUCIBLE: §13's "trajectory state is
// reproducible from evidence, cutoff, and policy version." The cutoff is an
// argument, never a clock read inside; the thresholds live in
// trajectory-policy.ts; and a snapshot stores both, so a state read in March
// can be recomputed in September and either match or be shown to have been
// computed under different rules.

import crypto from "node:crypto";

import { repo, type TenantContext } from "../repository";
import { ulid } from "../ids";
import { appendEventSafe } from "../events";
import { memberTimeline } from "./timeline";
import { buildTrajectory } from "./trajectory";
import { listGoals, observationsFor } from "./return-to-life";
import { LEVEL_LABEL } from "./return-to-life-vocabulary";
import { REVIEW_STATES, type TrajectoryReviewState } from "./trajectory-vocabulary";
import {
  TRAJECTORY_POLICY, DOMAIN_META, stateLabelFor,
  policyFor,
  type TrajectoryPolicy, type DomainType, type TrajectoryState, type Better,
} from "./trajectory-policy";

export {
  TRAJECTORY_POLICY, DOMAIN_META, STATE_LABEL, TRAJECTORY_STATES, STATE_NOTE,
  DOMAIN_TYPES, policyFor, betterFor, measurePolicy, stateLabelFor, stateNoteFor,
} from "./trajectory-policy";
export type {
  TrajectoryPolicy, DomainType, TrajectoryState, DomainPolicy, Better,
} from "./trajectory-policy";

export const TRAJECTORY_ENGINE_VERSION = TRAJECTORY_POLICY.version;

export class TrajectoryError extends Error {}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export interface TrajectoryPoint {
  /** ISO instant or "YYYY-MM-DD HH:MM:SS" — whatever the source recorded. */
  at: string;
  value: number;
  evidenceType: string;
  evidenceId: string;
  /** ADR 0010: reconstructed history is never presented as original evidence.
   *  It still plots — hiding it would make a sparse record look complete — but
   *  it is counted separately and named in the limitations. */
  reconstructed: boolean;
}

export interface DomainSeries {
  domainType: DomainType;
  /** What distinguishes this series inside its domain type: a goal id, an
   *  instrument id, or the domain's own name when there is only one. */
  domainKey: string;
  label: string;
  /** The scale, printed. A lane without its units invites the reader to compare
   *  it with the lane above. */
  unit: string;
  better: Better;
  points: TrajectoryPoint[];
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export interface WindowStat {
  from: string;
  to: string;
  n: number;
  /** The median, never a mean. One catastrophic day should not move the centre
   *  of a fortnight, and on a self-report scale it would. */
  median: number | null;
  /** Interquartile range — how much the readings disagree with each other. A
   *  window whose middle is 4 because it alternates 1 and 8 is not the same
   *  window as one that reads 4 every day, and a centre alone cannot tell them
   *  apart. */
  iqr: number | null;
  min: number | null;
  max: number | null;
  spanDays: number;
  evidenceIds: string[];
  reconstructedCount: number;
}

const DAY_MS = 86_400_000;

function ms(at: string): number {
  const t = Date.parse(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t : NaN;
}

function iso(t: number): string {
  return new Date(t).toISOString();
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function iqr(values: number[]): number | null {
  if (values.length < 4) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return q(0.75) - q(0.25);
}

/** The observations that fall inside a half-open window `[from, to)`. */
export function windowStat(points: TrajectoryPoint[], fromMs: number, toMs: number): WindowStat {
  const inside = points
    .filter((p) => {
      const t = ms(p.at);
      return Number.isFinite(t) && t >= fromMs && t < toMs;
    })
    .sort((a, b) => ms(a.at) - ms(b.at));
  const values = inside.map((p) => p.value);
  const first = inside[0] ? ms(inside[0].at) : NaN;
  const last = inside[inside.length - 1] ? ms(inside[inside.length - 1].at) : NaN;
  return {
    from: iso(fromMs),
    to: iso(toMs),
    n: inside.length,
    median: median(values),
    iqr: iqr(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    spanDays: inside.length > 1 ? Math.round((last - first) / DAY_MS) : 0,
    evidenceIds: inside.map((p) => p.evidenceId),
    reconstructedCount: inside.filter((p) => p.reconstructed).length,
  };
}

/** Movement expressed as improvement, in the domain's own units.
 *
 *  Positive is always better, whichever way the scale runs. This is the ONLY
 *  place the scale's direction is applied, so a domain where lower is better
 *  cannot be read backwards by some later branch that forgot. */
export function improvement(from: number, to: number, better: Better): number {
  if (better === "none") return 0;
  return better === "higher" ? to - from : from - to;
}

// ---------------------------------------------------------------------------
// The state machine (§6)
// ---------------------------------------------------------------------------

export interface Classification {
  state: TrajectoryState;
  current: WindowStat;
  comparison: WindowStat | null;
  prior: WindowStat | null;
  /** Signed toward improvement. Null when the domain has no direction. */
  improvementDelta: number | null;
  /** The same figure for the window before, so "slowing" can be a comparison of
   *  two rates rather than an impression. */
  priorImprovementDelta: number | null;
  /** How many observations in the current window individually sit worse than
   *  the previous window's centre by more than noise. §4: "require persistence
   *  for slowing/stalled/reversing. One bad day remains one observation." */
  adverseCount: number;
  explanation: string[];
  limitations: string[];
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Classify one series against its policy, as of a cutoff.
 *
 * PURE. No clock, no database, no I/O — the cutoff and the policy are both
 * arguments, which is what makes §13's "reproducible from evidence, cutoff, and
 * policy version" checkable rather than aspirational, and what lets the state
 * machine be tested against constructed series rather than against a seeded
 * database.
 *
 * THE ORDER OF THE BRANCHES IS A CLINICAL DECISION, not an implementation
 * detail. `slowing` is tested before `improving` because a window that is still
 * favourable but markedly less so than the one before it is more usefully read
 * as a change in trajectory than as good news — §3 calls it "a trajectory
 * change, not a failure", and the explanation says outright when the current
 * window is still moving the right way.
 */
export function classify(
  series: DomainSeries,
  args: { asOf: string; policy?: TrajectoryPolicy }
): Classification {
  const policy = args.policy ?? TRAJECTORY_POLICY;
  const spec = policyFor(series.domainType, series.domainKey, policy);
  const asOfMs = ms(args.asOf);
  const explanation: string[] = [];
  const limitations: string[] = [];

  // An instrument Steady has no calibrated threshold for gets no verdict. A
  // generic default would produce a confident state on a scale nobody has
  // decided a meaningful change for, and it would look exactly like a state
  // that was calibrated.
  if (!spec) {
    const empty = windowStat([], asOfMs, asOfMs);
    return {
      state: "insufficient_data",
      current: empty, comparison: null, prior: null,
      improvementDelta: null, priorImprovementDelta: null, adverseCount: 0,
      explanation: [
        `Steady has no registered meaningful-change threshold for ${series.label}, so it does not compute a trajectory state for it.`,
      ],
      limitations: [
        "The readings still plot on the longitudinal chart. What is missing is a calibrated threshold, not the data.",
      ],
    };
  }

  const w = spec.windowDays * DAY_MS;
  const current = windowStat(series.points, asOfMs - w, asOfMs + 1);
  const comparison = windowStat(series.points, asOfMs - 2 * w, asOfMs - w);
  const priorRaw = windowStat(series.points, asOfMs - 3 * w, asOfMs - 2 * w);
  const prior = priorRaw.n > 0 ? priorRaw : null;

  if (current.reconstructedCount > 0) {
    limitations.push(
      `${current.reconstructedCount} of the ${current.n} recent readings were reconstructed after the fact rather than observed at the time.`
    );
  }

  const insufficient = (why: string): Classification => ({
    state: "insufficient_data",
    current, comparison: comparison.n > 0 ? comparison : null, prior,
    improvementDelta: null, priorImprovementDelta: null, adverseCount: 0,
    explanation: [why],
    limitations,
  });

  if (current.n < spec.minObservations) {
    return insufficient(
      `${current.n} observation${current.n === 1 ? "" : "s"} in the last ${spec.windowDays} days; ${spec.minObservations} are needed before ${series.label.toLowerCase()} is compared with anything.`
    );
  }
  if (current.spanDays < spec.minSpanDays) {
    return insufficient(
      `The recent readings span ${current.spanDays} day${current.spanDays === 1 ? "" : "s"}. ${spec.minSpanDays} are needed — several readings close together are one reading taken more than once.`
    );
  }

  // Engagement, and any other domain with no direction of improvement. §2:
  // "descriptive context only; not adherence or prediction." There is no
  // favourable direction to move in, so there is no favourable state to reach:
  // the movement is reported as counts and the state stays neutral.
  if (series.better === "none") {
    explanation.push(
      `${current.n} in the last ${spec.windowDays} days, against ${comparison.n} in the ${spec.windowDays} days before.`
    );
    explanation.push(
      "This is context for reading the other domains. It is not adherence, and a change in it is not a change in recovery."
    );
    return {
      state: "stable",
      current, comparison: comparison.n > 0 ? comparison : null, prior,
      improvementDelta: null, priorImprovementDelta: null, adverseCount: 0,
      explanation, limitations,
    };
  }

  if (comparison.n < spec.minObservations || comparison.median === null) {
    limitations.push(
      `The ${spec.windowDays} days before this window hold ${comparison.n} observation${comparison.n === 1 ? "" : "s"}.`
    );
    return insufficient(
      `There is a recent picture but nothing comparable to set it against — ${comparison.n} observation${comparison.n === 1 ? "" : "s"} in the previous ${spec.windowDays} days.`
    );
  }

  const currentMedian = current.median!;
  const improvementDelta = improvement(comparison.median, currentMedian, series.better);
  const priorImprovementDelta =
    prior && prior.n >= spec.minObservations && prior.median !== null
      ? improvement(prior.median, comparison.median, series.better)
      : null;

  // Persistence, counted on individual observations rather than on the centre.
  // A window whose median moved because one reading was extreme has one adverse
  // observation, and §4 will not let one observation name a state.
  const adverseCount = series.points.filter((p) => {
    const t = ms(p.at);
    if (!Number.isFinite(t) || t < asOfMs - w || t > asOfMs) return false;
    return improvement(comparison.median!, p.value, series.better) <= -spec.noiseDelta;
  }).length;

  explanation.push(
    `Recent middle reading ${fmt(currentMedian)} ${series.unit ? `(${series.unit})` : ""}`.trim() +
    `, against ${fmt(comparison.median)} in the ${spec.windowDays} days before — ` +
    `${improvementDelta >= 0 ? "a favourable move of" : "a move against of"} ${fmt(Math.abs(improvementDelta))} on this scale.`
  );
  if (current.iqr !== null && current.iqr > spec.meaningfulDelta) {
    explanation.push(
      `The recent readings disagree with each other by ${fmt(current.iqr)} across the middle half, which is more than this domain's meaningful change. Read the middle figure with that in mind.`
    );
  }
  if (prior === null) {
    limitations.push(
      "There is no third window, so Steady cannot say which way this was moving before the comparison window.",
    );
  }

  const pick = (state: TrajectoryState, line: string): Classification => {
    explanation.push(line);
    return {
      state, current, comparison, prior,
      improvementDelta, priorImprovementDelta, adverseCount,
      explanation, limitations,
    };
  };

  // Reversing. §3: "requires more than one adverse point unless policy says
  // otherwise", which is `persistence`. The prior direction is reported rather
  // than required: a course that was already moving this way and continues to
  // is still moving the wrong way, and dropping it because it is a
  // continuation rather than a turn would file the worse case under nothing.
  if (improvementDelta <= -spec.meaningfulDelta && adverseCount >= spec.persistence) {
    const priorLine =
      priorImprovementDelta === null
        ? "What it was doing before that is not established."
        : priorImprovementDelta >= spec.noiseDelta
          ? "The window before this one was moving favourably, so this is a turn rather than a continuation."
          : priorImprovementDelta <= -spec.noiseDelta
            ? "The window before this one was already moving this way; this continues it."
            : "The window before this one was flat.";
    return pick(
      "reversing",
      `${adverseCount} of the ${current.n} recent readings individually sit worse than the previous window's middle. ${priorLine}`
    );
  }

  // Slowing. Three windows, and the reduction in rate must itself clear the
  // meaningful threshold — otherwise every improving course that improves
  // slightly less than last month becomes a finding.
  if (
    priorImprovementDelta !== null &&
    priorImprovementDelta >= spec.meaningfulDelta &&
    priorImprovementDelta - improvementDelta >= spec.meaningfulDelta &&
    improvementDelta > -spec.meaningfulDelta
  ) {
    const still =
      improvementDelta >= spec.noiseDelta
        ? " It is still moving favourably, by less."
        : improvementDelta <= -spec.noiseDelta
          ? " It has now moved slightly against."
          : " It is now flat.";
    return pick(
      "slowing",
      `The previous window gained ${fmt(priorImprovementDelta)} and this one ${fmt(improvementDelta)}.${still}`
    );
  }

  if (improvementDelta >= spec.meaningfulDelta) {
    return pick(
      "improving",
      `That clears this domain's meaningful-change threshold of ${fmt(spec.meaningfulDelta)}.`
    );
  }

  // Stalled. §3: "requires adequate observation density" — three populated
  // windows, all of them flat, and the whole review span inside a narrow band.
  // Without the density requirement a person who checked in twice a quarter
  // would be reported as stalled on the strength of having been quiet.
  if (
    prior !== null &&
    prior.n >= spec.minObservations &&
    priorImprovementDelta !== null &&
    Math.abs(improvementDelta) < spec.noiseDelta &&
    Math.abs(priorImprovementDelta) < spec.noiseDelta
  ) {
    const lows = [current.min, comparison.min, prior.min].filter((v): v is number => v !== null);
    const highs = [current.max, comparison.max, prior.max].filter((v): v is number => v !== null);
    const spread = Math.max(...highs) - Math.min(...lows);
    if (spread <= spec.narrowBand) {
      return pick(
        "stalled",
        `Across all ${spec.windowDays * 3} days the readings stayed between ${fmt(Math.min(...lows))} and ${fmt(Math.max(...highs))}, on ${current.n + comparison.n + prior.n} observations.`
      );
    }
  }

  return pick(
    "stable",
    `That is inside this domain's noise threshold of ${fmt(spec.noiseDelta)}. Holding steady is a state in its own right.`
  );
}

// ---------------------------------------------------------------------------
// Domain adapters (§12 Phase 1)
// ---------------------------------------------------------------------------
//
// Each reaches through a subsystem's own reader and turns what it finds into a
// series on its own scale. None of them converts, normalises, or rescales
// anything: §12's definition of done for this phase is "no combined score,
// native scales preserved", and the way to keep that promise is for there to be
// no arithmetic here at all.

interface PostSessionRow {
  id: string; delayed_risk: number; created_at: string;
}

/** Return-to-Life goals, one series per goal (§2's function domain).
 *
 *  ONE SERIES PER GOAL, never an average across goals. §2: "goal-specific
 *  movement; no averaging unrelated goals into one clinical score by default."
 *  Getting back to work and getting back to a friend's kitchen table are both
 *  function and they are not one number. */
async function functionSeries(
  ctx: TenantContext, personId: string, cutoff: string
): Promise<DomainSeries[]> {
  const goals = await listGoals(ctx, personId, ["active", "paused", "completed"]);
  const out: DomainSeries[] = [];
  for (const goal of goals) {
    const observations = await observationsFor(ctx, goal.id);
    const points = observations
      // ACCEPTED ONLY. §7 of handoff 01 keeps a proposed observation out of the
      // level, and a trajectory computed from proposals would be a trajectory
      // of what a model suggested rather than of what a clinician accepted.
      .filter((o) => o.status === "accepted" && o.observedLevel !== null && o.occurredAt <= cutoff)
      .map((o): TrajectoryPoint => ({
        at: o.occurredAt,
        value: o.observedLevel as number,
        evidenceType: "return_goal_observation",
        evidenceId: o.id,
        reconstructed: false,
      }));
    if (points.length === 0) continue;
    out.push({
      domainType: "function",
      domainKey: goal.id,
      label: goal.title,
      unit: "goal ladder",
      better: "higher",
      points,
    });
  }
  return out;
}

/** Check-in dimensions and scored instruments, from the event spine.
 *
 *  These come through `memberTimeline` and `buildTrajectory` rather than
 *  through their own SQL, which is deliberate: the timeline already applies the
 *  companion-visibility policy and the `asOf` reconstruction, and a second
 *  query path would be a second set of rules about what a clinician may see. */
async function spineSeries(personId: string, cutoff: string): Promise<DomainSeries[]> {
  const timeline = await memberTimeline(personId, { asOf: cutoff });
  const trajectory = buildTrajectory(timeline);
  const out: DomainSeries[] = [];

  const CHECKIN_DOMAIN: Record<string, DomainType> = {
    activation: "activation",
    dissociation: "dissociation",
    sleep: "sleep",
  };

  for (const s of trajectory.series) {
    const points = s.points.map((p): TrajectoryPoint => ({
      at: p.at, value: p.v,
      evidenceType: "longitudinal_event", evidenceId: p.eventId,
      reconstructed: p.reconstructed,
    }));

    const checkinDomain = CHECKIN_DOMAIN[s.id];
    if (checkinDomain) {
      out.push({
        domainType: checkinDomain, domainKey: s.id, label: s.label,
        unit: s.unit, better: s.betterWhen, points,
      });
      continue;
    }
    if (s.id.startsWith("instrument:")) {
      const instrument = s.id.slice("instrument:".length);
      out.push({
        domainType: "measure", domainKey: instrument, label: s.label,
        unit: s.unit, better: s.betterWhen, points,
      });
    }
  }

  // Engagement is the presence of check-ins rather than any value they carry,
  // so it is built from the activation series' timing and given a constant
  // value. The classifier never reads that value: a `none`-direction domain
  // reports counts.
  const activation = trajectory.series.find((s) => s.id === "activation");
  if (activation && activation.points.length > 0) {
    out.push({
      domainType: "engagement",
      domainKey: "checkins",
      label: "Check-ins",
      unit: "count",
      better: "none",
      points: activation.points.map((p): TrajectoryPoint => ({
        at: p.at, value: 1,
        evidenceType: "longitudinal_event", evidenceId: p.eventId,
        reconstructed: p.reconstructed,
      })),
    });
  }

  return out;
}

/** Delayed recovery burden after sessions (§2's session-recovery domain).
 *
 *  `delayed_risk` is a 0–10 reading of how hard the person expected the hours
 *  after a session to be — the same scale the escalation rule reads at 8. This
 *  domain describes the TREND below that line, which is the part no existing
 *  surface shows: a person whose post-session nights have been getting harder
 *  without any single one crossing the escalation threshold is exactly the case
 *  the trajectory layer exists for. */
async function sessionRecoverySeries(
  ctx: TenantContext, personId: string, cutoff: string
): Promise<DomainSeries[]> {
  const rows = await repo(ctx).findMany<PostSessionRow>(
    "post_session_checks", "user_id = ? AND created_at <= ?", [personId, cutoff],
    { orderBy: "created_at ASC" }
  );
  if (rows.length === 0) return [];
  return [{
    domainType: "session_recovery",
    domainKey: "delayed_risk",
    label: "Expected difficulty after sessions",
    unit: "0–10",
    better: "lower",
    points: rows.map((r): TrajectoryPoint => ({
      at: r.created_at,
      value: Number(r.delayed_risk),
      evidenceType: "post_session_check",
      evidenceId: r.id,
      reconstructed: false,
    })),
  }];
}

/** Every domain series Steady can build for a person, as of a cutoff.
 *
 *  ONE ADAPTER FAILING DOES NOT EMPTY THE PICTURE. A trajectory screen that
 *  went blank because the goals table was briefly unreadable would look exactly
 *  like a person with no history, which is the worst way for this surface to
 *  fail. So each adapter is guarded and its absence is reported. */
export async function domainSeriesFor(
  ctx: TenantContext, personId: string, args: { asOf?: string } = {}
): Promise<{ series: DomainSeries[]; unavailable: string[] }> {
  const cutoff = args.asOf ?? new Date().toISOString();
  const series: DomainSeries[] = [];
  const unavailable: string[] = [];

  const adapters: Array<[string, () => Promise<DomainSeries[]>]> = [
    ["function", () => functionSeries(ctx, personId, cutoff)],
    ["check-ins and measures", () => spineSeries(personId, cutoff)],
    ["session recovery", () => sessionRecoverySeries(ctx, personId, cutoff)],
  ];

  for (const [name, load] of adapters) {
    try {
      series.push(...(await load()));
    } catch (err) {
      // The class of failure only — a message can carry a goal title.
      console.error(`recovery trajectory: ${name} adapter failed:`, err instanceof Error ? err.name : "unknown");
      unavailable.push(name);
    }
  }
  return { series, unavailable };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface TrajectorySnapshot {
  id: string;
  personId: string;
  domainType: DomainType;
  domainKey: string;
  label: string;
  unit: string;
  better: Better;
  state: TrajectoryState;
  stateLabel: string;
  policyVersion: string;
  evidenceCutoff: string;
  classification: Classification;
  /** Whether this domain may reach the Command Center at all (§8). */
  signalEligible: boolean;
}

export interface TrajectorySet {
  personId: string;
  evidenceCutoff: string;
  policyVersion: string;
  snapshots: TrajectorySnapshot[];
  /** Adapters that could not run, by name. */
  unavailable: string[];
}

function snapshotId(args: {
  tenantId: string; personId: string; domainType: string; domainKey: string;
  policyVersion: string; evidenceCutoff: string;
}): string {
  // Deterministic, so recomputing the same cutoff under the same policy writes
  // the same row rather than a second one. The UNIQUE constraint would catch a
  // duplicate; deriving the id means the evidence rows land on the same parent.
  return crypto.createHash("sha256")
    .update([
      args.tenantId, args.personId, args.domainType, args.domainKey,
      args.policyVersion, args.evidenceCutoff,
    ].join("|"))
    .digest("hex").slice(0, 26);
}

/** Compute every domain's state for a person, as of a cutoff. Reads only. */
export async function computeTrajectory(
  ctx: TenantContext, personId: string,
  args: { asOf?: string; policy?: TrajectoryPolicy } = {}
): Promise<TrajectorySet> {
  const policy = args.policy ?? TRAJECTORY_POLICY;
  const evidenceCutoff = args.asOf ?? new Date().toISOString();
  const { series, unavailable } = await domainSeriesFor(ctx, personId, { asOf: evidenceCutoff });

  const snapshots = series.map((s): TrajectorySnapshot => {
    const classification = classify(s, { asOf: evidenceCutoff, policy });
    return {
      id: snapshotId({
        tenantId: ctx.tenantId, personId, domainType: s.domainType, domainKey: s.domainKey,
        policyVersion: policy.version, evidenceCutoff,
      }),
      personId,
      domainType: s.domainType,
      domainKey: s.domainKey,
      label: s.label,
      unit: s.unit,
      better: s.better,
      state: classification.state,
      stateLabel: stateLabelFor(s.domainType, classification.state),
      policyVersion: policy.version,
      evidenceCutoff,
      classification,
      signalEligible: DOMAIN_META[s.domainType].signalEligible,
    };
  });

  // Stable server ordering, so "the second lane" is a thing a clinician can say
  // to a colleague. Domains in the order §2 lists them, then by label.
  const ORDER: DomainType[] = [...Object.keys(DOMAIN_META)] as DomainType[];
  snapshots.sort((a, b) => {
    const d = ORDER.indexOf(a.domainType) - ORDER.indexOf(b.domainType);
    return d !== 0 ? d : a.label.localeCompare(b.label);
  });

  return { personId, evidenceCutoff, policyVersion: policy.version, snapshots, unavailable };
}

/**
 * Persist a computed set, with its evidence.
 *
 * IDEMPOTENT on (tenant, person, domain, policy version, cutoff), which is
 * §13's reproducibility clause made structural: recomputing the same cutoff
 * under the same rules cannot produce a second, differently-worded row that a
 * later reader would have to choose between.
 */
export async function saveTrajectory(
  ctx: TenantContext, set: TrajectorySet, actorPersonId: string
): Promise<void> {
  const r = repo(ctx);
  for (const s of set.snapshots) {
    const existing = await r.findOne<{ id: string }>(
      "recovery_trajectory_snapshots", "id = ?", [s.id]
    );
    if (existing) continue;

    await r.insert("recovery_trajectory_snapshots", {
      id: s.id,
      person_id: s.personId,
      domain_type: s.domainType,
      domain_key: s.domainKey,
      state: s.state,
      policy_version: s.policyVersion,
      evidence_cutoff: s.evidenceCutoff,
      current_window_json: JSON.stringify(s.classification.current),
      comparison_window_json: s.classification.comparison
        ? JSON.stringify(s.classification.comparison) : null,
      explanation_json: JSON.stringify(s.classification.explanation),
      limitations_json: JSON.stringify(s.classification.limitations),
      computed_at: new Date().toISOString(),
    });

    const cited = [
      ...s.classification.current.evidenceIds,
      ...(s.classification.comparison?.evidenceIds ?? []),
    ];
    let rank = 0;
    for (const evidenceId of cited) {
      await r.insert("recovery_trajectory_evidence", {
        snapshot_id: s.id,
        evidence_type: s.domainType === "function"
          ? "return_goal_observation"
          : s.domainType === "session_recovery" ? "post_session_check" : "longitudinal_event",
        evidence_id: evidenceId,
        rank: rank++,
      }).catch(() => { /* a repeated citation is one citation */ });
    }

    await appendEventSafe({
      personId: s.personId,
      type: "trajectory.snapshot_computed",
      actorType: "system",
      actorId: actorPersonId,
      payload: {
        snapshotId: s.id,
        domainType: s.domainType,
        domainKey: s.domainKey,
        state: s.state,
        policyVersion: s.policyVersion,
        evidenceCutoff: s.evidenceCutoff,
      },
    });
  }
}

/** The evidence a stored snapshot was computed from, in the order cited. */
export async function evidenceForSnapshot(
  ctx: TenantContext, snapshotId: string
): Promise<Array<{ evidenceType: string; evidenceId: string; rank: number }>> {
  const rows = await repo(ctx).findMany<{ evidence_type: string; evidence_id: string; rank: number }>(
    "recovery_trajectory_evidence", "snapshot_id = ?", [snapshotId], { orderBy: "rank ASC" }
  );
  return rows.map((r) => ({ evidenceType: r.evidence_type, evidenceId: r.evidence_id, rank: r.rank }));
}

// ---------------------------------------------------------------------------
// Clinician review (§5, §12 Phase 3)
// ---------------------------------------------------------------------------

export {
  REVIEW_STATES, REVIEW_LABEL, type TrajectoryReviewState,
} from "./trajectory-vocabulary";

export interface TrajectoryReview {
  id: string;
  snapshotId: string;
  clinicianPersonId: string;
  reviewState: TrajectoryReviewState;
  note: string | null;
  createdAt: string;
}

/**
 * Record what a clinician made of a state.
 *
 * DISAGREEMENT DOES NOT DELETE THE SNAPSHOT. It is recorded beside it, which is
 * the cross-feature invariant that corrections append: a clinician who thinks
 * the sleep lane is misreading a shift-work pattern is adding the thing Steady
 * did not know, and erasing the state would also erase the evidence that Steady
 * had been reading it that way for six weeks.
 */
export async function recordTrajectoryReview(
  ctx: TenantContext,
  args: {
    personId: string; snapshotId: string; clinicianPersonId: string;
    reviewState: TrajectoryReviewState; note?: string | null;
  }
): Promise<TrajectoryReview> {
  if (!(REVIEW_STATES as readonly string[]).includes(args.reviewState)) {
    throw new TrajectoryError(`"${args.reviewState}" is not a review state.`);
  }
  // A disagreement with no reason is a disagreement nobody can act on, and the
  // next reader sees a contested state with nothing to contest it with.
  if ((args.reviewState === "disagreed" || args.reviewState === "needs_context") && !args.note?.trim()) {
    throw new TrajectoryError(
      "Recording a disagreement or a missing-context note needs the reason in words."
    );
  }
  const id = ulid();
  const createdAt = new Date().toISOString();
  await repo(ctx).insert("recovery_trajectory_reviews", {
    id,
    person_id: args.personId,
    snapshot_id: args.snapshotId,
    clinician_person_id: args.clinicianPersonId,
    review_state: args.reviewState,
    note: args.note?.trim() || null,
    created_at: createdAt,
  });
  await appendEventSafe({
    personId: args.personId,
    type: "trajectory.reviewed",
    actorType: "clinician",
    actorId: args.clinicianPersonId,
    payload: { snapshotId: args.snapshotId, reviewState: args.reviewState, hasNote: Boolean(args.note?.trim()) },
  });
  return {
    id, snapshotId: args.snapshotId, clinicianPersonId: args.clinicianPersonId,
    reviewState: args.reviewState, note: args.note?.trim() || null, createdAt,
  };
}

export async function reviewsForPerson(
  ctx: TenantContext, personId: string
): Promise<TrajectoryReview[]> {
  const rows = await repo(ctx).findMany<{
    id: string; snapshot_id: string; clinician_person_id: string;
    review_state: string; note: string | null; created_at: string;
  }>("recovery_trajectory_reviews", "person_id = ?", [personId], { orderBy: "created_at DESC" });
  return rows.map((r) => ({
    id: r.id, snapshotId: r.snapshot_id, clinicianPersonId: r.clinician_person_id,
    reviewState: r.review_state as TrajectoryReviewState,
    note: r.note, createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// What other surfaces read (§8, §9)
// ---------------------------------------------------------------------------

/** The states that are worth a clinician's attention rather than chart
 *  commentary. §8: "do not emit work for every stable domain." */
export const DEVIATION_STATES: TrajectoryState[] = ["reversing", "stalled", "slowing"];

export function isDeviation(state: TrajectoryState): boolean {
  return DEVIATION_STATES.includes(state);
}

/** The deviations in a set that may reach the Command Center. */
export function deviations(set: TrajectorySet): TrajectorySnapshot[] {
  return set.snapshots.filter((s) => s.signalEligible && isDeviation(s.state));
}

/**
 * One sentence naming what moved, for a card or a prep paragraph.
 *
 * §8's wording rule, applied: "Recovery trajectory changed in sleep and
 * function across the current review window" rather than "patient is off
 * track". It names domains and a window; it does not grade the person.
 */
export function trajectoryLine(set: TrajectorySet): string | null {
  const moved = set.snapshots.filter((s) => isDeviation(s.state));
  const improving = set.snapshots.filter((s) => s.state === "improving");
  if (moved.length === 0 && improving.length === 0) return null;

  const name = (list: TrajectorySnapshot[]) =>
    list.map((s) => s.label).join(", ");

  if (moved.length === 0) {
    return `Moving favourably in ${name(improving)} across the current review window.`;
  }
  if (improving.length === 0) {
    return `Recovery trajectory changed in ${name(moved)} across the current review window.`;
  }
  // §4: "a patient can improve in one domain and worsen in another. Preserve
  // the disagreement." Both halves in one sentence, neither cancelling the
  // other out.
  return `Recovery trajectory changed in ${name(moved)}, while ${name(improving)} moved favourably, across the current review window.`;
}

/** The compact shape Session Prep and the caseload table read (§9). */
export interface TrajectoryContext {
  domainType: DomainType;
  domainKey: string;
  label: string;
  state: TrajectoryState;
  stateLabel: string;
  headline: string;
  evidenceIds: string[];
  limitations: string[];
  policyVersion: string;
}

export function trajectoryContext(set: TrajectorySet): TrajectoryContext[] {
  return set.snapshots
    .filter((s) => s.state !== "insufficient_data")
    .map((s) => ({
      domainType: s.domainType,
      domainKey: s.domainKey,
      label: s.label,
      state: s.state,
      stateLabel: s.stateLabel,
      headline: s.classification.explanation[0] ?? "",
      evidenceIds: s.classification.current.evidenceIds.slice(0, 6),
      limitations: s.classification.limitations,
      policyVersion: s.policyVersion,
    }));
}

/** The goal-ladder rung a function series' latest reading sits on, in words. */
export function levelWord(value: number): string {
  const rounded = Math.round(value);
  const clamped = Math.max(-2, Math.min(2, rounded)) as -2 | -1 | 0 | 1 | 2;
  return LEVEL_LABEL[clamped];
}
