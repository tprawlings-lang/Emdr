// Response observations (expansion handoff 02, Phase 2).
//
// Phase 1 recorded WHAT HAPPENED. This records WHAT WAS OBSERVED AFTERWARDS,
// and its definition of done is one sentence: "mixed and missing outcomes
// remain visible."
//
// Both halves of that are things a schema either makes structural or loses.
//
//   MIXED. §6: "an immediate distress decrease plus next-day worsening is
//   displayed as mixed response, not netted into one number." Netting requires
//   the two to be commensurable, and a `window_type` on every row is what stops
//   them ever being treated that way. There is no column here that could hold a
//   person's overall response to an intervention, because the moment such a
//   column exists something will average into it.
//
//   MISSING. §6: "missing delayed follow-up is reported. Do not classify it as
//   recovered." So absence is not the absence of a row — it is `missingWindows`,
//   computed from what a source type was EXPECTED to produce against what it
//   did. A session that never got a post-session check is a session whose
//   delayed course nobody knows, and that is a finding.
//
// AND THE DIRECTION IS A FACT ABOUT A NUMBER, NOT ABOUT A PERSON. `direction`
// is "decrease", "increase" or "unchanged" — what the value did. Which of those
// means the person is more settled depends on the dimension (distress falling
// and sleep quality rising are both relief) and lives in SETTLING_DIRECTION,
// one named table the projection and the copy both read. Storing "improved"
// would bake an interpretation into the evidence row, where no later reader
// could separate it back out.
//
// WHAT THIS MODULE WILL NOT DO. It does not decide whether an intervention
// helped. Every function here attaches one source-backed observation to one
// exposure in one window with its evidence class intact; §6's thresholds, the
// median, the strata and the pattern state are Phase 3's, computed from these
// rows and recomputable from them.

import { repo, type TenantContext } from "../repository";
import { data } from "../data";
import { ulid } from "../ids";
import { recordResponseObserved } from "./response-events";
import { listInstances, type InterventionInstance } from "./interventions";

// The vocabulary and the two pure judgements live in their own module so a
// client component can render a response without this file's database
// dependencies. Re-exported so every server-side caller keeps one import.
export {
  OUTCOME_TYPES, WINDOW_TYPES, RESPONSE_EVIDENCE_CLASSES, SETTLING_DIRECTION,
  OUTCOME_LABEL, WINDOW_LABEL, EVIDENCE_LABEL, EXPECTED_WINDOWS,
  ResponseObservationError, isSettling, missingWindowsFor, isMixed,
} from "./response-vocabulary";
export type {
  OutcomeType, WindowType, ResponseEvidenceClass, Direction, ResponseObservation,
} from "./response-vocabulary";

import {
  ResponseObservationError, directionOf, toObservation,
  type ObsRow, type OutcomeType, type WindowType, type Direction,
  type ResponseEvidenceClass, type ResponseObservation,
} from "./response-vocabulary";

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RecordObservationArgs {
  personId: string;
  instanceId: string;
  outcomeType: OutcomeType;
  windowType: WindowType;
  valueNum?: number | null;
  valueText?: string | null;
  unit?: string | null;
  direction?: Direction | null;
  evidenceClass: ResponseEvidenceClass;
  sourceType: string;
  sourceId: string;
  occurredAt: string;
  actorId?: string | null;
}

/**
 * Attach one source-backed observation to one exposure.
 *
 * Idempotent on (instance, outcome type, window, source type, source id), for the
 * same reason `recordInstance` is: an adapter that ran twice must not double the
 * evidence behind a pattern. All five are needed — one post-session check row
 * legitimately produces a distress reading, a recovery answer and a
 * delayed-risk score, on the same dimension in the same window from the same
 * row id, and those are three observations rather than one collision.
 */
