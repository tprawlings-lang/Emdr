// Handoff 11 package 1: the evaluation tenant, its PHI lock, and the primary
// care role. §8: "Add a test that the evaluation tenant cannot accept any
// field flagged as PHI."
//
//   - The tenant's settings live in one config file, and the database's mode
//     column mirrors it.
//   - Every PHI field is refused in an evaluation tenant, on insert and on
//     update, by the database itself — and accepted in an ordinary tenant, so
//     the refusal is the lock and not something else.
//   - The Postgres schema carries the same lock for every field (test:rls
//     proves it against a real cluster).
//   - The forms and the mobile API do not send those fields there.
//   - pcp_viewer exists, is its own door, and has no grant but its summary.
//   - The banner shows for the evaluation tenant only, in the handoff's words.

process.env.EMDR_DATA_DIR = `/tmp/steady-eval-tenant-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "evaluation-tenant-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "evaluation-tenant-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import {
  ensureConfiguredTenant, EVALUATION_BANNER, evaluationBannerFor, isEvaluationTenant, tenantConfig, TENANT_CONFIGS,
} from "../src/lib/tenants";
import { EVOLVEDMD_TENANT } from "../src/lib/tenants/evolvedmd";
import { PHI_FIELDS, PHI_LOCK_MESSAGE, phiLockTriggersSqlite, type PhiField } from "../src/lib/tenants/phi";
import { DEMO_ROLES, isRole, landingFor, PARTNER_ROLES, PERMISSIONS, ROLES } from "../src/lib/roles";

const db = getDb();
const EVAL = EVOLVEDMD_TENANT.id;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

function account(tenantId: string, role = "member"): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Synthetic', 'fabricated')").run(id, tenantId);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, 'Synthetic')")
    .run(id, tenantId, `${id}@synthetic.test`, role);
  return id;
}

/** One way to write each PHI field, for a person in a given tenant. A new
 *  field in PHI_FIELDS fails the coverage test below until it has a writer
 *  here, so no field is listed without being proved. */
const WRITERS: Record<string, (f: PhiField, person: string, tenant: string, value: string) => void> = {
  users: (f, person, _t, value) => { db.prepare(`UPDATE users SET ${f.column} = ? WHERE id = ?`).run(value, person); },
  external_identifiers: (f, person, tenant, value) => {
    db.prepare(`INSERT INTO external_identifiers (id, person_id, tenant_id, source_system, ${f.column}) VALUES (?, ?, ?, 'ehr', ?)`)
      .run(newId(), person, tenant, value);
  },
  safety_plans: (f, person, _t, value) => {
    db.prepare(`INSERT INTO safety_plans (user_id, ${f.column}) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET ${f.column} = excluded.${f.column}`).run(person, value);
  },
};

test("the config is the one place the tenant is described, and the database mirrors its mode", async () => {
  assert.deepEqual(TENANT_CONFIGS.map((t) => t.id), ["evolvedmd-eval"]);
  assert.equal(tenantConfig(EVAL), EVOLVEDMD_TENANT);
  assert.equal(EVOLVEDMD_TENANT.mode, "evaluation");
  assert.deepEqual([...EVOLVEDMD_TENANT.states], ["AZ", "MA", "NH", "ME"]);
  assert.deepEqual(EVOLVEDMD_TENANT.treatToTarget, { responseReductionPct: 50, remissionPhq9Below: 5, reviewIfNotRespondingByWeek: 10 });
  assert.equal(EVOLVEDMD_TENANT.escalation.careTeamContact.phone, null, "a contact was invented; evolvedMD supplies it");
  assert.equal(isEvaluationTenant(PLATFORM_TENANT_ID), false);
  await ensureConfiguredTenant(EVOLVEDMD_TENANT);
  await ensureConfiguredTenant(EVOLVEDMD_TENANT); // idempotent
  const row = db.prepare("SELECT kind, name, mode FROM tenants WHERE id = ?").get(EVAL);
  assert.deepEqual(row, { kind: "organization", name: "evolvedMD", mode: "evaluation" });
});

test("nothing partner-specific is written outside src/lib/tenants", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = path.join(dir, d.name);
      if (d.isDirectory()) { if (rel !== "src/lib/tenants") walk(rel); continue; }
      if (!/\.(ts|tsx)$/.test(d.name)) continue;
      if (/evolved ?md/i.test(read(rel).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))) hits.push(rel);
    }
  };
  walk("src");
  assert.deepEqual(hits, []);
});

test("the generator writes an insert and an update trigger for every field, and the database has them all", () => {
  const sql = phiLockTriggersSqlite();
  const names = [...sql.matchAll(/CREATE TRIGGER IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
  const expected = PHI_FIELDS.flatMap((f) => [`phi_lock_${f.table}_${f.column}_insert`, `phi_lock_${f.table}_${f.column}_update`]).sort();
  assert.deepEqual(names, expected);
  const installed = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'phi_lock_%'").all() as Array<{ name: string }>).map((t) => t.name).sort();
  assert.deepEqual(installed, expected);
});

test("every PHI field has a writer here, so none is listed without being proved", () => {
  for (const f of PHI_FIELDS) assert.ok(WRITERS[f.table], `no test writer for ${f.table}.${f.column}`);
});

test("the evaluation tenant refuses every PHI field, on insert and update, at the database", async () => {
  await ensureConfiguredTenant(EVOLVEDMD_TENANT);
  for (const f of PHI_FIELDS) {
    const person = account(EVAL);
    assert.throws(() => WRITERS[f.table](f, person, EVAL, "1990-01-01 / 555-0100 / MRN42"),
      (e: Error) => e.message.includes(`${f.table}.${f.column} ${PHI_LOCK_MESSAGE}`), `${f.table}.${f.column} was accepted`);
  }
  // An update is refused too: a plan saved without the field, then given one.
  const p = account(EVAL);
  db.prepare("INSERT INTO safety_plans (user_id, grounding_tools_json) VALUES (?, '[]')").run(p);
  assert.throws(() => db.prepare("UPDATE safety_plans SET support_contact_method = '555-0100' WHERE user_id = ?").run(p), /locked/);
  // Empty and null are not a value: a form posting an empty box still works.
  db.prepare("UPDATE safety_plans SET support_contact_method = '' WHERE user_id = ?").run(p);
});

test("the same fields are accepted in an ordinary tenant, so the refusal is the lock", () => {
  for (const f of PHI_FIELDS) {
    const person = account(PLATFORM_TENANT_ID);
    assert.doesNotThrow(() => WRITERS[f.table](f, person, PLATFORM_TENANT_ID, "1990-01-01"), `${f.table}.${f.column}`);
  }
});

test("the Postgres schema carries the same lock for every field", () => {
  const pg = read("scripts/pg-schema.sql");
  assert.match(pg, /ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mode/);
  for (const f of PHI_FIELDS) {
    const re = new RegExp(`CREATE TRIGGER phi_lock_${f.table}_${f.column} BEFORE INSERT OR UPDATE ON ${f.table}\\s+FOR EACH ROW EXECUTE FUNCTION steady_phi_lock\\('${f.column}', '${f.tenantVia}'\\)`);
    assert.match(pg, re, `${f.table}.${f.column} has no Postgres lock`);
  }
  assert.match(read("scripts/verify-rls.sh"), /PHI lock holds in an evaluation tenant/);
});

test("the forms and the mobile API do not send the safe person's details in an evaluation tenant", () => {
  const actions = read("src/lib/actions.ts");
  const save = actions.slice(actions.indexOf("export async function saveSafetyPlan"));
  assert.match(save.slice(0, 2000), /isEvaluationTenant\(user\.tenantId\)/);
  assert.match(read("src/lib/mobile/onboarding.ts"), /phiLocked \? null : \(b\.contactName/);
  const page = read("src/app/app/onboarding/profile/page.tsx");
  assert.equal((page.match(/disabled=\{phiLocked\}/g) ?? []).length, 2, "the contact fields are not disabled");
});

test("the banner: the handoff's words, the evaluation tenant only", () => {
  assert.equal(EVALUATION_BANNER, "Evaluation environment. No patient data.");
  assert.equal(evaluationBannerFor(EVAL), EVALUATION_BANNER);
  assert.equal(evaluationBannerFor(PLATFORM_TENANT_ID), null);
  assert.equal(evaluationBannerFor(undefined), null, "a signed-out visitor sees no tenant banner");
  assert.match(read("src/app/layout.tsx"), /<EvaluationBanner \/>/);
});

test("pcp_viewer: a role of its own, its own door, and no grant but its summary", async () => {
  assert.ok(isRole("pcp_viewer") && ROLES.includes("pcp_viewer"));
  assert.equal(landingFor("pcp_viewer"), "/pcp");
  assert.ok(PARTNER_ROLES.find((r) => r.role === "pcp_viewer")!.cannotSee.includes("Free text"));
  assert.ok(!DEMO_ROLES.some((r) => r.role === "pcp_viewer"), "a partner role joined the public handoff-07 personas");
  for (const [capability, grants] of Object.entries(PERMISSIONS)) {
    assert.equal(grants.pcp_viewer, capability === "pcp_summary" ? "assigned" : "no", capability);
  }
  // The database accepts the role (the CHECK was widened, and a rebuilt
  // table keeps its PHI lock).
  const pcp = account(EVAL, "pcp_viewer");
  assert.equal((db.prepare("SELECT role FROM users WHERE id = ?").get(pcp) as { role: string }).role, "pcp_viewer");
  const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'users' AND name LIKE 'phi_lock_%'").all() as Array<{ name: string }>).map((t) => t.name).sort();
  assert.deepEqual(triggers, ["phi_lock_users_dob_insert", "phi_lock_users_dob_update"]);
  const auth = read("src/lib/auth.ts");
  assert.match(auth, /export async function requirePcpViewer/);
  assert.match(read("src/app/pcp/page.tsx"), /await requirePcpViewer\(\)/);
});
