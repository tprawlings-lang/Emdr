// Clinical audit history (workflow spec §7, Phase 4).
//
// The platform already keeps a hash-chained audit log. What Phase 4 needs is
// different from a log viewer: a clinician looking at one member has to be able
// to answer "who touched this record, when, and why", and a reviewer has to be
// able to follow one alert from the moment it was raised to the moment someone
// closed it and said what they did.
//
// Three properties this file exists to hold:
//
//   TENANT SCOPE. `audit_log` carries no tenant column — it predates ADR 0011
//   and is deliberately outside TENANT_SCOPED_TABLES, because its rows are
//   actor/target references rather than person-scoped records. So scope is
//   applied by resolving actor and target through `users` and keeping only rows
//   that land inside the caller's tenant. That is a VIEW-LEVEL filter, not row
//   level security, and `scopeNote()` says so on the page rather than letting
//   the page imply otherwise.
//
//   NO CONTENT. An audit detail may carry a free-text note a clinician typed.
//   The same denylist the timeline uses applies here, because "the audit view"
//   is exactly the surface where content leaks back in without anyone deciding
//   that it should.
//
//   TAMPER EVIDENCE, SHOWN. The chain is verified and its result displayed. An
//   append-only claim nobody checks is a claim, not a control.

import { data } from "../data";
import { verifyAuditChain, type AuditRow, type ChainVerification } from "../audit";

/** Detail keys that may carry member content or clinician free text. Mirrors
 *  timeline.ts — the two lists are separate on purpose: this one governs a
 *  staff-facing audit surface and must be able to diverge without silently
 *  widening the member-facing one. */
const NEVER_DISPLAY = new Set([
  "value", "text", "transcript", "answers", "note", "note_text", "message",
  "reason", "rationale", "resolution", "email",
]);

/** What an audit entry is about, for grouping in the UI. */
export type AuditKind =
  | "access"        // someone read or entered
  | "clinical"      // a clinical decision or record change
  | "safety"        // a safety-family event
  | "consent"       // consent granted, withdrawn, or checked
  | "alert"         // alert lifecycle
  | "other";

export interface AuditEntry {
  id: number;
  at: string;
  kind: AuditKind;
  family: string;
  type: string;
  actorId: string | null;
  actorRole: string | null;
  actorLabel: string;
  target: string | null;
  /** Content-stripped detail. Never the raw payload. */
  detail: Record<string, unknown>;
  /** True when the entry's detail carried fields that were withheld. */
  redacted: boolean;
  /** Present once the row is chained. A null hash is reported, not hidden. */
  chained: boolean;
}

const KIND_FOR: Array<[RegExp, AuditKind]> = [
  [/^alert_/, "alert"],
  [/consent/, "consent"],
  [/login|session|review_access|review_persona|impersonat/, "access"],
  [/crisis|safety|kill_switch|escalation/, "safety"],
  [/clinical|override|correct|feedback|review/, "clinical"],
];

function kindOf(family: string, type: string): AuditKind {
  for (const [rx, kind] of KIND_FOR) {
    if (rx.test(type)) return kind;
  }
  if (family === "safety") return "safety";
  if (family === "clinical" || family === "specialist_action") return "clinical";
  if (family === "consent") return "consent";
  if (family === "identity" || family === "security") return "access";
  return "other";
}

function safeDetail(raw: string): { detail: Record<string, unknown>; redacted: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // An unparseable detail is reported as such rather than rendered raw — the
    // one case where showing the stored bytes would defeat the denylist.
    return { detail: { unparseable: true }, redacted: true };
  }
  if (!parsed || typeof parsed !== "object") return { detail: {}, redacted: false };

  const out: Record<string, unknown> = {};
  let redacted = false;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (NEVER_DISPLAY.has(k)) {
      redacted = true;
      continue;
    }
    out[k] = v;
  }
  return { detail: out, redacted };
}

/** The set of user ids inside a tenant. Used to scope the audit view, since the
 *  log itself is not tenant-columned. */
async function tenantMemberIds(tenantId: string): Promise<Set<string>> {
  const c = await data();
  const rows = (await c.all(
    "SELECT id FROM users WHERE tenant_id = ?", [tenantId]
  )) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

async function labelFor(ids: Set<string>): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map();
  const c = await data();
  const list = [...ids];
  const rows = (await c.all(
    `SELECT id, name, role FROM users WHERE id IN (${list.map(() => "?").join(",")})`,
    list
  )) as Array<{ id: string; name: string | null; role: string }>;
  return new Map(rows.map((r) => [r.id, `${r.name ?? "unnamed"} (${r.role})`]));
}

function toEntry(r: AuditRow, labels: Map<string, string>): AuditEntry {
  const { detail, redacted } = safeDetail(r.detail_json);
  return {
    id: r.id,
    at: r.created_at,
    kind: kindOf(r.event_family, r.event_type),
    family: r.event_family,
    type: r.event_type,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    actorLabel: r.actor_id
      ? labels.get(r.actor_id) ?? `${r.actor_role ?? "unknown"} · ${r.actor_id.slice(0, 8)}…`
      : "system",
    target: r.target,
    detail,
    redacted,
    chained: Boolean(r.entry_hash),
  };
}

export interface AuditHistory {
  entries: AuditEntry[];
  /** Chain verification over the whole log, so the page can show tamper state
   *  rather than assert append-only. */
  chain: ChainVerification;
  /** Rows the tenant filter removed. Reported so a clinician can tell "nothing
   *  happened" apart from "you cannot see what happened". */
  outOfScope: number;
  kindCounts: Record<AuditKind, number>;
}

