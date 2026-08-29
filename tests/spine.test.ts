// Longitudinal spine (ADR 0010) + tenancy/identity model (ADR 0011).
// Hermetic temp DB. Env set BEFORE imports.
process.env.EMDR_DATA_DIR = `/tmp/steady-spine-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import {
  getDb, PLATFORM_TENANT_ID, TENANT_SCOPED_TABLES, hashPassword, syncIdentitySpine,
} from "../src/lib/db";
import { ulid, ulidTime, isUlid, NIL_ULID } from "../src/lib/ids";
import {
  appendEvent, readEvents, readEventsAsOf, eventCount, isEventType, EVENT_TYPES,
} from "../src/lib/events";
import {
  platformContext, requireTenant, createPerson, getPerson, createTenant,
  assignRole, rolesFor, hasRole, enrollPerson, linkExternalId, resolveExternalId,
  getAccountByEmail,
} from "../src/lib/tenancy";

// ---------- ULID (ADR 0010 ordering guarantee) ----------

test("ulid: 26 chars, Crockford alphabet, decodes its own timestamp", () => {
  const now = Date.now();
  const id = ulid(now);
  assert.equal(id.length, 26);
  assert.ok(isUlid(id));
  assert.equal(ulidTime(id), now);
  assert.equal(isUlid("not-a-ulid"), false);
  assert.equal(isUlid("ILOU00000000000000000000000"), false, "excludes ambiguous letters");
});

test("ulid: lexical order equals creation order, including within a millisecond", () => {
  // Same millisecond: monotonic increment must still sort correctly. This is
  // the property random UUIDs lack and the event log depends on.
  const fixed = 1_700_000_000_000;
  const batch = Array.from({ length: 200 }, () => ulid(fixed));
  assert.deepEqual([...batch].sort(), batch, "same-ms ids sort in creation order");
  assert.equal(new Set(batch).size, batch.length, "no collisions");

  // Across milliseconds.
  const across = [ulid(fixed), ulid(fixed + 1), ulid(fixed + 2)];
  assert.deepEqual([...across].sort(), across);
});

// ---------- Tenancy backfill (ADR 0011 steps 1-4) ----------

test("migration creates the platform tenant", async () => {
  const c = await data();
  const t = (await c.get("SELECT * FROM tenants WHERE id = ?", [PLATFORM_TENANT_ID])) as
    { id: string; kind: string } | undefined;
  assert.ok(t, "platform tenant exists");
  assert.equal(t!.kind, "platform");
  assert.equal(PLATFORM_TENANT_ID, NIL_ULID, "platform tenant uses the reserved nil ULID");
});

test("every tenant-scoped table actually has tenant_id — schema guard", () => {
  // ADR 0011 §4: a new table must not silently escape tenant scoping. If this
  // fails, either add tenant_id to the table or justify its absence and update
  // TENANT_SCOPED_TABLES.
  const db = getDb();
  const missing: string[] = [];
  for (const table of TENANT_SCOPED_TABLES) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "tenant_id")) missing.push(table);
  }
  assert.deepEqual(missing, [], `tables missing tenant_id: ${missing.join(", ")}`);
});

test("no person-scoped table escapes the tenant list", () => {
  // The inverse guard: any table carrying user_id/person_id must be declared.
  const db = getDb();
  const spine = new Set([
    "persons", "accounts", "role_assignments", "enrollments",
    "external_identifiers", "longitudinal_events", "audit_log",
    "autonomous_signoffs",
  ]);
  const tables = (db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]).map((r) => r.name);

  const undeclared: string[] = [];
  for (const t of tables) {
    if (spine.has(t) || (TENANT_SCOPED_TABLES as readonly string[]).includes(t)) continue;
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    if (cols.includes("user_id") || cols.includes("person_id")) { undeclared.push(t); continue; }
    // A column NAME is a weak test, and it let one through: export_jobs points
    // at a person via `requested_by`, so the guard read it as impersonal and
    // said nothing. What makes a table person-scoped is the REFERENCE, not
    // what the column is called — so ask the schema instead of the naming
    // convention.
    const fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all() as { table: string }[];
    if (fks.some((f) => f.table === "users" || f.table === "persons")) undeclared.push(t);
  }
  assert.deepEqual(undeclared, [], `person-scoped but not tenant-declared: ${undeclared.join(", ")}`);
});

test("existing users are mirrored onto the identity spine, person id == user id", async () => {
  const c = await data();
  await c.run(
    "INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)",
    ["spine-u1", "spine1@test.local", "Spine One", "member", hashPassword("x")]
  );
  // The backfill runs during migrate(); it is idempotent, so reconcile the
  // user just inserted. (Identity dual-write at signup is a later step.)
  syncIdentitySpine();

  const p = await getPerson("spine-u1", platformContext());
  assert.ok(p, "person created for the user");
  assert.equal(p!.tenant_id, PLATFORM_TENANT_ID);
  assert.equal(p!.display_name, "Spine One");

  const acct = await getAccountByEmail("spine1@test.local");
  assert.ok(acct, "account created");
  assert.equal(acct!.person_id, "spine-u1", "account points at the person");
  assert.notEqual(acct!.id, acct!.person_id, "account has its own identity");

  assert.deepEqual(await rolesFor("spine-u1", platformContext()), ["member"]);
});

test("role is a relationship: one person can be both clinician and member", async () => {
  const ctx = platformContext();
  await createPerson({ tenantId: PLATFORM_TENANT_ID, displayName: "Dual Role", id: "spine-dual" });
  await assignRole("spine-dual", "member", ctx);
  await assignRole("spine-dual", "clinician", ctx);
  const roles = await rolesFor("spine-dual", ctx);
  assert.equal(roles.length, 2, "both roles held — unrepresentable in users.role");
  assert.ok(await hasRole("spine-dual", "clinician", ctx));
  // Idempotent.
  await assignRole("spine-dual", "member", ctx);
  assert.equal((await rolesFor("spine-dual", ctx)).length, 2);
});

test("a person can exist with no account — the Handoff C3 population case", async () => {
  const orgId = await createTenant({ kind: "organization", name: "Test Health System" });
  const personId = await createPerson({ tenantId: orgId, displayName: "Ingested Member" });
  const p = await getPerson(personId, { tenantId: orgId });
  assert.ok(p, "person exists");
  const c = await data();
  const accts = (await c.get(
    "SELECT COUNT(*) AS n FROM accounts WHERE person_id = ?", [personId]
  )) as { n: number };
  assert.equal(Number(accts.n), 0, "no login required");
});

test("tenant isolation: a foreign-tenant read returns nothing", async () => {
  const orgA = await createTenant({ kind: "organization", name: "Org A" });
  const orgB = await createTenant({ kind: "organization", name: "Org B" });
  const personA = await createPerson({ tenantId: orgA, displayName: "A Person" });

  assert.ok(await getPerson(personA, { tenantId: orgA }), "own tenant sees it");
  assert.equal(await getPerson(personA, { tenantId: orgB }), null, "foreign tenant does not");
});

test("a query without a tenant context throws rather than widening scope", () => {
  assert.throws(() => requireTenant(undefined), /Tenant context is required/);
  assert.throws(() => requireTenant({ tenantId: "" }), /Tenant context is required/);
  assert.doesNotThrow(() => requireTenant(platformContext()));
});

test("enterprise enrollment does not duplicate identity", async () => {
  const org = await createTenant({ kind: "organization", name: "Employer Co" });
  // A consumer person later enrolls in an enterprise program.
  await enrollPerson({ personId: "spine-u1", tenantId: org, programId: "bh-2027" });
  const c = await data();
  const persons = (await c.get(
    "SELECT COUNT(*) AS n FROM persons WHERE id = ?", ["spine-u1"]
  )) as { n: number };
  assert.equal(Number(persons.n), 1, "still one person, now enrolled in two tenants");
});

test("external identifiers map to canonical persons and are never keys", async () => {
  const org = await createTenant({ kind: "organization", name: "Payer Co" });
  const personId = await createPerson({ tenantId: org, displayName: "Claims Member" });
  await linkExternalId({
    personId, tenantId: org, sourceSystem: "payer-x", externalId: "MEM-12345", idType: "member_id",
  });
  assert.equal(await resolveExternalId("payer-x", "MEM-12345", { tenantId: org }), personId);
  assert.equal(await resolveExternalId("payer-x", "MEM-12345", { tenantId: PLATFORM_TENANT_ID }), null,
    "external id resolution is tenant-scoped");
  // Idempotent re-ingest.
  await linkExternalId({ personId, tenantId: org, sourceSystem: "payer-x", externalId: "MEM-12345" });
});

// ---------- Event spine (ADR 0010) ----------

test("event catalog: types are registered; unknown types are rejected", async () => {
  assert.ok(isEventType("daily_checkin.completed"));
  assert.equal(isEventType("something.invented"), false);
  assert.ok(Object.keys(EVENT_TYPES).length >= 15, "catalog covers the domain chain");
  await assert.rejects(
    // @ts-expect-error deliberately unregistered
    () => appendEvent({ personId: "spine-u1", type: "not.registered" }),
    /Unregistered event type/
  );
});

test("appendEvent writes an ordered, immutable record with provenance", async () => {
  const before = await eventCount("spine-u1");
  const id1 = await appendEvent({
    personId: "spine-u1",
    type: "daily_checkin.completed",
    payload: { activation: 3, recommendedAction: "processing_ok" },
    provenance: { ruleVersion: "checkin-v1" },
  });
  const id2 = await appendEvent({
    personId: "spine-u1",
    type: "assessment.scored",
    payload: { instrument: "phq-9", score: 8 },
    actorType: "system",
  });

  assert.ok(isUlid(id1) && isUlid(id2));
  assert.ok(id1 < id2, "ids sort in append order");
  assert.equal(await eventCount("spine-u1"), before + 2);

  const events = await readEvents({ personId: "spine-u1" });
  const mine = events.filter((e) => e.id === id1 || e.id === id2);
  assert.deepEqual(mine.map((e) => e.id), [id1, id2], "read back in order");

  const first = mine[0];
  assert.equal(first.event_type, "daily_checkin.completed");
  assert.equal(first.payload.activation, 3);
  assert.equal(first.provenance.ruleVersion, "checkin-v1");
  // Version 2: the payload carries `projectionId`, the primary key of the
  // current-state row it produces, without which a rebuild cannot reproduce
  // that row (ADR 0010 step 4).
  assert.equal(first.payload_version, 2);
  assert.equal(first.tenant_id, PLATFORM_TENANT_ID);
  assert.equal(first.actor_type, "patient", "defaults to the person");
  assert.equal(mine[1].actor_type, "system");
});

test("occurred_at is distinct from recorded_at — required for ingested data", async () => {
  const past = "2020-03-01 09:00:00";
  const id = await appendEvent({
    personId: "spine-u1",
    type: "assessment.scored",
    occurredAt: past,
    sourceSystem: "ehr-import",
    payload: { instrument: "phq-9", score: 14 },
    actorType: "integration",
  });
  const ev = (await readEvents({ personId: "spine-u1" })).find((e) => e.id === id)!;
  assert.equal(ev.occurred_at, past, "when it happened in the world");
  assert.notEqual(ev.recorded_at, past, "when Steady learned of it");
  assert.equal(ev.source_system, "ehr-import");
});

test("corrections append and supersede; the original is never mutated", async () => {
  const original = await appendEvent({
    personId: "spine-u1", type: "memory.recorded", payload: { key: "calm place", value: "beach" },
  });
  const correction = await appendEvent({
    personId: "spine-u1",
    type: "memory.patient_corrected",
    payload: { key: "calm place", value: "the pines" },
    supersedesEventId: original,
  });

  const events = await readEvents({ personId: "spine-u1" });
  const orig = events.find((e) => e.id === original)!;
  const corr = events.find((e) => e.id === correction)!;
  assert.equal(orig.payload.value, "beach", "original preserved verbatim");
  assert.equal(corr.supersedes_event_id, original);
  assert.equal(corr.payload.value, "the pines");
});

test("as-of read reconstructs what was known at a point in time (no future leakage)", async () => {
  const c = await data();
  const personId = "spine-asof";
  await createPerson({ tenantId: PLATFORM_TENANT_ID, displayName: "As Of", id: personId });

  const e1 = await appendEvent({ personId, type: "daily_checkin.completed", payload: { day: 1 } });
  // Backdate the first event's recorded_at so there is a clear cut point.
  await c.run("UPDATE longitudinal_events SET recorded_at = ? WHERE id = ?",
    ["2026-01-01 00:00:00", e1]);
  await appendEvent({ personId, type: "daily_checkin.completed", payload: { day: 2 } });

  const asOf = await readEventsAsOf(personId, "2026-01-02 00:00:00");
  assert.equal(asOf.length, 1, "only what was recorded by the cut point");
  assert.equal(asOf[0].payload.day, 1);

  assert.equal((await readEvents({ personId })).length, 2, "unfiltered read sees both");
});

test("events are tenant-scoped and filterable by type", async () => {
  const org = await createTenant({ kind: "organization", name: "Event Org" });
  const orgPerson = await createPerson({ tenantId: org, displayName: "Org Person" });
  await appendEvent({ personId: orgPerson, tenantId: org, type: "session.started", payload: {} });

  const orgEvents = await readEvents({ tenantId: org });
  assert.equal(orgEvents.length, 1);
  assert.equal(orgEvents[0].person_id, orgPerson);

  const platformEvents = await readEvents({ tenantId: PLATFORM_TENANT_ID });
  assert.ok(platformEvents.every((e) => e.person_id !== orgPerson), "no cross-tenant bleed");

  const typed = await readEvents({ personId: "spine-u1", types: ["assessment.scored"] });
  assert.ok(typed.length >= 2 && typed.every((e) => e.event_type === "assessment.scored"));
});

test("a FRESH database mirrors seeded users onto the spine", async () => {
  // Regression: migrate() runs the backfill against an empty users table on a
  // fresh DB, so the spine stayed empty until getDb() reconciled again after
  // seed(). Every deploy to a new environment hit this.
  const dir = `/tmp/steady-spine-fresh-${process.pid}-${Date.now()}`;
  const prev = process.env.EMDR_DATA_DIR;
  process.env.EMDR_DATA_DIR = dir;
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(
      "npx",
      ["tsx", "-e", `
        import { getDb } from "./src/lib/db";
        const db = getDb();
        const users = db.prepare("SELECT id, email, role FROM users").all();
        const ok = users.every((u: any) =>
          db.prepare("SELECT 1 FROM persons WHERE id=?").get(u.id) &&
          db.prepare("SELECT 1 FROM accounts WHERE person_id=? AND email=?").get(u.id, u.email) &&
          db.prepare("SELECT 1 FROM role_assignments WHERE person_id=? AND role=?").get(u.id, u.role));
        console.log(JSON.stringify({ users: users.length, ok }));
      `],
      { cwd: process.cwd(), env: { ...process.env, EMDR_DATA_DIR: dir }, encoding: "utf8" }
    );
    const r = JSON.parse(out.trim().split("\n").pop()!);
    assert.ok(r.users > 0, "seed created users");
    assert.equal(r.ok, true, "every seeded user has a person, account, and role");
  } finally {
    if (prev) process.env.EMDR_DATA_DIR = prev;
  }
});
