// The intervention ontology and instance reconstruction (expansion handoff 02,
// Phase 1).
//
// §1's question is "what has tended to help this person, under what
// circumstances, and what happens afterward?" — and it cannot be asked until
// Steady can name the things that happened. Today a breathing practice, a
// guided stabilization module and a clinician writing "we did cold water at
// the sink" are three unrelated rows in three unrelated tables. This module is
// the layer that says they are all INTERVENTION EXPOSURES, gives each a
// canonical identity, and reconstructs one timeline of them.
//
// PHASE 1 STOPS SHORT OF MEANING, DELIBERATELY. Its definition of done is
// "instances reconstruct from source events" and "no benefit labels yet".
// Nothing here computes, stores or displays whether an intervention helped —
// that is Phase 2's observations and Phase 3's aggregation, behind §6's
// evidence thresholds. An ontology that shipped with a benefit label attached
// would be a causal claim wearing a taxonomy's clothes.
//
// THREE RULES THAT ARE STRUCTURAL HERE RATHER THAN ADVISORY.
//
//   AN INSTANCE IS DERIVED, NOT AUTHORED. The adapters in §10 read
//   `therapy_sessions` and `practice_completions` and produce instances keyed
//   on (source_type, source_id). Re-running an adapter therefore updates rather
//   than duplicates, and an instance can always be traced back to the row that
//   produced it. There is no path that writes an instance with no source.
//
//   NORMALIZATION IS PROVISIONAL; THE EXPOSURE IS NOT. `clinician_confirmed`
//   is a column and not a filter on existence, because §8 forbids the model
//   creating "clinical intervention identity without review when ambiguous"
//   while §10 requires adapters to reconstruct history automatically. The event
//   happened either way; it is the NAME that is waiting for a person.
//
//   A CORRECTION APPENDS. Remapping an instance to a different definition
//   writes `response_fingerprint.pattern_corrected.v1` carrying the old
//   definition, so the mis-normalization stays in history rather than being
//   quietly overwritten (cross-feature invariant: "corrections append").
//
// AND ONE ABOUT WHAT SURVIVES. §13: "session response keeps hard stops and
// missing closes visible." A session that hard-stopped is an intervention
// instance like any other — it is, in fact, the most clinically interesting
// one — so it is recorded with its status in context rather than filtered out
// for being incomplete. Dropping it would turn "sessions" into "sessions that
// finished" under the same name, which is the exact substitution
// session-response.ts exists to refuse.

import { repo, type TenantContext } from "../repository";
import { data } from "../data";
import { ulid } from "../ids";
import { getPractice } from "../practices";
import { getModule } from "../modules";
import { recordInstanceRecorded, recordPatternCorrected } from "./response-events";

// The vocabulary lives in its own module so a client component can import the
// labels without pulling this file's database dependencies into the browser
// bundle. Re-exported here so every existing server-side caller keeps one
// import.
export {
  INTERVENTION_CLASSES, CLASS_LABEL, CLASS_NOTE, isInterventionClass,
  normalizeCanonicalKey, nativeKey, InterventionError,
} from "./intervention-vocabulary";
export type { InterventionClass, SourceScope, InstanceSourceType } from "./intervention-vocabulary";

import {
  InterventionError, normalizeCanonicalKey, nativeKey,
  type InterventionClass, type SourceScope, type InstanceSourceType,
} from "./intervention-vocabulary";

export interface InterventionDefinition {
  id: string;
  canonicalKey: string;
  displayName: string;
  interventionClass: InterventionClass;
  sourceScope: SourceScope;
  active: boolean;
  createdAt: string;
}

export interface InterventionInstance {
  id: string;
  personId: string;
  definitionId: string;
  sourceType: InstanceSourceType;
  sourceId: string;
  occurredAt: string;
  endedAt: string | null;
  /** How much of it: minutes, sets, a module's step count. Never an outcome. */
  dose: Record<string, unknown>;
  /** The circumstances §6 strata are drawn from — activation at open, time of
   *  day, whether the session completed. Never an outcome either. */
  context: Record<string, unknown>;
  clinicianConfirmed: boolean;
  createdAt: string;
}

