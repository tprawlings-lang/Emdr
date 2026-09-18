// Assigned support (17 September handoff, "Assigned support command").
//
//   "Replace the isolated feel of Module requests with an Assign support action
//   inside Care and relevant clinical contexts. This is a presentation and
//   workflow change over existing authority. It must not create a second access
//   engine or let an AI grant access."
//
// Almost everything below is about the sentence the handoff says twice: "Do not
// open restricted content because an assignment row exists. Access policy still
// controls the content request." An assignment is a clinician saying "do this".
// It is not permission to do it, and the difference is the whole feature.

process.env.EMDR_DATA_DIR = `/tmp/steady-assign-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "assigned-support-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "assigned-support-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { data } from "../src/lib/data";
import type { TenantContext } from "../src/lib/repository";
import { MODULES } from "../src/lib/modules";
import { checkModuleAccess } from "../src/lib/gating";
import {
  assignSupport, assignmentsFor, changeAssignment, assignableSupport,
  effectiveStatus, isLive, isPurpose, PURPOSES, MIN_EXPLANATION, AssignmentRefused,
  type SupportAssignment,
} from "../src/lib/clinical/assigned-support";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const db = getDb();
function person(role: string, name: string): string {
  const id = newId();
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, PLATFORM_TENANT_ID, name);
  db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, ?)"
  ).run(id, PLATFORM_TENANT_ID, `${id}@assign.test`, role, name);
  return id;
}

const clinician = person("clinician", "Dr Vale");
const member = person("member", "Rosa");
const ctx: TenantContext = { tenantId: PLATFORM_TENANT_ID, personId: clinician };

const GATED = MODULES.find((m) => m.order >= 7)!;
const EXPLANATION = "Ten minutes of the container practice before Thursday, when we will use it.";

let n = 0;
const assign = (over: Partial<Parameters<typeof assignSupport>[1]> = {}) =>
  assignSupport(ctx, {
    personId: member,
    supportId: GATED.id,
    purposeCode: "between_visit",
    patientExplanation: EXPLANATION,
    availability: "assigned",
    idempotencyKey: `key-${++n}`,
    ...over,
  });

// ---------------------------------------------------------------------------
// An assignment is not access
// ---------------------------------------------------------------------------

test("assigning support does not open it", async () => {
  // THE LOAD-BEARING TEST. The gate's answer must be byte-identical before and
  // after — not merely "still refused", because a second engine that refused
  // for its own reason would pass that weaker check while having replaced the
  // real one.
  const before = await checkModuleAccess(member, GATED);
  assert.equal(before.allowed, false, "the fixture is not gated, so there is nothing to prove");

  await assign();
  const after = await checkModuleAccess(member, GATED);
  assert.deepEqual(after, before,
    "the gate answered differently once an assignment existed, which is a second access engine");
});

test("nothing in the assignment path writes an unlock", async () => {
  await assign();
  const c = await data();
  const unlocks = (await c.all(
    "SELECT * FROM module_unlocks WHERE user_id = ?", [member]
  )) as unknown[];
  assert.equal(unlocks.length, 0,
    "assigning support created a module unlock, so the clinician's suggestion became a grant");
});

test("the access engine cannot see the assignment table at all", () => {
  // Structural, because the behavioural test above only proves the gate does
  // not use it TODAY. A gate that grew a join here would pass every screen and
  // fail the handoff's rule.
  for (const f of ["src/lib/gating.ts", "src/lib/clinical/gate-review.ts"]) {
    const src = code(read(f));
    assert.doesNotMatch(src, /support_assignments|assigned-support/,
      `${f} reads assigned support, so an assignment row can influence access`);
  }
  const mine = code(read("src/lib/clinical/assigned-support.ts"));
  assert.doesNotMatch(mine, /module_unlocks/,
    "the assignment path touches module_unlocks, so assigning becomes granting");
});

test("the catalog answers what may be assigned, not what may be opened", () => {
  // Filtering the assign menu by the gate would let a clinician read a person's
  // safety state out of a dropdown. It is also the shape that turns this into a
  // second access engine, one screen at a time.
  const src = code(read("src/lib/clinical/assigned-support.ts"));
  assert.doesNotMatch(src, /checkModuleAccess|gateDecisionsFor/,
    "the assign catalog consults the gate");
  assert.ok(assignableSupport().length > 3, "nothing can be assigned");
  assert.ok(!assignableSupport().some((m) => m.id === "sos"),
    "the emergency route is offered as homework");
});

// ---------------------------------------------------------------------------
// What is stored, and what is pointed at
// ---------------------------------------------------------------------------

test("the words the person was given are stored, not re-derived", async () => {
  const a = await assign({ patientExplanation: "  Practise the container for ten minutes.  " });
  assert.equal(a.patientExplanation, "Practise the container for ten minutes.");
  assert.ok(a.sharePolicy, "no sharing rule was recorded with the assignment");
  assert.ok(a.supportVersion, "no support version was recorded");
  assert.equal(a.status, "active");
});

test("an assignment points at the definition rather than copying it", () => {
  const src = code(read("src/lib/clinical/assigned-support.ts"));
  for (const field of ["steps", "objective", "durationLabel"]) {
    assert.doesNotMatch(src, new RegExp(`${field}:\\s*mod\\.`),
      `the clinical definition's ${field} is copied into the assignment row`);
  }
});

