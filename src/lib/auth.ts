import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { data } from "./data";
import { type Role, landingFor, isAggregateRole } from "./roles";

const COOKIE = "emdr_session";
// Dev-only signing secret. Production: managed secrets, short-lived sessions,
// AAL2 MFA, and step-up auth for exports/consent changes per the executive plan.
const SECRET = process.env.EMDR_SESSION_SECRET ?? "dev-only-secret-change-me";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
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
  // No aggregate role is admitted, and the reasoning is §30.6's rather than a
  // permissions preference: a clinician may read a record because of a care
  // relationship and a consent. An organization analyst has neither, and no
  // amount of seniority substitutes for them. A role that reports on
  // populations does not get to read people.
  //
  // This used to admit "admin" as a convenience, back when no aggregate
  // account existed and the role was a notional superuser. The moment one did
  // exist, that line handed a reporting account the whole clinical console.
  // tests/e2e/organization.spec.ts caught it.
  if (user.role !== "clinician") redirect(landingFor(user.role));
  return user;
}

/**
 * Any AGGREGATE surface — the shared door for organization, payer and demo
 * admin (handoff 07 p50).
 *
 * This answers "may this account be on an aggregate screen at all". It does
 * NOT answer "which aggregate screen", which is what let one account read both
 * consoles for as long as `admin` served both. Use `requireOrganization` or
 * `requirePayer` on a screen that belongs to one of them; use this only where
 * the surface genuinely serves both, such as the governed-export endpoint.
 *
 * What actually enforces the boundary is downstream: the projections these
 * screens read cannot return a person id, and the population they report on
 * has no names in the database at all. This check decides who gets through the
 * door; it is not what keeps the room safe.
 */
export async function requireIntelligence(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAggregateRole(user.role)) redirect(denialFor(user.role));
  return user;
}

/** The organization console. A payer account is denied here, and vice versa —
 *  p6: an organization "cannot see payer-wide data or unrelated
 *  organizations", and a payer "cannot see patient-level clinical records". */
export async function requireOrganization(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "organization" && user.role !== "demo_admin") redirect(denialFor(user.role));
  return user;
}

/** The payer console. */
export async function requirePayer(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "payer" && user.role !== "demo_admin") redirect(denialFor(user.role));
  return user;
}

/** The reviewer role specifically (p6: fixed gates, evidence, replay,
 *  corrections, audit — and NOT routine treatment decisions). */
export async function requireReviewer(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "reviewer" && user.role !== "demo_admin") redirect(denialFor(user.role));
  return user;
}

/**
 * The review console as a whole.
 *
 * Wider than `requireReviewer` by one role, deliberately: a CLINICIAN is
 * admitted because two of these screens record a clinician's sign-off on the
 * autonomous flow and on BLS configuration, and that authority is theirs
 * rather than the reviewer's. Denying them here would leave a console that
 * asks for a decision only one role can make and admits only roles that
 * cannot.
 *
 * Until handoff 07 this layout called `requireClinician`, which was the whole
 * check — the console had no role of its own, and its own file said so. The
 * moment `reviewer` existed that line became an infinite redirect: a reviewer
 * bounced to their landing page, which is inside the console, which bounced
 * them again.
 */
export async function requireReviewAccess(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "reviewer" && user.role !== "clinician" && user.role !== "demo_admin") {
    redirect(denialFor(user.role));
  }
  return user;
}

/**
 * The demo administration surface.
 *
 * p6 grants this role everything inside the fabricated environment and nothing
 * outside it. The breadth is deliberate and so is the confinement: production
 * administration must use purpose-limited permissions and break-glass access,
 * and this role's blanket visibility must never be carried into it.
 */
export async function requireDemoAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "demo_admin") redirect(denialFor(user.role));
  return user;
}

/**
 * Where a denied account goes.
 *
 * A member goes to their own home. Nothing about an aggregate or review
 * surface is their business, and a denial screen would be an answer to a
 * question they did not ask.
 *
 * Every other role gets /403. This is a SCOPE denial, not a record denial: the
 * consoles are not secrets — they are described on the public site — so saying
 * "outside your scope, here is how to request it" reveals nothing and is more
 * useful than a silent bounce. The rule that a forbidden RECORD returns
 * not-found is untouched; that one is about existence, and this is about
 * permission on something whose existence is published.
 */
function denialFor(role: Role): string {
  return role === "member" ? "/app/today" : "/403";
}