export async function recordObservation(
  ctx: TenantContext, args: RecordObservationArgs
): Promise<ResponseObservation> {
  const r = repo(ctx);
  // The instance must be visible in THIS tenant. The foreign key is global; it
  // only asks that the row exist somewhere (ADR 0011 §3).
  if (!(await r.exists("intervention_instances", "id = ?", [args.instanceId]))) {
    throw new ResponseObservationError("No such intervention instance.");
  }

  // SOURCE_TYPE IS PART OF THE KEY, and leaving it out was a real bug: one
  // post-session check produces a distress reading, a recovery answer and a
  // delayed-risk score, all in the same window on the same dimension from the
  // same row id. Without source_type in the key they collapse into one
  // observation that keeps overwriting itself, and three distinct answers
  // become whichever adapter wrote last.
  const existing = await r.findOne<ObsRow>(
    "intervention_response_observations",
    "intervention_instance_id = ? AND outcome_type = ? AND window_type = ? AND source_type = ? AND source_id = ?",
    [args.instanceId, args.outcomeType, args.windowType, args.sourceType, args.sourceId]
  );
  if (existing) {
    await r.update(
      "intervention_response_observations",
      {
        value_num: args.valueNum ?? null,
        value_text: args.valueText ?? null,
        unit: args.unit ?? null,
        direction: args.direction ?? null,
        occurred_at: args.occurredAt,
      },
      "id = ?",
      [existing.id]
    );
    const row = await r.findOne<ObsRow>("intervention_response_observations", "id = ?", [existing.id]);
    return toObservation(row!);
  }

  const id = ulid();
  await r.insert("intervention_response_observations", {
    id,
    person_id: args.personId,
    intervention_instance_id: args.instanceId,
    outcome_type: args.outcomeType,
    window_type: args.windowType,
    value_num: args.valueNum ?? null,
    value_text: args.valueText ?? null,
    unit: args.unit ?? null,
    direction: args.direction ?? null,
    evidence_class: args.evidenceClass,
    source_type: args.sourceType,
    source_id: args.sourceId,
    occurred_at: args.occurredAt,
  });
  await recordResponseObserved({
    observationId: id,
    tenantId: ctx.tenantId,
    personId: args.personId,
    instanceId: args.instanceId,
    outcomeType: args.outcomeType,
    windowType: args.windowType,
    evidenceClass: args.evidenceClass,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    occurredAt: args.occurredAt,
    direction: args.direction ?? null,
    actorId: args.actorId ?? null,
  });
  const row = await r.findOne<ObsRow>("intervention_response_observations", "id = ?", [id]);
  return toObservation(row!);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function observationsForPerson(
  ctx: TenantContext, personId: string
): Promise<ResponseObservation[]> {
  const rows = await repo(ctx).findMany<ObsRow>(
    "intervention_response_observations", "person_id = ?", [personId],
    { orderBy: "occurred_at DESC, rowid DESC" }
  );
  return rows.map(toObservation);
}

export async function observationsForInstance(
  ctx: TenantContext, instanceId: string
): Promise<ResponseObservation[]> {
  const rows = await repo(ctx).findMany<ObsRow>(
    "intervention_response_observations", "intervention_instance_id = ?", [instanceId],
    { orderBy: "occurred_at ASC, rowid ASC" }
  );
  return rows.map(toObservation);
}

// ---------------------------------------------------------------------------
// Missingness (§6, and the harder half of Phase 2's definition of done)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Adapters (§10)
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string; status: string; pre_suds: number | null; post_suds: number | null;
  hard_stop_reason: string | null; started_at: string; ended_at: string | null;
}

/**
 * Sessions → the immediate window.
 *
 * THE CLOSE READING IS ONLY EVIDENCE WHEN IT EXISTS. A session with no close
 * produces NO observation, and `missingWindowsFor` then reports the immediate
 * window as missing. The alternative — treating the opening reading as the
 * close, or the absence as no change — is precisely §6's "do not classify
 * missing delayed follow-up as recovered", one window earlier.
 *
 * A HARD STOP PRODUCES A SECOND OBSERVATION, in the same window, on the
 * adverse dimension. §5 requires "hard stop, worsening, inability to recover"
 * to remain visible and able to create attention work, and a hard stop whose
 * distress happened to fall would otherwise read as an ordinary settled
 * session. Both rows stand; nothing reconciles them into one.
 */
