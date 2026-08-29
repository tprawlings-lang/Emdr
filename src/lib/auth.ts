import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { data } from "./data";
import { type Role, landingFor, isAggregateRole } from "./roles";
import { DEMO_SEED_VERSION } from "./demo-seed";

const COOKIE = "emdr_session";
// The signing secret, read at CALL time.
//
// This was a module-level const, and that is worse than it looks: a process
// where the variable is set after this module loads signs and verifies with
// the dev fallback instead, silently. Production is unaffected — the
// environment is set before the process starts — which is exactly why it would
// never have been noticed there.
//
// It was noticed here because a guard passed for the wrong reason: a test
// building an expired token signed it with the real secret while this module
// verified with the fallback, so the token was rejected on its SIGNATURE and
// the expiry assertion never ran. Removing the expiry check entirely did not
// fail the test. A vacuous guard is worse than no guard, because it is
// counted.
//
// Production still requires managed secrets, short-lived sessions, AAL2 MFA
// and step-up auth for exports and consent changes, per the executive plan.
const secret = () => process.env.EMDR_SESSION_SECRET ?? "dev-only-secret-change-me";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** The acting tenant — §30.6 step 1 resolves this before anything else, and
   *  it now comes from the session rather than from counting rows. */
  tenantId: string;
  /** The verified session claims (p7). Present on any user resolved from a
   *  token, which is every path except a direct database read. */
  claims?: SessionClaims;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

const b64url = (b: Buffer) => b.toString("base64url");

/**
 * The session claims (handoff 07 §1.3, p7).
 *
 * p7 asks for environment, dataset_version, tenant_id, person_id, role,
 * purpose, issued_at, expires_at and an allowed_projection list. They travel
 * in the token, signed, so a session can be described without a lookup — which
 * is what makes an audit entry answer "under what scope was this read" rather
 * than only "by whom".
 *
 * WHAT THE CLAIMS DO NOT DO IS GRANT ANYTHING. `getUserFromToken` still reads
 * the account row on every request and treats the DATABASE as authoritative;
 * the claims are checked AGAINST it, and a disagreement destroys the session
 * rather than resolving in either direction. So a role changed after a token
 * was issued invalidates that token instead of silently travelling inside it,
 * and a forged claim cannot outvote the row it contradicts.
 *
 * That ordering is the whole design. A token that carries a role and is
 * trusted for it is a token that has to be revoked; one that carries a role
 * and is checked for it revokes itself.
 */
export interface SessionClaims {
  /** Claim-format version, so a change to this shape rejects old tokens
   *  loudly rather than mis-parsing them. */
  v: 1;
  sub: string;
  environment: string;
  dataset_version: string;
  tenant_id: string;
  /** Present only for a role that acts on behalf of a person. p7: "person_id
   *  when relevant" — an aggregate role has no person and must not carry one. */
  person_id?: string;
  role: Role;
  purpose: string;
  issued_at: number;
  expires_at: number;
  /** The projections this session may request. Named at issue time so a
   *  console cannot widen its own scope after the fact. */
  allowed_projections: string[];
  /** Token epoch, for "sign out everywhere". */
  epoch: number;
}

/**
 * Session lifetime.
 *
 * The demo is deliberately much shorter (p7: 60 minutes idle, 8 hours
 * absolute). A demonstration session left open on a laptop in a conference
 * room is the realistic exposure here, and it is a different risk from a
 * member's own device — so the numbers differ by environment rather than being
 * one compromise that suits neither.
 */
// Read at CALL time, not at module load. A module-level `const DEMO` froze
// the environment at import, which made the lifetime untestable and — worse —
// meant the value depended on import order rather than on configuration. The
// same class of bug as caching config at the top of a file: correct in
// production, where the environment is set before the process starts, and
// silently wrong anywhere else.
const isDemo = () => process.env.EMDR_DEMO === "1";
const idleMaxAgeSec = () => (isDemo() ? 60 * 60 : 7 * 24 * 60 * 60);
const absoluteMaxAgeMs = () => (isDemo() ? 8 : 30 * 24) * 60 * 60 * 1000;

