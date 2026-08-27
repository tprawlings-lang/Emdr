// Rebuilding current-state tables from the event log (ADR 0010 steps 3–4).
//
// ADR 0010 §2 redefines the current-state tables as *projections* of
// `longitudinal_events`. §3 is blunt about what makes that claim real:
//
//   > A test asserts that a full rebuild produces byte-identical projections to
//   > the incremental path. Without this test the spine is decorative — it is
//   > the difference between claiming replay and having it.
//
// This module is the rebuild. It reads events in id order (ULIDs, so that is
// append order) and folds them into a set of *shadow* tables — never the live
// ones. That is deliberate: a rebuild that truncates live tables to prove
// itself is not something to run against a PHI database, and a verifier that
// can destroy data is a worse liability than the drift it detects.
//
//   rebuildProjections()  → fold events into spine_rebuild_* tables
//   verifyProjections()   → rebuild, then diff live vs rebuilt, column by column
//
// WHAT IS AND IS NOT A PROJECTION
//
// Not every table can be rebuilt from events, and the ones that cannot are a
// design decision rather than an omission:
//
//   * `users` / `accounts` hold credentials. Events deliberately never carry a
//     password hash, so identity is reconstructable but *authentication* is not.
//   * `screenings` holds encrypted item-level responses; the event carries the
//     score and coded risk flags only.
//   * `ai_memory_items` holds encrypted memory values; the event carries the
//     type, key, and source.
//
// In each case the event records the coded structure and the protected content
// stays in its own governance zone (ADR 0009 §1). You cannot rebuild from
// events what the events were designed never to contain — so those tables are
// *partial* projections, and PROJECTED_TABLES below is the honest list of the
// ones a rebuild reproduces in full.

import { data } from "./data";
import type { DataClient } from "./data";
import { readEvents, type LongitudinalEvent } from "./events";

/** Tables fully reconstructable from the event log. */
export const PROJECTED_TABLES = [
  "checkins",
  "therapy_sessions",
  "practice_completions",
  "lesson_reads",
  "consents",
  "module_unlocks",
] as const;

export type ProjectedTable = (typeof PROJECTED_TABLES)[number];

const SHADOW_PREFIX = "spine_rebuild_";
const shadow = (t: string) => `${SHADOW_PREFIX}${t}`;

// ---------------------------------------------------------------------------
// Shadow table lifecycle
// ---------------------------------------------------------------------------

/** Empty copies of the live tables: same columns and types, no constraints.
 *  Dropping the constraints is intentional — the rebuild replays history whose
 *  foreign keys may reference rows outside the replay window, and a byte
 *  comparison cares about values, not about indexes. */
async function createShadowTables(c: DataClient): Promise<void> {
  for (const t of PROJECTED_TABLES) {
    await c.run(`DROP TABLE IF EXISTS ${shadow(t)}`);
    await c.run(`CREATE TABLE ${shadow(t)} AS SELECT * FROM ${t} WHERE 1 = 0`);
  }
}

export async function dropShadowTables(): Promise<void> {
  const c = await data();
  for (const t of PROJECTED_TABLES) await c.run(`DROP TABLE IF EXISTS ${shadow(t)}`);
}

/** Update the row if it is there, insert it otherwise. Written by hand rather
 *  than as ON CONFLICT because the shadow tables carry no unique indexes for a
 *  conflict target to name. */
async function upsert(
  c: DataClient, table: string, id: string, values: Record<string, unknown>,
  /** Columns written when the row is created and left alone afterwards. The
   *  live writes behave the same way — a second check-in on a day updates the
   *  scores but keeps the original `created_at`, and a re-requested unlock keeps
   *  the clinician who last touched it. Overwriting them on replay is the
   *  difference between a projection and an approximation. */
  insertOnly: Record<string, unknown> = {}
): Promise<void> {
  const cols = Object.keys(values);
  if (cols.length > 0) {
    const r = await c.run(
      `UPDATE ${table} SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
      [...cols.map((k) => values[k]), id]
    );
    if (r.changes > 0) return;
  }
  const all: Record<string, unknown> = { id, ...insertOnly, ...values };
  const keys = Object.keys(all);
  await c.run(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    keys.map((k) => all[k])
  );
}

/** Patch an existing row and do nothing if it is absent. Used for the terminal
 *  half of a lifecycle (a session ending, a consent being withdrawn) where the
 *  opening event may fall outside the replay window. */
async function patch(
  c: DataClient, table: string, id: string, values: Record<string, unknown>
): Promise<void> {
  const cols = Object.keys(values);
  if (cols.length === 0) return;
  await c.run(
    `UPDATE ${table} SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...cols.map((k) => values[k]), id]
  );
}

