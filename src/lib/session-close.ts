// How a session ends — one function for every path that ends one (Expansion
// Handoff Phase 0, "session termination logic gaps").
//
//   "Every new tool is a new session type that must terminate cleanly."
//
// What "cleanly" was missing, found by reading the two finish paths (web
// `finishSession`, mobile `finishSessionMobile`), which were copies:
//
// 1. AN END COULD BE REWRITTEN. The UPDATE had no condition on the current
//    status, so a hard-stopped session could be finished again as "completed"
//    — by a double tap, a retried request, or a client that simply said so. The
//    row then read as a session that went fine, and the processing rest keyed
//    on it was gone. An ended session now stays ended: the first close wins,
//    and every later one is refused and changes nothing.
//
// 2. THE CLIENT DECIDED WHETHER IT WAS A HARD STOP. The server stored whatever
//    outcome and ratings it was sent. The rule that a rating of 9 ends a
//    session (session-safety.ts, `sudsDecision`) ran only in the browser. Now
//    the server re-runs it over the trail it is given: if any rating in the
//    session crossed the line, the session closes as a hard stop whatever the
//    request claimed, and the before/after/peak figures are read off the same
//    trail rather than accepted alongside it.
//
// 3. A SESSION NOBODY CLOSED STAYED OPEN FOREVER. Closing the tab left the row
//    `in_progress` with no end; the care team's view said "still open" a week
//    later. "Pick up where you left off" did not reopen it either — it started
//    a new session beside it. A session cannot run past the cap
//    (SESSION_CAP_MIN, packet 4B.3), and only one runs at a time, so starting a
//    new one closes any left open, and one past its cap is never offered back.
//
// 4. A HARD STOP DID NOT, BY ITSELF, REST PROCESSING. The 24-hour rest read
//    only the closing rating. It now also reads the status, so a hard stop
//    rests processing even when the closing rating is missing.

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { createAlert } from "./clinical/alert-create";
import { recordSessionFinished, nowStamp } from "./spine";
import { sudsDecision, SESSION_CAP_MIN } from "./session-safety";

export type SessionOutcome = "completed" | "hard_stop" | "abandoned";

export interface SessionCloseRequest {
  outcome: SessionOutcome;
  hardStopReason?: string | null;
  /** Every distress rating in the session, in order, as the client holds it. */
  sudsTrail: unknown[];
}

export interface DerivedClose {
  status: SessionOutcome;
  preSuds: number | null;
  postSuds: number | null;
  peakSuds: number | null;
  hardStopReason: string | null;
  trail: number[];
}

/** A rating is a whole number from 0 to 10, or it is not a rating. Anything
 *  else is dropped rather than clamped: clamping a 14 to a 10 would write a
 *  number nobody chose into a clinical record. */
function ratings(raw: unknown[]): number[] {
  return raw.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10);
}

/** Pure: what the session's own ratings say about how it ended. The server's
 *  answer, not the request's — a request may make an ending MORE serious
 *  (declare a hard stop), never less. */
export function deriveClose(req: SessionCloseRequest): DerivedClose {
  const trail = ratings(Array.isArray(req.sudsTrail) ? req.sudsTrail : []);
  let crossedAt: number | null = null;
  for (let i = 0; i < trail.length; i++) {
    if (sudsDecision(trail.slice(0, i + 1)) === "hard_stop") { crossedAt = i; break; }
  }
  const hardStopped = req.outcome === "hard_stop" || crossedAt !== null;
  const reason = hardStopped
    ? (req.hardStopReason?.trim().slice(0, 200) ||
       (crossedAt !== null ? `Distress rated ${trail[crossedAt]}/10` : "unspecified"))
    : null;
  return {
    status: hardStopped ? "hard_stop" : req.outcome,
    preSuds: trail.length > 0 ? trail[0] : null,
    postSuds: trail.length > 0 ? trail[trail.length - 1] : null,
    peakSuds: trail.length > 0 ? Math.max(...trail) : null,
    hardStopReason: reason,
    trail,
  };
}

export type CloseResult =
  | { ok: true; status: SessionOutcome; moduleId: string }
  | { ok: false; reason: "not_found" | "already_closed" };