/** Explains exactly what the tenant filter does and does not guarantee. Shown
 *  on the page: a scoping caveat that lives only in a code comment protects
 *  nobody reading the screen. */
export function scopeNote(): string {
  return (
    "Scoped by resolving each entry's actor and target to your organization. " +
    "The audit log itself carries no tenant column, so this is a view filter " +
    "rather than row-level security, and platform-level entries with no actor " +
    "in your organization are excluded rather than shown."
  );
}

const EMPTY_COUNTS: Record<AuditKind, number> = {
  access: 0, clinical: 0, safety: 0, consent: 0, alert: 0, other: 0,
};

/** The whole audit feed for one tenant, content-stripped and actor-labelled.
 *
 *  This is what a clinician-facing audit console should read. The raw rows are
 *  not safe to render directly: a failed sign-in records the attempted address
 *  verbatim, and clinician notes, correction rationales, and alert resolutions
 *  are all free text. */
export async function scopedAuditFeed(args: {
  tenantId: string;
  limit?: number;
}): Promise<AuditHistory> {
  const c = await data();
  const rows = (await c.all(
    `SELECT a.* FROM audit_log a
      WHERE a.actor_id IN (SELECT id FROM users WHERE tenant_id = ?)
         OR a.target   IN (SELECT id FROM users WHERE tenant_id = ?)
      ORDER BY a.id DESC
      LIMIT ?`,
    [args.tenantId, args.tenantId, args.limit ?? 300]
  )) as AuditRow[];
  return assemble(rows, args.tenantId, []);
}

/** Audit history for one member: everything done to them, and everything they
 *  did, inside the caller's tenant. */
export async function memberAuditHistory(args: {
  personId: string;
  tenantId: string;
  limit?: number;
}): Promise<AuditHistory> {
  const c = await data();
  const limit = args.limit ?? 200;

  const rows = (await c.all(
    `SELECT * FROM audit_log
      WHERE target = ? OR actor_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [args.personId, args.personId, limit]
  )) as AuditRow[];

  return assemble(rows, args.tenantId, [args.personId]);
}

/** The trail behind one alert, oldest first: raised → seen → closed, with what
 *  was done. This is the specific thing a security reviewer is asked to follow
 *  end to end, so it is built as its own query rather than left to be filtered
 *  out of a longer list by eye. */
export async function alertTrail(args: {
  alertId: string;
  tenantId: string;
}): Promise<AuditHistory & { alert: AlertFacts | null }> {
  const c = await data();

  const alert = (await c.get(
    `SELECT a.id, a.user_id, a.alert_type, a.severity, a.status,
            a.created_at, a.reviewed_at, a.reviewed_by, u.tenant_id
       FROM alerts a JOIN users u ON u.id = a.user_id
      WHERE a.id = ? AND u.tenant_id = ?`,
    [args.alertId, args.tenantId]
  )) as (AlertFacts & { tenant_id: string }) | undefined;

  // A foreign-tenant alert is reported as absent, not as forbidden — a "not
  // permitted" response confirms the id exists.
  if (!alert) {
    return { entries: [], chain: await verifyAuditChain(), outOfScope: 0, kindCounts: { ...EMPTY_COUNTS }, alert: null };
  }

  const rows = (await c.all(
    `SELECT * FROM audit_log
      WHERE target = ? OR detail_json LIKE ?
      ORDER BY id ASC`,
    [args.alertId, `%${args.alertId}%`]
  )) as AuditRow[];

  // The alert id counts as in-scope: the join above already proved this alert
  // belongs to the caller's tenant. Without it every row would be dropped,
  // because an alert-lifecycle row targets the ALERT, not a user, and the
  // tenant filter resolves ids through `users`.
  const history = await assemble(rows, args.tenantId, [alert.user_id, args.alertId]);
  return { ...history, alert };
}

export interface AlertFacts {
  id: string;
  user_id: string;
  alert_type: string;
  severity: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

/** Filter to the caller's tenant, strip content, and label actors. Row order is
 *  whatever the caller's query asked for — newest-first for a member history,
 *  oldest-first for an alert trail, which reads as the sequence it was. */
async function assemble(
  rows: AuditRow[],
  tenantId: string,
  alwaysInScope: string[]
): Promise<AuditHistory> {
  const inTenant = await tenantMemberIds(tenantId);
  for (const id of alwaysInScope) inTenant.add(id);

  const kept: AuditRow[] = [];
  let outOfScope = 0;
  for (const r of rows) {
    // A row is in scope when either end of it is inside the tenant. A system
    // row with neither is excluded — see scopeNote().
    const actorIn = r.actor_id ? inTenant.has(r.actor_id) : false;
    const targetIn = r.target ? inTenant.has(r.target) : false;
    if (actorIn || targetIn) kept.push(r);
    else outOfScope += 1;
  }

  const ids = new Set<string>();
  for (const r of kept) if (r.actor_id) ids.add(r.actor_id);
  const labels = await labelFor(ids);

  const entries = kept.map((r) => toEntry(r, labels));
  const kindCounts = { ...EMPTY_COUNTS };
  for (const e of entries) kindCounts[e.kind] += 1;

  return { entries, chain: await verifyAuditChain(), outOfScope, kindCounts };
}
