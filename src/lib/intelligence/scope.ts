import { cache } from "react";
import { headers } from "next/headers";

import { data } from "@/lib/data";
import { audit } from "@/lib/audit";
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
  const tenant = user.role === "demo_admin"
    ? await demoAdminTenant("organization")
    : await resolveActingTenant();
  await recordAggregateAccess(user.id, user.role, tenant);
  return tenant;
}

/** A health plan: the acting tenant, when the account holds the payer role. */
export async function resolvePayerTenant(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "payer" && user.role !== "demo_admin") return null;
  const tenant = user.role === "demo_admin"
    ? await demoAdminTenant("payer")
    : await resolveActingTenant();
  await recordAggregateAccess(user.id, user.role, tenant);
  return tenant;
}

/**
 * §30.6 step 7, at the one place every aggregate console passes through.
 *
 * A DRILLDOWN IS A DISCLOSURE WHETHER OR NOT IT NAMES ANYBODY. Twenty-four
 * organization and payer routes read a population without recording that
 * anybody had, and the aggregate consoles are the surfaces whose whole risk is
 * that a small enough cohort stops being aggregate.
 *
 * Recorded AFTER the role check and with the tenant that was actually resolved,
 * so a refused request does not put a tenant id in the trail on the strength of
 * somebody asking for it. The surface comes from the request rather than from
 * twenty call sites, each of which would be a chance to name the wrong one.
 *
 * Never throws into a render: a failed audit on a read is not a reason to
 * withhold a report. §30.6's fail-closed rule is about protected evidence and
 * high-impact actions, which is the envelope's `audit_unavailable` state.
 *
 * ONCE PER REQUEST, not once per call. A console resolves its tenant from the
 * page and again from the components beneath it, and the first version of this
 * wrote twelve identical rows for four page views. An access trail with three
 * entries for one read is harder to answer a question from than one with a
 * single entry per read, which is the whole point of keeping it. React's
 * `cache` memoises by argument for the life of a render, which is exactly the
 * scope wanted here: one row per person per console per request.
 */
const recordAggregateAccess = cache(async (
  actorId: string, actorRole: string, tenantId: string | null
): Promise<void> => {
  if (!tenantId) return;
  let surface = "unknown";
  try {
    surface = (await headers()).get("x-pathname") ?? "unknown";
  } catch {
    // Called outside a request. Nothing to name, and nothing to fail.
  }
  try {
    await audit({
      actorId, actorRole, family: "security",
      type: "aggregate_console_viewed",
      target: tenantId,
      detail: { surface },
    });
  } catch (err) {
    console.error("access audit failed for an aggregate console read:", err);
  }
});

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