/** End a session. The first close wins; the UPDATE only matches an open row,
 *  so two racing closes cannot both land, and the loser writes nothing — no
 *  second event, no second alert. */
export async function closeSession(
  userId: string,
  sessionId: string,
  req: SessionCloseRequest,
  via: "web" | "mobile"
): Promise<CloseResult> {
  const c = await data();
  const session = (await c.get(
    "SELECT id, module_id, status, detail_json FROM therapy_sessions WHERE id = ? AND user_id = ?",
    [sessionId, userId]
  )) as { id: string; module_id: string; status: string; detail_json: string } | undefined;
  if (!session) return { ok: false, reason: "not_found" };
  if (session.status !== "in_progress") return { ok: false, reason: "already_closed" };

  const end = deriveClose(req);
  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(session.detail_json) as Record<string, unknown>; } catch { detail = {}; }
  // Merged, so the focus chosen at start survives completion.
  detail.sudsTrail = end.trail;
  if (end.status === "hard_stop" && req.outcome !== "hard_stop") {
    // Said out loud in the record: the request called this something else.
    detail.closedAs = { requested: req.outcome, ratingsSaid: "hard_stop" };
  }

  const endedAt = nowStamp();
  const { changes } = await c.run(
    `UPDATE therapy_sessions SET status = ?, pre_suds = ?, post_suds = ?, peak_suds = ?,
       hard_stop_reason = ?, detail_json = ?, ended_at = ?
     WHERE id = ? AND user_id = ? AND status = 'in_progress'`,
    [end.status, end.preSuds, end.postSuds, end.peakSuds, end.hardStopReason,
     JSON.stringify(detail), endedAt, sessionId, userId]
  );
  if (changes === 0) return { ok: false, reason: "already_closed" };

  await recordSessionFinished({
    userId, sessionId, moduleId: session.module_id,
    status: end.status, preSuds: end.preSuds, postSuds: end.postSuds,
    peakSuds: end.peakSuds, hardStopReason: end.hardStopReason,
    detail, occurredAt: endedAt, via,
  });
  await audit({
    actorId: userId, actorRole: "member", family: "module_runtime",
    type: `session_${end.status}`, target: session.module_id,
    detail: {
      sessionId, preSuds: end.preSuds, postSuds: end.postSuds, peakSuds: end.peakSuds,
      hardStopReason: end.hardStopReason, ...(via === "mobile" ? { via } : {}),
    },
  });
  if (end.status === "hard_stop") {
    await createAlert({
      userId, type: "session_hard_stop", severity: "high",
      detail: `Hard stop in module ${session.module_id}${via === "mobile" ? " (mobile)" : ""}: ${end.hardStopReason}`,
    });
  }
  return { ok: true, status: end.status, moduleId: session.module_id };
}

const CAP_MS = SESSION_CAP_MIN * 60_000;

function stampMs(s: string): number {
  return new Date(s.replace(" ", "T") + "Z").getTime();
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** The earliest start time an open session can have and still be running. */
export function openSessionCutoff(nowMs: number): string {
  return fmt(nowMs - CAP_MS);
}

/**
 * Close every session this member left open, before a new one starts. One
 * session runs at a time, so anything still open is over.
 *
 * Closed as `abandoned` — which is what happened: nobody finished it — and
 * never as completed. The end time is the moment it stopped being possible for
 * it to be running (the cap), or now if that is sooner, and the record says it
 * was closed for them rather than by them. No ratings are invented: a session
 * that ended without a closing rating keeps none.
 */
export async function closeLeftOpen(userId: string, nowMs: number, via: "web" | "mobile"): Promise<number> {
  const c = await data();
  const open = (await c.all(
    "SELECT id, module_id, started_at, detail_json FROM therapy_sessions WHERE user_id = ? AND status = 'in_progress'",
    [userId]
  )) as { id: string; module_id: string; started_at: string; detail_json: string }[];
  let closed = 0;
  for (const s of open) {
    const endedMs = Math.min(nowMs, stampMs(s.started_at) + CAP_MS);
    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(s.detail_json) as Record<string, unknown>; } catch { detail = {}; }
    detail.closedFor = endedMs < nowMs ? "left_open_past_cap" : "replaced_by_new_session";
    const endedAt = fmt(endedMs);
    const { changes } = await c.run(
      `UPDATE therapy_sessions SET status = 'abandoned', detail_json = ?, ended_at = ?
        WHERE id = ? AND user_id = ? AND status = 'in_progress'`,
      [JSON.stringify(detail), endedAt, s.id, userId]
    );
    if (changes === 0) continue;
    closed += 1;
    await recordSessionFinished({
      userId, sessionId: s.id, moduleId: s.module_id, status: "abandoned",
      detail, occurredAt: endedAt, via,
    });
    await audit({
      actorId: userId, actorRole: "system", family: "module_runtime",
      type: "session_abandoned", target: s.module_id,
      detail: { sessionId: s.id, closedFor: detail.closedFor, ...(via === "mobile" ? { via } : {}) },
    });
  }
  return closed;
}

