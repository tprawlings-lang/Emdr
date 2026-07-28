import crypto from "crypto";
import { data } from "./data";

export type EventFamily =
  | "identity"
  | "consent"
  | "clinical"
  | "module_runtime"
  | "specialist_action"
  | "billing"
  | "security"
  // Coded in-session safety events (compliance 4B.4): types and ids only,
  // never user content.
  | "safety";

// Canonical string hashed into the chain. Order-fixed and delimiter-escaped so
// two different rows can never serialize to the same bytes.
function canonical(fields: {
  prevHash: string;
  actorId: string | null;
  actorRole: string | null;
  family: string;
  type: string;
  target: string | null;
  detailJson: string;
  createdAt: string;
}): string {
  return [
    fields.prevHash,
    fields.actorId ?? "",
    fields.actorRole ?? "",
    fields.family,
    fields.type,
    fields.target ?? "",
    fields.detailJson,
    fields.createdAt,
  ]
    .map((s) => String(s).replace(/\|/g, "\\|"))
    .join("|");
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

const GENESIS = "0".repeat(64);

// Fixed 64-bit key for the audit-chain advisory lock. `hashtext` is stable
// across sessions and Postgres versions, so every instance derives the same
// key and contends on the same lock. Namespaced string keeps it from colliding
// with any other advisory lock the app might take later.
const AUDIT_LOCK_KEY_SQL = "hashtext('emdr_audit_chain')";

// Append-only, tamper-evident audit trail. Every consent, gating result,
// session event, and clinician decision passes through here. Each row is
// hash-chained to the previous one: entry_hash = sha256(prev_hash + content),
// so any retroactive edit or deletion breaks the chain from that point on
// (detectable via verifyAuditChain).
//
// Concurrency: the read-latest-then-append must be serialized, or two writers
// can read the same chain tip and fork it. On SQLite that's free — better-
// sqlite3 is synchronous and single-writer, so one process appends at a time.
// On Postgres (multi-instance) we take a transaction-scoped advisory lock at
// the top of the transaction; it serializes all appenders and auto-releases on
// COMMIT/ROLLBACK. An advisory lock (not SELECT..FOR UPDATE) is used so the
// empty-table / genesis case is covered too — there is no row to lock yet.
export async function audit(args: {
  actorId?: string | null;
  actorRole?: string | null;
  family: EventFamily;
  type: string;
  target?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const detailJson = JSON.stringify(args.detail ?? {});
  const createdAt = new Date().toISOString();

  const c = await data();
  await c.tx(async (t) => {
    // Serialize concurrent appenders before reading the chain tip. Postgres
    // only; the lock statement is not valid SQLite (and SQLite needs no lock).
    if (c.backend === "postgres") {
      await t.get(`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY_SQL})`);
    }

    const prev = (await t.get(
      "SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1"
    )) as { entry_hash: string | null } | undefined;
    const prevHash = prev?.entry_hash ?? GENESIS;

    const entryHash = sha256(
      canonical({
        prevHash,
        actorId: args.actorId ?? null,
        actorRole: args.actorRole ?? null,
        family: args.family,
        type: args.type,
        target: args.target ?? null,
        detailJson,
        createdAt,
      })
    );

    await t.run(
      `INSERT INTO audit_log (actor_id, actor_role, event_family, event_type, target, detail_json, created_at, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.actorId ?? null,
        args.actorRole ?? null,
        args.family,
        args.type,
        args.target ?? null,
        detailJson,
        createdAt,
        prevHash,
        entryHash,
      ]
    );
  });
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
  prev_hash: string | null;
  entry_hash: string | null;
}

export async function recentAuditEvents(limit = 200): Promise<AuditRow[]> {
  const c = await data();
  return (await c.all("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", [limit])) as AuditRow[];
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  /** id of the first row whose hash does not match (tamper point), if any. */
  brokenAtId?: number;
  reason?: string;
}

/**
 * Recompute the hash chain over every audit row in id order and confirm each
 * link. Any edited detail, changed actor, or deleted row (which orphans the
 * prev_hash link) is reported as a break. Rows written before the chain
 * columns existed (entry_hash NULL) are skipped until the first chained row,
 * so the check is meaningful on databases that predate this feature.
 */
export async function verifyAuditChain(): Promise<ChainVerification> {
  const c = await data();
  const rows = (await c.all(
    "SELECT id, actor_id, actor_role, event_family, event_type, target, detail_json, created_at, prev_hash, entry_hash FROM audit_log ORDER BY id ASC"
  )) as AuditRow[];

  let prevHash: string | null = null;
  let checked = 0;
  for (const r of rows) {
    if (r.entry_hash === null) continue; // legacy pre-chain row
    const expectedPrev = prevHash ?? r.prev_hash ?? GENESIS;
    if (r.prev_hash !== expectedPrev) {
      return { ok: false, checked, brokenAtId: r.id, reason: "prev_hash link mismatch (row inserted or deleted)" };
    }
    const recomputed = sha256(
      canonical({
        prevHash: r.prev_hash ?? GENESIS,
        actorId: r.actor_id,
        actorRole: r.actor_role,
        family: r.event_family,
        type: r.event_type,
        target: r.target,
        detailJson: r.detail_json,
        createdAt: r.created_at,
      })
    );
    if (recomputed !== r.entry_hash) {
      return { ok: false, checked, brokenAtId: r.id, reason: "entry_hash mismatch (row content altered)" };
    }
    prevHash = r.entry_hash;
    checked++;
  }
  return { ok: true, checked };
}
