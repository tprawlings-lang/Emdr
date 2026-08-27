// Clinical audit history and BLS Part 6 oversight (Phase 4, completion).
//
// Three things are asserted here, all of which are properties a working screen
// can quietly lose:
//
//   TENANT SCOPE. `audit_log` has no tenant column, so the clinician-facing
//   views scope by resolving actor and target through `users`. Before this
//   work the audit console read every organization's trail. That is the exact
//   isolation the platform claims publicly, so it gets a cross-tenant attack
//   case rather than a smoke test.
//
//   CONTENT. An audit detail can carry a clinician's free text, a correction
//   rationale, an alert resolution, or — from a failed sign-in — an email
//   address typed by whoever attempted it. The audit view is the surface where
//   that leaks back in without anyone deciding it should.
//
//   PROTOCOL VS CONFIGURATION. The Part 6 oversight page exists because a
//   signed document and a running flag can disagree. So the test asserts the
//   page reads live configuration, and that desensitization cannot be turned on
//   by an environment variable.

process.env.EMDR_DATA_DIR = `/tmp/steady-oversight-${process.pid}-${Date.now()}`;
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "oversight-test-key";
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { provisionPerson } from "../src/lib/spine";
import { audit } from "../src/lib/audit";
import {
  memberAuditHistory, alertTrail, scopedAuditFeed, scopeNote,
} from "../src/lib/clinical/audit-history";
import {
  PART6_GATES, rolloutStages, runningConfig, oversightStatus,
  HARD_STOPS, REAL_USE_APPROVED,
} from "../src/lib/clinical/bls-oversight";

const OTHER_TENANT = newId();
const CLIN = "oc-clin";
const MINE = "oc-member";
const THEIRS = "oc-foreign";

async function user(id: string, role: "member" | "clinician", tenantId: string) {
  const c = await data();
  await c.run(
    "INSERT INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, ?, ?, 'x', ?)",
    [id, `${id}@test.local`, id, role, tenantId]
  );
  await provisionPerson({ userId: id, name: id, email: `${id}@test.local`, role });
}

test("setup: two tenants, each with a member and audit activity", async () => {
  const c = await data();
  await c.run("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)", [OTHER_TENANT, "Other Org"]);

  await user(CLIN, "clinician", PLATFORM_TENANT_ID);
  await user(MINE, "member", PLATFORM_TENANT_ID);
  await user(THEIRS, "member", OTHER_TENANT);

  // Activity on my member, including a free-text field that must not render.
  await audit({
    actorId: CLIN, actorRole: "clinician", family: "clinical",
    type: "clinical_record_corrected", target: MINE,
    detail: { supersedes: "evt-1", rationale: "The SUDS was misheard as 8; it was 3." },
  });
  await audit({
    actorId: MINE, actorRole: "member", family: "consent",
    type: "consent_granted", target: MINE, detail: { scope: "processing_session" },
  });

  // Activity in the other tenant, which must never appear in my views.
  await audit({
    actorId: THEIRS, actorRole: "member", family: "clinical",
    type: "clinical_record_corrected", target: THEIRS,
    detail: { rationale: "foreign tenant content" },
  });

  const rows = await c.all("SELECT COUNT(*) AS n FROM audit_log");
  assert.ok((rows[0] as { n: number }).n >= 3);
});

// ---------------------------------------------------------------------------
// Tenant scope
// ---------------------------------------------------------------------------

test("ATTACK: the audit feed never returns another tenant's entries", async () => {
  const feed = await scopedAuditFeed({ tenantId: PLATFORM_TENANT_ID, limit: 500 });
  for (const e of feed.entries) {
    assert.notEqual(e.target, THEIRS, "a foreign tenant's row reached the feed by target");
    assert.notEqual(e.actorId, THEIRS, "a foreign tenant's row reached the feed by actor");
  }
  // And the reverse direction, so the filter is not merely excluding one id.
  const theirs = await scopedAuditFeed({ tenantId: OTHER_TENANT, limit: 500 });
  for (const e of theirs.entries) {
    assert.notEqual(e.target, MINE);
    assert.notEqual(e.actorId, MINE);
  }
  assert.ok(theirs.entries.length > 0, "the other tenant should see its own entries");
});

test("member history is scoped to that member and reports what it excluded", async () => {
  const h = await memberAuditHistory({ personId: MINE, tenantId: PLATFORM_TENANT_ID });
  assert.ok(h.entries.length >= 2);
  for (const e of h.entries) {
    assert.ok(
      e.target === MINE || e.actorId === MINE,
      `entry ${e.id} is in a member history but touches neither side of that member`
    );
  }
  // Exclusions are counted rather than silently dropped: "nothing happened" and
  // "you cannot see what happened" are different answers.
  assert.equal(typeof h.outOfScope, "number");
});

