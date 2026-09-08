// The therapeutic-load adapters, snapshots and reviews (expansion handoff 05
// §2, §5, §12).
//
// Where the policy tests run against constructed evidence, these run against a
// database, because what can go wrong here is about reaching real records:
//
//   AN ADAPTER READING PAST THE TENANT BOUNDARY. This engine reaches the safety
//   gate, sessions, post-session checks, goals, fingerprints, the trajectory
//   and a clinician's own notes — seven chances to widen what somebody may see.
//
//   A FALLBACK THAT FAILS OPEN. Every adapter is guarded so one failure does
//   not empty the reading, and the guarded fallback for SAFETY must block. An
//   adapter that returned an unblocked gate on failure would produce a
//   recommendation resting on an assumption nobody made, and it would look
//   exactly like a real one.
//
//   A SNAPSHOT WITH NO EVIDENCE, OR EVIDENCE WITH NO ROLE. §5's role column is
//   what makes a stored recommendation readable a year later: a post-session
//   check can be load evidence for one dimension and capacity evidence for
//   another, and a citation that did not say which would leave a reader unable
//   to tell what it was doing there.
//
//   A REVIEW CHANGING SOMETHING. §8: "these actions record judgement; they do
//   not automatically change plan/gates." §13: "clinician disagreement is
//   recorded and does not erase system evidence."

