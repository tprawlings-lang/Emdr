import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { getDb } from "./db";

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

export function makeSessionToken(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function parseToken(token: string): string | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return payload.split(".")[0] ?? null;
}

export async function setSessionCookie(userId: string) {
  const store = await cookies();
  store.set(COOKIE, makeSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 30 min idle target per plan; dev uses a fixed max age for simplicity.
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const userId = parseToken(token);
  if (!userId) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT id, email, name, role FROM users WHERE id = ? AND status = 'active'")
    .get(userId) as SessionUser | undefined;
  return row ?? null;
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
  if (user.role !== "clinician" && user.role !== "admin") redirect("/dashboard");
  return user;
}