test("the scope note states that this is a view filter, not row-level security", () => {
  const note = scopeNote().toLowerCase();
  assert.ok(note.includes("view filter"), "the scope note overstates what the filter is");
  assert.ok(
    note.includes("no tenant column") || note.includes("carries no tenant"),
    "the scope note does not explain why the filter is needed"
  );
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

test("free text never reaches an audit view, and the withholding is disclosed", async () => {
  const h = await memberAuditHistory({ personId: MINE, tenantId: PLATFORM_TENANT_ID });
  const serialised = JSON.stringify(h.entries);
  assert.ok(
    !serialised.includes("misheard"),
    "a correction rationale reached the audit view"
  );
  const corrected = h.entries.find((e) => e.type === "clinical_record_corrected");
  assert.ok(corrected, "the correction entry is missing");
  assert.equal(corrected!.redacted, true, "withheld fields were not disclosed as withheld");
  // The non-content field survives, so redaction is targeted rather than blanket.
  assert.equal(corrected!.detail.supersedes, "evt-1");
});

test("an attempted sign-in address never reaches the audit view", async () => {
  // login_failed records the attempted address verbatim. It is the clearest
  // case of content arriving in the log from outside the product.
  await audit({
    actorRole: "member", family: "identity", type: "login_failed",
    detail: { email: "someone.real@gmail.com", reason: "no such account" },
  });
  const feed = await scopedAuditFeed({ tenantId: PLATFORM_TENANT_ID, limit: 500 });
  assert.ok(
    !JSON.stringify(feed.entries).includes("someone.real@gmail.com"),
    "an attempted sign-in address reached the audit view"
  );
});

// ---------------------------------------------------------------------------
// Alert trail
// ---------------------------------------------------------------------------

test("an alert trail runs from creation to closure, oldest first", async () => {
  const c = await data();
  const alertId = newId();
  await c.run(
    `INSERT INTO alerts (id, user_id, alert_type, severity, detail, status, tenant_id)
     VALUES (?, ?, 'harm_urge', 'urgent', 'demo', 'open', ?)`,
    [alertId, MINE, PLATFORM_TENANT_ID]
  );
  await audit({
    actorRole: "member", family: "safety", type: "alert_raised",
    target: alertId, detail: { band: "immediate" },
  });
  await audit({
    actorId: CLIN, actorRole: "clinician", family: "specialist_action",
    type: "alert_closed", target: alertId,
    detail: { resolution: "Called and agreed a safety plan." },
  });

  const trail = await alertTrail({ alertId, tenantId: PLATFORM_TENANT_ID });
  assert.ok(trail.alert, "the alert was not found in its own tenant");
  assert.equal(trail.alert!.severity, "urgent");
  assert.ok(trail.entries.length >= 2, "the trail is missing entries");

  const types = trail.entries.map((e) => e.type);
  assert.ok(
    types.indexOf("alert_raised") < types.indexOf("alert_closed"),
    "the trail is not in sequence"
  );
  assert.ok(
    !JSON.stringify(trail.entries).includes("safety plan"),
    "the closure text reached the trail view"
  );
});

test("ATTACK: an alert in another tenant reads as absent, not as forbidden", async () => {
  const c = await data();
  const foreign = newId();
  await c.run(
    `INSERT INTO alerts (id, user_id, alert_type, severity, detail, status, tenant_id)
     VALUES (?, ?, 'harm_urge', 'urgent', 'demo', 'open', ?)`,
    [foreign, THEIRS, OTHER_TENANT]
  );
  const trail = await alertTrail({ alertId: foreign, tenantId: PLATFORM_TENANT_ID });
  // Absent, not refused: a "not permitted" response confirms the id exists.
  assert.equal(trail.alert, null);
  assert.deepEqual(trail.entries, []);
});

// ---------------------------------------------------------------------------
// Audit chain, surfaced
// ---------------------------------------------------------------------------

test("every audit view carries a chain verification result", async () => {
  const h = await memberAuditHistory({ personId: MINE, tenantId: PLATFORM_TENANT_ID });
  assert.equal(typeof h.chain.ok, "boolean");
  assert.ok(h.chain.checked > 0, "the chain check ran over nothing");
  assert.equal(h.chain.ok, true, "the audit chain is broken in a clean test database");
});

// ---------------------------------------------------------------------------
// BLS Part 6 oversight
// ---------------------------------------------------------------------------

test("Part 6 is not approved for real use, and no configuration changes that", () => {
  assert.equal(REAL_USE_APPROVED, false);
});

test("every Part 6 gate carries a state, and open gates cite the artefact", () => {
  assert.equal(PART6_GATES.length, 6, "Part 6 has six gates");
  const seen = new Set<number>();
  for (const g of PART6_GATES) {
    assert.ok(["met", "open", "blocked"].includes(g.state), `gate ${g.id} has an unknown state`);
    assert.ok(g.detail.length > 0, `gate ${g.id} has no detail`);
    assert.ok(!seen.has(g.n), `gate number ${g.n} is used twice`);
    seen.add(g.n);
    // A gate claimed as met must point at the artefact that closed it.
    if (g.state === "met") {
      assert.ok(g.evidence, `gate ${g.id} is met with no evidence cited`);
    }
  }
});

test("the human-factors and red-team gates are open, not quietly marked met", () => {
  // Both plans exist; neither exercise has been run. This is the drift the
  // oversight page is for — a written plan reading as a completed gate.
  for (const id of ["human-factors", "red-team"]) {
    const g = PART6_GATES.find((x) => x.id === id);
    assert.ok(g, `gate ${id} is missing`);
    assert.equal(g!.state, "open", `gate ${id} is marked ${g!.state} but the exercise has not run`);
  }
});

test("SAFETY: desensitization cannot be enabled by an environment variable", () => {
  // 4b is governed by the safety configuration, not a flag. Setting every
  // plausible environment variable must not open it.
  const before = rolloutStages().find((s) => s.id === "4b")!.enabled;
  assert.equal(before, false);

  const saved = { ...process.env };
  try {
    process.env.EMDR_BLS_RESOURCING = "1";
    process.env.EMDR_AUTONOMOUS_STIMULATION = "1";
    process.env.EMDR_BLS_DESENSITIZATION = "1";
    process.env.EMDR_DEMO = "1";
    const after = rolloutStages().find((s) => s.id === "4b")!.enabled;
    assert.equal(after, false, "an environment variable opened stage 4b");
    assert.equal(runningConfig().desensitizationEnabled, false);
  } finally {
    process.env = saved;
  }
});

test("the kill switch overrides the resourcing flag, not the other way round", () => {
  const saved = { ...process.env };
  try {
    process.env.EMDR_BLS_RESOURCING = "1";
    delete process.env.EMDR_KILL_BLS;
    assert.equal(rolloutStages().find((s) => s.id === "4a")!.enabled, true);

    process.env.EMDR_KILL_BLS = "1";
    const stage = rolloutStages().find((s) => s.id === "4a")!;
    assert.equal(stage.enabled, false, "the kill switch did not override the stage flag");
    assert.match(stage.because, /kill switch/i, "the reason does not name the kill switch");
    assert.match(oversightStatus().headline, /kill switch/i);
  } finally {
    process.env = saved;
  }
});

test("resourcing still requires per-member consent, not just the flag", () => {
  const saved = { ...process.env };
  try {
    process.env.EMDR_BLS_RESOURCING = "1";
    delete process.env.EMDR_KILL_BLS;
    const stage = rolloutStages().find((s) => s.id === "4a")!;
    // The flag enables the stage; it does not enable a session. The page has to
    // say so, or a clinician reads "enabled" as "running for everyone".
    assert.match(stage.because, /consent/i, "the 4a reason does not mention consent");
  } finally {
    process.env = saved;
  }
});

test("every stage states why it is or is not enabled", () => {
  for (const s of rolloutStages()) {
    assert.ok(s.because.length > 0, `stage ${s.id} does not say why`);
    assert.ok(s.entry.length > 0, `stage ${s.id} has no entry criteria`);
    assert.ok(s.scope.length > 0, `stage ${s.id} has no scope`);
  }
});

test("the five hard stopping criteria are present and unconditional", () => {
  assert.equal(HARD_STOPS.length, 5);
  for (const s of HARD_STOPS) {
    // A stop written with a hedge is not a stop.
    assert.doesNotMatch(s, /\b(?:may|might|consider|should probably|where possible)\b/i,
      `a hard stop is written conditionally: "${s}"`);
  }
});

test("oversight status reports gate counts that match the register", () => {
  const s = oversightStatus();
  assert.equal(s.gatesTotal, PART6_GATES.length);
  assert.equal(s.gatesMet, PART6_GATES.filter((g) => g.state === "met").length);
  assert.equal(s.blockedGates.length, PART6_GATES.filter((g) => g.state === "blocked").length);
  assert.ok(s.headline.length > 0);
});
