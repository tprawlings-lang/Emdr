// Genesis backfill (ADR 0010 step 3).
//
// Reconstructs longitudinal events from the current-state tables so a member's
// history does not begin abruptly on the day dual-write shipped. Without this,
// every pre-existing member appears to have been created the moment the spine
// went live, and Handoff B's pattern jobs would see a truncated timeline.
//
// Three properties this has to have, and how each is achieved:
//
//   HONEST — a reconstructed event is not original evidence. Every genesis row
//   carries payload_version 0, source_system 'backfill', and
//   provenance.reconstructed = true, so any consumer can exclude them. The ADR
//   is explicit that they are "never presented as original evidence."
//
//   CHRONOLOGICAL — the event id is a ULID whose time component is the SOURCE
//   ROW's timestamp, not now(). Reconstructed events therefore sort into their
//   true position relative to each other and to live events.
//
//   IDEMPOTENT — the id's random component is a hash of (table, row id), so
//   re-running produces identical ids and the insert conflicts rather than
//   duplicating. No tracking table, and a partial run can simply be re-run.
//
// occurred_at is the source row's timestamp (when it happened). recorded_at is
// left to default to now (when Steady reconstructed it). That asymmetry is the
// point of having both columns.

import { data } from "./data";
import { ulidFrom } from "./ids";
import { PLATFORM_TENANT_ID } from "./db";
import type { EventType } from "./events";

export interface BackfillResult {
  scanned: number;
  inserted: number;
  byType: Record<string, number>;
  skippedNoPerson: number;
}

/** SQLite/Postgres both store timestamps as 'YYYY-MM-DD HH:MM:SS' UTC text. */
function toMs(ts: string | null | undefined, fallback = 0): number {
  if (!ts) return fallback;
  const t = Date.parse(ts.replace(" ", "T") + (ts.includes("T") ? "" : "Z"));
  return Number.isFinite(t) ? t : fallback;
}

interface GenesisRow {
  personId: string;
  type: EventType;
  occurredAt: string;
  payload: Record<string, unknown>;
  actorType?: string;
  actorId?: string | null;
  correlationId?: string | null;
  /** Stable identity of the source row: `${table}:${id}[:${discriminator}]`. */
  seed: string;
}

