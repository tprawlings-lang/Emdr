// Clinical alerts: severity, ownership, deadlines, escalation (workflow §3).
//
// An alert without a named owner and a deadline is a notification, and
// notifications are how things get missed. Three rules are enforced here.
//
//   IMMEDIATE AND HIGH NEVER AUTO-RESOLVE. Closure requires a documented human
//   action — not an acknowledgement, and never the passage of time. An alert
//   that ages out silently is worse than one that was never raised, because the
//   queue then looks handled.
//
//   DEADLINES RESPECT THE COVERAGE MODEL. A "same day" deadline under a
//   business-hours rota means the next working day after hours. Computing it
//   from the configured schedule keeps the promise and the staffing aligned;
//   the alternative is a queue full of breaches nobody could have met.
//
//   OVERDUE IS A STATE, NOT A REPORT. It is computed on read, so it cannot
//   depend on a job having run.

import { data } from "../data";
import { newId } from "../db";
import { audit } from "../audit";
import { activePolicy, type ClinicalPolicy } from "../clinical-policy";

/** The bands from the workflow spec, mapped onto the existing `alerts.severity`
 *  column so no migration and no data rewrite is required. */
export type AlertBand = "immediate" | "high" | "standard" | "watch";

const BAND_FOR_SEVERITY: Record<string, AlertBand> = {
  urgent: "immediate",
  high: "high",
  moderate: "standard",
  info: "watch",
};

/** Hours from creation to the response deadline. `null` = no deadline. */
export const BAND_DEADLINE_HOURS: Record<AlertBand, number | null> = {
  immediate: 4,
  high: 24,
  standard: 168,
  watch: null,
};

/** Bands whose closure requires a documented action. */
export const NEVER_AUTO_RESOLVE: AlertBand[] = ["immediate", "high"];

