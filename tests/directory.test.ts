// The patient directory.
//
// A directory is a list of people, which makes it the surface where a tenant
// leak is both most likely and most damaging: the caseload only surfaces
// someone once they need attention, but a directory reaches for EVERYONE by
// construction. So the cross-tenant case is the first thing asserted, in both
// directions.
//
// The second thing these guard is the distinction the directory exists for. It
// answers "find this person"; the caseload answers "who needs me now". The
// failure mode is drift — a severity column here, a sort by it there — until
// there are two triage views that disagree with each other.

process.env.EMDR_DATA_DIR = `/tmp/steady-directory-${process.pid}-${Date.now()}`;
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "directory-test-key";
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { provisionPerson } from "../src/lib/spine";
import { memberDirectory, byInitial } from "../src/lib/clinical/directory";

const OTHER_TENANT = newId();

async function member(id: string, name: string, tenantId: string, status = "active") {
  const c = await data();
  await c.run(
    "INSERT INTO users (id, email, name, role, password_hash, tenant_id, status) VALUES (?, ?, ?, 'member', 'x', ?, ?)",
    [id, `${id}@test.local`, name, tenantId, status]
  );
  await provisionPerson({ userId: id, name, email: `${id}@test.local`, role: "member" });
}

test("setup: two tenants with overlapping names", async () => {
  const c = await data();
  await c.run("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)", [OTHER_TENANT, "Other Org"]);

  await member("dir-1", "Alex Rivera", PLATFORM_TENANT_ID);
  await member("dir-2", "Blake Osei", PLATFORM_TENANT_ID);
  await member("dir-3", "alma Ford", PLATFORM_TENANT_ID);   // lower-case, sorts with A
  await member("dir-4", "Zoë Nakamura", PLATFORM_TENANT_ID);
  await member("dir-5", "Alex Rivera", OTHER_TENANT);        // SAME NAME, other tenant
  await member("dir-6", "Departed Member", PLATFORM_TENANT_ID, "inactive");

  const n = (await c.get("SELECT COUNT(*) AS n FROM users WHERE role = 'member'")) as { n: number };
  assert.ok(n.n >= 6);
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("ATTACK: the directory never lists another tenant's members", async () => {
  const mine = await memberDirectory({ tenantId: PLATFORM_TENANT_ID });
  assert.ok(!mine.rows.some((r) => r.personId === "dir-5"), "a foreign tenant's member was listed");

  // The reverse direction, so the filter is not merely excluding one id.
  const theirs = await memberDirectory({ tenantId: OTHER_TENANT });
  assert.deepEqual(theirs.rows.map((r) => r.personId), ["dir-5"]);
  assert.equal(theirs.total, 1);
});

test("ATTACK: searching a name that exists in another tenant finds nothing", async () => {
  // The specific probe a directory invites: type a name you believe exists and
  // see whether the system admits to it. Same name, both tenants — each side
  // must see only its own.
  const theirs = await memberDirectory({ tenantId: OTHER_TENANT, query: "Alex Rivera" });
  assert.equal(theirs.rows.length, 1);
  assert.equal(theirs.rows[0].personId, "dir-5", "the wrong tenant's Alex was returned");

  const mine = await memberDirectory({ tenantId: PLATFORM_TENANT_ID, query: "Alex Rivera" });
  assert.equal(mine.rows.length, 1);
  assert.equal(mine.rows[0].personId, "dir-1");
});

// ---------------------------------------------------------------------------
// Finding people
// ---------------------------------------------------------------------------

test("the directory is alphabetical and case-insensitive", async () => {
  // Ordered by need would be exactly wrong here: a clinician looking up a known
  // name should find it where the alphabet says it is.
  const d = await memberDirectory({ tenantId: PLATFORM_TENANT_ID });
  const names = d.rows.map((r) => r.displayName);
  const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  assert.deepEqual(names, sorted, "the directory is not in alphabetical order");
  // "alma" must sort with the As, not after Z.
  assert.ok(names.indexOf("alma Ford") < names.indexOf("Blake Osei"));
});

test("inactive members are not listed", async () => {
  const d = await memberDirectory({ tenantId: PLATFORM_TENANT_ID });
  assert.ok(!d.rows.some((r) => r.displayName === "Departed Member"));
});

test("search filters but the total still reports the whole panel", async () => {
  // A filtered list that reports its own length as the total makes a panel of
  // twelve look like a panel of three.
  const d = await memberDirectory({ tenantId: PLATFORM_TENANT_ID, query: "al" });
  assert.ok(d.rows.length >= 2, "search did not match the expected names");
  assert.ok(d.total > d.rows.length, "the total collapsed to the filtered count");
  assert.equal(d.query, "al");
});

test("search is forgiving about case and surrounding space", async () => {
  const d = await memberDirectory({ tenantId: PLATFORM_TENANT_ID, query: "  RIVERA " });
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].displayName, "Alex Rivera");
});

test("grouping by initial keeps non-letters out of the alphabet", async () => {
  const d = await memberDirectory({ tenantId: PLATFORM_TENANT_ID });
  const groups = byInitial(d.rows);
  assert.ok(groups.length > 1);
  for (const [initial] of groups) {
    assert.ok(/^[A-Z#]$/.test(initial), `"${initial}" is not a valid group heading`);
  }
  // Every row lands in exactly one group.
  const grouped = groups.flatMap(([, rows]) => rows).length;
  assert.equal(grouped, d.rows.length);
});

// ---------------------------------------------------------------------------
// It must not become a second caseload
// ---------------------------------------------------------------------------

test("the directory carries a boolean flag, never a band or a reason", async () => {
  const d = await memberDirectory({ tenantId: PLATFORM_TENANT_ID });
  for (const r of d.rows) {
    assert.equal(typeof r.needsAttention, "boolean");
    // Severity, bands, and the reasons behind them belong to the caseload.
    // Two triage views that disagree is worse than one, and a directory that
    // grades people has become the second one.
    for (const forbidden of ["band", "reasons", "severity", "priority", "score"]) {
      assert.ok(!(forbidden in r), `the directory row carries "${forbidden}"`);
    }
  }
});

test("attention is flagged rather than hidden, so nobody is browsed past", async () => {
  // The opposite failure: a directory that shows no urgency at all lets a
  // clinician scan alphabetically past someone in crisis.
  const c = await data();
  await c.run(
    `INSERT INTO alerts (id, user_id, alert_type, severity, detail, status, tenant_id)
     VALUES (?, 'dir-2', 'harm_urge', 'urgent', 'demo', 'open', ?)`,
    [newId(), PLATFORM_TENANT_ID]
  );
  const d = await memberDirectory({ tenantId: PLATFORM_TENANT_ID });
  const blake = d.rows.find((r) => r.personId === "dir-2")!;
  assert.equal(blake.needsAttention, true);
  assert.equal(blake.openAlerts, 1);

  const alma = d.rows.find((r) => r.personId === "dir-3")!;
  assert.equal(alma.needsAttention, false, "everyone is flagged, which flags nobody");
});

test("no activity reads as no activity, not as zero", async () => {
  const d = await memberDirectory({ tenantId: PLATFORM_TENANT_ID });
  const fresh = d.rows.find((r) => r.personId === "dir-4")!;
  assert.equal(fresh.lastActive, null,
    "a member with no history should report null, so the page can say " +
    "'no activity recorded' rather than showing a misleading date");
});