export async function backfillGenesisEvents(opts: { limit?: number } = {}): Promise<BackfillResult> {
  const c = await data();
  const result: BackfillResult = { scanned: 0, inserted: 0, byType: {}, skippedNoPerson: 0 };

  // Only persons that exist may receive events — the FK is real. Users created
  // before the identity spine and never reconciled are counted, not crashed on.
  const personIds = new Set(
    ((await c.all("SELECT id FROM persons", [])) as { id: string }[]).map((r) => r.id)
  );

  const rows: GenesisRow[] = [];

  // ---- Identity ----
  for (const u of (await c.all(
    "SELECT id, role, created_at FROM users", []
  )) as { id: string; role: string; created_at: string }[]) {
    rows.push({
      personId: u.id, type: "person.registered", occurredAt: u.created_at,
      payload: { role: u.role }, seed: `users:${u.id}`,
    });
  }

  // ---- Consent ----
  for (const r of (await c.all(
    "SELECT id, user_id, policy_version, scope, granted_at, revoked_at FROM consents", []
  )) as { id: string; user_id: string; policy_version: string; scope: string; granted_at: string; revoked_at: string | null }[]) {
    rows.push({
      personId: r.user_id, type: "consent.granted", occurredAt: r.granted_at,
      payload: { policyVersion: r.policy_version, scope: r.scope },
      seed: `consents:${r.id}`,
    });
    if (r.revoked_at) {
      rows.push({
        personId: r.user_id, type: "consent.withdrawn", occurredAt: r.revoked_at,
        payload: { policyVersion: r.policy_version, scope: r.scope },
        seed: `consents:${r.id}:revoked`,
      });
    }
  }

  // ---- Assessments (scores and coded flags only; raw answers stay encrypted) ----
  for (const r of (await c.all(
    "SELECT id, user_id, instrument, instrument_version, total_score, risk_flags_json, created_at FROM screenings", []
  )) as { id: string; user_id: string; instrument: string; instrument_version: string; total_score: number; risk_flags_json: string; created_at: string }[]) {
    let riskFlags: string[] = [];
    try { const v = JSON.parse(r.risk_flags_json ?? "[]"); if (Array.isArray(v)) riskFlags = v.map(String); } catch { /* keep [] */ }
    rows.push({
      personId: r.user_id, type: "assessment.scored", occurredAt: r.created_at,
      payload: {
        instrument: r.instrument, instrumentVersion: r.instrument_version,
        totalScore: r.total_score, riskFlags,
      },
      seed: `screenings:${r.id}`,
    });
  }

  // ---- Daily check-ins ----
  for (const r of (await c.all(
    `SELECT id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
            dissociation, sleep_quality, substance_flag, recommended_action, created_at
       FROM checkins`, []
  )) as Record<string, string | number>[]) {
    rows.push({
      personId: String(r.user_id), type: "daily_checkin.completed",
      occurredAt: String(r.created_at ?? r.checkin_date),
      payload: {
        checkinDate: r.checkin_date, activation: r.activation, shutdown: r.shutdown,
        dissociation: r.dissociation, sleepQuality: r.sleep_quality,
        harmUrge: r.harm_urge === 1, feelsSafe: r.feels_safe === 1,
        substanceFlag: r.substance_flag === 1, recommendedAction: r.recommended_action,
      },
      seed: `checkins:${r.id}`,
    });
  }

  // ---- Sessions: one start event, and one terminal event if it ended ----
  for (const r of (await c.all(
    `SELECT id, user_id, module_id, status, pre_suds, post_suds, peak_suds,
            hard_stop_reason, started_at, ended_at
       FROM therapy_sessions`, []
  )) as Record<string, string | number | null>[]) {
    const sid = String(r.id);
    rows.push({
      personId: String(r.user_id), type: "session.started",
      occurredAt: String(r.started_at),
      payload: { sessionId: sid, moduleId: r.module_id },
      correlationId: sid, seed: `therapy_sessions:${sid}:started`,
    });
    if (r.ended_at) {
      const hardStopped = r.status === "hard_stop";
      rows.push({
        personId: String(r.user_id),
        type: hardStopped ? "session.hard_stopped" : "session.completed",
        occurredAt: String(r.ended_at),
        payload: {
          sessionId: sid, moduleId: r.module_id, status: r.status,
          preSuds: r.pre_suds, postSuds: r.post_suds, peakSuds: r.peak_suds,
          hardStopReason: r.hard_stop_reason,
        },
        correlationId: sid, seed: `therapy_sessions:${sid}:ended`,
      });
    }
  }

  // ---- Interventions ----
  for (const r of (await c.all(
    "SELECT id, user_id, practice_id, practice_type, duration_sec, created_at FROM practice_completions", []
  )) as Record<string, string | number>[]) {
    rows.push({
      personId: String(r.user_id), type: "intervention.completed",
      occurredAt: String(r.created_at),
      payload: {
        interventionId: r.practice_id, interventionType: r.practice_type,
        interventionVersion: "unversioned", durationSec: r.duration_sec,
      },
      seed: `practice_completions:${r.id}`,
    });
  }

  // ---- Lessons ----
  for (const r of (await c.all(
    "SELECT id, user_id, lesson_id, created_at FROM lesson_reads", []
  )) as Record<string, string>[]) {
    rows.push({
      personId: r.user_id, type: "lesson.read", occurredAt: r.created_at,
      payload: { lessonId: r.lesson_id }, seed: `lesson_reads:${r.id}`,
    });
  }

  // ---- Memory (type/key/source only — values stay encrypted) ----
  for (const r of (await c.all(
    "SELECT id, user_id, memory_type, memory_key, source_type, created_at FROM ai_memory_items WHERE active = 1", []
  )) as Record<string, string>[]) {
    rows.push({
      personId: r.user_id, type: "memory.recorded", occurredAt: r.created_at,
      payload: { memoryType: r.memory_type, key: r.memory_key, source: r.source_type },
      actorType: r.source_type === "user_message" ? "patient" : "system",
      seed: `ai_memory_items:${r.id}`,
    });
  }

  // ---- Clinician unlock decisions ----
  for (const r of (await c.all(
    `SELECT id, user_id, module_id, status, override, decided_at, clinician_id
       FROM module_unlocks WHERE decided_at IS NOT NULL`, []
  )) as Record<string, string | number | null>[]) {
    rows.push({
      personId: String(r.user_id), type: "module_unlock.decided",
      occurredAt: String(r.decided_at),
      payload: { moduleId: r.module_id, decision: r.status, override: r.override === 1 },
      actorType: "clinician", actorId: r.clinician_id ? String(r.clinician_id) : null,
      seed: `module_unlocks:${r.id}`,
    });
  }

  // ---- Insert ----
  const ordered = rows.sort((a, b) => toMs(a.occurredAt) - toMs(b.occurredAt));
  const slice = opts.limit ? ordered.slice(0, opts.limit) : ordered;
  result.scanned = slice.length;

  for (const row of slice) {
    if (!personIds.has(row.personId)) { result.skippedNoPerson++; continue; }
    const id = ulidFrom(toMs(row.occurredAt), `${row.seed}`);
    const before = await c.get("SELECT 1 AS x FROM longitudinal_events WHERE id = ?", [id]);
    if (before) continue;
    await c.run(
      `INSERT INTO longitudinal_events
         (id, tenant_id, person_id, event_type, payload_version, payload,
          actor_id, actor_type, occurred_at, source_system, provenance, correlation_id)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'backfill', ?, ?)`,
      [
        id, PLATFORM_TENANT_ID, row.personId, row.type,
        JSON.stringify(row.payload),
        row.actorId ?? row.personId,
        row.actorType ?? "patient",
        row.occurredAt,
        JSON.stringify({ reconstructed: true, sourceRow: row.seed }),
        row.correlationId ?? null,
      ]
    );
    result.inserted++;
    result.byType[row.type] = (result.byType[row.type] ?? 0) + 1;
  }
  return result;
}

/** Reconstructed events are excluded from anything that must rest on original
 *  evidence — model evaluation, outcome attribution, the Learning Ledger. */
export function isReconstructed(e: { payload_version: number; source_system: string }): boolean {
  return e.payload_version === 0 || e.source_system === "backfill";
}
