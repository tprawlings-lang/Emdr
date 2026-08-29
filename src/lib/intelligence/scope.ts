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

export async function resolveOrgTenant(): Promise<string | null> {
  const c = await data();
  const rows = (await c.all(
    "SELECT id FROM tenants WHERE kind = 'organization' ORDER BY id", [],
  )) as { id: string }[];
  return rows.length === 1 ? rows[0].id : null;
}
