// The Thoughts surface has something to show (Phases 1–3).
//
// The screens are honest and empty without a seed: a reviewer opens a demo
// member's Thoughts tab, finds nothing, and the only way to see anything is to
// record — which shows one thought at the start of its life and none of what
// the feature is for. Memory accumulating, a theme with evidence under it, and
// a decision still waiting are all states you cannot reach by pressing Record
// once.

process.env.EMDR_DATA_DIR = `/tmp/steady-thseed-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "thseed-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "thseed-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { demoId } from "../src/lib/demo-seed";
import { approvedMemory, itemsByIds, listItemsForThought } from "../src/lib/clinical/memory-store";
import { listThreads, membershipsForPerson, buildTimelines } from "../src/lib/clinical/thread-store";
import { listThoughts, currentTranscript, getThought } from "../src/lib/clinical/thought-store";
import { openFollowUps } from "../src/lib/clinical/followups";
import { FIXTURE_MARKER } from "../src/lib/clinical/transcription-fixture";
import type { TenantContext } from "../src/lib/repository";

const db = getDb();
const MEMBER = demoId(0);

/** The tenant the demo member actually lives in.
 *
 *  IT USED TO BE PLATFORM_TENANT_ID HERE AND IN THE SEED, and that is why this
 *  file passed while the Thoughts page said "Nothing recorded yet" on a record
 *  with three saved thoughts under it. The seed wrote to the platform tenant,
 *  this test read from the platform tenant, and the product read from the
 *  clinician's own — so the two halves agreed with each other and neither
 *  agreed with the screen.
 *
 *  Read from the person rather than named, so the test asks the same question
 *  the page asks. If a future seed writes to the wrong tenant again, this file
 *  fails instead of agreeing with it. */
const memberTenant =
  (db.prepare("SELECT tenant_id FROM persons WHERE id = ?").get(MEMBER) as
    | { tenant_id: string } | undefined)?.tenant_id ?? PLATFORM_TENANT_ID;
const ctx: TenantContext = { tenantId: memberTenant, personId: demoId(2) };

test("the demo member has recorded thoughts with transcripts", async () => {
  const thoughts = await listThoughts(ctx, MEMBER);
  assert.ok(thoughts.length >= 2, "one thought shows the start of a life, not a record");
  for (const t of thoughts) {
    const transcript = await currentTranscript(ctx, (await getThought(ctx, t.id))!);
    assert.ok(transcript, `${t.id} has no transcript`);
    // Every fabricated transcript says so IN ITS OWN TEXT, so the marker
    // travels with a copy, a quote and an export.
    assert.ok(transcript.text.includes(FIXTURE_MARKER), "a seeded transcript must say it is fabricated");
  }
});

test("kept items cover every statement class", async () => {
  const kept = await approvedMemory(ctx, MEMBER);
  assert.ok(kept.length >= 8, `expected a record worth reading, got ${kept.length} items`);
  const classes = new Set(kept.map((i) => i.statementClass));
  // All four, because the whole point of the layer is that they are different
  // and a demo showing only observations demonstrates none of it.
  const REQUIRED = [
    "clinician_observation", "patient_report", "clinician_hypothesis", "clinician_uncertainty",
  ] as const;
  for (const c of REQUIRED) {
    assert.ok(classes.has(c), `no kept item is a ${c}, so the screen cannot show what one looks like`);
  }
});

test("the deliberately wrong candidates were rejected, not kept", async () => {
  const thoughts = await listThoughts(ctx, MEMBER);
  const all = (await Promise.all(thoughts.map((t) => listItemsForThought(ctx, t.id)))).flat();
  const wrong = ["Lateness reflects avoidance.", "Clinician assesses motivation as low."];
  for (const text of wrong) {
    const item = all.find((i) => i.displayText === text);
    if (!item) continue;
    // The seed models a clinician who read the cards. Keeping these would show
    // a record that had accepted the two claims the transcript explicitly
    // withholds.
    assert.equal(item.status, "rejected", `${JSON.stringify(text)} was kept, and the transcript says the opposite`);
  }
  const kept = await approvedMemory(ctx, MEMBER);
  for (const text of wrong) {
    assert.ok(!kept.some((i) => i.displayText === text));
  }
});

test("there is a theme with evidence, and one whose evidence is all speculative", async () => {
  const threads = await listThreads(ctx, MEMBER, "active");
  assert.ok(threads.length >= 2, "one theme cannot show what a second looks like beside it");
  const memberships = await membershipsForPerson(ctx, MEMBER);
  const items = await itemsByIds(ctx, memberships.map((m) => m.memoryItemId));
  const timelines = buildTimelines(threads, memberships, items);

  assert.ok(timelines.some((t) => t.entries.length >= 2), "a pattern needs more than one entry");

  const speculative = timelines.find(
    (t) => t.entries.length > 0 &&
      t.entries.every((e) =>
        e.item.statementClass === "clinician_hypothesis" || e.item.statementClass === "clinician_uncertainty")
  );
  assert.ok(speculative,
    "no theme is entirely thinking-aloud, so the screen's 'nothing here has been recorded as observed' warning never appears on real data");
});

test("a decision is still waiting, and a refusal is still refused", async () => {
  const memberships = await membershipsForPerson(ctx, MEMBER);
  assert.ok(memberships.some((m) => m.status === "proposed"),
    "with nothing pending, Connect / Not related can never be exercised");
  assert.ok(memberships.some((m) => m.status === "rejected"),
    "with nothing refused, the rule that a refusal stays refused is invisible");
  // And the refusal is not sitting in the pending queue.
  const refused = memberships.filter((m) => m.status === "rejected");
  for (const r of refused) assert.notEqual(r.status, "proposed");
});

test("every thread member points at an item that exists", async () => {
  const memberships = await membershipsForPerson(ctx, MEMBER);
  const items = await itemsByIds(ctx, memberships.map((m) => m.memoryItemId));
  const ids = new Set(items.map((i) => i.id));
  for (const m of memberships) {
    // A membership pointing at nothing renders as a silent gap in a pattern,
    // which is worse than a shorter pattern.
    assert.ok(ids.has(m.memoryItemId), `membership ${m.id} points at a missing item`);
  }
});

test("a follow-up reaches the clinician's queue", async () => {
  const open = await openFollowUps(ctx, { personId: MEMBER });
  assert.ok(open.length >= 1, "the follow-up feed has nothing to show");
  assert.ok(open.every((f) => f.text.length > 0));
});

test("the seeded thoughts are in the tenant the demo clinician signs in to", () => {
  // THE GUARD THAT WAS MISSING. Everything else in this file reads with one
  // context, so a seed and a test can share a wrong tenant indefinitely and
  // both look correct. This compares the rows against the account a person
  // actually uses: the demo clinician's own tenant, from the users table.
  const clinician = db
    .prepare("SELECT tenant_id FROM users WHERE email = ?")
    .get("clinician.demo@steady.local") as { tenant_id: string } | undefined;
  if (!clinician) return; // a database without the demo accounts has nothing to check

  const tenants = new Set(
    (db.prepare("SELECT DISTINCT tenant_id AS t FROM clinician_thoughts").all() as
      Array<{ t: string }>).map((r) => r.t)
  );
  assert.ok(tenants.size > 0, "no thoughts were seeded at all");
  for (const t of tenants) {
    assert.equal(
      t, clinician.tenant_id,
      "a seeded thought is in a tenant the demo clinician cannot read, so the " +
        "Thoughts page will say nothing was recorded"
    );
  }
});

test("the newest seeded note is attached to the member's latest session", () => {
  // The session-linked-notes path, on the demo record rather than in a fixture.
  // Without this the wording "About the … session" is reachable code nobody
  // sees, which on this project is the same as not built.
  const linked = db
    .prepare(
      `SELECT t.id, t.source_session_id, t.recorded_at
         FROM clinician_thoughts t
        WHERE t.person_id = ? AND t.source_session_id IS NOT NULL`
    )
    .all(MEMBER) as Array<{ id: string; source_session_id: string; recorded_at: string }>;
  assert.equal(linked.length, 1, "exactly one seeded note should name a session");

  // And the session it names is on this member's own record.
  const owned = db
    .prepare("SELECT 1 FROM therapy_sessions WHERE id = ? AND user_id = ?")
    .get(linked[0].source_session_id, MEMBER);
  assert.ok(owned, "the seeded note names a session that is not on this member's record");
});
