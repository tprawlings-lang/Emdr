// The caseload clinical-state view and the recent-activity feed (expansion
// handoff 03 §6, §7; Phase 4).
//
// Phase 4's definition of done is two sentences, and each names the failure it
// is guarding:
//
//   "CASELOAD HAS NO COMPOSITE SCORE." The temptation is the sort. A table of
//   four descriptive states is harder to order than a table of numbers, so a
//   number appears "just for sorting" and within a month it is the thing people
//   read — a figure that compares people who are not comparable, hides which of
//   its inputs moved, and nobody can check. §23 forbids it outright.
//
//   "ACTIVITY IS NOT A RAW-EVENT FIREHOSE." A feed of every row would be
//   complete, honest, and unreadable — and an unreadable feed is one a
//   clinician stops opening, which is worse than not having it.
//
// The third property is the one with a person's privacy behind it, §7's:
// "metadata cannot bypass a content visibility restriction." A line saying a
// Companion conversation happened, at a time, about a topic, IS content when
// the policy withholds content. The tests below check that the line disappears
// and the COUNT does not.

process.env.EMDR_DATA_DIR = `/tmp/steady-ccl-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "ccl-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "ccl-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import { activePolicy, type ClinicalPolicy } from "../src/lib/clinical-policy";
import {
  buildCaseloadState, functionStateFrom, FUNCTION_LABEL, RESPONSE_LABEL,
  FUNCTION_WINDOW_DAYS, CASELOAD_STATE_VERSION,
} from "../src/lib/clinical/caseload-state";
import {
  buildRecentActivity, ACTIVITY_KINDS, ACTIVITY_LABEL, COLLAPSIBLE,
} from "../src/lib/clinical/recent-activity";

const db = getDb();
const T = { tenant: "tenant-ccl", clinician: "clin-ccl", a: "pat-ccl-a", b: "pat-ccl-b" };
db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(T.tenant, T.tenant);
db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'Dr X', 'clinician', 'x')")
  .run(T.clinician, "clin-ccl@example.test");
for (const id of [T.a, T.b]) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, 'member', 'x')")
    .run(id, `${id}@example.test`, id === T.a ? "Ada" : "Bea");
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')")
    .run(id, T.tenant, id === T.a ? "Ada" : "Bea");
}
db.prepare("UPDATE users SET tenant_id = ? WHERE id IN (?, ?, ?)").run(T.tenant, T.clinician, T.a, T.b);

function aCheckin(person: string, date: string, activation = 5) {
  db.prepare(
    `INSERT OR REPLACE INTO checkins
       (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
        dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, ?, ?, ?, 2, 0, 1, 1, 5, 0, 'practice', ?)`
  ).run(`ck-${person}-${date}`, person, T.tenant, date, activation, `${date} 08:00:00`);
}

function aConversation(id: string, person: string, at: string, risk: string) {
  db.prepare(
    `INSERT OR REPLACE INTO ai_conversations (id, user_id, tenant_id, context_type, risk_level, started_at)
     VALUES (?, ?, ?, 'general', ?, ?)`
  ).run(id, person, T.tenant, risk, at);
}

function withPolicy(over: Partial<ClinicalPolicy>): ClinicalPolicy {
  return { ...activePolicy(), ...over };
}

// ---------------------------------------------------------------------------
// No composite score (§23, Phase 4's definition of done)
// ---------------------------------------------------------------------------

test("the caseload state has no combined score anywhere in it", async () => {
  const state = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  for (const row of state.rows) {
    const numeric = Object.entries(row).filter(
      ([k, v]) => typeof v === "number" && !["lastContactDays", "openAlerts", "responseEvidenceCount"].includes(k)
    );
    assert.deepEqual(
      numeric, [],
      `no numeric summary may exist on a caseload row — found ${numeric.map(([k]) => k).join(", ")}`
    );
  }
  // And no arithmetic that could combine two columns.
  const src = fs.readFileSync("src/lib/clinical/caseload-state.ts", "utf8");
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const word of ["score", "composite", "overall", "weighted"]) {
    assert.ok(!new RegExp(`\\b${word}`, "i").test(code), `no "${word}" in the caseload state`);
  }
  // "index" needs a word boundary on both sides: Array.indexOf is how the sort
  // reads the band order, and that is the caseload model's ordering rather than
  // a number of this table's own.
  assert.ok(!/\bindex\b/i.test(code), "no index in the caseload state");
});

test("each column keeps its own vocabulary and its own version", async () => {
  const state = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  assert.equal(state.stateVersion, CASELOAD_STATE_VERSION);
  assert.ok(state.columnVersions.function, "function states carry the goal projection's version");
  assert.ok(state.columnVersions.response, "response states carry the fingerprint policy's");
  assert.notEqual(
    state.columnVersions.function, state.columnVersions.response,
    "two columns from two subsystems are not one computation"
  );
});

// §6: "No goal means Not set, not zero."
test("no goal is Not set, and one reading is not a direction", async () => {
  const state = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  for (const row of state.rows) {
    assert.equal(row.functionState, "not_set");
    assert.equal(FUNCTION_LABEL[row.functionState], "Not set");
    assert.ok(row.functionLimitations.some((l) => /No life goal/i.test(l)));
  }

  assert.equal(functionStateFrom([]), "no_evidence");
  assert.equal(
    functionStateFrom([{ level: 0, occurredAt: "2026-08-01" }]), "no_evidence",
    "one reading is a position, not a direction"
  );
  assert.equal(
    functionStateFrom([
      { level: -1, occurredAt: "2026-08-01" },
      { level: 0, occurredAt: "2026-08-20" },
    ]),
    "improving"
  );
  assert.equal(
    functionStateFrom([
      { level: 0, occurredAt: "2026-08-01" },
      { level: -1, occurredAt: "2026-08-20" },
    ]),
    "lost_ground"
  );
  assert.equal(
    functionStateFrom([
      { level: 0, occurredAt: "2026-08-01" },
      { level: 0, occurredAt: "2026-08-20" },
    ]),
    "little_change"
  );
});

// The order is not chronological in the input; a comparison that took the array
// order rather than the dates would call a decline an improvement.
test("the function state compares by date, never by array order", () => {
  assert.equal(
    functionStateFrom([
      { level: 0, occurredAt: "2026-08-20" },
      { level: -1, occurredAt: "2026-08-01" },
    ]),
    "improving",
    "the newest reading is the later date, whatever order they arrived in"
  );
});

// §6: "Response... must show supportive/mixed/insufficient evidence honestly."
test("a person under the response threshold reads insufficient, not neutral", async () => {
  const state = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  for (const row of state.rows) {
    assert.equal(row.responseState, "insufficient");
    assert.equal(RESPONSE_LABEL[row.responseState], "Insufficient evidence");
    assert.ok(
      row.responseDetail.length > 10,
      "and it says why — a bare label is the thing §6 asks the table to open"
    );
  }
});

// §20 again: a blank in a trajectory column reads as flat.
test("the unbuilt columns say they are unbuilt, in words", async () => {
  const state = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  for (const row of state.rows) {
    assert.equal(row.trajectory.present, false);
    assert.equal(row.load.present, false);
    assert.ok(/not built yet/i.test(row.trajectory.note));
    assert.ok(
      /absent feature, not a flat trajectory/i.test(row.trajectory.note),
      "the note must say what the absence does NOT mean"
    );
  }
});

test("every state opens its calculation window", async () => {
  const state = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  for (const row of state.rows) {
    assert.ok(row.functionLimitations.length > 0, "§6: every label opens its limitations");
  }
  assert.ok(FUNCTION_WINDOW_DAYS > 0);
});

// §3: "clicking [Stable] opens filtered Caseload."
test("a person filter narrows the table without changing the order", async () => {
  const all = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  const one = await buildCaseloadState({
    clinicianId: T.clinician, tenantId: T.tenant, personIds: [T.b],
  });
  assert.ok(all.rows.length >= one.rows.length);
  assert.deepEqual(one.rows.map((r) => r.personId), [T.b]);

  const filteredOrder = all.rows.filter((r) => r.personId === T.b).map((r) => r.personId);
  assert.deepEqual(one.rows.map((r) => r.personId), filteredOrder, "a filter is not a re-sort");
});

test("the table order is stable across builds", async () => {
  const a = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  const b = await buildCaseloadState({ clinicianId: T.clinician, tenantId: T.tenant });
  assert.deepEqual(a.rows.map((r) => r.personId), b.rows.map((r) => r.personId));
});

// ---------------------------------------------------------------------------
// The feed is a feed (§7)
// ---------------------------------------------------------------------------

test("only clinically relevant kinds appear, from an allowlist", () => {
  assert.deepEqual([...ACTIVITY_KINDS], [
    "checkin", "measure", "session", "practice", "goal_milestone",
    "thought_saved", "companion", "safety", "followup",
  ]);
  for (const k of ACTIVITY_KINDS) assert.ok(ACTIVITY_LABEL[k]);

  // An allowlist, not a denylist. A new event type added by some future feature
  // must be EXCLUDED until somebody decides it is clinically relevant —
  // otherwise every new type arrives in the feed by default, which is how a
  // feed becomes a firehose without anyone choosing it.
  const src = fs.readFileSync("src/lib/clinical/recent-activity.ts", "utf8");
  assert.ok(!/EXCLUDE|denylist|blocklist/i.test(src.replace(/\/\/.*$/gm, "")));
});

test("repeated same-day practices collapse into one line with a count", async () => {
  const day = "2026-09-01";
  for (let i = 0; i < 4; i++) {
    db.prepare(
      `INSERT OR REPLACE INTO practice_completions
         (id, user_id, tenant_id, practice_id, practice_type, duration_sec, created_at)
       VALUES (?, ?, ?, 'box-4', 'breathwork', 180, ?)`
    ).run(`pr-${i}`, T.a, T.tenant, `${day} 0${i + 1}:00:00`);
  }
  aCheckin(T.a, day);

  const feed = await buildRecentActivity({ clinicianId: T.clinician, tenantId: T.tenant });
  const practices = feed.items.filter((i) => i.kind === "practice" && i.personId === T.a);
  assert.equal(practices.length, 1, "four practices on one day is one line");
  assert.equal(practices[0].eventCount, 4, "and the count keeps the collapse honest");
  assert.ok(
    /4 practices/.test(practices[0].headline),
    "the line says how many rather than naming one of them"
  );
  assert.equal(
    practices[0].detail, null,
    "naming one would make the other three invisible while implying it mattered most"
  );
});

// Asserted on the rule, not on a fixture: the checkins table is UNIQUE per
// person per day, so no fixture can produce a same-day collision and a
// behavioural test here would pass whatever the set said.
test("only kinds whose repeats carry no meaning collapse", async () => {
  assert.deepEqual([...COLLAPSIBLE].sort(), ["companion", "practice"]);
  for (const kind of ["checkin", "measure", "session", "goal_milestone", "safety"] as const) {
    assert.ok(
      !COLLAPSIBLE.has(kind),
      `${kind} must never collapse — activation 8 on Tuesday and 3 on Wednesday are two things a clinician reads separately`
    );
  }

  aCheckin(T.a, "2026-09-02", 8);
  aCheckin(T.a, "2026-09-03", 3);
  const feed = await buildRecentActivity({ clinicianId: T.clinician, tenantId: T.tenant });
  const checkins = feed.items.filter((i) => i.kind === "checkin" && i.personId === T.a);
  assert.ok(checkins.length >= 2);
  assert.ok(checkins.every((i) => i.eventCount === 1));
});

test("the feed is chronological and stable, newest first", async () => {
  const a = await buildRecentActivity({ clinicianId: T.clinician, tenantId: T.tenant });
  const b = await buildRecentActivity({ clinicianId: T.clinician, tenantId: T.tenant });
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
  for (let i = 1; i < a.items.length; i++) {
    assert.ok(
      a.items[i - 1].occurredAt >= a.items[i].occurredAt,
      "§7: default chronological order"
    );
  }
});

test("a missing close reading stays missing in the feed", async () => {
  db.prepare(
    `INSERT OR REPLACE INTO therapy_sessions
       (id, user_id, tenant_id, module_id, status, pre_suds, post_suds, started_at)
     VALUES ('ccl-s1', ?, ?, 'calm-place', 'abandoned', 6, NULL, '2026-09-02 10:00:00')`
  ).run(T.a, T.tenant);
  const feed = await buildRecentActivity({ clinicianId: T.clinician, tenantId: T.tenant });
  const session = feed.items.find((i) => i.id === "session:ccl-s1");
  assert.ok(session);
  assert.ok(/left a session early/.test(session.headline));
  assert.ok(/no close reading/.test(session.detail ?? ""), "missing does not become a number");
});

// ---------------------------------------------------------------------------
// Companion (§7, §18) — the one with a person's privacy behind it
// ---------------------------------------------------------------------------

test("no Companion transcript text reaches the feed under any policy", async () => {
  aConversation("cv-1", T.a, "2026-09-03 21:00:00", "none");
  aConversation("cv-2", T.a, "2026-09-03 22:00:00", "elevated");
  db.prepare(
    `INSERT OR REPLACE INTO ai_messages (id, conversation_id, user_id, tenant_id, sender, message_text, created_at)
     VALUES ('msg-1', 'cv-1', ?, ?, 'member', 'My sister called and it was awful', '2026-09-03 21:01:00')`
  ).run(T.a, T.tenant);

  for (const visibility of ["never", "escalation", "member_shared", "always"] as const) {
    const feed = await buildRecentActivity({
      clinicianId: T.clinician, tenantId: T.tenant, policy: withPolicy({ companionVisibility: visibility }),
    });
    const blob = JSON.stringify(feed.items);
    assert.ok(
      !blob.includes("sister"),
      `transcript text leaked under "${visibility}" — §7 bars raw Companion text under every policy`
    );
  }
});

// §7's hardest clause: "metadata cannot bypass a content visibility
// restriction." A line saying a conversation happened, when, and about what IS
// content delivered by summary.
test("under a withholding policy the entry disappears and the count does not", async () => {
  const feed = await buildRecentActivity({
    clinicianId: T.clinician, tenantId: T.tenant, policy: withPolicy({ companionVisibility: "never" }),
  });
  assert.equal(
    feed.items.filter((i) => i.kind === "companion").length, 0,
    "no companion line at all — metadata is content when content is withheld"
  );
  assert.ok(feed.withheld.count >= 2, "but the absence is visible");
  assert.ok(/withheld by policy/i.test(feed.withheld.reason));
  assert.ok(
    /They happened; you are not seeing them here/.test(feed.withheld.reason),
    "and it says plainly that something exists which the clinician is not seeing"
  );
});

test("an escalation policy shows the risk conversation and withholds the ordinary one", async () => {
  const feed = await buildRecentActivity({
    clinicianId: T.clinician, tenantId: T.tenant,
    policy: withPolicy({ companionVisibility: "escalation" }),
  });
  const companion = feed.items.filter((i) => i.kind === "companion");
  assert.equal(companion.length, 1, "the one that raised risk");
  assert.ok(/Risk language was flagged/.test(companion[0].detail ?? ""));
  assert.equal(feed.withheld.count, 1, "and the routine one is counted, not shown");
});

test("a shown Companion line carries no topic, only that it happened", async () => {
  // On its own day, so at least one line is UNCOLLAPSED. A collapsed line
  // rewrites its own headline, which would hide a topic leak in the
  // per-conversation wording — the exact thing this test is for.
  aConversation("cv-3", T.b, "2026-09-05 19:00:00", "elevated");

  const feed = await buildRecentActivity({
    clinicianId: T.clinician, tenantId: T.tenant, policy: withPolicy({ companionVisibility: "always" }),
  });
  const companion = feed.items.filter((i) => i.kind === "companion");
  assert.ok(companion.length >= 2);
  assert.ok(
    companion.some((i) => i.eventCount === 1),
    "at least one line is a single conversation, with its own wording"
  );
  for (const i of companion) {
    assert.ok(
      /had \d+ Companion conversations|had a Companion conversation/.test(i.headline),
      `"${i.headline}" is not a Companion line`
    );
    assert.ok(
      // The HEADLINE as well as the detail. A topic smuggled into the headline
      // is the same content leak wearing a different field name.
      !/about|discussed|topic|regarding|elevated|risk level/i.test(`${i.headline} ${i.detail ?? ""}`),
      `"${i.headline} / ${i.detail}" names a topic — that is content, and §7 keeps it out of the clinician-wide feed`
    );
  }
});

// A collapse that reworded the thing it collapsed would be worse than no
// collapse: two Companion conversations once read as "completed 2 practices".
test("a collapsed line describes the kind it collapsed", async () => {
  const feed = await buildRecentActivity({
    clinicianId: T.clinician, tenantId: T.tenant, policy: withPolicy({ companionVisibility: "always" }),
  });
  for (const i of feed.items.filter((x) => x.eventCount > 1)) {
    if (i.kind === "companion") assert.ok(/Companion/.test(i.headline), i.headline);
    if (i.kind === "practice") assert.ok(/practice/.test(i.headline), i.headline);
  }
});

// ---------------------------------------------------------------------------
// Scope (§18)
// ---------------------------------------------------------------------------

test("the feed covers the caseload, and the scope is resolved before anything is read", async () => {
  const feed = await buildRecentActivity({ clinicianId: T.clinician, tenantId: T.tenant });
  const allowed = new Set([T.a, T.b]);
  for (const i of feed.items) assert.ok(allowed.has(i.personId));
  assert.ok(feed.coveredPeople > 0);

  // §18: "cross-patient and cross-tenant access fails before retrieval." The
  // caseload is resolved first and its ids bound into every query — a feed
  // built from the tenant and filtered afterwards would already have loaded
  // rows the clinician may not see.
  const src = fs.readFileSync("src/lib/clinical/recent-activity.ts", "utf8");
  const build = src.slice(src.indexOf("export async function buildRecentActivity"));
  assert.ok(build.indexOf("buildCaseload") < build.indexOf("await c.all") || !build.includes("await c.all"));
  assert.ok(build.includes("placeholders"), "person ids are bound, never interpolated");
});

test("the tenant is a bound parameter, never interpolated into SQL", () => {
  const src = fs.readFileSync("src/lib/clinical/recent-activity.ts", "utf8");
  assert.ok(
    !/tenant_id = '\$\{/.test(src),
    "a boundary assembled by string concatenation is one an escaping quote gets through"
  );
  assert.ok(src.includes("tenant_id = ?"));
});

// Not "an unknown clinician sees nothing" — under a shared-coverage model the
// caseload legitimately includes people nobody is individually assigned. The
// property is that the feed never exceeds what the caseload model returned.
test("the feed never covers anyone the caseload model did not return", async () => {
  const { buildCaseload } = await import("../src/lib/clinical/caseload");
  for (const clinicianId of [T.clinician, "nobody-at-all"]) {
    const caseload = await buildCaseload({ clinicianId, tenantId: T.tenant });
    const allowed = new Set(caseload.rows.map((r) => r.personId));
    const feed = await buildRecentActivity({ clinicianId, tenantId: T.tenant });
    assert.equal(feed.coveredPeople, allowed.size);
    for (const i of feed.items) {
      assert.ok(allowed.has(i.personId), `${i.personId} is not on this caseload`);
    }
  }
});

test("an empty caseload produces an empty feed, not a tenant-wide one", async () => {
  const feed = await buildRecentActivity({ clinicianId: T.clinician, tenantId: "tenant-that-is-not-real" });
  assert.deepEqual(feed.items, []);
  assert.equal(feed.coveredPeople, 0);
});