process.env.EMDR_DATA_DIR = `/tmp/steady-tle-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "tle-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "tle-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { readEvents } from "../src/lib/events";
import {
  computeTherapeuticLoad, saveTherapeuticLoad, evidenceForLoadSnapshot,
  recordLoadReview, loadReviewsForPerson, gatherLoadEvidence, assess,
  loadSnapshotId, TherapeuticLoadError, THERAPEUTIC_LOAD_POLICY,
  type LoadSnapshot,
} from "../src/lib/clinical/therapeutic-load";
import { readSessionRecovery, readClinicianContext } from "../src/lib/clinical/therapeutic-load-evidence";
import { THERAPEUTIC_LOAD_PROVIDER } from "../src/lib/clinical/attention-providers/therapeutic-load";
import { conforms, isDeterministic } from "../src/lib/clinical/attention-providers/contract";

const db = getDb();
const T = {
  tenant: "tenant-tle", other: "tenant-tle-other",
  clinician: "clin-tle", patient: "pat-tle", stranger: "pat-tle-foreign",
};

for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'Dr L', 'clinician', 'x')")
  .run(T.clinician, "clin-tle@example.test");
db.prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(T.tenant, T.clinician);
db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Dr L', 'fabricated')")
  .run(T.clinician, T.tenant);
for (const [id, tenant, name] of [[T.patient, T.tenant, "Lee"], [T.stranger, T.other, "Stranger"]] as const) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, 'member', 'x')")
    .run(id, `${id}@example.test`, name);
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')")
    .run(id, tenant, name);
  db.prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(tenant, id);
}

const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const CUTOFF = "2026-09-01T00:00:00.000Z";
const DAY = 86_400_000;
const at = (n: number) => new Date(Date.parse(CUTOFF) - n * DAY).toISOString().replace("T", " ").slice(0, 19);

/** A session with a difficult evening afterwards, for a person in one tenant. */
function seedSession(person: string, tenant: string, n: number, opts: {
  delayedRisk: number; recoveryConfirmed: number; peak?: number; status?: string;
}) {
  const sid = `sess-${person}-${n}`;
  db.prepare(
    `INSERT OR REPLACE INTO therapy_sessions
       (id, user_id, tenant_id, module_id, status, pre_suds, peak_suds, post_suds, started_at, ended_at)
     VALUES (?, ?, ?, 'calm-place', ?, 7, ?, 3, ?, ?)`
  ).run(sid, person, tenant, opts.status ?? "completed", opts.peak ?? 5, at(n * 7), at(n * 7));
  db.prepare(
    `INSERT OR REPLACE INTO post_session_checks
       (id, session_id, user_id, tenant_id, distress, oriented, safe_tonight,
        delayed_risk, recovery_confirmed, escalated, created_at)
     VALUES (?, ?, ?, ?, 3, 1, 1, ?, ?, 0, ?)`
  ).run(`chk-${person}-${n}`, sid, person, tenant, opts.delayedRisk, opts.recoveryConfirmed, at(n * 7));
}

function seedCheckin(person: string, tenant: string, daysAgo: number, sleep: number, dissociation: number) {
  const date = at(daysAgo).slice(0, 10);
  db.prepare(
    `INSERT OR REPLACE INTO checkins
       (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
        dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, ?, ?, 4, 2, 0, 1, ?, ?, 0, 'practice', ?)`
  ).run(`ck-${person}-${date}`, person, tenant, date, dissociation, sleep, at(daysAgo));
}

// Four sessions that went well in the room and badly afterwards: the person
// left calmer than they arrived every time, and every evening and the day after
// were worse. That is the clinical picture §13 names — "repeated delayed
// recovery can produce stabilize even when immediate session response looks
// favorable" — and it needs a check-in on both sides of each session, because
// "worse afterwards" is not observable without a before.
for (const n of [1, 2, 3, 4]) {
  seedSession(T.patient, T.tenant, n, { delayedRisk: 8, recoveryConfirmed: 0 });
  seedCheckin(T.patient, T.tenant, n * 7 + 1, 7, 2);  // the day before
  seedCheckin(T.patient, T.tenant, n * 7 - 1, 3, 6);  // the day after
  // An identical record for a person in another tenant.
  seedSession(T.stranger, T.other, n, { delayedRisk: 8, recoveryConfirmed: 0 });
  seedCheckin(T.stranger, T.other, n * 7 + 1, 7, 2);
  seedCheckin(T.stranger, T.other, n * 7 - 1, 3, 6);
}

/**
 * A snapshot computed from this person's REAL records with the gate opened.
 *
 * The module gate runs consent, then a fitness screener, then five baseline
 * instruments, then profile completeness, then today's check-in, then module
 * prerequisites — so a fixture that unblocked it would be a sixty-line
 * reconstruction of the entire enrolment funnel, and it would break the next
 * time that funnel changed for reasons unrelated to this feature.
 *
 * So the gate is stubbed HERE, deliberately and visibly, and everything else —
 * the sessions, the post-session checks, the goals, the fingerprints, the
 * trajectory — comes from the database. The gate's own behaviour is covered by
 * "a person the real gate is holding reads as blocked" below, which runs the
 * whole real stack and checks the short-circuit; this covers what happens on
 * the other side of it.
 */
async function unblockedSnapshot(personId: string): Promise<LoadSnapshot> {
  const gathered = await gatherLoadEvidence(ctx, {
    personId, asOf: CUTOFF, windowSessions: THERAPEUTIC_LOAD_POLICY.windowSessions,
  });
  const evidence = {
    ...gathered,
    safety: {
      blocked: false, gateState: "open" as const, moduleTitle: null, headline: null,
      safeAlternative: null, openAlerts: [], ref: null, evidenceIds: [],
    },
  };
  const assessment = assess(evidence, { asOf: CUTOFF, policy: THERAPEUTIC_LOAD_POLICY });
  return {
    ...assessment,
    // The same derivation the engine uses, so the idempotency and evidence
    // assertions below are about the real write path.
    id: loadSnapshotId({
      tenantId: ctx.tenantId, personId,
      policyVersion: assessment.policyVersion, evidenceCutoff: CUTOFF,
    }),
    personId,
    unavailable: gathered.unavailable,
  };
}

// ---------------------------------------------------------------------------
// Adapters (§2, §12 Phase 1)
// ---------------------------------------------------------------------------

test("a session's follow-up travels with it, and a missing one stays null", async () => {
  const rows = await readSessionRecovery(ctx, { personId: T.patient, asOf: CUTOFF, limit: 6 });
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.ok(r.check, "a seeded follow-up did not travel with its session");
    assert.equal(r.check!.recoveryConfirmed, false);
    assert.equal(r.check!.delayedRisk, 8);
  }

  // A session nobody asked about. §7's whole point is that this is
  // distinguishable from a good one, which a boolean would not have been.
  db.prepare(
    `INSERT OR REPLACE INTO therapy_sessions
       (id, user_id, tenant_id, module_id, status, pre_suds, peak_suds, post_suds, started_at, ended_at)
     VALUES ('sess-unasked', ?, ?, 'calm-place', 'completed', 7, 5, 3, ?, ?)`
  ).run(T.patient, T.tenant, at(2), at(2));
  const after = await readSessionRecovery(ctx, { personId: T.patient, asOf: CUTOFF, limit: 6 });
  const unasked = after.find((r) => r.sessionId === "sess-unasked")!;
  assert.equal(unasked.check, null, "an unasked session must be null, never a default answer");
});

test("a foreign tenant's identical record is not readable", async () => {
  // ADR 0011. The stranger has the same four sessions under another tenant, so
  // a leak would produce a plausible reading rather than an obvious error.
  const rows = await readSessionRecovery(ctx, { personId: T.stranger, asOf: CUTOFF, limit: 6 });
  assert.deepEqual(rows, [], "a foreign person's sessions were read");

  const snapshot = await computeTherapeuticLoad(ctx, T.stranger, { asOf: CUTOFF });
  // Whatever the safety gate says about them — the gate reads a legacy
  // user-scoped path — no dimension may be computed from their records, and no
  // evidence from their tenant may be cited.
  const cited = [...snapshot.load, ...snapshot.capacity].flatMap((d) => d.evidenceIds);
  assert.ok(
    !cited.some((id) => id.includes(T.stranger)),
    `a foreign person's records were cited: ${cited.join(", ")}`
  );
  assert.ok(
    ["insufficient_data", "blocked_by_safety"].includes(snapshot.state),
    `a substantive reading was computed for somebody in another tenant: ${snapshot.state}`
  );
});