export interface ClinicalAlert {
  id: string;
  personId: string;
  personName: string;
  band: AlertBand;
  type: string;
  detail: string;
  createdAt: string;
  /** Computed from the band and the coverage model. */
  dueAt: string | null;
  overdue: boolean;
  status: "open" | "reviewed";
  ownerId: string | null;
  /** What was actually done. Not "acknowledged". */
  resolution: string | null;
  resolvedAt: string | null;
  /** True when this band may never close without a documented action. */
  requiresDocumentedAction: boolean;
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

const BUSINESS_START = 9, BUSINESS_END = 17;
const EXTENDED_START = 7, EXTENDED_END = 21;

/** Advance `from` by `hours` of *coverage* time.
 *
 *  Under a 24-hour rota this is plain addition. Under business or extended
 *  hours it walks forward through covered time only, so a Friday-evening alert
 *  is due Monday morning rather than Saturday — which is what the rota can
 *  actually deliver, and therefore what the member should be told. */
export function deadlineFrom(from: Date, hours: number, policy: ClinicalPolicy): Date {
  if (policy.coverage === "24_hour") return new Date(from.getTime() + hours * 3600_000);
  if (policy.coverage === "none") return new Date(from.getTime() + hours * 3600_000);

  const [open, close] = policy.coverage === "extended"
    ? [EXTENDED_START, EXTENDED_END]
    : [BUSINESS_START, BUSINESS_END];

  const cursor = new Date(from.getTime());
  let remaining = hours;

  // Bounded: each iteration either consumes remaining hours or advances the
  // cursor to the next covered window, so it cannot spin.
  for (let guard = 0; guard < 400 && remaining > 0; guard++) {
    const day = cursor.getUTCDay();
    const hour = cursor.getUTCHours() + cursor.getUTCMinutes() / 60;

    if (day === 0 || day === 6) {           // weekend → next day, at open
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(open, 0, 0, 0);
      continue;
    }
    if (hour < open) { cursor.setUTCHours(open, 0, 0, 0); continue; }
    if (hour >= close) {                     // after hours → next day, at open
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(open, 0, 0, 0);
      continue;
    }
    const availableToday = close - hour;
    if (remaining <= availableToday) {
      cursor.setTime(cursor.getTime() + remaining * 3600_000);
      remaining = 0;
    } else {
      remaining -= availableToday;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(open, 0, 0, 0);
    }
  }
  return cursor;
}

function parseStamp(s: string): Date {
  return new Date(Date.parse(s.replace(" ", "T") + (s.includes("T") ? "" : "Z")));
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

interface AlertRow {
  id: string; user_id: string; member_name: string; alert_type: string;
  severity: string; detail: string; status: string;
  reviewed_by: string | null; review_note: string | null;
  created_at: string; reviewed_at: string | null;
}

/** The alert queue for one tenant, ordered by urgency then by lateness. */
export async function alertQueue(args: {
  tenantId: string;
  includeResolved?: boolean;
  policy?: ClinicalPolicy;
  now?: Date;
}): Promise<ClinicalAlert[]> {
  const policy = args.policy ?? activePolicy();
  const now = args.now ?? new Date();
  const c = await data();

  const rows = (await c.all(
    `SELECT a.*, u.name AS member_name
       FROM alerts a JOIN users u ON u.id = a.user_id
      WHERE u.tenant_id = ?${args.includeResolved ? "" : " AND a.status = 'open'"}
      ORDER BY a.created_at DESC`,
    [args.tenantId]
  )) as AlertRow[];

  const alerts = rows.map((r) => {
    const band = BAND_FOR_SEVERITY[r.severity] ?? "standard";
    const hours = BAND_DEADLINE_HOURS[band];
    const created = parseStamp(r.created_at);
    const due = hours === null ? null : deadlineFrom(created, hours, policy);
    return {
      id: r.id,
      personId: r.user_id,
      personName: r.member_name,
      band,
      type: r.alert_type,
      detail: r.detail,
      createdAt: r.created_at,
      dueAt: due ? fmt(due) : null,
      overdue: due !== null && r.status === "open" && now.getTime() > due.getTime(),
      status: r.status as "open" | "reviewed",
      ownerId: r.reviewed_by,
      resolution: r.review_note,
      resolvedAt: r.reviewed_at,
      requiresDocumentedAction: NEVER_AUTO_RESOLVE.includes(band),
    } satisfies ClinicalAlert;
  });

  const order: AlertBand[] = ["immediate", "high", "standard", "watch"];
  alerts.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const d = order.indexOf(a.band) - order.indexOf(b.band);
    if (d !== 0) return d;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return alerts;
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

export class AlertClosureError extends Error {}

/** Close an alert with a documented action.
 *
 *  Refuses an empty or trivially short resolution for the bands that require a
 *  documented action. "Acknowledged" is not an action, and a queue that accepts
 *  it teaches everyone that closing is a formality. */
export async function closeAlert(args: {
  alertId: string;
  clinicianId: string;
  tenantId: string;
  resolution: string;
  now?: Date;
}): Promise<ClinicalAlert> {
  const c = await data();
  const row = (await c.get(
    `SELECT a.*, u.name AS member_name FROM alerts a JOIN users u ON u.id = a.user_id
      WHERE a.id = ? AND u.tenant_id = ?`,
    [args.alertId, args.tenantId]
  )) as AlertRow | undefined;

  // Scoped by tenant: an alert in another tenant is not "forbidden", it does
  // not exist, so the response cannot be used to probe for one.
  if (!row) throw new AlertClosureError("Alert not found.");
  if (row.status === "reviewed") throw new AlertClosureError("Alert is already closed.");

  const band = BAND_FOR_SEVERITY[row.severity] ?? "standard";
  const resolution = args.resolution.trim();

  if (NEVER_AUTO_RESOLVE.includes(band) && resolution.length < 10) {
    throw new AlertClosureError(
      `A ${band}-band alert closes with a documented action, not an acknowledgement. ` +
      "Record what was done — who was contacted, what was decided, what follows."
    );
  }
  if (resolution.length === 0) throw new AlertClosureError("A resolution is required.");

  const at = fmt(args.now ?? new Date());
  await c.run(
    `UPDATE alerts SET status = 'reviewed', reviewed_by = ?, review_note = ?, reviewed_at = ?
      WHERE id = ?`,
    [args.clinicianId, resolution, at, args.alertId]
  );

  await audit({
    actorId: args.clinicianId,
    actorRole: "clinician",
    family: "specialist_action",
    type: "alert_closed",
    target: args.alertId,
    detail: { band, personId: row.user_id, alertType: row.alert_type },
  });

  const queue = await alertQueue({ tenantId: args.tenantId, includeResolved: true, now: args.now });
  return queue.find((a) => a.id === args.alertId)!;
}

/** Alerts past their deadline, for the supervisor escalation view. */
export function overdueAlerts(alerts: ClinicalAlert[]): ClinicalAlert[] {
  return alerts.filter((a) => a.overdue);
}

/** Dismissal-rate signal (workflow §3, logging plan §3): bulk closure of a
 *  category means the category is miscalibrated, and recalibrating a clinical
 *  threshold is a clinical decision — not something to fix by lowering the
 *  volume. */
export function alertPressure(alerts: ClinicalAlert[]): {
  byType: Record<string, { open: number; overdue: number }>;
  overdueTotal: number;
} {
  const byType: Record<string, { open: number; overdue: number }> = {};
  for (const a of alerts) {
    byType[a.type] ??= { open: 0, overdue: 0 };
    if (a.status === "open") byType[a.type].open++;
    if (a.overdue) byType[a.type].overdue++;
  }
  return { byType, overdueTotal: alerts.filter((a) => a.overdue).length };
}
