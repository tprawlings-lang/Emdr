// Upsell engine (pricing Phase B). Two jobs:
//
//   1. Enforce the Base tier's once-a-week companion conversation, warmly.
//   2. Recommend a move up the ladder ONLY when the member's own usage or
//      memory shows a real fit — an earned, specific suggestion, never a
//      generic banner.
//
// Hard rules, in order of precedence:
//   - Crisis is never capped, never upsold, never throttled. Risk-flagged
//     messages don't count toward the weekly window, and no recommendation is
//     ever attached to a crisis or risk-flagged exchange.
//   - Recommendations are rate-limited (one of any kind per 5 days; the same
//     kind at most once per 14 days) and every one shown is recorded in
//     upsell_events — both for the cooldowns and so we can measure what the
//     system recommends and what converts.

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { getEntitlements, getTier } from "./entitlements";
import { getSubscription } from "./billing";

const WEEK_MS = 7 * 86400000;
const ANY_KIND_COOLDOWN_MS = 5 * 86400000;
const SAME_KIND_COOLDOWN_MS = 14 * 86400000;
/** How long after signup the "you had Premium for a week" win-back stays relevant. */
const WINBACK_WINDOW_MS = 21 * 86400000;

function sqliteToMs(ts: string): number {
  return new Date(ts.replace(" ", "T") + "Z").getTime();
}

// ---------- Base weekly companion cap ----------

export type CompanionAllowance =
  | { ok: true }
  | { ok: false; nextAvailable: string; reply: string };

/** Can this member start/continue a companion exchange right now?
 *
 *  Base gets one conversation a week: the first (non-risk) message opens a
 *  companion day; the rest of that calendar day is open so the conversation
 *  can breathe; the window then rests until 7 days after it opened. Crisis is
 *  exempt at the call site (checked BEFORE this) and risk-flagged messages
 *  never count toward the window. */
export async function companionAllowance(userId: string): Promise<CompanionAllowance> {
  const ent = await getEntitlements(userId);
  if (!ent || ent.companionPerWeek === null) return { ok: true };

  const c = await data();
  const rows = (await c.all(
    `SELECT created_at FROM ai_messages
       WHERE user_id = ? AND sender = 'member' AND risk_flag = 0
       ORDER BY created_at DESC LIMIT 200`,
    [userId]
  )) as { created_at: string }[];

  const now = Date.now();
  const inWindow = rows.filter((r) => now - sqliteToMs(r.created_at) < WEEK_MS);
  if (inWindow.length === 0) return { ok: true };

  const today = new Date(now).toISOString().slice(0, 10);
  const usedToday = inWindow.some((r) => r.created_at.slice(0, 10) === today);
  if (usedToday) return { ok: true };

  const windowOpenedMs = Math.min(...inWindow.map((r) => sqliteToMs(r.created_at)));
  const nextAvailable = new Date(windowOpenedMs + WEEK_MS).toISOString().slice(0, 10);
  return {
    ok: false,
    nextAvailable,
    reply:
      `I'm here once a week on your current membership, and we've had our conversation for this week — I'll be back on ${nextAvailable}. ` +
      `What we talked about stays with me for next time. Your practices, lessons, and grounding tools are all open in the meantime — ` +
      `and if you'd like me here every day, with memory of everything we've worked through, that's what Plus is for (Settings → Membership). ` +
      `If you're struggling right now, though, don't wait for me: the Ground page and crisis support are always open, membership or not.`,
  };
}

// ---------- Earned recommendations ----------

export interface UpsellSuggestion {
  kind: "trial_winback" | "plus_fit" | "premium_fit";
  message: string;
}

async function lastShown(userId: string): Promise<{ any: number | null; byKind: Record<string, number> }> {
  const c = await data();
  const rows = (await c.all(
    "SELECT kind, created_at FROM upsell_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    [userId]
  )) as { kind: string; created_at: string }[];
  const byKind: Record<string, number> = {};
  let any: number | null = null;
  for (const r of rows) {
    const ms = sqliteToMs(r.created_at);
    if (any === null || ms > any) any = ms;
    if (!(r.kind in byKind) || ms > byKind[r.kind]) byKind[r.kind] = ms;
  }
  return { any, byKind };
}