// §6 step 1 through the REAL safety stack rather than a constructed gate. A
// person with no active membership is held by the module gate, and the engine
// must display that and stop — which is the property most worth checking
// end to end, because it is the one that would break silently if the gate
// adapter ever started returning something the engine could weigh.
test("a person the real gate is holding reads as blocked, and computes nothing", async () => {
  const snapshot = await computeTherapeuticLoad(ctx, T.patient, { asOf: CUTOFF });
  assert.equal(snapshot.state, "blocked_by_safety", snapshot.explanation.join(" | "));
  assert.deepEqual(snapshot.load, [], "dimensions were computed past a real safety hold");
  assert.deepEqual(snapshot.capacity, []);
  assert.ok(snapshot.safetyConstraint?.ref?.startsWith("gate:"), snapshot.safetyConstraint?.ref ?? "no ref");
  assert.ok(
    snapshot.explanation.some((l) => /rules elsewhere/.test(l)),
    "the constraint must be attributed to the safety engine, not restated as this feature's finding"
  );
});

test("the guarded safety fallback blocks rather than opens", () => {
  // The failure direction is the whole point. An adapter that returned an
  // unblocked gate when it could not read one would produce a recommendation
  // resting on an assumption nobody made — indistinguishable from a real one.
  const src = fs.readFileSync("src/lib/clinical/therapeutic-load-evidence.ts", "utf8");
  const guard = src.slice(src.indexOf('guard("safety"'), src.indexOf('guard("sessions"'));
  assert.match(guard, /blocked:\s*true/, "the safety fallback does not block");
  assert.ok(!/blocked:\s*false/.test(guard), "the safety fallback can return an open gate");
});

test("only the clinician's own saved notes are read for uncertainty", () => {
  // Never patient text, never Companion text. A feature that scanned a
  // person's own words for hesitation and used it to hold a recommendation
  // would be doing something nobody agreed to.
  const src = fs.readFileSync("src/lib/clinical/therapeutic-load-evidence.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function readClinicianContext"));
  assert.match(fn, /listThoughts/, "it does not read clinician thoughts");
  assert.ok(
    !/companion|ai_messages|ai_conversations|checkins/i.test(fn.slice(0, 900)),
    "the uncertainty scan reaches patient or Companion content"
  );
});

test("a person with no clinician notes reads as not uncertain", async () => {
  const c = await readClinicianContext(ctx, T.patient);
  assert.equal(c.uncertain, false);
  assert.equal(c.quote, null, "an absence must not produce a quote");
});

// ---------------------------------------------------------------------------
// The reading, end to end
// ---------------------------------------------------------------------------

test("four hard evenings after four favourable sessions read as stabilize", async () => {
  const snapshot = await unblockedSnapshot(T.patient);
  // Every one of those sessions ended with the person calmer than they
  // started. §13: "repeated delayed recovery can produce stabilize even when
  // immediate session response looks favorable."
  assert.equal(snapshot.state, "stabilize", snapshot.explanation.join(" | "));
  assert.ok(snapshot.load.some((d) => d.key === "recovery_time" && d.reading === "high"));
  assert.ok(snapshot.limitations.length > 0, "a state above insufficient_data must carry limitations");
});

test("a saved snapshot cites its evidence with a role, and appends one event", async () => {
  const snapshot = await unblockedSnapshot(T.patient);
  await saveTherapeuticLoad(ctx, snapshot, T.clinician);

  const evidence = await evidenceForLoadSnapshot(ctx, snapshot.id);
  assert.ok(evidence.length > 0, "a stored recommendation cites nothing");
  for (const e of evidence) {
    assert.ok(
      ["load", "capacity", "constraint", "context"].includes(e.role),
      `a citation with no role: ${JSON.stringify(e)}`
    );
  }
  assert.ok(evidence.some((e) => e.role === "load"), "no load evidence was stored");

  const events = await readEvents({ personId: T.patient });
  const computed = events.filter((e) => e.event_type === "therapeutic_load.snapshot_computed");
  assert.equal(computed.length, 1);
  const payload = computed[0].payload as Record<string, unknown>;
  assert.equal(payload.state, snapshot.state);
  assert.ok(payload.policyVersion, "a snapshot event with no policy version cannot be attributed");
});

