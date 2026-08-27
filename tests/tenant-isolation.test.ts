// Cross-tenant isolation attack cases (ADR 0011 §4, Handoff C1).
//
// Handoff C1 requires that tenant isolation be "enforced at the data-access
// layer and tested with cross-tenant attack cases." This file is that test set.
// It is written adversarially: each case is an attempt to reach tenant B's data
// while holding tenant A's context, and the assertion is that the attempt
// yields nothing AND leaks nothing about whether the target exists.
//
// Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-isolation-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { newId } from "../src/lib/db";
import { repo, crossTenantContext, Repository } from "../src/lib/repository";
import {
  createTenant, createPerson, getPerson, platformContext, assignRole, rolesFor,
  resolveExternalId, linkExternalId,
} from "../src/lib/tenancy";
import { readEvents, appendEvent } from "../src/lib/events";

// Two tenants that must never see each other.
let orgA = "", orgB = "";
let personA = "", personB = "";
let checkinA = "", checkinB = "";

test("setup: two tenants, each with a person and a check-in", async () => {
  orgA = await createTenant({ kind: "organization", name: "Alpha Health" });
  orgB = await createTenant({ kind: "organization", name: "Beta Health" });
  // persons.id == users.id (ADR 0011 refinement), so user_id foreign keys are
  // already valid person references.
  personA = "iso-user-A";
  personB = "iso-user-B";

  const c = await data();
  for (const [tenant, person, label] of [[orgA, personA, "A"], [orgB, personB, "B"]] as const) {
    const uid = person;
    await c.run("INSERT INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, ?, ?, ?, ?)",
      [uid, `iso-${label}@test.local`, `Iso ${label}`, "member", "x", tenant]);
    await createPerson({ tenantId: tenant, displayName: `${label} Patient`, id: uid });
    const id = newId();
    await c.run(
      `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge,
         feels_safe, dissociation, sleep_quality, substance_flag, recommended_action, tenant_id)
       VALUES (?, ?, '2026-05-01', 5, 2, 0, 1, 3, 6, 0, 'processing_ok', ?)`,
      [id, person, tenant]
    );
    if (label === "A") checkinA = id; else checkinB = id;
  }
  assert.ok(orgA && orgB && personA && personB && checkinA && checkinB);
});

// ---------- Read paths ----------

test("ATTACK: read tenant B's row by its exact id while holding tenant A's context", async () => {
  const asA = repo({ tenantId: orgA });
  const stolen = await asA.findOne("checkins", "id = ?", [checkinB]);
  assert.equal(stolen, null, "returns nothing — not a filtered version, nothing");

  // Control: the same query for its own row succeeds, proving the query works.
  assert.ok(await asA.findOne("checkins", "id = ?", [checkinA]), "own row is reachable");
});

test("ATTACK: id enumeration cannot distinguish a foreign row from a nonexistent one", async () => {
  const asA = repo({ tenantId: orgA });
  const foreign = await asA.exists("checkins", "id = ?", [checkinB]);
  const fictional = await asA.exists("checkins", "id = ?", ["definitely-not-a-real-id"]);
  assert.equal(foreign, fictional,
    "a real foreign id and a made-up id are indistinguishable — enumeration reveals nothing");
  assert.equal(foreign, false);
});

test("ATTACK: unfiltered list read returns only the caller's tenant", async () => {
  const rowsA = await repo({ tenantId: orgA }).findMany("checkins");
  const rowsB = await repo({ tenantId: orgB }).findMany("checkins");
  assert.equal(rowsA.length, 1);
  assert.equal(rowsB.length, 1);
  assert.notDeepEqual(rowsA, rowsB);
  assert.equal(
    rowsA.some((r) => (r as { tenant_id: string }).tenant_id !== orgA), false,
    "no foreign row bleeds into a list"
  );
});

test("ATTACK: aggregate counts do not leak the other tenant's volume", async () => {
  const nA = await repo({ tenantId: orgA }).count("checkins");
  const nB = await repo({ tenantId: orgB }).count("checkins");
  const total = (await (await data()).get("SELECT COUNT(*) AS n FROM checkins", [])) as { n: number };
  assert.equal(nA, 1);
  assert.equal(nB, 1);
  assert.ok(Number(total.n) >= 2, "both rows exist globally");
  assert.notEqual(nA, Number(total.n), "the count is scoped, not global");
});

test("ATTACK: a WHERE clause crafted to widen scope is still confined", async () => {
  const asA = repo({ tenantId: orgA });
  // The caller supplies an always-true predicate hoping to select everything.
  const all = await asA.findMany("checkins", "1 = 1");
  assert.equal(all.length, 1, "the tenant predicate is ANDed on regardless");
  // And an attempt to override the tenant in the predicate itself.
  const spoof = await asA.findMany("checkins", "tenant_id = ?", [orgB]);
  assert.equal(spoof.length, 0, "cannot select a foreign tenant by naming it");
});

// ---------- Write paths ----------

test("ATTACK: update targeting tenant B's row leaves it untouched", async () => {
  const asA = repo({ tenantId: orgA });
  await asA.update("checkins", { recommended_action: "crisis" }, "id = ?", [checkinB]);

  const victim = await repo({ tenantId: orgB }).findOne<{ recommended_action: string }>(
    "checkins", "id = ?", [checkinB]
  );
  assert.equal(victim?.recommended_action, "processing_ok", "tenant B's row is unchanged");
});

