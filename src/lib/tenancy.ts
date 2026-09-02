// Tenancy and identity (ADR 0011).
//
// Three entities that the single `users` table currently conflates:
//
//   Person  — a human Steady holds data about. MAY EXIST WITHOUT AN ACCOUNT:
//             Handoff C3 ingests covered populations whose members have never
//             logged in and may never do so.
//   Account — a login. Optional; links to exactly one Person.
//   Tenant  — a governance boundary. Always present; consumer records use the
//             reserved platform tenant so the column is never null.
//
// Role becomes a relationship (`role_assignments`) rather than an attribute,
// which fixes a modelling error already latent in `users.role`: a clinician who
// is also a member cannot be represented there.
//
// During the migration `persons.id` equals the corresponding `users.id`, so
// every existing `user_id` foreign key is already a valid `person_id`. That
// turns ADR 0011's step 5 from a data migration into a rename.

import { data } from "./data";
import type { Role as LoginRole } from "./roles";
import { ulid } from "./ids";
import { PLATFORM_TENANT_ID } from "./db";

export { PLATFORM_TENANT_ID };

// The spine's role vocabulary: the six login roles (src/lib/roles.ts) plus
// `care_manager`, which is a care-relationship role rather than an account
// role — nobody signs in as one.
export type Role = LoginRole | "care_manager";

export interface Person {
  id: string;
  tenant_id: string;
  display_name: string | null;
  timezone: string | null;
  locale: string | null;
  status: string;
  created_at: string;
}

export interface Account {
  id: string;
  person_id: string;
  tenant_id: string;
  email: string;
  status: string;
  token_epoch: number;
}

/** Required for every scoped query. Passing one explicitly is what makes
 *  isolation a single invariant rather than a per-call-site judgement: a query
 *  issued without a context throws rather than returning everything (ADR 0011
 *  §3). */
export interface TenantContext {
  tenantId: string;
  /** The person on whose behalf the work is happening, when there is one. */
  personId?: string;
  /** Set only by explicitly-named, audited platform-administration paths.
   *  Product code must never construct a context with this set. */
  crossTenant?: boolean;
}

/** The context for direct-to-consumer work. */
export function platformContext(personId?: string): TenantContext {
  return { tenantId: PLATFORM_TENANT_ID, personId };
}

/** Guard for repository helpers. Throws rather than silently widening scope —
 *  a missing tenant must fail loudly, because the failure mode of the
 *  alternative is cross-tenant PHI exposure. */
export function requireTenant(ctx: TenantContext | undefined): TenantContext {
  if (!ctx || typeof ctx.tenantId !== "string" || ctx.tenantId.length === 0) {
    throw new Error("Tenant context is required for scoped data access (ADR 0011).");
  }
  return ctx;
}

// ---------- Person ----------

export async function getPerson(id: string, ctx: TenantContext): Promise<Person | null> {
  const t = requireTenant(ctx);
  const c = await data();
  const row = (await c.get(
    t.crossTenant
      ? "SELECT * FROM persons WHERE id = ?"
      : "SELECT * FROM persons WHERE id = ? AND tenant_id = ?",
    t.crossTenant ? [id] : [id, t.tenantId]
  )) as Person | undefined;
  return row ?? null;
}

