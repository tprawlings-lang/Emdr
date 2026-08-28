// The patient directory.
//
// Distinct from the caseload, and the distinction is the point.
//
//   THE CASELOAD answers "who needs me now". It is ordered by clinical need,
//   every band carries a written reason, and it deliberately does not contain
//   everyone — a queue that lists the whole panel is not a queue.
//
//   THE DIRECTORY answers "find this person". Alphabetical, searchable,
//   everyone. It is the view a clinician wants when someone calls, when they
//   are preparing for a named appointment, or when they simply want to look
//   someone up — none of which the caseload can serve, because ordering by
//   urgency is exactly wrong for finding a known name.
//
// The risk in building it is that a directory quietly becomes a second
// caseload: add a severity column, sort by it, and you have two triage views
// that disagree. So this carries a single quiet attention flag and no band, no
// reasons, and no ordering by need — if a clinician wants triage, the caseload
// is one click away and it is better at it.
//
// The opposite risk is worse: a directory that hides urgency lets someone
// browse alphabetically past a person in crisis. Hence the flag.

import { data } from "../data";

export interface DirectoryRow {
  personId: string;
  displayName: string;
  /** Last day they did anything at all. Null reads as "no activity recorded",
   *  which is different from zero and is shown as such. */
  lastActive: string | null;
  /** Open alerts. A count, not a severity — the caseload owns severity. */
  openAlerts: number;
  /** True when something is waiting on a clinician. Deliberately boolean: a
   *  directory that grades people has become a caseload. */
  needsAttention: boolean;
}

export interface Directory {
  rows: DirectoryRow[];
  /** Total in the tenant, before the search filter. Lets the page say
   *  "3 of 12" rather than leaving a filtered list looking like the whole
   *  panel. */
  total: number;
  query: string;
}

/** Everyone in the caller's tenant, alphabetically.
 *
 *  Tenant scope comes from the caller's own record, never from the request —
 *  a tenant supplied by the caller is a tenant an attacker can choose. */
export async function memberDirectory(args: {
  tenantId: string;
  query?: string;
}): Promise<Directory> {
  const c = await data();
  const query = (args.query ?? "").trim();

  const rows = (await c.all(
    `SELECT u.id            AS person_id,
            u.name          AS display_name,
            (SELECT MAX(checkin_date) FROM checkins ck WHERE ck.user_id = u.id) AS last_checkin,
            (SELECT MAX(ended_at)     FROM therapy_sessions ts
              WHERE ts.user_id = u.id AND ts.status = 'completed')              AS last_session,
            (SELECT COUNT(*) FROM alerts a
              WHERE a.user_id = u.id AND a.status = 'open')                     AS open_alerts,
            (SELECT COUNT(*) FROM module_unlocks mu
              WHERE mu.user_id = u.id AND mu.status = 'requested')              AS pending_unlocks
       FROM users u
      WHERE u.tenant_id = ? AND u.role = 'member' AND u.status = 'active'
      ORDER BY u.name COLLATE NOCASE ASC`,
    [args.tenantId]
  )) as Array<{
    person_id: string; display_name: string | null;
    last_checkin: string | null; last_session: string | null;
    open_alerts: number; pending_unlocks: number;
  }>;

  const all: DirectoryRow[] = rows.map((r) => {
    const lastActive = latest(r.last_checkin, r.last_session);
    return {
      personId: r.person_id,
      displayName: r.display_name ?? "Unnamed",
      lastActive,
      openAlerts: r.open_alerts,
      needsAttention: r.open_alerts > 0 || r.pending_unlocks > 0,
    };
  });

  const filtered = query
    ? all.filter((r) => r.displayName.toLowerCase().includes(query.toLowerCase()))
    : all;

  return { rows: filtered, total: all.length, query };
}

function latest(a: string | null, b: string | null): string | null {
  const da = a ? a.slice(0, 10) : null;
  const db = b ? b.slice(0, 10) : null;
  if (!da) return db;
  if (!db) return da;
  return da > db ? da : db;
}

/** Group alphabetically, so a long panel is scannable by initial rather than by
 *  reading every row. Returns entries in order. */
export function byInitial(rows: DirectoryRow[]): Array<[string, DirectoryRow[]]> {
  const groups = new Map<string, DirectoryRow[]>();
  for (const r of rows) {
    const initial = (r.displayName.trim()[0] ?? "?").toUpperCase();
    const key = /[A-Z]/.test(initial) ? initial : "#";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