export async function syncSessionResponses(
  ctx: TenantContext, personId: string, instances: InterventionInstance[]
): Promise<ResponseObservation[]> {
  const sessions = instances.filter((i) => i.sourceType === "therapy_session");
  if (sessions.length === 0) return [];
  const c = await data();
  const rows = (await c.all(
    `SELECT id, status, pre_suds, post_suds, hard_stop_reason, started_at, ended_at
       FROM therapy_sessions
      WHERE user_id = ? AND id IN (${sessions.map(() => "?").join(",")})`,
    [personId, ...sessions.map((s) => s.sourceId)]
  )) as SessionRow[];
  const bySource = new Map(rows.map((r) => [r.id, r]));

  const out: ResponseObservation[] = [];
  for (const inst of sessions) {
    const row = bySource.get(inst.sourceId);
    if (!row) continue;

    if (row.pre_suds !== null && row.post_suds !== null) {
      out.push(
        await recordObservation(ctx, {
          personId,
          instanceId: inst.id,
          outcomeType: "within_encounter",
          windowType: "immediate",
          valueNum: row.post_suds - row.pre_suds,
          valueText: `${row.pre_suds} to ${row.post_suds}`,
          unit: "suds_points",
          direction: directionOf(row.pre_suds, row.post_suds),
          evidenceClass: "measured",
          sourceType: "therapy_session",
          sourceId: row.id,
          occurredAt: row.ended_at ?? row.started_at,
        })
      );
    }

    if (row.status === "hard_stop") {
      out.push(
        await recordObservation(ctx, {
          personId,
          instanceId: inst.id,
          outcomeType: "adverse_or_hard_stop",
          windowType: "immediate",
          valueNum: 1,
          valueText: row.hard_stop_reason ?? "stopped by a safety rule",
          direction: "increase",
          evidenceClass: "system_event",
          sourceType: "therapy_session",
          sourceId: row.id,
          occurredAt: row.ended_at ?? row.started_at,
        })
      );
    }
  }
  return out;
}

/** The delayed-risk score at which the app's own post-session path escalates
 *  (`submitPostSessionCheck` in actions.ts). Reused rather than re-chosen: the
 *  response record and the safety path must not disagree about what counts as a
 *  hard night, and §11 forbids this feature inventing a second threshold beside
 *  the safety engine's. */
export const DELAYED_RISK_ESCALATION = 8;

interface PostCheckRow {
  id: string; session_id: string; distress: number; recovery_confirmed: number;
  delayed_risk: number; created_at: string;
}

/**
 * Post-session checks → the post_session window.
 *
 * §5's recovery_burden, with its own interpretation rule: "delayed cost can
 * coexist with immediate benefit." So this window is recorded independently of
 * the immediate one and never adjusted against it.
 *
 * `recovery_confirmed` is recorded as its own observation rather than folded
 * into the distress reading. A person can be less distressed and still not
 * recovered, and the two answers come from two different questions.
 */