/** Which projections each role may request. The aggregate roles are named
 *  explicitly rather than by exclusion, so a new projection is unreachable
 *  until someone decides which roles may see it. */
const PROJECTIONS: Record<Role, string[]> = {
  member: ["person_summary.v4", "person_timeline.v2"],
  clinician: ["clinician_queue.v3", "person_summary.v4", "person_timeline.v2", "safety_replay.v1"],
  reviewer: ["safety_replay.v1", "audit_trail.v2", "test_summary.v6"],
  organization: ["org_metrics.v2", "org_locations.v1"],
  payer: ["payer_metrics.v2", "cost_model.v1", "contract_report.v1"],
  demo_admin: ["*"],
};

async function currentEpochAndTenant(userId: string): Promise<{ epoch: number; tenantId: string; role: Role }> {
  const c = await data();
  const row = (await c.get(
    "SELECT token_epoch, tenant_id, role FROM users WHERE id = ?", [userId],
  )) as { token_epoch: number | null; tenant_id: string; role: Role } | undefined;
  return { epoch: row?.token_epoch ?? 0, tenantId: row?.tenant_id ?? "", role: row?.role ?? "member" };
}

/**
 * Issue a session.
 *
 * `purpose` is recorded rather than inferred, for the same reason the governed
 * export requires one: a scope with no stated reason cannot be reviewed later.
 * It defaults to the honest description of what this environment is for.
 */
export async function makeSessionToken(
  userId: string,
  purpose = isDemo() ? "demonstration" : "care",
): Promise<string> {
  const { epoch, tenantId, role } = await currentEpochAndTenant(userId);
  const now = Date.now();
  const claims: SessionClaims = {
    v: 1,
    sub: userId,
    environment: isDemo() ? "demo" : (process.env.NODE_ENV ?? "development"),
    dataset_version: isDemo() ? DEMO_SEED_VERSION : "live",
    tenant_id: tenantId,
    // An aggregate role reports on a population and acts for no one. Carrying
    // a person_id would be the first half of exactly the drift §30.6 forbids.
    ...(isAggregateRole(role) ? {} : { person_id: userId }),
    role,
    purpose,
    issued_at: now,
    expires_at: now + absoluteMaxAgeMs(),
    allowed_projections: PROJECTIONS[role] ?? [],
    epoch,
  };
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  return `${payload}.${sign(payload)}`;
}

/** Parse and verify a token. Returns the claims, or null — never a partial
 *  result, because a caller that has to decide which half to trust will
 *  eventually trust the wrong one. */
export function readClaims(token: string): SessionClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }
  if (claims.v !== 1 || typeof claims.sub !== "string" || !claims.sub) return null;
  // The absolute lifetime is IN the token, so it cannot be extended by
  // reissuing the cookie with a longer maxAge.
  if (!Number.isFinite(claims.expires_at) || Date.now() > claims.expires_at) return null;
  return claims;
}

export async function setSessionCookie(userId: string) {
  const store = await cookies();
  store.set(COOKIE, await makeSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: idleMaxAgeSec(),
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
  const claims = readClaims(token);
  if (!claims) return null;

  const c = await data();
  const row = (await c.get(
    "SELECT id, email, name, role, tenant_id, token_epoch FROM users WHERE id = ? AND status = 'active'",
    [claims.sub],
  )) as (SessionUser & { tenant_id: string; token_epoch: number | null }) | undefined;
  if (!row) return null;

  // Revocation: a token whose epoch is behind the user's current epoch was
  // invalidated by "sign out everywhere" or a password change.
  if ((row.token_epoch ?? 0) !== claims.epoch) return null;

  // The DATABASE is authoritative, and a disagreement destroys the session
  // rather than resolving in either direction. Trusting the claim would let a
  // role or tenant change travel inside an old token; trusting the row alone
  // would make the claim decorative, and an audit entry that cites a scope
  // nothing checked is worse than one that cites none.
  if (row.role !== claims.role) return null;
  if (row.tenant_id !== claims.tenant_id) return null;

  return {
    id: row.id, email: row.email, name: row.name, role: row.role,
    tenantId: row.tenant_id, claims,
  };
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
