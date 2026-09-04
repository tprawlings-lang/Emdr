// The Command Center's queue mapping (expansion handoff 03 §2, §9, §11;
// Phase 1).
//
// Phase 1's definition of done, and how each half fails:
//
//   "EXISTING QUEUE UNCHANGED WHEN FEATURE IS OFF." This fails quietly. A merge
//   that only hid its output behind a flag would still have changed the ORDER
//   of the rows around it, and nobody would notice until a clinician said the
//   queue looked different this morning. So the test below builds the queue
//   twice against identical data — flag on, flag off — and compares the item
//   ids in order.
//
//   "SAFETY RETAINS CURRENT AUTHORITY." This fails slowly. An attention signal
//   lands in the same bucket as a safety obligation, nothing on the row
//   distinguishes them, and within a month the clinician reads the whole bucket
//   as advisory. §2 is explicit: "safety remains visibly labeled as safety.
//   Non-safety review_now cannot masquerade as safety."
//
// And the third property, from §9: STABLE IS NOT A ROW. "Stable / No Action is
// a projection outcome... do not insert thousands of stable rows into the
// signal table." A quiet caseload must produce a count and no writes.

process.env.EMDR_DATA_DIR = `/tmp/steady-ccm-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "ccm-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "ccm-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import {
  buildWorkQueue, uiGroupFor, UI_GROUP_LABEL, collapseWithCaseloadRows,
  type WorkGroup, type UiGroup, type WorkItem,
} from "../src/lib/clinical/work-queue";
import {
  commandCenterFlagEnabled, commandCenterSurfaceAvailable,
  commandCenterFlagRequires, ALL_COMMAND_CENTER_FLAGS,
} from "../src/lib/clinical/command-center-flags";

const db = getDb();
const T = { tenant: "tenant-ccm", clinician: "clin-ccm", patient: "pat-ccm", quiet: "pat-ccm-quiet" };
db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(T.tenant, T.tenant);
db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'Dr X', 'clinician', 'x')")
  .run(T.clinician, "clin-ccm@example.test");
for (const id of [T.patient, T.quiet]) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'A', 'member', 'x')")
    .run(id, `${id}@example.test`);
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'A', 'fabricated')")
    .run(id, T.tenant);
}
db.prepare("UPDATE users SET tenant_id = ? WHERE id IN (?, ?, ?)")
  .run(T.tenant, T.clinician, T.patient, T.quiet);

async function queue(now = new Date("2026-09-04T10:00:00Z")) {
  return buildWorkQueue({ clinicianId: T.clinician, tenantId: T.tenant, now });
}

// ---------------------------------------------------------------------------
// The UI mapping (§2)
// ---------------------------------------------------------------------------

test("five machine groups map onto §2's three visible buckets", () => {
  const mapping: Record<WorkGroup, UiGroup | null> = {
    needs_action: "needs_attention",
    review_today: "review_today",
    waiting_member: "waiting",
    waiting_staff: "waiting",
    // §2: "recently resolved work belongs in Recent Activity and patient
    // history, not as a permanent front-page section."
    recently_resolved: null,
  };
  for (const [group, ui] of Object.entries(mapping)) {
    assert.equal(uiGroupFor(group as WorkGroup), ui, `${group} maps to ${ui}`);
  }
  for (const ui of ["needs_attention", "review_today", "waiting"] as UiGroup[]) {
    assert.ok(UI_GROUP_LABEL[ui]);
  }
});

// The machine groups keep their granularity. Waiting-on-member and
// waiting-on-staff are one bucket to a clinician scanning and two different
// dependencies to the code that has to name them; collapsing the machine groups
// to match the UI would lose the second.
test("the machine groups are not collapsed to match the UI", () => {
  assert.notEqual(uiGroupFor("waiting_member"), null);
  assert.equal(uiGroupFor("waiting_member"), uiGroupFor("waiting_staff"));
  const src = fs.readFileSync("src/lib/clinical/work-queue.ts", "utf8");
  assert.ok(src.includes('"waiting_member"') && src.includes('"waiting_staff"'));
});

// ---------------------------------------------------------------------------
// The flag (§21 Phase 1, Appendix B)
// ---------------------------------------------------------------------------

test("the queue is identical, in order, with the feature off", async () => {
  const before = process.env.CLINICAL_ATTENTION_SIGNALS;
  try {
    process.env.CLINICAL_ATTENTION_SIGNALS = "1";
    const on = await queue();
    process.env.CLINICAL_ATTENTION_SIGNALS = "0";
    const off = await queue();

    // Same data, no signals raised for this fixture — so the two must agree
    // exactly, including order. An ordering that differed would mean the merge
    // touched the sort even when it produced nothing.
    assert.deepEqual(
      off.items.map((i) => i.id), on.items.map((i) => i.id),
      "the merge must not move the rows around it"
    );
    assert.deepEqual(off.groupCounts, on.groupCounts);
    assert.deepEqual(off.coverage.providersRan, [], "nothing runs when the feature is off");
    assert.equal(off.coverage.truncated, false);
  } finally {
    if (before === undefined) delete process.env.CLINICAL_ATTENTION_SIGNALS;
    else process.env.CLINICAL_ATTENTION_SIGNALS = before;
  }
});

test("a later surface cannot open over a phase that is switched off", () => {
  const before = { ...process.env };
  try {
    process.env.CLINICAL_ATTENTION_SIGNALS = "0";
    process.env.CLINICAL_COMMAND_CENTER = "1";
    process.env.CLINICAL_COMMAND_CENTER_DRAWER = "1";
    assert.equal(
      commandCenterSurfaceAvailable("CLINICAL_COMMAND_CENTER"), false,
      "a Command Center over signals nobody generates is a screen with nothing behind it"
    );
    assert.equal(commandCenterSurfaceAvailable("CLINICAL_COMMAND_CENTER_DRAWER"), false);
    assert.equal(commandCenterFlagEnabled("CLINICAL_COMMAND_CENTER"), true, "its own flag is on");
  } finally {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("CLINICAL_COMMAND") || k === "CLINICAL_ATTENTION_SIGNALS") delete process.env[k];
    }
    Object.assign(process.env, before);
  }
});

test("every flag has a stated dependency or is a root", () => {
  for (const f of ALL_COMMAND_CENTER_FLAGS) {
    const requires = commandCenterFlagRequires(f);
    assert.ok(requires === null || ALL_COMMAND_CENTER_FLAGS.includes(requires));
  }
  assert.equal(commandCenterFlagRequires("CLINICAL_ATTENTION_SIGNALS"), null, "the substrate is the root");
});

// ---------------------------------------------------------------------------
// Safety authority (§2, §9)
// ---------------------------------------------------------------------------

test("every row says whether it carries safety authority", async () => {
  const q = await queue();
  for (const i of q.items) {
    assert.equal(typeof i.safetyAuthority, "boolean", `${i.id} must declare it`);
  }
});

// The band is NOT how a renderer should tell them apart, and this is the test
// that says so: an attention signal and a safety obligation can share a bucket.
test("safety authority is a field, never inferable from the band", () => {
  const src = fs.readFileSync("src/lib/clinical/work-queue.ts", "utf8");
  const start = src.indexOf("async function mergeAttentionSignals");
  // Bounded to the function. Slicing to end-of-file would sweep in the
  // alert-derived row further down, which legitimately DOES set safety
  // authority — and the test would then pass or fail for the wrong reason.
  const merge = src.slice(start, src.indexOf("\nexport async function buildWorkQueue", start));
  assert.ok(merge.length > 0 && merge.length < src.length);
  assert.ok(
    /safetyAuthority: false/.test(merge),
    "an attention signal never carries safety authority"
  );
  assert.ok(
    !/safetyAuthority: true/.test(merge),
    "and there is no path in the merge that could set it"
  );
});

test("an attention signal can never reach the safety engine's own band", () => {
  const src = fs.readFileSync("src/lib/clinical/work-queue.ts", "utf8");
  const table = src.slice(
    src.indexOf("const BAND_FOR_ATTENTION"),
    src.indexOf("};", src.indexOf("const BAND_FOR_ATTENTION"))
  );
  assert.ok(table.length > 0);
  assert.ok(
    !table.includes('"immediate"'),
    "immediate is the safety engine's band; a signal that reached it could outrank a safety obligation"
  );
});

// ---------------------------------------------------------------------------
// Stable is a projection, not a row (§9)
// ---------------------------------------------------------------------------

test("stable is the caseload minus everyone with open work, and stores nothing", async () => {
  const q = await queue();
  const withWork = new Set(
    q.items.filter((i) => i.group !== "recently_resolved").map((i) => i.personId)
  );
  for (const id of q.stablePersonIds) {
    assert.ok(!withWork.has(id), "a person with open work is not stable");
  }
  assert.equal(q.stableCount, q.stablePersonIds.length, "the count and the list agree");

  const stored = db.prepare(
    "SELECT COUNT(*) AS n FROM clinical_attention_signals WHERE tenant_id = ?"
  ).get(T.tenant) as { n: number };
  assert.equal(stored.n, 0, "a quiet caseload writes no rows at all");
});

test("the four header counts are computed from the items that are in the queue", async () => {
  const q = await queue();
  const counted: Record<UiGroup, number> = { needs_attention: 0, review_today: 0, waiting: 0 };
  for (const i of q.items) {
    const ui = uiGroupFor(i.group);
    if (ui) counted[ui] += 1;
  }
  assert.deepEqual(q.uiCounts, counted, "the header and the list cannot disagree");
  assert.ok(
    !Object.values(q.uiCounts).some((n) => n < 0),
    "a count derived by subtraction must never go negative"
  );
});

// ---------------------------------------------------------------------------
// Coverage (§20)
// ---------------------------------------------------------------------------

test("coverage is reported rather than inferred from a shorter list", async () => {
  const q = await queue();
  assert.ok(Array.isArray(q.coverage.providersRan));
  assert.ok(Array.isArray(q.coverage.providersFailed));
  assert.equal(typeof q.coverage.truncated, "boolean");
  for (const f of q.coverage.providersFailed) {
    assert.ok(f.providerId && f.reason);
    assert.ok(f.reason.length < 60, "a coverage reason is a class of failure, not a message");
  }
});


// ---------------------------------------------------------------------------
// One person, one concern, one row (§11)
// ---------------------------------------------------------------------------
//
// The duplicate this guards against is a real one, seen on the first render:
// "Omar Bergström — No check-in for 22 days" from the caseload model, and
// directly beneath it "Omar Bergström — No check-in for 22 days. Their last one
// was 2026-08-13" from the engagement-gap provider. Same person, same fact, two
// rows, two Contact buttons.

test("a person never has two rows for the same concern in the same bucket", async () => {
  const before = process.env.CLINICAL_ATTENTION_SIGNALS;
  try {
    process.env.CLINICAL_ATTENTION_SIGNALS = "1";
    const q = await queue();
    const seen = new Map<string, string[]>();
    for (const i of q.items) {
      const ui = uiGroupFor(i.group);
      if (!ui) continue;
      const key = `${i.personId}::${ui}`;
      seen.set(key, [...(seen.get(key) ?? []), i.id]);
    }
    for (const [key, ids] of seen) {
      assert.equal(
        ids.length, 1,
        `${key} has ${ids.length} rows: ${ids.join(", ")} — §11 collapses same-person same-reason`
      );
    }
  } finally {
    if (before === undefined) delete process.env.CLINICAL_ATTENTION_SIGNALS;
    else process.env.CLINICAL_ATTENTION_SIGNALS = before;
  }
});

/** A work item, built by hand so the rule is tested rather than the seed. */
function anItem(over: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    group: "waiting_member", band: "watch", personId: "p1", personName: "Omar",
    reason: "No check-in for 22 days", detail: null, resolvedAt: null, change: null,
    evidenceAt: "2026-08-13 00:00:00", ownerId: null, ownerName: null,
    dueAt: null, overdue: false, eventCount: 1, action: "contact",
    actionable: true, blockedReason: null, safetyAuthority: false,
    signalId: null, supportFacts: [], lastContactDays: 22,
    ...over,
  };
}

test("a caseload row and a signal about the same person and bucket become one row", () => {
  const existing = [anItem({ id: "person:p1", overdue: true, eventCount: 2 })];
  const signals = [anItem({
    id: "signal:s1", signalId: "s1",
    reason: "No check-in for 22 days. Their last one was 2026-08-13.",
    supportFacts: ["An observed gap, not a prediction."],
  })];

  const survivors = collapseWithCaseloadRows(existing, signals);
  assert.equal(survivors.length, 1);
  assert.equal(existing.length, 0, "the caseload row is removed from the list being built");

  const [row] = survivors;
  assert.equal(row.signalId, "s1", "the row that can open its evidence survives");
  assert.ok(
    row.supportFacts.includes("No check-in for 22 days"),
    "nothing the caseload said is lost"
  );
  assert.ok(row.supportFacts.length <= 3, "§4 caps at three");
  assert.equal(row.eventCount, 3, "the collapse preserves the event count");
  assert.equal(row.overdue, true, "and never softens a deadline");
});

test("a signal and a caseload concern in different buckets stay two rows", () => {
  const existing = [anItem({ id: "person:p1", group: "needs_action" })];
  const signals = [anItem({ id: "signal:s1", signalId: "s1", group: "waiting_member" })];
  const survivors = collapseWithCaseloadRows(existing, signals);
  assert.equal(survivors.length, 1);
  assert.equal(existing.length, 1, "two different pieces of work stay two rows");
});

// SAME person, SAME bucket, and the alert row still survives. A safety
// obligation is not a duplicate of a review signal even when they concern the
// same person at the same moment — §9's whole point is that the two are
// different kinds of thing — so only caseload-derived rows are absorbable.
test("an alert row is never absorbed, even for the same person and bucket", () => {
  const existing: WorkItem[] = [anItem({ id: "alert:x", safetyAuthority: true })];
  const signals = [anItem({ id: "signal:s1", signalId: "s1" })];
  const survivors = collapseWithCaseloadRows(existing, signals);
  assert.equal(survivors.length, 1);
  assert.equal(survivors[0].supportFacts.length, 0, "it absorbed nothing");
  assert.equal(existing.length, 1, "safety keeps its own row");
  assert.equal(existing[0].id, "alert:x");
});

test("a signal about a person with no row of any kind is untouched", () => {
  const existing: WorkItem[] = [anItem({ id: "person:p2", personId: "p2" })];
  const signals = [anItem({ id: "signal:s1", signalId: "s1" })];
  const survivors = collapseWithCaseloadRows(existing, signals);
  assert.equal(survivors.length, 1);
  assert.equal(existing.length, 1, "another person's row is not theirs to absorb");
});

// The rule is only worth having if it is wired in. The fixture caseload raises
// no signals, so the integration test above passes either way — this is what
// catches a merge that pushed the signal rows straight in.
test("the merge routes its rows through the collapse", () => {
  const src = fs.readFileSync("src/lib/clinical/work-queue.ts", "utf8");
  assert.ok(
    /items\.push\(\.\.\.collapseWithCaseloadRows\(items, merged\.items\)\)/.test(src),
    "signal rows must not be pushed into the queue without passing the collapse"
  );
});

test("the collapse keeps the row that can open its evidence", () => {
  const src = fs.readFileSync("src/lib/clinical/work-queue.ts", "utf8");
  const fn = src.slice(
    src.indexOf("function collapseWithCaseloadRows"),
    src.indexOf("\nasync function mergeAttentionSignals")
  );
  assert.ok(fn.length > 0);
  // The signal row is the one pushed; the caseload row is the one absorbed.
  assert.ok(fn.includes("survivors.push"), "the signal row survives");
  assert.ok(
    fn.includes("caseloadRow.reason"),
    "and nothing the caseload said is lost — its reason becomes a supporting fact"
  );
  assert.ok(
    fn.includes("row.overdue || caseloadRow.overdue"),
    "a collapse must never soften a deadline"
  );
});
