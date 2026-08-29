import { data } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth";

// Which tenant an Intelligence account reports on (§30.6 step 1: resolve the
// acting tenant before anything else).
//
// This used to COUNT. `resolveOrgTenant` returned the single organization-kind
// tenant and failed closed when there was not exactly one — which worked for
// exactly as long as there was exactly one. The payer seed added a second and
// every organization screen would have rendered "no organization in scope";
// that was patched by excluding tenants holding a payer contract, an inference
// standing on an inference, and it would have broken again the moment handoff
// 07's Wave 2 adds eight demo organizations.
//
// An account belongs to a tenant. It is now bound at seed time and carried in
// the session claims (§1.3, p7), so resolving it is a read rather than a
// deduction, and adding a hundred tenants changes nothing.

/** The tenant this account acts for, from its session. Null when the account
 *  is not bound to one — which fails closed, and now means "not configured"
 *  rather than "ambiguous". */
export async function resolveActingTenant(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  // The platform tenant is where direct-to-consumer records live. An aggregate
  // console scoped to it would report on every unassigned person in the
  // deployment, which is the opposite of minimum necessary.
  const NIL = "0".repeat(26);
  return user.tenantId && user.tenantId !== NIL ? user.tenantId : null;
}

/**
 * A provider network: the acting tenant, when the account holds the
 * organization role.
 *
 * The role check is what keeps this from becoming a way for a payer account to
 * name an organization tenant and be believed. The layout guard already denies
 * that, and this refuses it a second time — a scope resolver that trusts its
 * caller is one layer of defence pretending to be two.
 */
export async function resolveOrgTenant(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "organization" && user.role !== "demo_admin") return null;
  if (user.role === "demo_admin") return demoAdminTenant("organization");
  return await resolveActingTenant();
}

/** A health plan: the acting tenant, when the account holds the payer role. */
export async function resolvePayerTenant(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "payer" && user.role !== "demo_admin") return null;
  if (user.role === "demo_admin") return demoAdminTenant("payer");
  return await resolveActingTenant();
}

/**
 * Demo administration is the one role with no tenant of its own (p6: "all
 * fabricated tenants"), so it needs a tenant NAMED for it to read a console.
 *
 * It resolves the same way the seed binds it — through the account that holds
 * the role — rather than by re-deriving the tenant from its shape. That keeps
 * one definition of "the payer tenant" in the system instead of two that can
 * disagree, and it means demo admin sees exactly what the payer sees.
 */
async function demoAdminTenant(role: "organization" | "payer"): Promise<string | null> {
  const c = await data();
  const rows = (await c.all(
    "SELECT tenant_id AS id FROM users WHERE role = ? ORDER BY id", [role],
  )) as { id: string }[];
  // Still fails closed on ambiguity, and the ambiguity is now a real one — two
  // accounts holding the same aggregate role in different tenants — rather
  // than an artefact of counting.
  return rows.length === 1 ? rows[0].id : null;
}