// ── The check after a session ────────────────────────────────────────────────
//
// The after-session questions (distress now, oriented, safe until tomorrow,
// likelihood of a hard night) are the last safety read of a session, and the
// action that saved them trusted its form completely:
//
//   - any session id was accepted, including another member's, and the row was
//     written under the caller with that id;
//   - a missing distress rating became 0 — "no distress" — so a form that lost
//     its answer read as the calmest possible close, and escalation keyed on it
//     did not fire;
//   - a second submission wrote a second row and raised a second alert.
//
// Now: the session must be theirs and must have ended; every rating must be a
// real answer or nothing is saved; and there is one check per session.

export type PostCheckResult =
  | { ok: true; unsafe: boolean; escalated: boolean }
  | { ok: false; reason: "not_found" | "still_open" | "already_checked" | "incomplete" };

function rating(v: unknown): number | null {
  if (typeof v !== "string" || !/^(10|[0-9])$/.test(v)) return null;
  return Number(v);
}

function yesNo(v: unknown): boolean | null {
  return v === "yes" ? true : v === "no" ? false : null;
}

export async function recordPostSessionCheck(
  userId: string,
  sessionId: string,
  raw: { distress: unknown; oriented: unknown; safeTonight: unknown; delayedRisk: unknown; recoveryConfirmed: boolean }
): Promise<PostCheckResult> {
  const c = await data();
  const session = (await c.get(
    "SELECT status FROM therapy_sessions WHERE id = ? AND user_id = ?", [sessionId, userId]
  )) as { status: string } | undefined;
  if (!session) return { ok: false, reason: "not_found" };
  if (session.status === "in_progress") return { ok: false, reason: "still_open" };

  const distress = rating(raw.distress);
  const delayedRisk = rating(raw.delayedRisk);
  const oriented = yesNo(raw.oriented);
  const safeTonight = yesNo(raw.safeTonight);
  // Zero is a real answer on both scales, so a missing one is not zero.
  if (distress === null || delayedRisk === null || oriented === null || safeTonight === null) {
    return { ok: false, reason: "incomplete" };
  }

  const escalated = !oriented || !safeTonight || distress >= 8 || delayedRisk >= 8;
  const { changes } = await c.run(
    `INSERT INTO post_session_checks
       (id, session_id, user_id, distress, oriented, safe_tonight, delayed_risk, recovery_confirmed, escalated)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM post_session_checks WHERE session_id = ?)`,
    [newId(), sessionId, userId, distress, oriented ? 1 : 0, safeTonight ? 1 : 0, delayedRisk,
     raw.recoveryConfirmed ? 1 : 0, escalated ? 1 : 0, sessionId]
  );
  if (changes === 0) return { ok: false, reason: "already_checked" };

  await audit({
    actorId: userId, actorRole: "member", family: "clinical",
    type: "post_session_check", target: sessionId,
    detail: { distress, oriented, safeTonight, delayedRisk, recoveryConfirmed: raw.recoveryConfirmed, needsEscalation: escalated },
  });
  if (!safeTonight) {
    await createAlert({
      userId, type: "post_session_unsafe", severity: "urgent",
      detail: "Member reported they cannot stay safe until tomorrow after a session.",
    });
  } else if (escalated) {
    await createAlert({
      userId, type: "post_session_review", severity: "high",
      detail: `Post-session thresholds exceeded (distress ${distress}, oriented ${oriented}, delayed risk ${delayedRisk}).`,
    });
  }
  return { ok: true, unsafe: !safeTonight, escalated };
}
