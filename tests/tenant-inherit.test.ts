// A row about a person belongs to that person's tenant (src/lib/tenants/
// inherit.ts). Found building the evaluation tenant: the live writers never
// name a tenant, so a member tester's check-ins, alerts and measures were
// filed in the platform tenant — invisible to the tenant's own views, and
// refused outright by Postgres RLS (test:rls proves that half).

process.env.EMDR_DATA_DIR = `/tmp/steady-tenant-inherit-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "tenant-inherit-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "tenant-inherit-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID, TENANT_SCOPED_TABLES } from "../src/lib/db";
import { inheritingTables, tenantInheritTriggersSqlite } from "../src/lib/tenants/inherit";
import { createAlert } from "../src/lib/clinical/alert-create";
import { ensureConfiguredTenant } from "../src/lib/tenants";
import { EVOLVEDMD_TENANT } from "../src/lib/tenants/evolvedmd";

const db = getDb();
const T = EVOLVEDMD_TENANT.id;
const tables = inheritingTables(db, TENANT_SCOPED_TABLES);

function member(tenant: string): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Synthetic', 'fabricated')").run(id, tenant);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'Synthetic')")
    .run(id, tenant, `${id}@synthetic.test`);
  return id;
}

const checkin = (user: string, date: string, tenant?: string) => {
  const id = newId();
  db.prepare(
    `INSERT INTO checkins (id, user_id${tenant ? ", tenant_id" : ""}, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action) VALUES (?, ?${tenant ? ", ?" : ""}, ?, 3, 3, 0, 1, 1, 6, 0, 'continue')`
  ).run(...[id, user, ...(tenant ? [tenant] : []), date]);
  return (db.prepare("SELECT tenant_id FROM checkins WHERE id = ?").get(id) as { tenant_id: string }).tenant_id;
};

test("every tenant-scoped table with an owner has its trigger, and the ones people write to are among them", () => {
  assert.ok(tables.length >= 40, `${tables.length}`);
  for (const t of ["checkins", "screenings", "alerts", "consents", "activity_entries", "member_thought_records", "safety_plans", "care_visits"]) {
    assert.ok(tables.some((x) => x.table === t), `${t} does not inherit`);
  }
  const installed = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'tenant_inherit_%'").all() as Array<{ name: string }>).map((r) => r.name));
  for (const t of tables) assert.ok(installed.has(`tenant_inherit_${t.table}`), t.table);
  assert.equal(tenantInheritTriggersSqlite(tables, PLATFORM_TENANT_ID).match(/CREATE TRIGGER/g)!.length, tables.length);
});

test("Postgres carries the same list", () => {
  const pg = fs.readFileSync(path.join(process.cwd(), "scripts/pg-schema.sql"), "utf8");
  const block = pg.slice(pg.indexOf("FUNCTION steady_tenant_inherit()"));
  const listed = [...block.matchAll(/'([a-z_]+):(user_id|person_id)'/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(listed, tables.map((t) => `${t.table}:${t.owner}`));
  assert.match(block, /CREATE TRIGGER tenant_inherit BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION steady_tenant_inherit\(%L\)/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "scripts/verify-rls.sh"), "utf8"), /lands in its member's tenant/);
});

test("a row written without a tenant takes its person's; the platform stays the platform; a named tenant is kept", async () => {
  await ensureConfiguredTenant(EVOLVEDMD_TENANT);
  const evalMember = member(T);
  const platformMember = member(PLATFORM_TENANT_ID);
  assert.equal(checkin(evalMember, "2026-09-20"), T);
  assert.equal(checkin(platformMember, "2026-09-20"), PLATFORM_TENANT_ID);
  assert.equal(checkin(evalMember, "2026-09-21", PLATFORM_TENANT_ID), T, "the platform default is indistinguishable from omission");
  const other = newId();
  db.prepare("INSERT INTO tenants (id, kind, name) VALUES (?, 'organization', 'Other')").run(other);
  assert.equal(checkin(evalMember, "2026-09-22", other), other, "a writer that names a tenant keeps it");
  // A person with no user row (a clinician-side record) inherits through persons.
  const personOnly = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Synthetic', 'fabricated')").run(personOnly, T);
  const visit = newId();
  db.prepare("INSERT INTO care_visits (id, tenant_id, person_id, clinician_person_id, kind, minutes, scheduled_at, status) VALUES (?, ?, ?, ?, 'visit', 45, '2026-10-01 09:00:00', 'scheduled')")
    .run(visit, PLATFORM_TENANT_ID, personOnly, evalMember);
  assert.equal((db.prepare("SELECT tenant_id FROM care_visits WHERE id = ?").get(visit) as { tenant_id: string }).tenant_id, T);
});

test("a live writer that names no tenant files the row in the member's tenant", async () => {
  const evalMember = member(T);
  await createAlert({ userId: evalMember, type: "checkin_safety_positive", severity: "urgent", detail: "Synthetic." });
  const row = db.prepare("SELECT tenant_id FROM alerts WHERE user_id = ?").get(evalMember) as { tenant_id: string };
  assert.equal(row.tenant_id, T);
});
