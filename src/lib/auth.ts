import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { data } from "./data";

const COOKIE = "emdr_session";
// Dev-only signing secret. Production: managed secrets, short-lived sessions,
// AAL2 MFA, and step-up auth for exports/consent changes per the executive plan.
const SECRET = process.env.EMDR_SESSION_SECRET ?? "dev-only-secret-change-me";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "member" | "clinician" | "admin";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

// Per-user token epoch: bumping it (signOutEverywhere / password change)
// invalidates every previously issued token for that user. Tokens issued
// before this feature carry no epoch and are treated as epoch 0, matching the
// default, so existing sessions stay valid until they expire or the user bumps.
async function currentEpoch(userId: string): Promise<number> {
  const c = await data();
  const row = (await c.get("SELECT token_epoch FROM users WHERE id = ?", [userId])) as
    | { token_epoch: number | null }
    | undefined;
  return row?.token_epoch ?? 0;
}

export async function makeSessionToken(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now()}.${await currentEpoch(userId)}`;
  return `${payload}.${sign(payload)}`;
}

// Session lifetime (compliance 1.3): 7-day idle window via the cookie's
// maxAge, 30-day absolute cap via the issue timestamp inside the signed token.
const IDLE_MAX_AGE_SEC = 7 * 24 * 60 * 60;
const ABSOLUTE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function parseToken(token: string): { userId: string; epoch: number } | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [userId, issuedAt, epoch] = payload.split(".");
  if (!userId) return null;
  const issued = Number(issuedAt);
  if (!Number.isFinite(issued) || Date.now() - issued > ABSOLUTE_MAX_AGE_MS) return null;
  return { userId, epoch: Number(epoch ?? 0) || 0 };
}

export async function setSessionCookie(userId: string) {
  const store = await cookies();
  store.set(COOKIE, await makeSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: IDLE_MAX_AGE_SEC,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

/**
 * Resolve a session user from a raw bearer token (no cookies). This is the
 * cookie-independent core of `getCurrentUser`, exported so the mobile JSON API
 * (which authenticates with `Authorization: Bearer <token>`) can reuse the
 * exact same signature check, absolute-lifetime check, and per-user epoch
 * revocation as the web app. The token itself is produced by `makeSessionToken`.
 */
export async function getUserFromToken(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const parsed = parseToken(token);
  if (!parsed) return null;
  const c = await data();
  const row = (await c.get(
    "SELECT id, email, name, role, token_epoch FROM users WHERE id = ? AND status = 'active'",
    [parsed.userId]
  )) as (SessionUser & { token_epoch: number | null }) | undefined;
  if (!row) return null;
  // Revocation: a token whose epoch is behind the user's current epoch was
  // invalidated by "sign out everywhere" (or a password change).
  if ((row.token_epoch ?? 0) !== parsed.epoch) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return getUserFromToken(store.get(COOKIE)?.value);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user) return user;

  // Two different situations, and telling them apart is the whole point of
  // §26 giving /session-expired its own screen. A visitor who was never signed
  // in needs the sign-in page. Someone whose session ended needs to know that
  // is what happened — that nothing they saved is lost, and that anything they
  // were part-way through typing was deliberately not kept.
  //
  // The presence of the cookie is what separates them, and it reveals nothing:
  // whoever holds the browser already knows whether they signed in. A rejected
  // cookie could be expired, revoked by "sign out everywhere", or forged, and
  // this deliberately does not distinguish those — the message is the same for
  // all three, and a forger learns nothing from it.
  const store = await cookies();
  redirect(store.get(COOKIE) ? "/session-expired" : "/login");
}

export async function requireMember(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "member") redirect("/clinician");
  return user;
}

export async function requireClinician(): Promise<SessionUser> {
  const user = await requireUser();
  // "admin" is NOT admitted. It used to be, as a convenience back when no
  // admin account existed and the role was a notional superuser — and the
  // moment one did exist, that line handed an aggregate reporting account the
  // whole clinical console. tests/e2e/organization.spec.ts caught it.
  //
  // The reasoning is §30.6's, not a permissions preference: a clinician may
  // read a record because of a care relationship and a consent. An
  // organization analyst has neither, and no amount of seniority substitutes
  // for them. A role that reports on populations does not get to read people.
  if (user.role !== "clinician") {
    redirect(user.role === "admin" ? "/organization/overview" : "/app/today");
  }
  return user;
}

/** Steady Intelligence — the organization and payer surfaces.
 *
 *  These are AGGREGATE roles, and the distinction is the whole point of the
 *  check: aggregate access must never become person-level care access
 *  (§30.6). A clinician is deliberately NOT admitted here by their clinical
 *  role, because their right to read a record comes from a care relationship
 *  and consent, and neither is what these screens are reporting under.
 *
 *  What actually enforces the boundary is downstream: the projections these
 *  screens read cannot return a person id, and the population they report on
 *  has no names in the database at all. This check decides who gets through
 *  the door; it is not what keeps the room safe. */
export async function requireIntelligence(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    // A member goes to their own home. Nothing about this surface is their
    // business, and a denial screen would be an answer to a question they did
    // not ask.
    //
    // A clinician gets /403 instead. This is a SCOPE denial, not a record
    // denial: the aggregate console is not a secret — it is on the public site
    // — so saying "outside your scope, here is how to request it" reveals
    // nothing and is more useful than a silent bounce. The rule that a
    // forbidden RECORD returns not-found is untouched; it is about existence,
    // and this is about permission on something whose existence is published.
    redirect(user.role === "member" ? "/app/today" : "/403");
  }
  return user;
}
