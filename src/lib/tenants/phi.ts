// The PHI lock (Handoff 11 §0 and §8: "Add a test that the evaluation tenant
// cannot accept any field flagged as PHI").
//
// An evaluation tenant runs on synthetic people, so the fields that exist only
// to hold a real identifier have no business holding anything there. They are
// listed here once, and the lock is a database trigger generated from this list
// for SQLite and written out for Postgres (scripts/pg-schema.sql), so no write
// path — a form, an import, a seed, a script — can get round it. The app's own
// forms also disable these fields in an evaluation tenant, so a person is told
// before they type rather than refused after.
//
// WHAT IS NOT HERE, AND WHY. Names and emails are identifiers too, but an
// account cannot exist without them; in an evaluation tenant the seed uses an
// obviously synthetic list and domain (Handoff 11 W1), and staff sign in with
// their work email as staff, not as patients. Free text is not a "field"; it
// is covered by the tenant holding no real patients at all.

export interface PhiField {
  table: string;
  column: string;
  /** How the row's tenant is found: its own tenant_id, or its user's. */
  tenantVia: "tenant_id" | "user_id";
  why: string;
}

export const PHI_FIELDS: readonly PhiField[] = [
  { table: "users", column: "dob", tenantVia: "tenant_id", why: "A date of birth." },
  { table: "external_identifiers", column: "external_id", tenantVia: "tenant_id", why: "A record number from another system (an MRN or a member id)." },
  { table: "safety_plans", column: "support_contact_name", tenantVia: "user_id", why: "A named third party: the member's safe person." },
  { table: "safety_plans", column: "support_contact_method", tenantVia: "user_id", why: "How to reach that person: a phone number or address." },
];

export const PHI_LOCK_MESSAGE = "is a PHI field and is locked in an evaluation tenant";

/** The SQLite triggers, one before-insert and one before-update per field. */
export function phiLockTriggersSqlite(): string {
  return PHI_FIELDS.map((f) => {
    const mode = f.tenantVia === "tenant_id"
      ? "(SELECT mode FROM tenants WHERE id = NEW.tenant_id)"
      : "(SELECT t.mode FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = NEW.user_id)";
    const when = `NEW.${f.column} IS NOT NULL AND NEW.${f.column} <> '' AND ${mode} = 'evaluation'`;
    const raise = `SELECT RAISE(ABORT, '${f.table}.${f.column} ${PHI_LOCK_MESSAGE}');`;
    return ["INSERT", "UPDATE"].map((op) => `
  CREATE TRIGGER IF NOT EXISTS phi_lock_${f.table}_${f.column}_${op.toLowerCase()}
    BEFORE ${op} ON ${f.table} WHEN ${when}
  BEGIN ${raise} END;`).join("");
  }).join("\n");
}
