// Tenant-scoped data access (ADR 0011 §3).
//
// The failure mode this exists to prevent is a single forgotten WHERE clause
// becoming cross-tenant PHI exposure. Tenant scoping therefore does NOT live at
// call sites, where it depends on every developer remembering it. It lives
// here, beneath them: the repository injects `tenant_id = ?` into every query
// it issues, and a repository cannot be constructed without a TenantContext.
//
//   repo(ctx).findOne("checkins", "user_id = ?", [personId])
//     → SELECT * FROM checkins WHERE (user_id = ?) AND tenant_id = ?
//
// Reading another tenant's row therefore does not return a filtered result — it
// returns nothing, exactly as if the row did not exist. Enumeration by id leaks
// no information about whether the id is real.
//
// Cross-tenant access exists for platform administration and is deliberately
// awkward: it requires `crossTenantContext()`, whose call sites are greppable,
// and every use is written to the audit log with the reason.
//
// This is the application-layer half of the defence. Postgres row-level
// security (scripts/pg-schema.sql) is the other half, so a bug here still
// cannot cross tenants once the Postgres cutover lands.

import { data } from "./data";
import { TENANT_SCOPED_TABLES } from "./db";
import { requireTenant, type TenantContext } from "./tenancy";
import { audit } from "./audit";

export type { TenantContext };

const SCOPED = new Set<string>(TENANT_SCOPED_TABLES);

/** Guards against SQL injection through a table name and against scoping a
 *  table that has no tenant column (which would silently throw at the DB). */
function assertScopable(table: string): void {
  if (!SCOPED.has(table)) {
    throw new Error(
      `Table "${table}" is not tenant-scoped. Add tenant_id and declare it in ` +
      `TENANT_SCOPED_TABLES (ADR 0011 §2), or use the unscoped data() client ` +
      `deliberately for a non-person-scoped table.`
    );
  }
}

export class Repository {
  constructor(private readonly ctx: TenantContext) {
    requireTenant(ctx);
  }

  get tenantId(): string {
    return this.ctx.tenantId;
  }

  /** Append the tenant predicate unless this is an audited cross-tenant call. */
  private scope(where: string | undefined, params: unknown[]): { sql: string; params: unknown[] } {
    if (this.ctx.crossTenant) {
      return { sql: where ? `WHERE ${where}` : "", params };
    }
    const clause = where ? `WHERE (${where}) AND tenant_id = ?` : "WHERE tenant_id = ?";
    return { sql: clause, params: [...params, this.ctx.tenantId] };
  }

  async findOne<T = Record<string, unknown>>(
    table: string, where?: string, params: unknown[] = []
  ): Promise<T | null> {
    assertScopable(table);
    const s = this.scope(where, params);
    const c = await data();
    const row = await c.get(`SELECT * FROM ${table} ${s.sql} LIMIT 1`, s.params);
    return (row as T) ?? null;
  }

  async findMany<T = Record<string, unknown>>(
    table: string, where?: string, params: unknown[] = [], opts: { orderBy?: string; limit?: number } = {}
  ): Promise<T[]> {
    assertScopable(table);
    const s = this.scope(where, params);
    const order = opts.orderBy ? ` ORDER BY ${opts.orderBy}` : "";
    const limit = opts.limit ? ` LIMIT ${Number(opts.limit)}` : "";
    const c = await data();
    return (await c.all(`SELECT * FROM ${table} ${s.sql}${order}${limit}`, s.params)) as T[];
  }

  async count(table: string, where?: string, params: unknown[] = []): Promise<number> {
    assertScopable(table);
    const s = this.scope(where, params);
    const c = await data();
    const row = (await c.get(`SELECT COUNT(*) AS n FROM ${table} ${s.sql}`, s.params)) as { n: number };
    return Number(row?.n ?? 0);
  }

  /** Insert, stamping the tenant. A caller-supplied tenant_id is ignored rather
   *  than trusted — the context is the authority. */
  async insert(table: string, values: Record<string, unknown>): Promise<void> {
    assertScopable(table);
    const row: Record<string, unknown> = { ...values, tenant_id: this.ctx.tenantId };
    const cols = Object.keys(row);
    const c = await data();
    await c.run(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((k) => row[k])
    );
  }

  /** Update rows matching `where` within this tenant. Returns nothing rather
   *  than a row count, so a caller cannot infer the existence of foreign rows. */
  async update(
    table: string, values: Record<string, unknown>, where: string, params: unknown[] = []
  ): Promise<void> {
    assertScopable(table);
    // tenant_id is never reassignable through an update — moving a record
    // between tenants must be a deliberate, audited operation, not a field write.
    const row = { ...values };
    delete row.tenant_id;
    const sets = Object.keys(row);
    if (sets.length === 0) return;
    const s = this.scope(where, [...sets.map((k) => row[k]), ...params]);
    const c = await data();
    await c.run(
      `UPDATE ${table} SET ${sets.map((k) => `${k} = ?`).join(", ")} ${s.sql}`,
      s.params
    );
  }

  async deleteWhere(table: string, where: string, params: unknown[] = []): Promise<void> {
    assertScopable(table);
    const s = this.scope(where, params);
    const c = await data();
    await c.run(`DELETE FROM ${table} ${s.sql}`, s.params);
  }

  /** Does a row exist in THIS tenant? Returns false for a foreign-tenant row,
   *  which is what makes id enumeration useless to an attacker. */
  async exists(table: string, where: string, params: unknown[] = []): Promise<boolean> {
    return (await this.findOne(table, where, params)) !== null;
  }
}

/** The sanctioned entry point for person-scoped data access. */
export function repo(ctx: TenantContext): Repository {
  return new Repository(ctx);
}

/** Cross-tenant access for platform administration only.
 *
 *  Deliberately awkward: it is a named function, so every use is greppable in
 *  review, and it writes an audit record with the stated reason. Product code
 *  must never call this — a member-facing path that needs it has a design bug. */
export async function crossTenantContext(args: {
  actorId: string;
  reason: string;
}): Promise<TenantContext> {
  await audit({
    actorId: args.actorId,
    actorRole: "admin",
    family: "security",
    type: "cross_tenant_access",
    detail: { reason: args.reason },
  });
  return { tenantId: "*", crossTenant: true };
}