export async function syncPostSessionResponses(
  ctx: TenantContext, personId: string, instances: InterventionInstance[]
): Promise<ResponseObservation[]> {
  const sessions = instances.filter((i) => i.sourceType === "therapy_session");
  if (sessions.length === 0) return [];
  const c = await data();
  const rows = (await c.all(
    `SELECT id, session_id, distress, recovery_confirmed, delayed_risk, created_at
       FROM post_session_checks
      WHERE user_id = ? AND session_id IN (${sessions.map(() => "?").join(",")})
      ORDER BY created_at ASC`,
    [personId, ...sessions.map((s) => s.sourceId)]
  )) as PostCheckRow[];

  const byInstance = new Map(sessions.map((s) => [s.sourceId, s]));
  const out: ResponseObservation[] = [];
  for (const row of rows) {
    const inst = byInstance.get(row.session_id);
    if (!inst) continue;

    out.push(
      await recordObservation(ctx, {
        personId,
        instanceId: inst.id,
        outcomeType: "recovery_burden",
        windowType: "post_session",
        valueNum: row.distress,
        unit: "distress",
        // A level, not a change: there is no earlier reading in this window to
        // compare it against, and inventing one from the session's close would
        // be netting two windows — the thing §6 forbids.
        direction: null,
        evidenceClass: "patient_report",
        sourceType: "post_session_check",
        sourceId: row.id,
        occurredAt: row.created_at,
      })
    );

    out.push(
      await recordObservation(ctx, {
        personId,
        instanceId: inst.id,
        outcomeType: "recovery_burden",
        windowType: "post_session",
        valueNum: row.recovery_confirmed ? 1 : 0,
        valueText: row.recovery_confirmed
          ? "said they had come back to themselves"
          : "had not come back to themselves yet",
        unit: "recovery_confirmed",
        direction: row.recovery_confirmed ? "decrease" : "increase",
        evidenceClass: "patient_report",
        sourceType: "post_session_check_recovery",
        sourceId: row.id,
        occurredAt: row.created_at,
      })
    );

    // delayed_risk is a 0-10 SCALE, not a flag — the post-session form asks
    // "how likely are nightmares, urges, or shutdown tonight?" Treating any
    // non-zero answer as an adverse event would put an adverse row on almost
    // every session, and §11 is explicit that a single difficult session is not
    // an attention item. So the number is recorded as what it is, and the
    // adverse marker only appears at the threshold the app's own safety path
    // already escalates on.
    out.push(
      await recordObservation(ctx, {
        personId,
        instanceId: inst.id,
        outcomeType: "recovery_burden",
        windowType: "post_session",
        valueNum: row.delayed_risk,
        unit: "delayed_risk",
        direction: null,
        evidenceClass: "patient_report",
        sourceType: "post_session_check_risk",
        sourceId: row.id,
        occurredAt: row.created_at,
      })
    );

    if (row.delayed_risk >= DELAYED_RISK_ESCALATION) {
      out.push(
        await recordObservation(ctx, {
          personId,
          instanceId: inst.id,
          outcomeType: "adverse_or_hard_stop",
          windowType: "post_session",
          valueNum: row.delayed_risk,
          valueText: `expected a hard night afterwards (${row.delayed_risk} of 10)`,
          direction: "increase",
          evidenceClass: "patient_report",
          sourceType: "post_session_check_risk_high",
          sourceId: row.id,
          occurredAt: row.created_at,
        })
      );
    }
  }
  return out;
}

interface CheckinRow {
  id: string; checkin_date: string; activation: number; sleep_quality: number;
}

/**
 * Daily check-ins → the next_day window.
 *
 * §10 is careful about this one: check-ins "supply before/after context
 * windows, not direct causation." So the direction here compares the check-in
 * the day AFTER an exposure with the one on the day of it — a description of
 * what the person's own daily record did across that boundary, with no claim
 * about why.
 *
 * WITH NO BEFORE READING THERE IS NO DIRECTION. A person who checked in the day
 * after a session but not the day of it has a next-day state and no comparison,
 * and the row says so with `direction: null` rather than comparing against
 * something else that happened to be nearby.
 */
export async function syncNextDayResponses(
  ctx: TenantContext, personId: string, instances: InterventionInstance[]
): Promise<ResponseObservation[]> {
  if (instances.length === 0) return [];
  const c = await data();
  const rows = (await c.all(
    `SELECT id, checkin_date, activation, sleep_quality
       FROM checkins WHERE user_id = ? ORDER BY checkin_date ASC`,
    [personId]
  )) as CheckinRow[];
  if (rows.length === 0) return [];
  const byDate = new Map(rows.map((r) => [r.checkin_date, r]));

  const out: ResponseObservation[] = [];
  for (const inst of instances) {
    const day = inst.occurredAt.slice(0, 10);
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const after = byDate.get(next.toISOString().slice(0, 10));
    if (!after) continue;
    const before = byDate.get(day);

    out.push(
      await recordObservation(ctx, {
        personId,
        instanceId: inst.id,
        outcomeType: "recovery_burden",
        windowType: "next_day",
        valueNum: after.activation,
        valueText: before ? `${before.activation} to ${after.activation}` : null,
        unit: "activation",
        direction: before ? directionOf(before.activation, after.activation) : null,
        evidenceClass: "patient_report",
        sourceType: "checkin",
        sourceId: after.id,
        occurredAt: after.checkin_date,
      })
    );

    out.push(
      await recordObservation(ctx, {
        personId,
        instanceId: inst.id,
        outcomeType: "sleep_after",
        windowType: "next_day",
        valueNum: after.sleep_quality,
        valueText: before ? `${before.sleep_quality} to ${after.sleep_quality}` : null,
        unit: "sleep_quality",
        direction: before ? directionOf(before.sleep_quality, after.sleep_quality) : null,
        evidenceClass: "patient_report",
        sourceType: "checkin_sleep",
        sourceId: after.id,
        occurredAt: after.checkin_date,
      })
    );
  }
  return out;
}