async function insertIfAbsent(
  c: DataClient, table: string, id: string, values: Record<string, unknown>
): Promise<void> {
  const existing = await c.get(`SELECT 1 AS x FROM ${table} WHERE id = ?`, [id]);
  if (existing) return;
  const all: Record<string, unknown> = { id, ...values };
  const keys = Object.keys(all);
  await c.run(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    keys.map((k) => all[k])
  );
}

// ---------------------------------------------------------------------------
// Projectors
// ---------------------------------------------------------------------------

const bit = (v: unknown) => (v === true || v === 1 || v === "1" ? 1 : 0);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Resolves a logical table name to the physical one being written: the live
 *  table during a command, the shadow copy during verification. */
export type TableTarget = (table: ProjectedTable) => string;

const LIVE: TableTarget = (t) => t;
const SHADOW: TableTarget = (t) => shadow(t);

type Projector = (
  c: DataClient, ev: LongitudinalEvent, pid: string, at: TableTarget
) => Promise<void>;

/** Which current-state row each event type produces, and how.
 *
 *  `pid` is the payload's `projectionId` — the primary key of the target row.
 *  Events written before that field existed (payload_version 1) cannot be
 *  projected: the rebuild reports them rather than inventing an id, because an
 *  invented id is silent drift and a reported gap is a fact. */
const PROJECTORS: Partial<Record<string, Projector>> = {
  "daily_checkin.completed": async (c, ev, pid, at) => {
    const p = ev.payload;
    await upsert(c, at("checkins"), pid, {
      user_id: ev.person_id,
      tenant_id: ev.tenant_id,
      checkin_date: str(p.checkinDate),
      activation: num(p.activation),
      shutdown: num(p.shutdown),
      harm_urge: bit(p.harmUrge),
      feels_safe: bit(p.feelsSafe),
      dissociation: num(p.dissociation),
      sleep_quality: num(p.sleepQuality),
      substance_flag: bit(p.substanceFlag),
      recommended_action: str(p.recommendedAction),
      triggers_json: JSON.stringify(Array.isArray(p.triggerIds) ? p.triggerIds : []),
    }, { created_at: ev.occurred_at });
  },

  "session.started": async (c, ev, pid, at) => {
    const p = ev.payload;
    await upsert(c, at("therapy_sessions"), pid, {
      user_id: ev.person_id,
      tenant_id: ev.tenant_id,
      module_id: str(p.moduleId),
      status: "in_progress",
      pre_suds: null, post_suds: null, peak_suds: null, hard_stop_reason: null,
      detail_json: JSON.stringify(p.focus ? { focus: p.focus } : {}),
      started_at: ev.occurred_at,
      ended_at: null,
    });
  },

  "session.completed": async (c, ev, pid, at) => projectSessionEnd(c, ev, pid, at),
  "session.hard_stopped": async (c, ev, pid, at) => projectSessionEnd(c, ev, pid, at),

  "intervention.completed": async (c, ev, pid, at) => {
    const p = ev.payload;
    await upsert(c, at("practice_completions"), pid, {
      user_id: ev.person_id,
      tenant_id: ev.tenant_id,
      practice_id: str(p.interventionId),
      practice_type: str(p.interventionType),
      duration_sec: num(p.durationSec) ?? 0,
      created_at: ev.occurred_at,
    });
  },

  // A re-read of a lesson is a no-op on the current-state row (the live write is
  // ON CONFLICT DO NOTHING), so the projection keeps the first read's timestamp.
  "lesson.read": async (c, ev, pid, at) => {
    await insertIfAbsent(c, at("lesson_reads"), pid, {
      user_id: ev.person_id,
      tenant_id: ev.tenant_id,
      lesson_id: str(ev.payload.lessonId),
      created_at: ev.occurred_at,
    });
  },

  "consent.granted": async (c, ev, pid, at) => {
    const p = ev.payload;
    await upsert(c, at("consents"), pid, {
      user_id: ev.person_id,
      tenant_id: ev.tenant_id,
      policy_version: str(p.policyVersion),
      scope: str(p.scope),
      granted_at: ev.occurred_at,
      revoked_at: null,
    });
  },

  // A withdrawal closes an existing grant; it never opens a row of its own.
  "consent.withdrawn": async (c, ev, pid, at) => {
    await patch(c, at("consents"), pid, { revoked_at: ev.occurred_at });
  },

  "module_unlock.requested": async (c, ev, pid, at) => {
    const p = ev.payload;
    // Mirrors the live upsert exactly: a re-request resets the status, note,
    // and timestamps but leaves the clinician and override flag from any earlier
    // decision in place.
    await upsert(c, at("module_unlocks"), pid, {
      user_id: ev.person_id,
      tenant_id: ev.tenant_id,
      module_id: str(p.moduleId),
      status: "requested",
      member_note: str(p.memberNote),
      decision_reason: null,
      requested_at: ev.occurred_at,
      decided_at: null,
    }, { clinician_id: null, override: 0 });
  },

  // A clinician can decide on a request that was never made through the product
  // (a direct grant), so this opens the row when it is absent rather than
  // assuming a preceding request event.
  "module_unlock.decided": async (c, ev, pid, at) => {
    const p = ev.payload;
    await upsert(c, at("module_unlocks"), pid, {
      user_id: ev.person_id,
      tenant_id: ev.tenant_id,
      module_id: str(p.moduleId),
      status: str(p.decision),
      clinician_id: ev.actor_id,
      decision_reason: str(p.decisionReason),
      override: bit(p.override),
      decided_at: ev.occurred_at,
    }, { member_note: null, requested_at: ev.occurred_at });
  },
};

