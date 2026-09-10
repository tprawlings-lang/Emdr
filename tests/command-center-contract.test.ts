// The published provider contract, the care-time correction flow, the
// tenant-aware flags and the policy registry (expansion handoff 03 §10, §13,
// Appendix B; Phase 6).
//
// Phase 6's definition of done is a promise made to code that does not exist
// yet: "Handoffs 04 and 05 plug in without changing queue semantics or data
// contracts." That is the hardest kind to keep, because nothing fails today
// when it is broken — it fails in three months, in somebody else's handoff,
// with the queue's behaviour already changed underneath them.
//
// So the contract is executable. `conforms()` is run against EVERY registered
// provider here, which means a provider added later cannot ship breaking a rule
// the existing ones keep — and the trajectory and load providers arrive into a
// suite that already checks them.
//
// The correction flow has its own quiet failure. §13 asks that a clinician be
// able to correct recorded care time, and the obvious implementation is an
// UPDATE. That makes the ledger a record of what somebody currently believes
// rather than of what they recorded and when, and a care-time ledger that can
// be silently rewritten is one no staffing or reimbursement conversation should
// be built on.

process.env.EMDR_DATA_DIR = `/tmp/steady-cct-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "cct-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "cct-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { readEvents } from "../src/lib/events";
import {
  recordCareAction, correctCareAction, careActionsForPerson, currentCareActions,
  AttentionSignalError,
} from "../src/lib/clinical/attention-signals";
import { registeredProviders } from "../src/lib/clinical/attention-providers/registry";
import "../src/lib/clinical/attention-providers/providers";
import {
  conforms, isDeterministic, PROVIDER_CONTRACT_VERSION,
} from "../src/lib/clinical/attention-providers/contract";
import type { AttentionSignalCandidate } from "../src/lib/clinical/attention-vocabulary";
import {
  POLICY_REGISTRY, policyById, policySummaryLine,
} from "../src/lib/clinical/policy-registry";
import {
  ALL_COMMAND_CENTER_FLAGS, setTenantFlag, tenantFlagOverrides,
  flagEnabledWith, surfaceAvailableWith, commandCenterFlagEnabled,
} from "../src/lib/clinical/command-center-flags";

const db = getDb();
const T = { tenant: "tenant-cct", other: "tenant-cct-2", clinician: "clin-cct", patient: "pat-cct" };
for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
for (const id of [T.clinician, T.patient]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };

const CUTOFF = "2026-09-04T00:00:00.000Z";
function aCandidate(over: Partial<AttentionSignalCandidate> = {}): AttentionSignalCandidate {
  return {
    type: "test", dedupeKey: "test:1", band: "review_today",
    statement: "Difficulty afterwards has been recorded on 3 of 6 exposures.",
    evidenceIds: ["e1"], evidenceAt: "2026-09-01T00:00:00.000Z",
    limitations: [], policyVersion: "test.1.0.0",
    ...over,
  };
}
const PROVIDER = { id: "test-provider", version: "1.0.0", purpose: "A test provider." };

// ---------------------------------------------------------------------------
// The published contract (§10)
// ---------------------------------------------------------------------------

test("the contract is itself versioned, so a later change to it can be dated", () => {
  assert.ok(/^attention-provider-contract\.\d+\.\d+\.\d+$/.test(PROVIDER_CONTRACT_VERSION));
});

test("a well-formed candidate conforms", () => {
  assert.deepEqual(conforms(PROVIDER, [aCandidate()], { evidenceCutoff: CUTOFF }), []);
});

// §10: "a provider may emit review-worthiness, but only existing safety
// machinery may create safety authority." The band vocabulary already prevents
// the obvious route; this is the one left open — smuggling the authority into
// the WORDING and letting the sentence carry what the band could not.
test("a statement that claims safety authority fails the contract", () => {
  for (const statement of [
    "Urgent: this person needs contact today.",
    "Escalate — she is at risk of harm.",
    "This is critical and unsafe.",
    "High priority: contact immediately.",
  ]) {
    const issues = conforms(PROVIDER, [aCandidate({ statement })], { evidenceCutoff: CUTOFF });
    assert.ok(
      issues.some((i) => i.rule === "no_safety_authority"),
      `"${statement}" must fail the contract`
    );
  }
});

test("a statement that prescribes fails the contract", () => {
  for (const statement of [
    "You should increase the session frequency.",
    "I recommend reducing the pace.",
    "Consider starting treatment for insomnia.",
  ]) {
    const issues = conforms(PROVIDER, [aCandidate({ statement })], { evidenceCutoff: CUTOFF });
    assert.ok(
      issues.some((i) => i.rule === "no_treatment_direction" || i.rule === "no_safety_authority"),
      `"${statement}" must fail the contract`
    );
  }
});

// Checkable from outside precisely because the cutoff is an argument. A
// provider that read a clock internally could not be tested for this.
test("evidence after the cutoff fails the contract", () => {
  const issues = conforms(
    PROVIDER, [aCandidate({ evidenceAt: "2026-12-01T00:00:00.000Z" })], { evidenceCutoff: CUTOFF }
  );
  assert.ok(issues.some((i) => i.rule === "no_future_evidence"));
});

test("an unversioned provider, an unnamed band and an unexplained candidate all fail", () => {
  assert.ok(
    conforms({ ...PROVIDER, version: "v1" }, [], { evidenceCutoff: CUTOFF })
      .some((i) => i.rule === "versioned")
  );
  assert.ok(
    conforms(PROVIDER, [aCandidate({ band: "urgent" as never })], { evidenceCutoff: CUTOFF })
      .some((i) => i.rule === "band_vocabulary")
  );
  assert.ok(
    conforms(PROVIDER, [aCandidate({ statement: "  " })], { evidenceCutoff: CUTOFF })
      .some((i) => i.rule === "explainable")
  );
  assert.ok(
    conforms(PROVIDER, [aCandidate({ dedupeKey: "" })], { evidenceCutoff: CUTOFF })
      .some((i) => i.rule === "one_lineage")
  );
});

// A signal whose whole content IS an absence has nothing to cite, and says so
// in its limitations. That is the exception the rule is written around.
test("a candidate must cite evidence or state a limitation", () => {
  assert.ok(
    conforms(PROVIDER, [aCandidate({ evidenceIds: [], limitations: [] })], { evidenceCutoff: CUTOFF })
      .some((i) => i.rule === "cites_or_qualifies")
  );
  assert.deepEqual(
    conforms(
      PROVIDER,
      [aCandidate({ evidenceIds: [], limitations: ["Nothing has been recorded to open."] })],
      { evidenceCutoff: CUTOFF }
    ),
    []
  );
});

// THE POINT OF THE WHOLE FILE. Every provider in the registry is checked, so
// the ones handoffs 04 and 05 add arrive into a suite that already tests them.
test("every registered provider conforms and is deterministic", async () => {
  const providers = registeredProviders();
  assert.ok(providers.length >= 4, "the four this handoff ships");

  for (const provider of providers) {
    const args = { ctx, personId: T.patient, evidenceCutoff: CUTOFF };
    const candidates = await provider.evaluate(args);
    const issues = conforms(provider, candidates, { evidenceCutoff: CUTOFF });
    assert.deepEqual(
      issues, [],
      `${provider.id} breaks the contract: ${issues.map((i) => `${i.rule}: ${i.detail}`).join("; ")}`
    );
    assert.ok(
      await isDeterministic(provider, args),
      `${provider.id} returned different candidates for identical inputs — a queue that shuffles is one where "the third row" stops meaning anything`
    );
  }
});

test("the contract is documented next to the registry it governs", () => {
  const src = fs.readFileSync("src/lib/clinical/attention-providers/contract.ts", "utf8");
  // The rules a later author will look for, named in the file they will open.
  for (const rule of ["§10", "§11", "safety authority", "future-data leakage", "deterministic"]) {
    assert.ok(src.includes(rule), `the contract must state "${rule}"`);
  }
});

// ---------------------------------------------------------------------------
// The care-time correction flow (§13)
// ---------------------------------------------------------------------------

test("a correction appends and never rewrites", async () => {
  const originalId = await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "review",
    durationSeconds: 900, sourceSurface: "drawer",
  });

  const corrected = await correctCareAction(ctx, {
    supersedesId: originalId, clinicianId: T.clinician,
    reason: "logged against the wrong person", durationSeconds: 300,
  });
  assert.notEqual(corrected.id, originalId);
  assert.equal(corrected.supersedesId, originalId);
  assert.equal(corrected.durationSeconds, 300);
  assert.equal(corrected.correctionReason, "logged against the wrong person");

  const all = await careActionsForPerson(ctx, T.patient);
  const original = all.find((a) => a.id === originalId);
  assert.ok(original, "the superseded entry is still in the ledger");
  assert.equal(original.durationSeconds, 900, "and still says what it said");

  const current = await currentCareActions(ctx, T.patient);
  assert.ok(!current.some((a) => a.id === originalId), "but it is not what the record now reads");
  assert.ok(current.some((a) => a.id === corrected.id));
});

test("a correction carries forward what it is not correcting", async () => {
  const id = await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "open_session_prep",
    note: "read the brief before her appointment", durationSeconds: 600,
    outcomeState: "reviewed", sourceSurface: "drawer",
  });
  const corrected = await correctCareAction(ctx, {
    supersedesId: id, clinicianId: T.clinician, reason: "it was ten minutes, not twenty",
    durationSeconds: 1200,
  });
  assert.equal(corrected.durationSeconds, 1200);
  assert.equal(
    corrected.note, "read the brief before her appointment",
    "a correction to the duration must not silently drop the note"
  );
  assert.equal(corrected.outcomeState, "reviewed");
  assert.equal(corrected.action, "open_session_prep");
});

// A correction is a statement about what happened THEN. Moving its completion
// time to now would reorder the ledger by when somebody noticed a mistake.
test("a correction keeps the original completion time", async () => {
  // Asserted on a pair made here rather than by scanning the ledger: a scan
  // that happened to find no corrections in its window would pass whatever the
  // code did.
  const id = await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "review_trajectory",
    durationSeconds: 60, sourceSurface: "drawer",
  });
  // Backdated, because the work being corrected is work that happened earlier.
  // Correcting something recorded seconds ago cannot tell a preserved timestamp
  // from a fresh one — they are the same to the second.
  db.prepare("UPDATE between_visit_care_actions SET completed_at = ? WHERE id = ?")
    .run("2026-08-20 09:30:00", id);
  const before = (await careActionsForPerson(ctx, T.patient)).find((a) => a.id === id)!;
  assert.ok(before);
  assert.equal(before.completedAt, "2026-08-20 09:30:00");

  const corrected = await correctCareAction(ctx, {
    supersedesId: id, clinicianId: T.clinician, reason: "wrong duration", durationSeconds: 120,
  });
  assert.equal(
    corrected.completedAt, before.completedAt,
    "a correction is a statement about what happened THEN — moving it to now would reorder the ledger by when somebody noticed a mistake"
  );
  assert.notEqual(corrected.createdAt, "", "though it is a new row, recorded now");
});

test("a correction needs a reason", async () => {
  const id = await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "contact", sourceSurface: "drawer",
  });
  await assert.rejects(
    () => correctCareAction(ctx, { supersedesId: id, clinicianId: T.clinician, reason: "  " }),
    AttentionSignalError,
    "an unexplained rewrite is the thing appending is protecting against"
  );
});

// Two corrections both pointing at the same original would leave two current
// answers with no way to choose between them.
test("a lineage is a chain, not a fork", async () => {
  const id = await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "add_followup", sourceSurface: "drawer",
  });
  await correctCareAction(ctx, { supersedesId: id, clinicianId: T.clinician, reason: "first fix" });
  await assert.rejects(
    () => correctCareAction(ctx, { supersedesId: id, clinicianId: T.clinician, reason: "second fix" }),
    AttentionSignalError
  );
});

test("the correction is legible in the ledger as a correction", async () => {
  const events = await readEvents({
    personId: T.patient, types: ["between_visit_care.action_recorded"],
  });
  const corrections = events.filter((e) => e.payload.supersedesId);
  assert.ok(corrections.length > 0);
  for (const e of corrections) {
    assert.ok(e.payload.correctionReason, "without this a replay sees two actions where one happened");
    assert.equal(e.actor_type, "clinician");
  }
});

test("correcting another tenant's entry is refused", async () => {
  const id = await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "review", sourceSurface: "drawer",
  });
  await assert.rejects(
    () => correctCareAction(
      { tenantId: T.other, personId: T.clinician },
      { supersedesId: id, clinicianId: T.clinician, reason: "not mine to correct" }
    ),
    AttentionSignalError
  );
});

// ---------------------------------------------------------------------------
// Tenant-aware flags (Appendix B)
// ---------------------------------------------------------------------------

test("no override means the deployment's answer", async () => {
  const overrides = await tenantFlagOverrides(T.tenant);
  for (const flag of ALL_COMMAND_CENTER_FLAGS) {
    assert.equal(flagEnabledWith(flag, overrides), commandCenterFlagEnabled(flag));
  }
});

test("an override changes one tenant's answer and nobody else's", async () => {
  await setTenantFlag({
    tenantId: T.tenant, flag: "CLINICAL_COMMAND_CENTER_ACTIVITY", enabled: false,
    setBy: T.clinician, reason: "our team reads the caseload instead",
  });
  const mine = await tenantFlagOverrides(T.tenant);
  const theirs = await tenantFlagOverrides(T.other);

  assert.equal(flagEnabledWith("CLINICAL_COMMAND_CENTER_ACTIVITY", mine), false);
  assert.equal(
    flagEnabledWith("CLINICAL_COMMAND_CENTER_ACTIVITY", theirs),
    commandCenterFlagEnabled("CLINICAL_COMMAND_CENTER_ACTIVITY"),
    "another organization's environment is unaffected"
  );
  assert.equal(mine.get("CLINICAL_COMMAND_CENTER_ACTIVITY")?.setBy, T.clinician);
  assert.ok(
    mine.get("CLINICAL_COMMAND_CENTER_ACTIVITY")?.reason,
    "a flag that changed a clinician's screen with nobody's name on it is a change nobody can ask about"
  );
});

// "No opinion" and "decided against" are different states, and a surface that
// reported them identically would make a deliberate decision indistinguishable
// from never having been asked.
test("clearing an override is not the same as setting it false", async () => {
  await setTenantFlag({
    tenantId: T.tenant, flag: "CLINICAL_COMMAND_CENTER_ACTIVITY", enabled: null, setBy: T.clinician,
  });
  const overrides = await tenantFlagOverrides(T.tenant);
  assert.equal(overrides.has("CLINICAL_COMMAND_CENTER_ACTIVITY"), false);
  assert.equal(
    flagEnabledWith("CLINICAL_COMMAND_CENTER_ACTIVITY", overrides),
    commandCenterFlagEnabled("CLINICAL_COMMAND_CENTER_ACTIVITY")
  );
});

// The override changes one flag's answer, not the rule that a phase rests on
// the one before it.
test("a tenant cannot open a surface over a phase that is off", async () => {
  await setTenantFlag({
    tenantId: T.tenant, flag: "CLINICAL_ATTENTION_SIGNALS", enabled: false, setBy: T.clinician,
  });
  await setTenantFlag({
    tenantId: T.tenant, flag: "CLINICAL_COMMAND_CENTER_DRAWER", enabled: true, setBy: T.clinician,
  });
  const overrides = await tenantFlagOverrides(T.tenant);
  assert.equal(flagEnabledWith("CLINICAL_COMMAND_CENTER_DRAWER", overrides), true, "its own switch is on");
  assert.equal(
    surfaceAvailableWith("CLINICAL_COMMAND_CENTER_DRAWER", overrides), false,
    "a drawer over signals nobody generates is a screen with nothing behind it"
  );

  await setTenantFlag({ tenantId: T.tenant, flag: "CLINICAL_ATTENTION_SIGNALS", enabled: null, setBy: T.clinician });
  await setTenantFlag({ tenantId: T.tenant, flag: "CLINICAL_COMMAND_CENTER_DRAWER", enabled: null, setBy: T.clinician });
});

test("a flag nobody defines any more is ignored rather than crashing a page", async () => {
  db.prepare(
    "INSERT OR REPLACE INTO tenant_feature_flags (tenant_id, flag, enabled, set_by) VALUES (?, 'CLINICAL_REMOVED_FEATURE', 1, ?)"
  ).run(T.tenant, T.clinician);
  const overrides = await tenantFlagOverrides(T.tenant);
  assert.ok(!overrides.has("CLINICAL_REMOVED_FEATURE" as never));
  // Removing a feature must not brick the tenant that had switched it on.
  assert.equal(surfaceAvailableWith("CLINICAL_ATTENTION_SIGNALS", overrides), commandCenterFlagEnabled("CLINICAL_ATTENTION_SIGNALS"));
});

test("tenant flags survive a demo reset — a reset is not a config change", async () => {
  const { PRESERVED_TABLES } = await import("../src/lib/demo-reset");
  assert.ok(
    (PRESERVED_TABLES as readonly string[]).includes("tenant_feature_flags"),
    "turning presentation back on is not the reset's decision to make"
  );
});

// ---------------------------------------------------------------------------
// The policy registry (Phase 6)
// ---------------------------------------------------------------------------

test("every versioned policy in the stack is registered", () => {
  const registered = new Set(POLICY_REGISTRY.map((p) => p.version));
  // The strings a screen can print. A policy that appears on a surface and not
  // in this list is a rule nobody can enumerate.
  const inUse = [
    "clinical-policy-2026-08-t1",
    "retrieval-policy.1.0.0",
    "session-prep.1.0.0",
    "return-goal-projection.1.0.0",
    "response-fingerprint.1.0.0",
    "engagement-gap.1.0.0",
    "command-context.1.0.0",
    "command-center-summary.1.0.0",
    "caseload-state.1.0.0",
    "recent-activity.1.0.0",
  ];
  for (const v of inUse) {
    assert.ok(registered.has(v), `${v} is in force and is not in the registry`);
  }
});

test("each entry says what it decides and which module owns it", () => {
  for (const p of POLICY_REGISTRY) {
    assert.ok(p.id && p.label && p.version);
    assert.ok(p.decides.length > 20, `${p.id} must say what it decides, in words`);
    assert.ok(
      fs.existsSync(p.module),
      `${p.id} points at ${p.module}, which does not exist — "which file do I change" needs one true answer`
    );
  }
  assert.equal(new Set(POLICY_REGISTRY.map((p) => p.id)).size, POLICY_REGISTRY.length);
  assert.ok(policyById("response_fingerprint"));
  assert.equal(policyById("nope"), undefined);
  assert.ok(policySummaryLine().includes(String(POLICY_REGISTRY.length)));
});

// A registry holding its own copy of a version would be one more thing to keep
// in sync, and the first to go stale.
test("the registry imports its versions rather than copying them", () => {
  const src = fs.readFileSync("src/lib/clinical/policy-registry.ts", "utf8");
  for (const [name, version] of [
    ["RESPONSE_POLICY.version", "response-fingerprint.1.0.0"],
    ["COMMAND_CONTEXT_VERSION", "command-context.1.0.0"],
    ["CASELOAD_STATE_VERSION", "caseload-state.1.0.0"],
  ] as const) {
    assert.ok(src.includes(name), `${name} must be imported`);
    assert.ok(!src.includes(`"${version}"`), `${version} must not be written out as a literal`);
  }
});


// A table that shipped one commit earlier without these columns is exactly the
// case CREATE TABLE IF NOT EXISTS cannot handle, and the failure is a page that
// throws "no such column" rather than anything a test would have caught.
test("a database from before the correction flow gains its columns", () => {
  const cols = (db.prepare("PRAGMA table_info(between_visit_care_actions)").all() as { name: string }[])
    .map((c) => c.name);
  assert.ok(cols.includes("supersedes_id"));
  assert.ok(cols.includes("correction_reason"));

  const src = fs.readFileSync("src/lib/db.ts", "utf8");
  assert.ok(
    src.includes('ensureColumn(db, "between_visit_care_actions", "supersedes_id"'),
    "the migration runs on boot, not only in a fresh schema"
  );

  // The index over a migrated column must be created AFTER the migration. In
  // SCHEMA_SQL it runs first and throws "no such column" during boot on every
  // database created before the column existed — which is every deployed one.
  const schemaEnd = src.indexOf("export const SCHEMA_SQL");
  const schema = src.slice(schemaEnd, src.indexOf("`;", schemaEnd));
  assert.ok(
    !schema.includes("idx_care_actions_supersedes"),
    "an index over a migrated column cannot live in SCHEMA_SQL"
  );
  assert.ok(src.includes("idx_care_actions_supersedes"), "but it does exist");
  assert.ok(
    src.indexOf("idx_care_actions_supersedes") >
      src.indexOf('ensureColumn(db, "between_visit_care_actions", "supersedes_id"'),
    "and it is created after the column it indexes"
  );

  const indexes = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'between_visit_care_actions'"
  ).all() as { name: string }[]).map((r) => r.name);
  assert.ok(indexes.includes("idx_care_actions_supersedes"));
});
