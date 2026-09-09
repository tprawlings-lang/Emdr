// Recording and reading telemetry signals (§31.7).
//
// The catalog in ./telemetry.ts decides what a signal MAY carry. This writes
// what passed and reads it back for the operational review. Two properties are
// worth stating because they are the whole point of putting this behind a
// function:
//
//   NOTHING IS RECORDED THAT THE CATALOG DID NOT DECLARE. `sanitize` runs
//   before the insert, not in a review afterwards, and a declared field holding
//   prose throws rather than being truncated into the row.
//
//   A TELEMETRY FAILURE NEVER BREAKS A SCREEN. §31.7's signals measure whether
//   the product works; a product that stops working when its measurement does
//   is worse than one that is unmeasured. So a write failure is swallowed and
//   the caller continues — which is the opposite of the audit rule in §30.6
//   step 7, deliberately: an audit row is evidence of a disclosure and fails
//   closed, a telemetry row is not.

import { data } from "../data";
import { newId, PLATFORM_TENANT_ID } from "../db";
import { sanitize, SIGNAL_NAMES, TelemetryRefused } from "./catalog";

export interface RecordedSignal {
  signal: string;
  actorRole: string | null;
  fields: Record<string, string | number>;
  createdAt: string;
}

/**
 * Record one signal.
 *
 * The actor's ROLE is stored and their id is not. §31.7 asks every signal to be
 * answerable by role, and no signal to be traceable to a person — an actor id
 * would make `permission_denied` a log of who tried what, which is the row that
 * rule exists to forbid.
 */
export async function recordSignal(
  signalName: string,
  payload: Record<string, unknown> = {},
  opts: { tenantId?: string; actorRole?: string } = {}
): Promise<void> {
  // A refusal is the catalog working, so it is not swallowed with the rest: a
  // caller passing prose has a defect and should see it in development.
  const { fields } = sanitize(signalName, payload);
  try {
    const c = await data();
    await c.run(
      "INSERT INTO telemetry_signals (id, tenant_id, signal, actor_role, fields) VALUES (?, ?, ?, ?, ?)",
      [newId(), opts.tenantId ?? PLATFORM_TENANT_ID, signalName,
        opts.actorRole ?? null, JSON.stringify(fields)]
    );
  } catch {
    // Measurement never blocks the thing being measured.
  }
}

/** Fire-and-forget, for a render path that must not wait on a write. A rejected
 *  promise here is a refusal from the catalog, which is a defect in the caller
 *  rather than a runtime condition — logged, never thrown into a page. */
export function noteSignal(
  signalName: string,
  payload: Record<string, unknown> = {},
  opts: { tenantId?: string; actorRole?: string } = {}
): void {
  void recordSignal(signalName, payload, opts).catch((err) => {
    if (err instanceof TelemetryRefused) console.error("telemetry refused:", err.message);
  });
}

/**
 * The two signals a decision surface produces when it renders.
 *
 * §31.7 asks `decision_surface_viewed` to measure "screen reach and load
 * state", and `projection_stale_shown` to "detect feed and projection delay".
 * Both are answers about the same render, so they are recorded from the same
 * call — a surface that reports it was viewed but not that it was stale would
 * make the second signal depend on somebody remembering it at every call site.
 *
 * Takes the envelope's STATE, never its data. There is nothing in an envelope's
 * payload a signal may carry.
 */
export function noteSurfaceViewed(
  surface: string,
  envelope: { state: string; staleSince?: string; meta?: { schemaVersion?: string } },
  opts: { tenantId?: string; actorRole?: string } = {}
): void {
  noteSignal("decision_surface_viewed", { surface, loadState: envelope.state }, opts);
  if (envelope.state === "stale") {
    // Age from the envelope's own staleSince rather than from a clock the
    // caller passes, so the number on the screen and the number in the signal
    // cannot disagree.
    const since = envelope.staleSince ? Date.parse(envelope.staleSince) : NaN;
    noteSignal("projection_stale_shown", {
      // The projection TYPE, taken off the contract name the envelope already
      // carries — "member_today.v4" is the member_today projection, which is
      // §30.3's grain. Read from the envelope rather than named again by the
      // caller, so a signal cannot claim a projection the page did not read.
      projectionType: (envelope.meta?.schemaVersion ?? surface).split(".")[0],
      ...(Number.isFinite(since) ? { ageSeconds: Math.max(0, Math.round((Date.now() - since) / 1000)) } : {}),
      sourceStatus: "stale",
    }, opts);
  }
}

/** How many of each signal exist. Every declared signal appears, including the
 *  ones at zero — a signal that has never fired is the finding, and a list that
 *  omits it hides that. */
export async function signalCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of SIGNAL_NAMES) out[name] = 0;
  try {
    const c = await data();
    const rows = (await c.all(
      "SELECT signal, COUNT(*) AS n FROM telemetry_signals GROUP BY signal"
    )) as Array<{ signal: string; n: number }>;
    for (const r of rows) {
      // Only declared signals are reported. A row with an undeclared name could
      // only come from outside this module, and counting it here would make the
      // catalog look like it covers something it does not.
      if (name(r.signal)) out[r.signal] = Number(r.n);
    }
  } catch {
    // A database that cannot answer reads as nothing recorded, which is what
    // the screen should say rather than failing.
  }
  return out;
}

const name = (s: string) => SIGNAL_NAMES.includes(s);

/** The most recent signals, for the review screen. Field values only — there is
 *  no person to resolve, by construction. */
export async function recentSignals(limit = 20): Promise<RecordedSignal[]> {
  try {
    const c = await data();
    const rows = (await c.all(
      `SELECT signal, actor_role, fields, created_at FROM telemetry_signals
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [limit]
    )) as Array<{ signal: string; actor_role: string | null; fields: string; created_at: string }>;
    return rows.map((r) => ({
      signal: r.signal,
      actorRole: r.actor_role,
      fields: JSON.parse(r.fields || "{}") as Record<string, string | number>,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
