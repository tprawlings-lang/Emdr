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
  if (!user) redirect("/login");
  return user;
}

export async function requireMember(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "member") redirect("/clinician");
  return user;
}

export async function requireClinician(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "clinician" && user.role !== "admin") redirect("/app/today");
  return user;
}