test("an explanation a person cannot act on is refused", async () => {
  await assert.rejects(() => assign({ patientExplanation: "do it" }), AssignmentRefused);
  await assert.rejects(
    () => assign({ patientExplanation: "x".repeat(MIN_EXPLANATION - 1) }), AssignmentRefused
  );
});

test("a purpose outside the recorded set is refused", async () => {
  await assert.rejects(() => assign({ purposeCode: "because" }), AssignmentRefused);
  for (const code of Object.keys(PURPOSES)) assert.equal(isPurpose(code), true);
  assert.equal(isPurpose("because"), false);
});

test("a clinician cannot assign support to themselves", async () => {
  await assert.rejects(() => assign({ personId: clinician }), AssignmentRefused);
});

// ---------------------------------------------------------------------------
// Committed once
// ---------------------------------------------------------------------------

test("the same key twice is one assignment", async () => {
  // "Append the assignment fact once with an idempotency key." A double submit
  // otherwise puts the same instruction in somebody's plan twice.
  const key = `idem-${Date.now()}`;
  const first = await assign({ idempotencyKey: key });
  const second = await assign({ idempotencyKey: key });
  assert.equal(second.id, first.id, "a resubmission created a second assignment");

  const mine = (await assignmentsFor(ctx, member)).filter((a) => a.id === first.id);
  assert.equal(mine.length, 1);
});

test("two requests racing produce one assignment, not two", async () => {
  // The lookup answers the ordinary double submit; the UNIQUE index answers the
  // case where both reads miss. Without the second, a double click is two rows.
  const key = `race-${Date.now()}`;
  const [a, b] = await Promise.all([
    assign({ idempotencyKey: key }), assign({ idempotencyKey: key }),
  ]);
  assert.equal(a.id, b.id, "two concurrent submissions created two assignments");
});

// ---------------------------------------------------------------------------
// Expiry, and the states after it
// ---------------------------------------------------------------------------

test("an expired assignment reads as expired without a job having run", () => {
  const base = {
    id: "a", personId: member, tenantId: PLATFORM_TENANT_ID, supportId: GATED.id,
    supportVersion: "v", assignedBy: clinician, purposeCode: "between_visit",
    patientExplanation: EXPLANATION, sharePolicy: "v", availability: "assigned",
    status: "active", startsAt: "2026-09-01 09:00:00", reviewAt: null,
    policyVersion: "v", createdAt: "2026-09-01 09:00:00", decidedAt: null, decidedNote: null,
  } as unknown as SupportAssignment;

  const live = { ...base, expiresAt: "2026-09-30 09:00:00" };
  const gone = { ...base, expiresAt: "2026-09-10 09:00:00" };
  const now = new Date("2026-09-18T09:00:00Z");

  assert.equal(effectiveStatus(live, now), "active");
  assert.equal(effectiveStatus(gone, now), "expired",
    "an assignment past its expiry still reads as active until something sweeps it");
  assert.equal(isLive(gone, now), false);
  assert.equal(isLive(live, now), true);

  // And expiry never overrides a decision somebody made.
  assert.equal(effectiveStatus({ ...gone, status: "completed" }, now), "completed");
  assert.equal(effectiveStatus({ ...gone, status: "withdrawn" }, now), "withdrawn");
});