interface DefRow {
  id: string; canonical_key: string; display_name: string;
  intervention_class: string; source_scope: string; active: number; created_at: string;
}

interface InstRow {
  id: string; person_id: string; intervention_definition_id: string;
  source_type: string; source_id: string; occurred_at: string; ended_at: string | null;
  dose_json: string; context_json: string; clinician_confirmed: number; created_at: string;
}

function parseJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toDefinition(r: DefRow): InterventionDefinition {
  return {
    id: r.id,
    canonicalKey: r.canonical_key,
    displayName: r.display_name,
    interventionClass: r.intervention_class as InterventionClass,
    sourceScope: r.source_scope as SourceScope,
    active: r.active === 1,
    createdAt: r.created_at,
  };
}

function toInstance(r: InstRow): InterventionInstance {
  return {
    id: r.id,
    personId: r.person_id,
    definitionId: r.intervention_definition_id,
    sourceType: r.source_type as InstanceSourceType,
    sourceId: r.source_id,
    occurredAt: r.occurred_at,
    endedAt: r.ended_at,
    dose: parseJson(r.dose_json),
    context: parseJson(r.context_json),
    clinicianConfirmed: r.clinician_confirmed === 1,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Canonical keys
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export interface DefinitionSpec {
  canonicalKey: string;
  displayName: string;
  interventionClass: InterventionClass;
  sourceScope?: SourceScope;
}

/**
 * Fetch or create a definition, idempotently within the tenant.
 *
 * The registry is per tenant because a canonical vocabulary is an
 * organizational agreement, not a universal one. Two clinicians in one practice
 * calling the same thing by one name is what makes their patients' evidence
 * comparable; two organizations agreeing is not something Steady can assert.
 *
 * An existing definition is returned UNCHANGED. A caller passing a different
 * display name does not get to rename an intervention as a side effect of
 * recording an instance of it — renaming is `renameDefinition`, which is
 * deliberate and audited.
 */
export async function ensureDefinition(
  ctx: TenantContext, spec: DefinitionSpec
): Promise<InterventionDefinition> {
  const r = repo(ctx);
  const existing = await r.findOne<DefRow>(
    "intervention_definitions", "canonical_key = ?", [spec.canonicalKey]
  );
  if (existing) return toDefinition(existing);

  const id = ulid();
  await r.insert("intervention_definitions", {
    id,
    canonical_key: spec.canonicalKey,
    display_name: spec.displayName,
    intervention_class: spec.interventionClass,
    source_scope: spec.sourceScope ?? "steady_native",
    active: 1,
  });
  // Re-read rather than construct: a concurrent insert loses the UNIQUE race
  // and we want the winner's row, not a local object describing a row that
  // isn't there.
  const row = await r.findOne<DefRow>(
    "intervention_definitions", "canonical_key = ?", [spec.canonicalKey]
  );
  if (!row) throw new InterventionError("Failed to register the intervention definition.");
  return toDefinition(row);
}

export async function listDefinitions(
  ctx: TenantContext, opts: { includeInactive?: boolean } = {}
): Promise<InterventionDefinition[]> {
  const rows = await repo(ctx).findMany<DefRow>(
    "intervention_definitions",
    opts.includeInactive ? undefined : "active = 1",
    [],
    { orderBy: "display_name ASC" }
  );
  return rows.map(toDefinition);
}

export async function getDefinition(
  ctx: TenantContext, id: string
): Promise<InterventionDefinition | null> {
  const row = await repo(ctx).findOne<DefRow>("intervention_definitions", "id = ?", [id]);
  return row ? toDefinition(row) : null;
}

/** Manual clinician normalization (§12, Phase 1): give a definition the name
 *  the practice actually uses. The canonical key does not move, so no evidence
 *  is re-pointed by a rename. */
export async function renameDefinition(
  ctx: TenantContext, id: string, displayName: string
): Promise<void> {
  const name = displayName.trim();
  if (!name) throw new InterventionError("An intervention needs a display name.");
  await repo(ctx).update("intervention_definitions", { display_name: name }, "id = ?", [id]);
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

export interface RecordInstanceArgs {
  personId: string;
  definitionId: string;
  sourceType: InstanceSourceType;
  sourceId: string;
  occurredAt: string;
  endedAt?: string | null;
  dose?: Record<string, unknown>;
  context?: Record<string, unknown>;
  clinicianConfirmed?: boolean;
  /** Who caused the exposure to be recorded, for the event. */
  actorId?: string | null;
}

/**
 * Record one exposure, idempotently on (source_type, source_id).
 *
 * IDEMPOTENCY IS THE POINT, not an optimization. §12's definition of done is
 * "instances reconstruct from source events" — a reconstruction that produced a
 * second instance every time it ran would make the support count in §6 a
 * function of how often the adapter had been invoked, which is the least
 * clinical number imaginable.
 *
 * A re-run refreshes dose and context (a session that has since closed now has
 * an end and a status) but never resets `clinician_confirmed`: a person's
 * review of the normalization is not an adapter's to undo.
 */
export async function recordInstance(
  ctx: TenantContext, args: RecordInstanceArgs
): Promise<InterventionInstance> {
  const r = repo(ctx);
  // The definition must be one THIS tenant can see. The foreign key on the
  // column is global — it only asks that the row exist somewhere — so without
  // this check an instance in one organization could be filed against another
  // organization's canonical intervention, and every count drawn from it would
  // be a count across a tenant boundary. `findOne` returns null for a foreign
  // row exactly as if it did not exist, so this leaks nothing about whether the
  // id is real (ADR 0011 §3).
  if (!(await r.exists("intervention_definitions", "id = ?", [args.definitionId]))) {
    throw new InterventionError("No such intervention definition.");
  }
  const existing = await r.findOne<InstRow>(
    "intervention_instances", "source_type = ? AND source_id = ?", [args.sourceType, args.sourceId]
  );

  if (existing) {
    await r.update(
      "intervention_instances",
      {
        intervention_definition_id: args.definitionId,
        occurred_at: args.occurredAt,
        ended_at: args.endedAt ?? null,
        dose_json: JSON.stringify(args.dose ?? {}),
        context_json: JSON.stringify(args.context ?? {}),
        ...(args.clinicianConfirmed ? { clinician_confirmed: 1 } : {}),
      },
      "id = ?",
      [existing.id]
    );
    const row = await r.findOne<InstRow>("intervention_instances", "id = ?", [existing.id]);
    return toInstance(row!);
  }

  const id = ulid();
  await r.insert("intervention_instances", {
    id,
    person_id: args.personId,
    intervention_definition_id: args.definitionId,
    source_type: args.sourceType,
    source_id: args.sourceId,
    occurred_at: args.occurredAt,
    ended_at: args.endedAt ?? null,
    dose_json: JSON.stringify(args.dose ?? {}),
    context_json: JSON.stringify(args.context ?? {}),
    clinician_confirmed: args.clinicianConfirmed ? 1 : 0,
  });
  // The event is emitted only for a NEW instance. A re-run of an adapter is not
  // a new clinical fact, and a ledger that gained a row every time a projection
  // refreshed would stop being a history of what happened to the person.
  await recordInstanceRecorded({
    instanceId: id,
    tenantId: ctx.tenantId,
    personId: args.personId,
    definitionId: args.definitionId,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    occurredAt: args.occurredAt,
    actorId: args.actorId ?? null,
  });
  const row = await r.findOne<InstRow>("intervention_instances", "id = ?", [id]);
  return toInstance(row!);
}

export async function listInstances(
  ctx: TenantContext, personId: string, opts: { limit?: number; definitionId?: string } = {}
): Promise<InterventionInstance[]> {
  const where = ["person_id = ?"];
  const params: unknown[] = [personId];
  if (opts.definitionId) {
    where.push("intervention_definition_id = ?");
    params.push(opts.definitionId);
  }
  const rows = await repo(ctx).findMany<InstRow>(
    "intervention_instances", where.join(" AND "), params,
    { orderBy: "occurred_at DESC, rowid DESC", limit: opts.limit }
  );
  return rows.map(toInstance);
}

export async function getInstance(
  ctx: TenantContext, id: string
): Promise<InterventionInstance | null> {
  const row = await repo(ctx).findOne<InstRow>("intervention_instances", "id = ?", [id]);
  return row ? toInstance(row) : null;
}

/** A clinician accepts the normalization. This is the review §8 requires before
 *  a model-proposed or adapter-inferred identity is treated as agreed. */
export async function confirmInstance(
  ctx: TenantContext, instanceId: string, clinicianId: string
): Promise<void> {
  const inst = await getInstance(ctx, instanceId);
  if (!inst) throw new InterventionError("No such intervention instance.");
  await repo(ctx).update(
    "intervention_instances", { clinician_confirmed: 1 }, "id = ?", [instanceId]
  );
  await recordInstanceRecorded({
    instanceId, tenantId: ctx.tenantId, personId: inst.personId,
    definitionId: inst.definitionId, sourceType: inst.sourceType, sourceId: inst.sourceId,
    occurredAt: inst.occurredAt, actorId: clinicianId, confirmed: true,
  });
}

/**
 * Re-point an instance at a different definition.
 *
 * The correction APPENDS: the event carries the definition it moved away from,
 * so the record of what Steady used to believe survives. §7's
 * `pattern_corrected` exists for exactly this — "normalization/source mapping
 * corrected without erasing prior history".
 */
export async function remapInstance(
  ctx: TenantContext,
  args: { instanceId: string; toDefinitionId: string; clinicianId: string; reason?: string }
): Promise<void> {
  const inst = await getInstance(ctx, args.instanceId);
  if (!inst) throw new InterventionError("No such intervention instance.");
  const target = await getDefinition(ctx, args.toDefinitionId);
  if (!target) throw new InterventionError("No such intervention definition.");
  if (inst.definitionId === args.toDefinitionId) return;

  await repo(ctx).update(
    "intervention_instances",
    { intervention_definition_id: args.toDefinitionId, clinician_confirmed: 1 },
    "id = ?",
    [args.instanceId]
  );
  await recordPatternCorrected({
    tenantId: ctx.tenantId,
    personId: inst.personId,
    instanceId: args.instanceId,
    fromDefinitionId: inst.definitionId,
    toDefinitionId: args.toDefinitionId,
    clinicianId: args.clinicianId,
    reason: args.reason ?? null,
  });
}

// ---------------------------------------------------------------------------
// Adapters (§10)
// ---------------------------------------------------------------------------

// Which class a Steady practice belongs to.
//
// EXPLICIT PER PRACTICE, not derived from `practice_type`, because the type is
// a delivery format and the class is a clinical function. Every meditation in
// the catalog is `type: "meditation"`, but "orienting to now" is grounding — it
// brings attention back to the room — while "a place of calm" is resourcing, an
// internal resource being built. Collapsing them onto the format would put a
// containment exercise and a body scan in the same bucket and then invite §6 to
// compute a median over the pair.
const PRACTICE_CLASS: Record<string, InterventionClass> = {
  // Breathwork: regulation in the present.
  "coherent-5-5": "grounding",
  "extended-exhale": "grounding",
  "physiological-sigh": "grounding",
  "box-4": "grounding",
  "four-seven-eight": "grounding",
  // Meditation splits by function, not by format.
  "orienting-to-now": "grounding",
  "breath-anchor": "grounding",
  "gentle-body-scan": "grounding",
  "calm-place": "resourcing",
  "self-compassion": "resourcing",
  container: "resourcing",
  // Sleep and movement are practices with a shape and a duration.
  "wind-down-breath": "structured_practice",
  "sleep-body-scan": "structured_practice",
  "put-the-day-down": "structured_practice",
  "safe-and-warm": "structured_practice",
  "orienting-turns": "grounding",
  "grounding-stance": "grounding",
  "gentle-stretch": "structured_practice",
  "shake-it-out": "grounding",
  "push-and-press": "grounding",
  // The demo population generator writes a coarser vocabulary of its own
  // ("grounding", "breathing", "learning", "preparation", "support") rather
  // than the catalog's practice ids. They are real rows in this system's
  // practice_completions table, so they are classified here rather than left to
  // the fallback — which would file a grounding exercise as a structured
  // practice for every one of the thousands of generated people.
  grounding: "grounding",
  breathing: "grounding",
  learning: "structured_practice",
  preparation: "structured_practice",
  support: "structured_practice",
};

/** The fallback for a practice the map has not been updated for. A new
 *  breathing practice is grounding; anything else is a structured practice
 *  until someone classifies it. Conservative in the direction that matters:
 *  nothing lands in `resourcing` by accident, because resourcing is the class
 *  §5's function_after dimension leans on hardest. */
function practiceClass(practiceId: string, practiceType: string): InterventionClass {
  return (
    PRACTICE_CLASS[practiceId] ??
    (practiceType === "breathwork" || practiceType === "breathing" || practiceType === "grounding"
      ? "grounding"
      : "structured_practice")
  );
}

function prettify(id: string): string {
  const s = id.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface SessionRow {
  id: string; module_id: string; status: string;
  pre_suds: number | null; post_suds: number | null; peak_suds: number | null;
  hard_stop_reason: string | null; started_at: string; ended_at: string | null;
}

/**
 * Sessions → session_intervention instances.
 *
 * EVERY session, including the ones that did not finish. §13 is unambiguous:
 * "session response keeps hard stops and missing closes visible, consistent
 * with current Steady session-response design." A hard stop is an exposure that
 * happened, and it is the exposure a clinician most needs counted. Its status
 * travels in context so Phase 3 can stratify on it rather than having to guess
 * from a missing close.
 *
 * The context carries the OPENING activation and never the closing one. The
 * close is an outcome and belongs to Phase 2's response observations; putting
 * it here would let a Phase 1 surface display a before-and-after with no
 * threshold, no window and no evidence class in front of it — which is the
 * benefit label Phase 1 exists to not ship.
 */
export async function syncSessionInstances(
  ctx: TenantContext, personId: string, opts: { limit?: number } = {}
): Promise<InterventionInstance[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, module_id, status, pre_suds, post_suds, peak_suds, hard_stop_reason,
            started_at, ended_at
       FROM therapy_sessions
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT ?`,
    [personId, opts.limit ?? 200]
  )) as SessionRow[];

  const out: InterventionInstance[] = [];
  for (const row of rows) {
    const mod = getModule(row.module_id);
    const def = await ensureDefinition(ctx, {
      canonicalKey: nativeKey("module", row.module_id),
      displayName: mod?.name ?? prettify(row.module_id),
      interventionClass: "session_intervention",
      sourceScope: "steady_native",
    });
    out.push(
      await recordInstance(ctx, {
        personId,
        definitionId: def.id,
        sourceType: "therapy_session",
        sourceId: row.id,
        occurredAt: row.started_at,
        endedAt: row.ended_at,
        dose: { moduleId: row.module_id, tier: mod?.tier ?? null },
        context: {
          sessionStatus: row.status,
          // The reading at open — a circumstance, not an outcome.
          activationAtOpen: row.pre_suds,
          // Recorded because §5's adverse_or_hard_stop dimension must stay
          // visible, and because a session with no close is a different fact
          // from a session that closed. Neither is a benefit label.
          completed: row.status === "completed",
          hardStop: row.status === "hard_stop",
          hardStopReason: row.hard_stop_reason,
          missingClose: row.post_suds === null,
        },
        actorId: personId,
      })
    );
  }
  return out;
}

interface PracticeRow {
  id: string; practice_id: string; practice_type: string;
  duration_sec: number; created_at: string;
}

/**
 * Practice completions → grounding / resourcing / structured_practice instances.
 *
 * §10's rule for this adapter is a restriction, and it is worth restating where
 * the code is: "delayed response needs other evidence before any benefit
 * pattern." A completed practice is a BEHAVIOURAL FACT — the person did it —
 * and §5 files that under engagement_reuse with the note "not proof of
 * benefit". So this adapter records the exposure and attaches no outcome at
 * all. Whether anything followed is a question for a check-in, a measure or a
 * person, and it is asked in Phase 2.
 */
export async function syncPracticeInstances(
  ctx: TenantContext, personId: string, opts: { limit?: number } = {}
): Promise<InterventionInstance[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, practice_id, practice_type, duration_sec, created_at
       FROM practice_completions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [personId, opts.limit ?? 400]
  )) as PracticeRow[];

  const out: InterventionInstance[] = [];
  for (const row of rows) {
    const practice = getPractice(row.practice_id);
    const def = await ensureDefinition(ctx, {
      canonicalKey: nativeKey("practice", row.practice_id),
      displayName: practice?.title ?? prettify(row.practice_id),
      interventionClass: practiceClass(row.practice_id, row.practice_type),
      sourceScope: "steady_native",
    });
    out.push(
      await recordInstance(ctx, {
        personId,
        definitionId: def.id,
        sourceType: "practice_completion",
        sourceId: row.id,
        occurredAt: row.created_at,
        endedAt: null,
        dose: { durationSec: row.duration_sec, practiceType: row.practice_type },
        context: { hourOfDay: Number(row.created_at.slice(11, 13)) || 0 },
        actorId: personId,
      })
    );
  }
  return out;
}

/**
 * Rebuild this person's intervention timeline from its sources.
 *
 * Safe to call on every page load: `recordInstance` is idempotent on
 * (source_type, source_id), so this converges rather than accumulating. That is
 * what lets the surface be honest without a background job — the alternative
 * during this phase would be a screen showing whatever the last cron run
 * happened to catch.
 */
export async function syncInterventionInstances(
  ctx: TenantContext, personId: string
): Promise<InterventionInstance[]> {
  const sessions = await syncSessionInstances(ctx, personId);
  const practices = await syncPracticeInstances(ctx, personId);
  return [...sessions, ...practices].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

// ---------------------------------------------------------------------------
// Manual clinician entry (§2's external_clinician_entered)
// ---------------------------------------------------------------------------

/**
 * A clinician records an intervention that happened outside Steady.
 *
 * §2 requires a normalized key for this class, so the wording goes through
 * `normalizeCanonicalKey` and lands in the same registry as everything else —
 * which is what makes "we did cold water at the sink" countable beside a
 * grounding practice instead of being a note nobody can aggregate.
 *
 * `clinicianConfirmed` is true because a clinician typed it. That is the one
 * source where the normalization is not provisional: the person who named the
 * intervention is the person §8 would have sent it to for review.
 */
export async function recordClinicianIntervention(
  ctx: TenantContext,
  args: {
    personId: string;
    wording: string;
    interventionClass: InterventionClass;
    occurredAt: string;
    clinicianId: string;
    note?: string | null;
    sourceType?: Extract<InstanceSourceType, "clinician_entry" | "clinician_thought">;
    sourceId?: string;
  }
): Promise<InterventionInstance> {
  const wording = args.wording.trim();
  if (!wording) throw new InterventionError("An intervention needs a name.");
  const def = await ensureDefinition(ctx, {
    canonicalKey: normalizeCanonicalKey(wording),
    displayName: wording,
    interventionClass: args.interventionClass,
    sourceScope: "clinician_entered",
  });
  return recordInstance(ctx, {
    personId: args.personId,
    definitionId: def.id,
    sourceType: args.sourceType ?? "clinician_entry",
    // A clinician entry has no source row of its own, so it gets an id that is
    // unique per entry. Reusing the definition id here would make a second
    // entry of the same intervention idempotently overwrite the first — one
    // exposure where two occurred, and §6's support count reading low as a
    // result.
    sourceId: args.sourceId ?? ulid(),
    occurredAt: args.occurredAt,
    dose: {},
    context: { enteredBy: args.clinicianId, note: args.note ?? null },
    clinicianConfirmed: true,
    actorId: args.clinicianId,
  });
}