async function projectSessionEnd(
  c: DataClient, ev: LongitudinalEvent, pid: string, at: TableTarget
): Promise<void> {
  const p = ev.payload;
  const values: Record<string, unknown> = {
    status: str(p.status),
    pre_suds: num(p.preSuds),
    post_suds: num(p.postSuds),
    peak_suds: num(p.peakSuds),
    hard_stop_reason: str(p.hardStopReason),
    ended_at: ev.occurred_at,
  };
  if (p.detail && typeof p.detail === "object") values.detail_json = JSON.stringify(p.detail);
  await patch(c, at("therapy_sessions"), pid, values);
}

// ---------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------

export interface RebuildGap {
  eventId: string;
  eventType: string;
  payloadVersion: number;
  reason: string;
}

export interface RebuildResult {
  events: number;
  applied: number;
  /** Events with no projector — safety, inference, memory and the rest. Not a
   *  problem: they carry history the current-state tables never held. */
  noProjector: number;
  /** Events a projector exists for but which cannot be applied. */
  gaps: RebuildGap[];
}

export interface RebuildOptions {
  personId?: string;
  tenantId?: string;
  /** Replay only what the system knew at this instant — the point-in-time
   *  reconstruction Handoff D4/D6 needs, with no future-data leakage. */
  asOf?: string;
}

