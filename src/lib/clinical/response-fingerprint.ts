// The fingerprint projection (expansion handoff 02, Phase 3).
//
// Deterministic aggregation over evidence, pinned to a policy version. Its
// definition of done is two claims: "minimum evidence thresholds enforced" and
// "every pattern opens evidence".
//
// FOUR THINGS THIS FILE IS BUILT NOT TO DO.
//
//   IT DOES NOT USE A MEAN. §6: "use robust descriptive statistics: median
//   change and observed range/IQR rather than a fragile mean when sample size
//   is small." At n = 4 one hard session moves a mean by a point and a half and
//   moves a median not at all, and the mean is the number a clinician would
//   then carry into a decision.
//
//   IT DOES NOT COMBINE WINDOWS. Every summary is per window. There is no
//   "overall response" anywhere in this module, because §6's mixed case — an
//   immediate decrease with next-day worsening — has to survive aggregation,
//   and it only survives if nothing is ever in a position to average it away.
//
//   IT DOES NOT TREAT ABSENCE AS RECOVERY. `missingFollowupCount` is computed
//   and stored beside the support count, and the limitations list names what is
//   missing in words. §6: "missing delayed follow-up is reported. Do not
//   classify it as recovered."
//
//   IT DOES NOT DESCRIBE A PATTERN BELOW THRESHOLD. Under three comparable
//   exposures the state is `insufficient_data` and the descriptive statistics
//   are not computed at all — not computed and hidden, not computed and greyed.
//   A number that exists is a number something eventually renders.
//
// AND ONE THING IT IS BUILT TO DO. Every snapshot writes its evidence: the
// instance ids and observation ids it was computed from, into
// response_fingerprint_evidence. "Every pattern opens evidence" is not a UI
// feature that could be dropped in a redesign — the rows are the record of what
// the number was made of, and a snapshot without them would be a claim with no
// way back to its sources.

import { repo, type TenantContext } from "../repository";
import { ulid } from "../ids";
import { recordSnapshotComputed, recordPatternReviewed } from "./response-events";
import {
  listInstances, listDefinitions,
  type InterventionDefinition, type InterventionInstance,
} from "./interventions";
import { observationsForPerson } from "./response-observations";
import {
  isSettling, missingWindowsFor, isMixed,
  type ResponseObservation, type WindowType, type OutcomeType,
} from "./response-vocabulary";
import {
  RESPONSE_POLICY, PATTERN_STATE_LABEL,
  type ResponsePolicy, type PatternState,
} from "./response-fingerprint-policy";

export {
  RESPONSE_POLICY, PATTERN_STATES, PATTERN_STATE_LABEL, PATTERN_STATE_NOTE,
} from "./response-fingerprint-policy";
export type { PatternState, ResponsePolicy } from "./response-fingerprint-policy";

// ---------------------------------------------------------------------------
// Robust statistics (§6)
// ---------------------------------------------------------------------------

/** The middle value. Even counts take the mean of the two middle values, which
 *  is the standard definition and not the mean §6 rules out — that one is over
 *  the whole sample, where a single hard session moves it. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The observed range. §6 asks for range OR IQR beside the median; both are
 *  returned so a surface can show the honest spread at small n (range) and the
 *  robust one at larger n (IQR) without recomputing. */