test("withdrawing needs a reason and completing does not", async () => {
  const a = await assign();
  await assert.rejects(
    () => changeAssignment(ctx, { assignmentId: a.id, to: "withdrawn" }), AssignmentRefused
  );
  const done = await changeAssignment(ctx, { assignmentId: a.id, to: "completed" });
  assert.equal(done.status, "completed");

  // And an answered assignment is not answered again.
  await assert.rejects(
    () => changeAssignment(ctx, { assignmentId: a.id, to: "paused" }), AssignmentRefused
  );
});

test("a withdrawal keeps the assignment and its reason", async () => {
  const a = await assign();
  const w = await changeAssignment(ctx, {
    assignmentId: a.id, to: "withdrawn",
    note: "We changed the plan in session; this is no longer the right next step.",
  });
  assert.equal(w.status, "withdrawn");
  assert.match(w.decidedNote ?? "", /changed the plan/);

  const stored = (await assignmentsFor(ctx, member)).find((x) => x.id === a.id);
  assert.ok(stored, "a withdrawn assignment was deleted rather than kept");
  assert.equal(stored.status, "withdrawn");
});

// ---------------------------------------------------------------------------
// The record of it
// ---------------------------------------------------------------------------

test("an assignment reaches the event spine and the audit trail", async () => {
  const a = await assign();
  const c = await data();
  const ev = (await c.get(
    "SELECT * FROM longitudinal_events WHERE person_id = ? AND event_type = 'intervention.assigned' ORDER BY id DESC LIMIT 1",
    [member]
  )) as Record<string, unknown> | undefined;
  assert.ok(ev, "assigning support wrote no event, so the plan cannot be rebuilt from history");

  const row = (await c.get(
    "SELECT * FROM audit_log WHERE event_type = 'support_assigned' ORDER BY id DESC LIMIT 1", []
  )) as Record<string, unknown> | undefined;
  assert.ok(row, "assigning support is not in the audit trail");
  assert.ok(!JSON.stringify(row).includes(EXPLANATION),
    "the patient-facing wording was copied into the audit detail");
  assert.ok(a.id);
});

test("the table is tenant-scoped, so one clinician cannot read another org's plan", async () => {
  const other: TenantContext = { tenantId: "some-other-tenant", personId: clinician };
  const theirs = await assignmentsFor(other, member);
  assert.deepEqual(theirs, [],
    "an assignment was readable from another tenant's context");
});

// ---------------------------------------------------------------------------
// The screen (17 September handoff: "inside Care")
// ---------------------------------------------------------------------------

test("two different assignments in one minute are two assignments", () => {
  // THE BUG THE FIRST KEY HAD. A key hashed from tenant, person, clinician and
  // the minute looked tidier and silently deduplicated two DIFFERENT
  // instructions given close together: the second was answered with the first
  // and never recorded. Deduplicating distinct instructions is worse than the
  // duplicate a key exists to stop.
  const page = code(read("src/app/clinician/member/[id]/care/page.tsx"));
  assert.match(page, /randomUUID\(\)/,
    "the idempotency key is derived from the request again, so two assignments can collide");
  assert.doesNotMatch(page, /toISOString\(\)\.slice\(0, 16\)/,
    "the key is minute-truncated, which makes two assignments in one minute one assignment");
});