/** Fold the event log into the shadow tables. */
export async function rebuildProjections(opts: RebuildOptions = {}): Promise<RebuildResult> {
  const c = await data();
  await createShadowTables(c);

  const events = await readEvents({
    personId: opts.personId, tenantId: opts.tenantId, asOf: opts.asOf,
  });
  const result: RebuildResult = { events: events.length, applied: 0, noProjector: 0, gaps: [] };

  for (const ev of events) {
    const project = PROJECTORS[ev.event_type];
    if (!project) { result.noProjector++; continue; }

    const pid = ev.payload.projectionId;
    if (typeof pid !== "string" || pid.length === 0) {
      result.gaps.push({
        eventId: ev.id, eventType: ev.event_type, payloadVersion: ev.payload_version,
        reason:
          "no projectionId in payload — written before the current-state key was " +
          "carried (payload_version 1); the row it produced cannot be identified",
      });
      continue;
    }
    await project(c, ev, pid, SHADOW);
    result.applied++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Live application (ADR 0013 §3)
// ---------------------------------------------------------------------------

/** Apply one event to the LIVE current-state tables.
 *
 *  This is the other half of the transaction an authoritative command opens:
 *  append the event, then fold it into the projection, both or neither.
 *
 *  It shares its projectors with `rebuildProjections` on purpose. The whole
 *  claim of ADR 0010 step 4 is that replay reproduces what the incremental path
 *  wrote — a claim that only holds if the two ARE the same code. A separate
 *  live implementation that happens to agree today is a byte-identity test
 *  measuring a coincidence.
 *
 *  Returns false when the event type has no projector (safety, inference and
 *  memory events carry history the current-state tables never held), so a
 *  caller can tell "nothing to project" from "projected". */
export async function applyProjection(c: DataClient, ev: LongitudinalEvent): Promise<boolean> {
  const project = PROJECTORS[ev.event_type];
  if (!project) return false;

  const pid = ev.payload.projectionId;
  if (typeof pid !== "string" || pid.length === 0) {
    throw new Error(
      `Event ${ev.id} (${ev.event_type}, payload_version ${ev.payload_version}) has no ` +
      `projectionId, so the row it should produce cannot be identified. An authoritative ` +
      `command may not fall back to inventing one.`
    );
  }
  await project(c, ev, pid, LIVE);
  return true;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface RowDiff {
  table: string;
  id: string;
  kind: "missing_in_rebuild" | "extra_in_rebuild" | "differs";
  /** For "differs": column → [live, rebuilt]. */
  columns?: Record<string, [unknown, unknown]>;
}

export interface VerifyResult {
  identical: boolean;
  rebuild: RebuildResult;
  /** Rows compared per table. */
  compared: Record<string, number>;
  diffs: RowDiff[];
}

/** Columns excluded from the comparison, with a reason for each. */
const IGNORED_COLUMNS: Record<string, string> = {
  // No current-state table has one today; listed so the exclusion is a decision
  // rather than an accident if one is added.
};

function normalize(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  // SQLite and Postgres disagree on whether a small integer comes back as a
  // number or a string; the comparison is about values, not driver typing.
  if (typeof v === "bigint") return Number(v);
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  const x = normalize(a), y = normalize(b);
  if (x === y) return true;
  if (x === null || y === null) return false;
  if (typeof x === "number" || typeof y === "number") return Number(x) === Number(y);
  return String(x) === String(y);
}

/** Rebuild from events and diff the result against the live tables.
 *
 *  Scoped to persons that have events: a live row for someone with no history
 *  in the spine is out of scope for a replay, and counting it as a difference
 *  would make the check fail for a reason replay cannot fix. */
export async function verifyProjections(opts: RebuildOptions = {}): Promise<VerifyResult> {
  const rebuild = await rebuildProjections(opts);
  const c = await data();

  const known = ((await c.all(
    `SELECT DISTINCT person_id FROM longitudinal_events${opts.personId ? " WHERE person_id = ?" : ""}`,
    opts.personId ? [opts.personId] : []
  )) as { person_id: string }[]).map((r) => r.person_id);

  const diffs: RowDiff[] = [];
  const compared: Record<string, number> = {};

  for (const table of PROJECTED_TABLES) {
    if (known.length === 0) { compared[table] = 0; continue; }
    const inList = known.map(() => "?").join(",");
    const live = (await c.all(
      `SELECT * FROM ${table} WHERE user_id IN (${inList}) ORDER BY id`, known
    )) as Record<string, unknown>[];
    const built = (await c.all(
      `SELECT * FROM ${shadow(table)} WHERE user_id IN (${inList}) ORDER BY id`, known
    )) as Record<string, unknown>[];

    const liveById = new Map(live.map((r) => [String(r.id), r]));
    const builtById = new Map(built.map((r) => [String(r.id), r]));
    compared[table] = liveById.size;

    for (const [id, lrow] of liveById) {
      const brow = builtById.get(id);
      if (!brow) { diffs.push({ table, id, kind: "missing_in_rebuild" }); continue; }
      const cols: Record<string, [unknown, unknown]> = {};
      for (const k of Object.keys(lrow)) {
        if (k in IGNORED_COLUMNS) continue;
        if (!sameValue(lrow[k], brow[k])) cols[k] = [lrow[k], brow[k]];
      }
      if (Object.keys(cols).length > 0) diffs.push({ table, id, kind: "differs", columns: cols });
    }
    for (const id of builtById.keys()) {
      if (!liveById.has(id)) diffs.push({ table, id, kind: "extra_in_rebuild" });
    }
  }

  return { identical: diffs.length === 0 && rebuild.gaps.length === 0, rebuild, compared, diffs };
}

/** A one-line-per-difference report. Exists so a failing replay says *what*
 *  drifted rather than only *that* it did — the difference between a check that
 *  gets fixed and one that gets deleted. */
export function formatVerifyResult(v: VerifyResult): string {
  const lines: string[] = [];
  lines.push(
    `events=${v.rebuild.events} applied=${v.rebuild.applied} ` +
    `no-projector=${v.rebuild.noProjector} gaps=${v.rebuild.gaps.length}`
  );
  for (const [t, n] of Object.entries(v.compared)) lines.push(`  ${t}: ${n} row(s) compared`);
  for (const g of v.rebuild.gaps) {
    lines.push(`  GAP ${g.eventType} v${g.payloadVersion} ${g.eventId}: ${g.reason}`);
  }
  for (const d of v.diffs) {
    if (d.kind === "differs") {
      const cols = Object.entries(d.columns ?? {})
        .map(([k, [a, b]]) => `${k}: live=${JSON.stringify(a)} rebuilt=${JSON.stringify(b)}`)
        .join("; ");
      lines.push(`  DIFF ${d.table}#${d.id} ${cols}`);
    } else {
      lines.push(`  ${d.kind.toUpperCase()} ${d.table}#${d.id}`);
    }
  }
  return lines.join("\n");
}
