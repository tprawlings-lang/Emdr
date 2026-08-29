import { data } from "@/lib/data";

// Which organization an Intelligence account reports on.
//
// §30.6 step 1 resolves the acting tenant before anything else, and every
// organization projection takes that tenant id rather than reading "the
// organization" from ambient state. This is the one place that resolution
// happens, so there is a single line to change when role assignments carry it.
//
// In this deployment there is exactly one organization tenant, and the
// operations account is not yet bound to it by a role assignment — that
// binding is part of the access-request work §26 puts at /review/access, which
// is not built. Rather than fake a grant, this resolves the single
// organization tenant and returns null when there is not exactly one, so an
// ambiguous case fails closed instead of picking one.

/**
 * A provider network: an organization tenant with no payer contract.
 *
 * The `kind` column cannot tell these apart — a payer is an organization too,
 * and widening the CHECK constraint would be a table rebuild for a
 * distinction that already exists structurally. What actually separates them
 * is that a payer HAS a contract: it reports on a contracted population using
 * claims, and a provider network does not.
 *
 * This mattered immediately. Seeding the payer added a second
 * organization-kind tenant, and the previous "exactly one organization" rule
 * started returning null — every organization screen would have rendered "no
 * organization in scope" the moment the payer work landed.
 */
export async function resolveOrgTenant(): Promise<string | null> {
  const c = await data();
  const rows = (await c.all(
    `SELECT t.id FROM tenants t
      WHERE t.kind = 'organization'
        AND NOT EXISTS (SELECT 1 FROM payer_contracts pc WHERE pc.tenant_id = t.id)
      ORDER BY t.id`,
    [],
  )) as { id: string }[];
  return rows.length === 1 ? rows[0].id : null;
}

/** A health plan: the tenant that holds a payer contract. Same fail-closed
 *  rule — an ambiguous case returns null rather than picking one. */
export async function resolvePayerTenant(): Promise<string | null> {
  const c = await data();
  const rows = (await c.all(
    "SELECT DISTINCT tenant_id AS id FROM payer_contracts ORDER BY tenant_id", [],
  )) as { id: string }[];
  return rows.length === 1 ? rows[0].id : null;
}