test("recomputing the same cutoff under the same policy does not write a second row", async () => {
  const snapshot = await unblockedSnapshot(T.patient);
  await saveTherapeuticLoad(ctx, snapshot, T.clinician);
  const before = db.prepare("SELECT COUNT(*) AS n FROM therapeutic_load_snapshots").get() as { n: number };
  await saveTherapeuticLoad(ctx, snapshot, T.clinician);
  await saveTherapeuticLoad(ctx, snapshot, T.clinician);
  const after = db.prepare("SELECT COUNT(*) AS n FROM therapeutic_load_snapshots").get() as { n: number };
  assert.equal(after.n, before.n, "a repeated computation duplicated the record");
});

// ---------------------------------------------------------------------------
// Review (§8, §13)
// ---------------------------------------------------------------------------

test("a disagreement needs a reason and does not erase the reading", async () => {
  const snapshot = await unblockedSnapshot(T.patient);
  await saveTherapeuticLoad(ctx, snapshot, T.clinician);

  await assert.rejects(
    () => recordLoadReview(ctx, {
      personId: T.patient, snapshotId: snapshot.id,
      clinicianPersonId: T.clinician, decision: "disagree",
    }),
    TherapeuticLoadError
  );

  await recordLoadReview(ctx, {
    personId: T.patient, snapshotId: snapshot.id, clinicianPersonId: T.clinician,
    decision: "disagree", note: "The delayed-risk answers are about a house move, not the sessions.",
  });
  const reviews = await loadReviewsForPerson(ctx, T.patient);
  assert.equal(reviews.length, 1);

  // §13: "clinician disagreement is recorded and does not erase system
  // evidence." The reading stays exactly as it was.
  const stored = db.prepare("SELECT state FROM therapeutic_load_snapshots WHERE id = ?")
    .get(snapshot.id) as { state: string };
  assert.equal(stored.state, snapshot.state);
  const again = await unblockedSnapshot(T.patient);
  assert.equal(again.state, snapshot.state, "the reading was suppressed after a disagreement");
});

test("a recorded decision changes nothing about access or the plan", async () => {
  const before = {
    unlocks: (db.prepare("SELECT COUNT(*) AS n FROM module_unlocks WHERE user_id = ?").get(T.patient) as { n: number }).n,
    alerts: (db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ?").get(T.patient) as { n: number }).n,
    sessions: (db.prepare("SELECT COUNT(*) AS n FROM therapy_sessions WHERE user_id = ?").get(T.patient) as { n: number }).n,
  };
  const snapshot = await unblockedSnapshot(T.patient);
  await saveTherapeuticLoad(ctx, snapshot, T.clinician);
  await recordLoadReview(ctx, {
    personId: T.patient, snapshotId: snapshot.id, clinicianPersonId: T.clinician,
    decision: "review_progression",
  });
  // §13: "no system action autonomously changes treatment intensity, module
  // access, or trauma-processing status." The strongest decision a clinician
  // can record here is "I will look at it", and looking is theirs to do.
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM module_unlocks WHERE user_id = ?").get(T.patient) as { n: number }).n, before.unlocks);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ?").get(T.patient) as { n: number }).n, before.alerts);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM therapy_sessions WHERE user_id = ?").get(T.patient) as { n: number }).n, before.sessions);
});

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

test("the provider passes the published contract and is deterministic", async () => {
  const args = { ctx, personId: T.patient, evidenceCutoff: CUTOFF };
  const candidates = await THERAPEUTIC_LOAD_PROVIDER.evaluate(args);
  const issues = conforms(THERAPEUTIC_LOAD_PROVIDER, candidates, { evidenceCutoff: CUTOFF });
  assert.deepEqual(issues, [], issues.map((i) => `${i.rule}: ${i.detail}`).join("\n"));
  assert.ok(await isDeterministic(THERAPEUTIC_LOAD_PROVIDER, args));
});

test("the evidence gather reports what it could not read", async () => {
  const gathered = await gatherLoadEvidence(ctx, {
    personId: T.patient, asOf: CUTOFF, windowSessions: THERAPEUTIC_LOAD_POLICY.windowSessions,
  });
  assert.ok(Array.isArray(gathered.unavailable));
  assert.equal(gathered.sessions.length > 0, true);
  // A partial picture must be reported as partial rather than served as
  // complete — the field exists whether or not anything failed today.
  const snapshot = await computeTherapeuticLoad(ctx, T.patient, { asOf: CUTOFF });
  assert.deepEqual(snapshot.unavailable, gathered.unavailable);
});