interface GoalObsRow {
  id: string; goal_id: string; observed_level: number | null;
  evidence_class: string; status: string; occurred_at: string;
}

/** How long after an exposure a functional observation is still attached to it.
 *  Fourteen days: long enough that a real-life attempt following a piece of work
 *  is caught, short enough that it is not attached to everything that happened
 *  that month. In versioned policy in Phase 3; here it is the linkage window. */
export const FUNCTIONAL_WINDOW_DAYS = 14;

/**
 * Return-to-Life observations → the functional window.
 *
 * §5 calls this the "highest-value real-life outcome when evidence is
 * available", and §10 sets the boundary: "attach functional response if
 * temporally and semantically related; model match remains candidate."
 *
 * THE LINK IS TEMPORAL, AND THAT IS ALL IT IS. This attaches a goal observation
 * that fell inside the window after an exposure. It does not claim the exposure
 * produced it, and the surface says so. What it does do is put a person's
 * functional movement next to what was happening around it, which is the thing
 * a symptom scale cannot show.
 *
 * ONLY ACCEPTED GOAL OBSERVATIONS. Handoff 01 §7's hard boundary is that a
 * model candidate proposes evidence and never moves a level; carrying a
 * `proposed` observation into a response fingerprint would let it move
 * something else instead.
 */
export async function syncFunctionalResponses(
  ctx: TenantContext, personId: string, instances: InterventionInstance[]
): Promise<ResponseObservation[]> {
  if (instances.length === 0) return [];
  const rows = await repo(ctx).findMany<GoalObsRow>(
    "return_to_life_observations",
    "person_id = ? AND status = 'accepted' AND observed_level IS NOT NULL",
    [personId],
    { orderBy: "occurred_at ASC" }
  );
  if (rows.length === 0) return [];

  const out: ResponseObservation[] = [];
  for (const inst of instances) {
    const from = inst.occurredAt.slice(0, 10);
    const until = new Date(`${from}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + FUNCTIONAL_WINDOW_DAYS);
    const to = until.toISOString().slice(0, 10);

    for (const g of rows) {
      const day = g.occurred_at.slice(0, 10);
      if (day < from || day > to) continue;
      out.push(
        await recordObservation(ctx, {
          personId,
          instanceId: inst.id,
          outcomeType: "function_after",
          windowType: "functional",
          valueNum: g.observed_level,
          valueText: `goal level ${g.observed_level} observed within ${FUNCTIONAL_WINDOW_DAYS} days`,
          unit: "goal_level",
          // No direction. A single level is a position, not a movement, and
          // comparing it with the previous one across a different goal's ladder
          // would be a comparison the ladders do not license.
          direction: null,
          // The goal observation's OWN class travels, because §13 requires
          // patient report and clinician observation to stay distinguishable
          // all the way through. What is a candidate here is the LINK, not the
          // observation.
          evidenceClass:
            g.evidence_class === "clinician_observed" ? "clinician_observation"
            : g.evidence_class === "patient_reported" ? "patient_report"
            : g.evidence_class === "system_measured" ? "system_event"
            : "model_candidate",
          sourceType: "return_goal_observation",
          sourceId: g.id,
          occurredAt: g.occurred_at,
        })
      );
    }
  }
  return out;
}

/**
 * Rebuild every response window for this person from its sources.
 *
 * Idempotent throughout, like the instance sync, so a page can call it on read
 * without a background job to fall behind.
 */
export async function syncResponseObservations(
  ctx: TenantContext, personId: string
): Promise<ResponseObservation[]> {
  const instances = await listInstances(ctx, personId);
  return [
    ...(await syncSessionResponses(ctx, personId, instances)),
    ...(await syncPostSessionResponses(ctx, personId, instances)),
    ...(await syncNextDayResponses(ctx, personId, instances)),
    ...(await syncFunctionalResponses(ctx, personId, instances)),
  ];
}