test("the key is minted where the form is drawn, not where it is handled", () => {
  // A key generated inside the action is new on every submit, which is the
  // failure the key exists to prevent.
  const action = code(read("src/lib/clinical/assignment-actions.ts"));
  assert.doesNotMatch(action, /randomUUID|newId\(\)/,
    "the action mints its own key, so a double submit is two assignments");
  assert.match(action, /idempotencyKey: String\(formData\.get\("idempotencyKey"\)/,
    "the action no longer takes the key from the form");
});

test("the Care screen offers the command and says it opens nothing", async () => {
  const page = code(read("src/app/clinician/member/[id]/care/page.tsx"));
  assert.match(page, /<AssignedSupport/, "Assign support is not on the Care screen");
  assert.doesNotMatch(page, /Assigned support\.<\/span> Not built/,
    "Care still says assigned support is not built");

  // Normalised, because JSX wraps a sentence across lines and a guard that
  // matched the raw source would be testing the formatter.
  const view = read("src/components/clinical/AssignedSupport.tsx").replace(/\s+/g, " ");
  assert.match(view, /Assigning does not open anything/,
    "the screen does not say that assigning is not opening");
  // AND BESIDE THE BUTTON, not only in the section's opening paragraph: the
  // clinician who believes this unlocks something is the one about to press it.
  const atTheButton = view.slice(view.indexOf("<form action={assignSupportAction}"));
  assert.match(atTheButton, /It does not unlock anything, and it does not notify anyone/,
    "the boundary is stated at the top of the section and not at the point of action");
});

test("nothing empty is left unexplained", () => {
  // §30.8 again: a person with no assignments has not been overlooked by this
  // screen, and a blank space says nothing about which of the two it is.
  const view = read("src/components/clinical/AssignedSupport.tsx");
  assert.match(view, /Nothing is assigned\. That is a state, not a gap/);
});

test("the module name comes from the catalog, not from the row", () => {
  // The row stores a reference. A title copied into it goes stale the first
  // time a module is renamed, and then somebody's plan names something that no
  // longer exists.
  const view = code(read("src/components/clinical/AssignedSupport.tsx"));
  assert.match(view, /MODULES\.find\(\(m\) => m\.id === supportId\)\?\.name/,
    "the screen renders a stored title rather than resolving the reference");
});

// ---------------------------------------------------------------------------
// The other half of the conversation (module requests)
// ---------------------------------------------------------------------------
//
// "Replace the isolated feel of Module requests with an Assign support action
// inside Care and relevant clinical contexts."
//
// The isolation is the defect, not the screen. /clinician/unlocks answers a
// request properly — tenant-scoped, a reason required, the member reads it back
// — and it is the only place in the product that knows the request exists. It
// is not in navigation, and a person's own record said nothing about what they
// had asked for.

test("a person's own request is readable from their record", async () => {
  const db2 = getDb();
  db2.prepare(
    `INSERT OR REPLACE INTO module_unlocks
       (id, user_id, tenant_id, module_id, status, member_note, requested_at)
     VALUES (?, ?, ?, ?, 'requested', ?, '2026-09-15 08:00:00')`
  ).run("mu-1", member, PLATFORM_TENANT_ID, GATED.id, "I think I am ready for this one.");

  const { moduleRequestsFor, awaitingDecision } =
    await import("../src/lib/clinical/module-requests");
  const all = await moduleRequestsFor(ctx, member);
  assert.equal(all.length, 1, "the request is not readable from the record");
  assert.equal(all[0].status, "requested");
  assert.equal(all[0].note, "I think I am ready for this one.",
    "the person's own words were summarised away");
  assert.equal(awaitingDecision(all).length, 1);
});

test("a request in another tenant is not on this record", async () => {
  const { moduleRequestsFor } = await import("../src/lib/clinical/module-requests");
  const elsewhere = await moduleRequestsFor(
    { tenantId: "another-tenant", personId: clinician }, member
  );
  assert.deepEqual(elsewhere, [],
    "a request was readable from outside the acting tenant");
});

test("the record reports the request and does not answer it", () => {
  // The decision stays on the screen that owns it, where a reason is required
  // and the person reads it back. A second answer path would be a second place
  // for that rule to be forgotten.
  const view = read("src/components/clinical/AssignedSupport.tsx");
  assert.match(view, /has asked to open/, "the record does not say what the person asked for");
  assert.match(view, /href="\/clinician\/unlocks"/, "there is no way through to answer it");
  assert.ok(!/decideUnlock|unlockAction/.test(code(view)),
    "the Care screen grew its own way to decide an unlock");
});

test("Care passes the requests it read", () => {
  const page = code(read("src/app/clinician/member/[id]/care/page.tsx"));
  assert.match(page, /moduleRequestsFor\(ctx, id\)/, "Care does not read the person's requests");
  assert.match(page, /requests=\{requests\}/, "Care reads them and does not show them");
});