export function range(values: number[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Quartiles by the same halving rule as the median, so a reader can reproduce
 *  them by hand from the listed evidence — which is what §13's
 *  "reproducible from evidence + policy version" actually requires. */
export function iqr(values: number[]): { q1: number; q3: number } | null {
  if (values.length < 4) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const lower = s.slice(0, mid);
  const upper = s.slice(s.length % 2 === 1 ? mid + 1 : mid);
  const q1 = median(lower);
  const q3 = median(upper);
  return q1 === null || q3 === null ? null : { q1, q3 };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface WindowSummary {
  windowType: WindowType;
  outcomeType: OutcomeType;
  /** How many exposures contributed an observation in this window. The
   *  denominator, always beside the number. */
  observedOn: number;
  medianChange: number | null;
  range: { min: number; max: number } | null;
  iqr: { q1: number; q3: number } | null;
  /** Exposures where this window moved toward settled, away from it, or
   *  neither. Three counts rather than a proportion, because a proportion
   *  without its denominator is what a reader remembers. */
  towardSettled: number;
  awayFromSettled: number;
  unchanged: number;
  unit: string | null;
}

export interface ContextStratum {
  key: string;
  label: string;
  supportCount: number;
  medianChange: number | null;
  range: { min: number; max: number } | null;
}

export interface FingerprintSummary {
  definition: InterventionDefinition;
  policyVersion: string;
  evidenceCutoff: string;
  patternState: PatternState;
  supportCount: number;
  /** Exposures with at least one expected window nobody recorded. */
  missingFollowupCount: number;
  /** Exposures whose own windows disagreed. Never netted (§6). */
  mixedCount: number;
  /** Exposures with an adverse or non-recovery observation. */
  recoveryBurdenCount: number;
  windows: WindowSummary[];
  strata: ContextStratum[];
  /** What this summary cannot support, in words a clinician reads. */
  limitations: string[];
  /** The rows it was computed from. "Every pattern opens evidence." */
  evidence: { instanceIds: string[]; observationIds: string[] };
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/** The window/outcome pairs summarised, in reading order. Fixed rather than
 *  discovered from the data so two people's fingerprints have the same shape
 *  and a missing row means missing rather than "not summarised this time". */
const SUMMARISED: Array<{ windowType: WindowType; outcomeType: OutcomeType }> = [
  { windowType: "immediate", outcomeType: "within_encounter" },
  { windowType: "post_session", outcomeType: "recovery_burden" },
  { windowType: "next_day", outcomeType: "recovery_burden" },
  { windowType: "next_day", outcomeType: "sleep_after" },
  { windowType: "functional", outcomeType: "function_after" },
];

function summariseWindow(
  observations: ResponseObservation[],
  windowType: WindowType,
  outcomeType: OutcomeType
): WindowSummary | null {
  const rows = observations.filter(
    (o) => o.windowType === windowType && o.outcomeType === outcomeType
  );
  if (rows.length === 0) return null;

  // Only observations that are a CHANGE contribute to the median. A level with
  // no earlier reading (a next-day check-in with no day-of one) is real
  // evidence about the person and tells you nothing about movement, so it is
  // counted in `observedOn` and excluded from the statistic.
  const changes = rows
    .filter((o) => o.direction !== null && o.valueNum !== null && o.unit === "suds_points")
    .map((o) => o.valueNum as number);

  let toward = 0, away = 0, unchanged = 0;
  for (const o of rows) {
    const s = isSettling(o.outcomeType, o.direction);
    if (s === true) toward++;
    else if (s === false) away++;
    else unchanged++;
  }

  return {
    windowType,
    outcomeType,
    observedOn: new Set(rows.map((o) => o.instanceId)).size,
    medianChange: median(changes),
    range: range(changes),
    iqr: iqr(changes),
    towardSettled: toward,
    awayFromSettled: away,
    unchanged,
    unit: rows[0].unit,
  };
}

function bandFor(policy: ResponsePolicy, instance: InterventionInstance): { key: string; label: string } | null {
  const opening = instance.context.activationAtOpen;
  if (typeof opening !== "number") return null;
  const band = policy.activationBands.find((b) => opening >= b.min && opening <= b.max);
  return band ? { key: band.key, label: band.label } : null;
}

/**
 * The pattern state, from counts alone.
 *
 * ORDERED MOST SERIOUS FIRST, and that order is the clinical judgement in this
 * function. A course of work that settles someone in the room and repeatedly
 * costs them the night is `recovery_burden_observed`, not `mixed` and certainly
 * not favorable — §5: "delayed cost can coexist with immediate benefit", and
 * the reason to record it at all is that the cost is the part that gets lost.
 *
 * Deterministic and total: same counts, same state, every time, which is what
 * makes a stored snapshot checkable against its own evidence.
 */
export function patternStateFor(
  args: {
    supportCount: number;
    mixedCount: number;
    recoveryBurdenCount: number;
    towardSettledCount: number;
  },
  policy: ResponsePolicy = RESPONSE_POLICY
): PatternState {
  if (args.supportCount < policy.displayThreshold) return "insufficient_data";
  if (args.recoveryBurdenCount >= policy.recoveryBurdenThreshold) return "recovery_burden_observed";
  if (args.mixedCount >= args.supportCount * policy.mixedShare) return "mixed";
  if (
    args.supportCount >= policy.repeatedPatternThreshold &&
    args.towardSettledCount >= args.supportCount * policy.favorableShare
  ) {
    return "favorable_observed_pattern";
  }
  return "limited_observed_pattern";
}

function limitationsFor(
  args: {
    supportCount: number;
    missingFollowupCount: number;
    policy: ResponsePolicy;
    windows: WindowSummary[];
    strataSuppressed: number;
    hasFunctional: boolean;
  }
): string[] {
  const out: string[] = [];
  if (args.supportCount < args.policy.repeatedPatternThreshold) {
    out.push(
      `${args.supportCount} recorded exposure${args.supportCount === 1 ? "" : "s"} — under the ` +
      `${args.policy.repeatedPatternThreshold} this needs before anything is called a repeated pattern.`
    );
  }
  if (args.missingFollowupCount > 0) {
    out.push(
      `${args.missingFollowupCount} of ${args.supportCount} had a window nobody recorded. ` +
      `That is unknown, not recovered.`
    );
  }
  if (!args.hasFunctional) {
    out.push("No life-goal observation fell in the window after any of these, so there is no functional evidence here.");
  }
  if (args.strataSuppressed > 0) {
    out.push(
      `${args.strataSuppressed} starting-state group${args.strataSuppressed === 1 ? "" : "s"} had too few ` +
      `exposures to separate out, so ${args.strataSuppressed === 1 ? "it is" : "they are"} folded into the whole.`
    );
  }
  const immediate = args.windows.find((w) => w.windowType === "immediate");
  if (immediate && immediate.observedOn < args.supportCount) {
    out.push(
      `${args.supportCount - immediate.observedOn} had no close reading, so ${
        args.supportCount - immediate.observedOn === 1 ? "it is" : "they are"
      } absent from the within-encounter figures.`
    );
  }
  return out;
}

/**
 * The fingerprint for every intervention this person has evidence for.
 *
 * `asOf` is the evidence cutoff and defaults to now. Passing an earlier instant
 * reconstructs what Steady could have said then — the cross-feature invariant
 * against future-data leakage, and the thing that makes a snapshot from last
 * month re-checkable rather than merely re-readable.
 */
export async function computeFingerprints(
  ctx: TenantContext,
  personId: string,
  opts: { asOf?: string; policy?: ResponsePolicy } = {}
): Promise<FingerprintSummary[]> {
  const policy = opts.policy ?? RESPONSE_POLICY;
  const cutoff = opts.asOf ?? new Date().toISOString();

  const definitions = await listDefinitions(ctx);
  const byDefinition = new Map(definitions.map((d) => [d.id, d]));
  const instances = (await listInstances(ctx, personId)).filter((i) => i.occurredAt <= cutoff);
  const observations = (await observationsForPerson(ctx, personId)).filter(
    (o) => o.occurredAt <= cutoff
  );

  const obsByInstance = new Map<string, ResponseObservation[]>();
  for (const o of observations) {
    const list = obsByInstance.get(o.instanceId) ?? [];
    list.push(o);
    obsByInstance.set(o.instanceId, list);
  }

  const grouped = new Map<string, InterventionInstance[]>();
  for (const i of instances) {
    const list = grouped.get(i.definitionId) ?? [];
    list.push(i);
    grouped.set(i.definitionId, list);
  }

  const out: FingerprintSummary[] = [];
  for (const [definitionId, group] of grouped) {
    const definition = byDefinition.get(definitionId);
    if (!definition) continue;

    const groupObs = group.flatMap((i) => obsByInstance.get(i.id) ?? []);
    const supportCount = group.length;

    let mixedCount = 0;
    let recoveryBurdenCount = 0;
    let missingFollowupCount = 0;
    let towardSettledCount = 0;

    for (const inst of group) {
      const obs = obsByInstance.get(inst.id) ?? [];
      if (isMixed(obs)) mixedCount++;
      if (missingWindowsFor(inst, obs).length > 0) missingFollowupCount++;
      if (
        obs.some(
          (o) =>
            o.outcomeType === "adverse_or_hard_stop" ||
            (o.unit === "recovery_confirmed" && o.valueNum === 0)
        )
      ) {
        recoveryBurdenCount++;
      }
      // An exposure counts as settling when its IMMEDIATE window moved toward
      // settled and nothing in a later window moved away from it. Requiring the
      // later windows to agree is what keeps §6's mixed case from being counted
      // as favorable on the strength of the first reading alone.
      const immediate = obs.find((o) => o.windowType === "immediate" && o.outcomeType === "within_encounter");
      const laterAdverse = obs.some(
        (o) => o.windowType !== "immediate" && isSettling(o.outcomeType, o.direction) === false
      );
      if (immediate && isSettling(immediate.outcomeType, immediate.direction) === true && !laterAdverse) {
        towardSettledCount++;
      }
    }

    const patternState = patternStateFor(
      { supportCount, mixedCount, recoveryBurdenCount, towardSettledCount },
      policy
    );

    // BELOW THRESHOLD, NOTHING IS COMPUTED. Not computed and hidden — not
    // computed. §6's display threshold is a rule about what may exist, because
    // a statistic that exists is a statistic something eventually renders.
    const belowThreshold = patternState === "insufficient_data";

    const windows = belowThreshold
      ? []
      : SUMMARISED.map((s) => summariseWindow(groupObs, s.windowType, s.outcomeType))
          .filter((w): w is WindowSummary => w !== null);

    // Context strata (§6): only where each stratum has enough support of its
    // own. Everything below the threshold is counted and named as suppressed
    // rather than silently dropped, so the reader knows the whole is a whole.
    const strata: ContextStratum[] = [];
    let strataSuppressed = 0;
    if (!belowThreshold) {
      const banded = new Map<string, { label: string; instances: InterventionInstance[] }>();
      for (const inst of group) {
        const band = bandFor(policy, inst);
        if (!band) continue;
        const entry = banded.get(band.key) ?? { label: band.label, instances: [] };
        entry.instances.push(inst);
        banded.set(band.key, entry);
      }
      for (const [key, entry] of banded) {
        if (entry.instances.length < policy.stratumThreshold) {
          strataSuppressed++;
          continue;
        }
        const changes = entry.instances
          .flatMap((i) => obsByInstance.get(i.id) ?? [])
          .filter((o) => o.windowType === "immediate" && o.unit === "suds_points" && o.valueNum !== null)
          .map((o) => o.valueNum as number);
        strata.push({
          key,
          label: entry.label,
          supportCount: entry.instances.length,
          medianChange: median(changes),
          range: range(changes),
        });
      }
      strata.sort((a, b) => a.key.localeCompare(b.key));
    }

    out.push({
      definition,
      policyVersion: policy.version,
      evidenceCutoff: cutoff,
      patternState,
      supportCount,
      missingFollowupCount,
      mixedCount,
      recoveryBurdenCount,
      windows,
      strata,
      limitations: limitationsFor({
        supportCount, missingFollowupCount, policy, windows, strataSuppressed,
        hasFunctional: groupObs.some((o) => o.windowType === "functional"),
      }),
      evidence: {
        instanceIds: group.map((i) => i.id).sort(),
        observationIds: groupObs.map((o) => o.id).sort(),
      },
    });
  }

  // Most evidence first, then alphabetical — a stable server ordering, so two
  // reads of the same data put the same intervention at the top.
  out.sort(
    (a, b) =>
      b.supportCount - a.supportCount ||
      a.definition.displayName.localeCompare(b.definition.displayName)
  );
  return out;
}

/** The ones §6 permits a surface to describe at all. */
export function displayable(summaries: FingerprintSummary[]): FingerprintSummary[] {
  return summaries.filter((s) => s.patternState !== "insufficient_data");
}

// ---------------------------------------------------------------------------
// Snapshots (§4, §7)
// ---------------------------------------------------------------------------

export interface StoredSnapshot {
  id: string;
  definitionId: string;
  policyVersion: string;
  evidenceCutoff: string;
  supportCount: number;
  missingFollowupCount: number;
  summary: Record<string, unknown>;
  limitations: string[];
  computedAt: string;
}

interface SnapRow {
  id: string; intervention_definition_id: string; policy_version: string;
  evidence_cutoff: string; support_count: number; missing_followup_count: number;
  summary_json: string; limitations_json: string; computed_at: string;
}

function toSnapshot(r: SnapRow): StoredSnapshot {
  const parse = <T>(s: string, fallback: T): T => {
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  return {
    id: r.id,
    definitionId: r.intervention_definition_id,
    policyVersion: r.policy_version,
    evidenceCutoff: r.evidence_cutoff,
    supportCount: r.support_count,
    missingFollowupCount: r.missing_followup_count,
    summary: parse<Record<string, unknown>>(r.summary_json, {}),
    limitations: parse<string[]>(r.limitations_json, []),
    computedAt: r.computed_at,
  };
}

/**
 * Persist one computed summary, with its evidence.
 *
 * Re-computing under the same policy over the same cutoff returns the EXISTING
 * snapshot rather than writing a second opinion — the UNIQUE key does that, and
 * §13's reproducibility requirement is what it is for. A threshold change bumps
 * the policy version, which produces a new row beside the old one instead of
 * restating it.
 *
 * The evidence rows are written in the same call as the snapshot, not by a
 * later job. "Every pattern opens evidence" fails the moment those two can come
 * apart.
 */
export async function saveSnapshot(
  ctx: TenantContext, personId: string, summary: FingerprintSummary
): Promise<StoredSnapshot> {
  const r = repo(ctx);
  const existing = await r.findOne<SnapRow>(
    "response_fingerprint_snapshots",
    "person_id = ? AND intervention_definition_id = ? AND policy_version = ? AND evidence_cutoff = ?",
    [personId, summary.definition.id, summary.policyVersion, summary.evidenceCutoff]
  );
  if (existing) return toSnapshot(existing);

  const id = ulid();
  await r.insert("response_fingerprint_snapshots", {
    id,
    person_id: personId,
    intervention_definition_id: summary.definition.id,
    policy_version: summary.policyVersion,
    evidence_cutoff: summary.evidenceCutoff,
    support_count: summary.supportCount,
    missing_followup_count: summary.missingFollowupCount,
    summary_json: JSON.stringify({
      patternState: summary.patternState,
      mixedCount: summary.mixedCount,
      recoveryBurdenCount: summary.recoveryBurdenCount,
      windows: summary.windows,
      strata: summary.strata,
    }),
    limitations_json: JSON.stringify(summary.limitations),
  });

  const c = repo(ctx);
  for (const instanceId of summary.evidence.instanceIds) {
    await c.insert("response_fingerprint_evidence", {
      snapshot_id: id, evidence_type: "intervention_instance", evidence_id: instanceId,
    });
  }
  for (const observationId of summary.evidence.observationIds) {
    await c.insert("response_fingerprint_evidence", {
      snapshot_id: id, evidence_type: "response_observation", evidence_id: observationId,
    });
  }

  await recordSnapshotComputed({
    snapshotId: id,
    tenantId: ctx.tenantId,
    personId,
    definitionId: summary.definition.id,
    policyVersion: summary.policyVersion,
    evidenceCutoff: summary.evidenceCutoff,
    supportCount: summary.supportCount,
    missingFollowupCount: summary.missingFollowupCount,
    patternState: summary.patternState,
    evidenceIds: [...summary.evidence.instanceIds, ...summary.evidence.observationIds],
  });

  const row = await r.findOne<SnapRow>("response_fingerprint_snapshots", "id = ?", [id]);
  return toSnapshot(row!);
}

export async function evidenceFor(
  ctx: TenantContext, snapshotId: string
): Promise<Array<{ evidenceType: string; evidenceId: string }>> {
  const rows = await repo(ctx).findMany<{ evidence_type: string; evidence_id: string }>(
    "response_fingerprint_evidence", "snapshot_id = ?", [snapshotId]
  );
  return rows.map((r) => ({ evidenceType: r.evidence_type, evidenceId: r.evidence_id }));
}

/** A clinician read a displayed pattern and said what they made of it. The
 *  shared product rule — "the clinician decides what clinical meaning and
 *  action to accept" — is only auditable if their having decided is a fact. */
export async function reviewPattern(
  ctx: TenantContext,
  args: {
    personId: string; snapshotId: string; definitionId: string;
    clinicianId: string; decision: "agreed" | "disagreed" | "noted";
    note?: string | null;
  }
): Promise<void> {
  await recordPatternReviewed({
    tenantId: ctx.tenantId,
    personId: args.personId,
    snapshotId: args.snapshotId,
    definitionId: args.definitionId,
    clinicianId: args.clinicianId,
    decision: args.decision,
    note: args.note ?? null,
  });
}

/** One line for Session Prep's "what has tended to help / what to watch". */
export function fingerprintLine(summary: FingerprintSummary): string {
  const n = summary.supportCount;
  const times = `${n} recorded exposure${n === 1 ? "" : "s"}`;
  return `${summary.definition.displayName} — ${PATTERN_STATE_LABEL[summary.patternState].toLowerCase()}, on ${times}.`;
}

// ---------------------------------------------------------------------------
// Session Prep adapter (§9, §12 Phase 3)
// ---------------------------------------------------------------------------

export interface ResponseContext {
  definitionId: string;
  text: string;
  /** Instance and observation ids. Session Prep withholds an uncited claim, so
   *  a fingerprint that reached the brief without its evidence would be dropped
   *  rather than shown — which is the behaviour we want, and the reason these
   *  ids have to travel rather than being looked up again there. */
  citations: string[];
  /** Whether this one is a thing to watch rather than a thing that has tended
   *  to settle. §9 asks the brief for both halves, and separating them here
   *  rather than in the renderer means the clinician's screen and any later
   *  reader of the brief cannot disagree about which was which. */
  toWatch: boolean;
}

/**
 * What Session Prep is allowed to say about this person's responses.
 *
 * ONLY WHAT §6 PERMITS TO BE DISPLAYED. `displayable` drops everything below
 * the threshold, so a brief cannot carry a pattern the detail screen would
 * refuse to show — the brief being shorter is not a licence for it to be looser.
 *
 * A cap of three, because §11 caps the whole brief at about a minute of
 * reading. The rest are on the responses screen, which the brief links to.
 */
export async function responseContextFor(
  ctx: TenantContext,
  personId: string,
  opts: { asOf?: string; limit?: number } = {}
): Promise<ResponseContext[]> {
  const summaries = displayable(await computeFingerprints(ctx, personId, { asOf: opts.asOf }));
  return summaries.slice(0, opts.limit ?? 3).map((f) => ({
    definitionId: f.definition.id,
    text: fingerprintLine(f),
    // The instance ids alone: they are the exposures, and citing every
    // observation would put a hundred ids behind a one-line claim without
    // making it any more openable.
    citations: f.evidence.instanceIds,
    toWatch:
      f.patternState === "recovery_burden_observed" || f.patternState === "mixed",
  }));
}
