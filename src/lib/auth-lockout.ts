// The sign-in lockout, in one place, for every door.
//
// Compliance 1.5 asks for ten failed attempts in fifteen minutes to pause an
// account for fifteen minutes. What was actually deployed did none of those
// three things reliably, and the three failures compounded:
//
// THE WINDOW WAS NOT FIFTEEN MINUTES — it was "since midnight UTC". The cutoff
// was built with `toISOString().slice(0, 19).replace("T", " ")`, producing
// `2026-09-11 16:24:32`, and compared as text against rows `audit()` writes as
// `2026-09-11T16:38:32.923Z`. At position ten the stored row has `T` (0x54)
// and the cutoff has a space (0x20), so EVERY row sharing the date sorts after
// the cutoff no matter what time it carries. A failure from ten hours ago
// counted. Ten failures therefore locked an account until the date rolled
// over, and the screen went on saying "paused for 15 minutes — try again
// then", which is the part that makes it cruel rather than merely wrong.
//
// The column holds both formats and that is not this module's to change:
// `audit()` writes ISO-8601 with `T` and `Z`, `demo-seed.ts` writes
// space-separated, and the schema default is `datetime('now')`. So comparison
// NORMALIZES rather than assuming — `substr(replace(created_at,'T',' '),1,19)`
// on the stored value, against a cutoff cut the same way. It is valid on both
// backends and it is correct for rows in either format, which a comparison
// against a raw ISO cutoff would not have been.
//
// IT WAS ENFORCED ON ONE DOOR OF TWO. `loginMobile` wrote `login_failed` and
// never read it, so `POST /api/mobile/v1/auth/login` was an unlimited
// password-guessing channel against every account — including the pilot's real
// participants — while the web form counted to ten. A lockout implemented
// beside one caller is a lockout, implemented in a shared module and called by
// both is the mechanism. This is the module.
//
// AND THERE WAS NO WAY OUT. Failures are counted from an append-only log, so
// nothing could clear them; there is no code path in the product that changes
// an existing password, and `/reset` correctly refuses for want of an email
// channel. Locked meant locked. So the count now starts at the LAST PASSWORD
// RESET when there is one — which is the right rule independently of who can
// perform it: failures recorded against a password that no longer exists say
// nothing about whoever is typing now.

import { data } from "./data";

/** Failed attempts that pause an account (compliance 1.5). */
export const LOCKOUT_THRESHOLD = 10;

/** How far back failures are counted, and how long a pause therefore lasts. */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** Audit type written when an operator sets a new password. Counting starts
 *  again here, so the name is shared rather than spelled twice. */
export const PASSWORD_RESET_EVENT = "password_reset";

// Both stored formats, cut to the same second-precision shape. Applied to the
// column AND to the cutoff, so the two are always compared like for like.
const NORMALIZED = "substr(replace(created_at, 'T', ' '), 1, 19)";

/** A moment in the shape the comparison above expects. */
export function lockoutStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Failed sign-ins that still count against this address.
 *
 * Counted by `target` regardless of whether an account exists, which is
 * deliberate and predates this module: answering "no such account" quickly and
 * "wrong password" slowly is an account-enumeration oracle, and the addresses
 * in this deployment are published.
 */
export async function failedSignInsAgainst(email: string): Promise<number> {
  const c = await data();
  const target = email.trim().toLowerCase();
  const windowStart = lockoutStamp(Date.now() - LOCKOUT_WINDOW_MS);

  const reset = (await c.get(
    `SELECT MAX(${NORMALIZED}) AS at FROM audit_log
      WHERE event_type = ? AND target = ?`,
    [PASSWORD_RESET_EVENT, target],
  )) as { at: string | null } | undefined;

  // The later of the two bounds. A reset inside the window shortens it; a
  // reset from last week does not lengthen it.
  const lastReset = reset?.at ?? null;
  const since = lastReset && lastReset > windowStart ? lastReset : windowStart;

  const row = (await c.get(
    `SELECT COUNT(*) AS n FROM audit_log
      WHERE event_type = 'login_failed' AND target = ? AND ${NORMALIZED} > ?`,
    [target, since],
  )) as { n: number | string } | undefined;

  // Postgres returns COUNT(*) as a bigint, which node-postgres hands back as a
  // string. `>= 10` against a string is a comparison nobody wants to reason
  // about at a security boundary.
  return Number(row?.n ?? 0);
}

/** Whether this address is currently paused. */
export async function isLockedOut(email: string): Promise<boolean> {
  return (await failedSignInsAgainst(email)) >= LOCKOUT_THRESHOLD;
}