/** Create a person with no account — the Handoff C3 population case. */
export async function createPerson(args: {
  tenantId: string;
  displayName?: string | null;
  timezone?: string | null;
  locale?: string | null;
  id?: string;
  /** Fabricated or real. NOT optional and with no default: the distinction is
   *  generated-by-the-system versus originated-by-a-person, and a caller that
   *  has not decided which it is creating has not finished thinking. */
  provenance: "fabricated" | "real";
}): Promise<string> {
  const id = args.id ?? ulid();
  const c = await data();
  await c.run(
    `INSERT INTO persons (id, tenant_id, display_name, timezone, locale, provenance)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id, args.tenantId, args.displayName ?? null, args.timezone ?? null, args.locale ?? null,
      // REQUIRED, with no default. A caller that has not decided whether it is
      // creating a fabricated person or a real one has not finished thinking,
      // and the database refuses the row rather than guessing.
      args.provenance,
    ]
  );
  return id;
}

// ---------- Account ----------

export async function getAccountByEmail(email: string): Promise<Account | null> {
  const c = await data();
  const row = (await c.get(
    "SELECT id, person_id, tenant_id, email, status, token_epoch FROM accounts WHERE email = ?",
    [email.trim().toLowerCase()]
  )) as Account | undefined;
  return row ?? null;
}

export async function accountsForPerson(personId: string, ctx: TenantContext): Promise<Account[]> {
  const t = requireTenant(ctx);
  const c = await data();
  return (await c.all(
    "SELECT id, person_id, tenant_id, email, status, token_epoch FROM accounts WHERE person_id = ? AND tenant_id = ?",
    [personId, t.tenantId]
  )) as Account[];
}

// ---------- Roles ----------

/** A person's roles within one tenant. Multiple roles are legitimate — a
 *  clinician may also be a member. */
export async function rolesFor(personId: string, ctx: TenantContext): Promise<Role[]> {
  const t = requireTenant(ctx);
  const c = await data();
  const rows = (await c.all(
    `SELECT role FROM role_assignments
      WHERE person_id = ? AND tenant_id = ?
        AND (effective_to IS NULL OR effective_to > CURRENT_TIMESTAMP)`,
    [personId, t.tenantId]
  )) as { role: Role }[];
  return rows.map((r) => r.role);
}

export async function hasRole(personId: string, role: Role, ctx: TenantContext): Promise<boolean> {
  return (await rolesFor(personId, ctx)).includes(role);
}

export async function assignRole(personId: string, role: Role, ctx: TenantContext): Promise<void> {
  const t = requireTenant(ctx);
  const c = await data();
  await c.run(
    `INSERT INTO role_assignments (id, person_id, tenant_id, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(person_id, tenant_id, role) DO NOTHING`,
    [ulid(), personId, t.tenantId, role]
  );
}

// ---------- Tenants ----------

export async function createTenant(args: {
  kind: "organization" | "facility" | "program";
  name: string;
  parentTenantId?: string | null;
}): Promise<string> {
  const id = ulid();
  const c = await data();
  await c.run(
    "INSERT INTO tenants (id, kind, name, parent_tenant_id) VALUES (?, ?, ?, ?)",
    [id, args.kind, args.name, args.parentTenantId ?? null]
  );
  return id;
}

/** Enroll an existing person into a tenant's program without duplicating
 *  identity — the consumer→enterprise conversion path (Handoff C1). */
export async function enrollPerson(args: {
  personId: string;
  tenantId: string;
  programId?: string | null;
  eligibility?: string | null;
}): Promise<string> {
  const id = ulid();
  const c = await data();
  await c.run(
    `INSERT INTO enrollments (id, person_id, tenant_id, program_id, eligibility)
     VALUES (?, ?, ?, ?, ?)`,
    [id, args.personId, args.tenantId, args.programId ?? null, args.eligibility ?? null]
  );
  return id;
}

/** Map an external system's identifier to a canonical person. External IDs are
 *  never primary keys (Handoff C2). */
export async function linkExternalId(args: {
  personId: string;
  tenantId: string;
  sourceSystem: string;
  externalId: string;
  idType?: string | null;
}): Promise<void> {
  const c = await data();
  await c.run(
    `INSERT INTO external_identifiers (id, person_id, tenant_id, source_system, external_id, id_type)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, source_system, external_id) DO NOTHING`,
    [ulid(), args.personId, args.tenantId, args.sourceSystem, args.externalId, args.idType ?? null]
  );
}

export async function resolveExternalId(
  sourceSystem: string, externalId: string, ctx: TenantContext
): Promise<string | null> {
  const t = requireTenant(ctx);
  const c = await data();
  const row = (await c.get(
    `SELECT person_id FROM external_identifiers
      WHERE tenant_id = ? AND source_system = ? AND external_id = ?`,
    [t.tenantId, sourceSystem, externalId]
  )) as { person_id: string } | undefined;
  return row?.person_id ?? null;
}
