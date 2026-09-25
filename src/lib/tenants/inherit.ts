// A row about a person belongs to that person's tenant.
//
// FOUND BUILDING THE EVALUATION TENANT (Handoff 11 package 2). The live writers
// — the web and mobile check-in, alerts, measures, program entries — were
// written when every person lived in the platform tenant, so they never name
// a tenant and the column's default files the row there. For a member tester
// in an evaluation tenant that is wrong twice over: the row is invisible to
// the tenant's own views, and in Postgres the RLS check refuses the insert
// outright (a session in one tenant writing a row marked for another).
//
// Fixed where it cannot be forgotten: the database fills the tenant from the
// row's person when a writer left it at the platform default. A writer that
// names a tenant keeps it. Rows for people in the platform tenant — the whole
// demo population — are untouched, so nothing already written changes.
//
// Postgres carries the same rule (scripts/pg-schema.sql, steady_tenant_inherit)
// over the same list; a test holds the two lists together.

import type Database from "better-sqlite3";

/** The column naming whose row it is, per table; users first, since a user's
 *  id is their person's id. */
export const OWNER_COLUMNS = ["user_id", "person_id"] as const;

export interface InheritingTable { table: string; owner: (typeof OWNER_COLUMNS)[number] }

/** The tenant-scoped tables that carry both a tenant and an owner column. */
export function inheritingTables(db: Database.Database, scoped: readonly string[]): InheritingTable[] {
  const out: InheritingTable[] = [];
  for (const table of scoped) {
    if (table === "users") continue;
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
    if (!cols.has("tenant_id")) continue;
    const owner = OWNER_COLUMNS.find((c) => cols.has(c));
    if (owner) out.push({ table, owner });
  }
  return out;
}

/** One after-insert trigger per table. */
export function tenantInheritTriggersSqlite(tables: readonly InheritingTable[], platformTenantId: string): string {
  return tables.map(({ table, owner }) => {
    const theirs = `COALESCE((SELECT tenant_id FROM users WHERE id = NEW.${owner}), (SELECT tenant_id FROM persons WHERE id = NEW.${owner}))`;
    return `
  CREATE TRIGGER IF NOT EXISTS tenant_inherit_${table} AFTER INSERT ON ${table}
    WHEN NEW.tenant_id = '${platformTenantId}' AND COALESCE(${theirs}, '${platformTenantId}') <> '${platformTenantId}'
  BEGIN UPDATE ${table} SET tenant_id = ${theirs} WHERE rowid = NEW.rowid; END;`;
  }).join("\n");
}