test("ATTACK: delete targeting tenant B's row is a no-op", async () => {
  const asA = repo({ tenantId: orgA });
  await asA.deleteWhere("checkins", "id = ?", [checkinB]);
  assert.ok(
    await repo({ tenantId: orgB }).exists("checkins", "id = ?", [checkinB]),
    "tenant B's row survives"
  );
});

test("ATTACK: a caller-supplied tenant_id on insert is ignored, not trusted", async () => {
  const asA = repo({ tenantId: orgA });
  const id = newId();
  await asA.insert("lesson_reads", {
    id, user_id: personA, lesson_id: "window-of-tolerance",
    tenant_id: orgB, // the attack: claim to be writing into tenant B
  });
  const inB = await repo({ tenantId: orgB }).findOne("lesson_reads", "id = ?", [id]);
  assert.equal(inB, null, "the row did not land in tenant B");
  assert.ok(await asA.findOne("lesson_reads", "id = ?", [id]), "it landed in the caller's own tenant");
});

test("ATTACK: tenant_id cannot be reassigned through an update", async () => {
  const asA = repo({ tenantId: orgA });
  await asA.update("checkins", { tenant_id: orgB, activation: 9 }, "id = ?", [checkinA]);
  const row = await asA.findOne<{ tenant_id: string; activation: number }>("checkins", "id = ?", [checkinA]);
  assert.ok(row, "row still belongs to tenant A");
  assert.equal(row!.tenant_id, orgA, "moving a record between tenants is not a field write");
  assert.equal(row!.activation, 9, "the legitimate part of the update applied");
});

// ---------- Construction and misuse ----------

test("a repository cannot be constructed without a tenant context", () => {
  assert.throws(() => new Repository(undefined as never), /Tenant context is required/);
  assert.throws(() => repo({ tenantId: "" }), /Tenant context is required/);
});

test("a table that is not tenant-scoped is refused rather than silently unscoped", async () => {
  const asA = repo({ tenantId: orgA });
  await assert.rejects(() => asA.findOne("tenants", "id = ?", [orgB]), /not tenant-scoped/);
  await assert.rejects(() => asA.findMany("longitudinal_events"), /not tenant-scoped/);
});

test("cross-tenant access is possible, named, and audited", async () => {
  const c = await data();
  const before = (await c.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'cross_tenant_access'", []
  )) as { n: number };

  const ctx = await crossTenantContext({ actorId: "platform-admin", reason: "isolation test" });
  const all = await repo(ctx).findMany("checkins");
  assert.ok(all.length >= 2, "the escape hatch genuinely sees across tenants");

  const after = (await c.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'cross_tenant_access'", []
  )) as { n: number };
  assert.equal(Number(after.n), Number(before.n) + 1, "every use is recorded with its reason");
});

// ---------- Identity and spine surfaces ----------

test("ATTACK: person lookup across tenants returns nothing", async () => {
  assert.equal(await getPerson(personB, { tenantId: orgA }), null);
  assert.ok(await getPerson(personB, { tenantId: orgB }));
});

test("ATTACK: role assignment in one tenant does not grant it in another", async () => {
  await assignRole(personA, "clinician", { tenantId: orgA });
  assert.deepEqual(await rolesFor(personA, { tenantId: orgA }), ["clinician"]);
  assert.deepEqual(await rolesFor(personA, { tenantId: orgB }), [],
    "a clinician at Alpha is not a clinician at Beta");
});

test("ATTACK: external identifiers resolve only within their own tenant", async () => {
  await linkExternalId({
    personId: personB, tenantId: orgB, sourceSystem: "payer", externalId: "SHARED-999",
  });
  assert.equal(await resolveExternalId("payer", "SHARED-999", { tenantId: orgA }), null,
    "tenant A cannot resolve tenant B's member id");
  assert.equal(await resolveExternalId("payer", "SHARED-999", { tenantId: orgB }), personB);
});

test("ATTACK: the event log is tenant-scoped on read", async () => {
  await appendEvent({ personId: personA, tenantId: orgA, type: "lesson.read", payload: { lessonId: "a" } });
  await appendEvent({ personId: personB, tenantId: orgB, type: "lesson.read", payload: { lessonId: "b" } });

  const seenByA = await readEvents({ tenantId: orgA });
  assert.ok(seenByA.length > 0);
  assert.equal(seenByA.some((e) => e.person_id === personB), false,
    "tenant A's event read contains none of tenant B's history");
});

// ---------- Platform tenant ----------

test("the platform (consumer) tenant is isolated from enterprise tenants", async () => {
  const c = await data();
  const id = newId();
  await c.run(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge,
       feels_safe, dissociation, sleep_quality, substance_flag, recommended_action)
     VALUES (?, 'iso-user-A', '2026-06-01', 4, 2, 0, 1, 2, 7, 0, 'processing_ok')`,
    [id]
  );
  // Written with the default tenant → the platform tenant, not orgA.
  assert.ok(await repo(platformContext()).exists("checkins", "id = ?", [id]));
  assert.equal(await repo({ tenantId: orgA }).exists("checkins", "id = ?", [id]), false,
    "an enterprise tenant cannot read consumer records");
});