/** Decide whether an upgrade suggestion is EARNED right now; if so, record it
 *  and return it. Returns null far more often than not — cooldowns first, then
 *  only fires on a real signal from the member's own data. Never call this on
 *  a crisis or risk-flagged exchange. */
export async function maybeUpsell(userId: string): Promise<UpsellSuggestion | null> {
  const tier = await getTier(userId);
  if (!tier || tier === "premium") return null;

  const now = Date.now();
  const shown = await lastShown(userId);
  if (shown.any !== null && now - shown.any < ANY_KIND_COOLDOWN_MS) return null;

  const suggestion = await pickSuggestion(userId, tier);
  if (!suggestion) return null;
  const lastSame = shown.byKind[suggestion.kind];
  if (lastSame !== undefined && now - lastSame < SAME_KIND_COOLDOWN_MS) return null;

  const c = await data();
  await c.run("INSERT INTO upsell_events (id, user_id, kind) VALUES (?, ?, ?)", [
    newId(), userId, suggestion.kind,
  ]);
  await audit({
    actorId: userId, actorRole: "member", family: "billing",
    type: "upsell_shown", detail: { kind: suggestion.kind, tier },
  });
  return suggestion;
}

async function pickSuggestion(userId: string, tier: "base" | "plus"): Promise<UpsellSuggestion | null> {
  const c = await data();

  // 1) Post-trial win-back: they had Premium for their first week; the sub is
  // now active on a lower tier and still young enough that the memory of the
  // full system is fresh.
  const sub = await getSubscription(userId);
  if (
    sub && sub.status === "active" &&
    Date.now() - sqliteToMs(sub.created_at) < WINBACK_WINDOW_MS
  ) {
    return {
      kind: "trial_winback",
      message:
        tier === "base"
          ? "A thought — during your first week you had all of Steady: the guided program, unlimited conversations with me, and your day planned each morning. If any of that was helping, Plus brings back the program and our conversations, and Premium brings back all of it. It's in Settings → Membership whenever you want it."
          : "A thought — during your first week, Premium was planning your day each morning and adjusting your pacing automatically. If you've missed that since, it's one switch away in Settings → Membership.",
    };
  }

  // 2) Fit signals from the member's own data.
  if (tier === "base") {
    // Recurring triggers they've named are exactly what the guided program
    // works with — and what the companion's memory holds between sessions.
    const trig = (await c.get(
      "SELECT COUNT(*) AS n FROM user_triggers WHERE user_id = ? AND active = 1",
      [userId]
    )) as { n: number };
    if (Number(trig.n) >= 2) {
      return {
        kind: "plus_fit",
        message:
          "You've named a few triggers you keep running into. That's exactly what the guided program works through, step by step — and on Plus I'd remember all of it between conversations, not just once a week. If you're curious, it's in Settings → Membership.",
      };
    }
    return null;
  }

  // tier === "plus": between-session strain → Premium's autonomous support.
  const hardStops = (await c.get(
    `SELECT COUNT(*) AS n FROM therapy_sessions
       WHERE user_id = ? AND status = 'hard_stop'
         AND started_at > datetime('now', '-30 days')`,
    [userId]
  )) as { n: number };
  const elevated = (await c.get(
    `SELECT COUNT(*) AS n FROM checkins
       WHERE user_id = ?
         AND recommended_action IN ('grounding_only','stabilization')
         AND checkin_date > date('now', '-14 days')`,
    [userId]
  )) as { n: number };
  if (Number(hardStops.n) >= 1 || Number(elevated.n) >= 3) {
    return {
      kind: "premium_fit",
      message:
        "The last stretch has asked a lot of you between sessions. Premium is built for exactly that: I'd plan each day with you, check in on the hard mornings without being asked, and your pacing would adjust automatically to keep things inside your window. It's in Settings → Membership if that support would help.",
    };
  }
  return null;
}
