import { getDb } from "./db";

export type EventFamily =
  | "identity"
  | "consent"
  | "clinical"
  | "module_runtime"
  | "specialist_action"
  | "billing"
  | "security";

// Append-only audit trail. Every consent, gating result, session event,
// and clinician decision must pass through here so the trail is complete.
export function audit(args: {
  actorId?: string | null;
  actorRole?: string | null;
  family: EventFamily;
  type: string;
  target?: string | null;
  detail?: Record<string, unknown>;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (actor_id, actor_role, event_family, event_type, target, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    args.actorId ?? null,
    args.actorRole ?? null,
    args.family,
    args.type,
    args.target ?? null,
    JSON.stringify(args.detail ?? {})
  );
}

export interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  event_family: string;
  event_type: string;
  target: string | null;
  detail_json: string;
  created_at: string;
}

export function recentAuditEvents(limit = 200): AuditRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit) as AuditRow[];
}
