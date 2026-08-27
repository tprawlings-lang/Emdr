// Steady Clinical prototype — service layer (Phase 4).
//
// The properties asserted here are the ones the workflow specification calls
// non-negotiable, and each is a rule a reasonable implementation could get
// wrong in a way that looks fine on screen:
//
//   * a caseload ordered by clinical need, never by contract tier
//   * a band that always carries its reason, never a bare score
//   * a summary claim that cannot cite is not displayed
//   * a citation that does not resolve is treated as fabrication
//   * reconstructed history is not evidence
//   * immediate-band alerts never close without a documented action
//   * approve, correct, and override are distinct, and a safety stop is not overridable
//
// Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-clinical-${process.pid}-${Date.now()}`;
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "clinical-test-key";
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { provisionPerson } from "../src/lib/spine";
import { appendEvent, readEvents } from "../src/lib/events";
import { memberTimeline, originalEvidence } from "../src/lib/clinical/timeline";
import { buildSummary, validateSummary, type Claim } from "../src/lib/clinical/summary";
import { buildCaseload, canAct, isCoverageAction } from "../src/lib/clinical/caseload";
import {
  alertQueue, closeAlert, deadlineFrom, AlertClosureError, alertPressure,
} from "../src/lib/clinical/alerts";
import { approve, correct, override, recordFeedback, ReviewError } from "../src/lib/clinical/review";
import { T1_DEFAULT_POLICY } from "../src/lib/clinical-policy";

const CLIN = "clin-1";
const CALM = "member-calm";      // steady, no flags
const RISK = "member-risk";      // harm urge + hard stop

async function member(id: string, name: string) {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, ?, 'member', 'x', ?)",
    [id, `${id}@test.local`, name, PLATFORM_TENANT_ID]);
  await provisionPerson({ userId: id, name, email: `${id}@test.local`, role: "member" });
}

test("setup: two members with contrasting clinical pictures", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, ?, 'clinician', 'x', ?)",
    [CLIN, "clin@test.local", "Dr Test", PLATFORM_TENANT_ID]);
  await provisionPerson({ userId: CLIN, name: "Dr Test", email: "clin@test.local", role: "clinician" });
  await member(CALM, "Calm Member");
  await member(RISK, "At-Risk Member");

  // Calm: three improving check-ins.
  for (const [d, act] of [["2026-08-20", 7], ["2026-08-21", 5], ["2026-08-22", 3]] as const) {
    await c.run(
      `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
         dissociation, sleep_quality, substance_flag, recommended_action, created_at, tenant_id)
       VALUES (?, ?, ?, ?, 2, 0, 1, 1, 7, 0, 'processing_ok', ?, ?)`,
      [newId(), CALM, d, act, `${d} 09:00:00`, PLATFORM_TENANT_ID]
    );
    await appendEvent({
      personId: CALM, type: "daily_checkin.completed", occurredAt: `${d} 09:00:00`,
      payload: { projectionId: newId(), checkinDate: d, activation: act, shutdown: 2,
        dissociation: 1, sleepQuality: 7, harmUrge: false, feelsSafe: true,
        substanceFlag: false, recommendedAction: "processing_ok" },
    });
  }

  // At-risk: harm urge, and a hard-stopped session.
  await c.run(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action, created_at, tenant_id)
     VALUES (?, ?, '2026-08-22', 8, 6, 1, 0, 6, 2, 0, 'crisis', '2026-08-22 08:00:00', ?)`,
    [newId(), RISK, PLATFORM_TENANT_ID]
  );
  await appendEvent({
    personId: RISK, type: "daily_checkin.completed", occurredAt: "2026-08-22 08:00:00",
    payload: { projectionId: newId(), checkinDate: "2026-08-22", activation: 8, shutdown: 6,
      dissociation: 6, sleepQuality: 2, harmUrge: true, feelsSafe: false,
      substanceFlag: false, recommendedAction: "crisis" },
  });
  const sid = newId();
  await c.run(
    `INSERT INTO therapy_sessions (id, user_id, module_id, status, pre_suds, post_suds, peak_suds,
       hard_stop_reason, started_at, ended_at, tenant_id)
     VALUES (?, ?, 'body-scan', 'hard_stop', 6, 9, 9, 'Distress rated 9/10',
             '2026-08-22 10:00:00', '2026-08-22 10:20:00', ?)`,
    [sid, RISK, PLATFORM_TENANT_ID]
  );
  await appendEvent({
    personId: RISK, type: "session.hard_stopped", occurredAt: "2026-08-22 10:20:00",
    payload: { projectionId: sid, sessionId: sid, moduleId: "body-scan", status: "hard_stop",
      preSuds: 6, postSuds: 9, peakSuds: 9, hardStopReason: "Distress rated 9/10" },
    correlationId: sid,
  });
  await c.run(
    `INSERT INTO alerts (id, user_id, alert_type, severity, detail, created_at, tenant_id)
     VALUES (?, ?, 'session_hard_stop', 'urgent', 'Hard stop in body-scan: Distress rated 9/10',
             '2026-08-22 10:20:00', ?)`,
    [newId(), RISK, PLATFORM_TENANT_ID]
  );

  assert.ok((await readEvents({ personId: RISK })).length >= 2);
});

// ---------- Caseload ----------

test("caseload is ordered by clinical need, and every band carries its reason", async () => {
  const cl = await buildCaseload({ clinicianId: CLIN, tenantId: PLATFORM_TENANT_ID });
  const risk = cl.rows.find((r) => r.personId === RISK)!;
  const calm = cl.rows.find((r) => r.personId === CALM)!;

  assert.equal(risk.band, "immediate");
  assert.ok(cl.rows.indexOf(risk) < cl.rows.indexOf(calm), "the at-risk member sorts first");

  // The rule that matters: never a bare score.
  for (const row of cl.rows) {
    if (row.band === "none") continue;
    assert.ok(row.reasons.length > 0, `${row.displayName} has band ${row.band} with no reason`);
    for (const reason of row.reasons) {
      assert.ok(/[a-z]{4,}/i.test(reason), `reason "${reason}" is not a sentence`);
    }
  }
  assert.ok(risk.reasons.some((r) => /harm urge/i.test(r)));
});

test("contract tier plays no part in caseload ordering", async () => {
  const c = await data();
  // Give the CALM member the top tier. Clinical need must still decide.
  await c.run(
    `INSERT INTO subscriptions (user_id, plan, status, price_cents, current_period_end)
     VALUES (?, 'premium', 'active', 3499, '2099-01-01 00:00:00')`, [CALM]
  );
  const cl = await buildCaseload({ clinicianId: CLIN, tenantId: PLATFORM_TENANT_ID });
  const risk = cl.rows.findIndex((r) => r.personId === RISK);
  const calm = cl.rows.findIndex((r) => r.personId === CALM);
  assert.ok(risk < calm, "a paying member must not outrank a member in crisis");
});

test("caseload models decide who may act, and coverage is visible", () => {
  assert.equal(canAct("pooled", "other", "owner"), true);
  assert.equal(canAct("owned", "other", "owner"), false);
  assert.equal(canAct("owned", "owner", "owner"), true);
  // Hybrid: anyone may act, because the alternative is a member in an
  // immediate band waiting for one person to return from leave.
  assert.equal(canAct("hybrid", "other", "owner"), true);
  assert.equal(isCoverageAction("hybrid", "other", "owner"), true,
    "acting outside your own caseload must be visible as coverage");
  assert.equal(isCoverageAction("hybrid", "owner", "owner"), false);
});

// ---------- Timeline ----------

test("the timeline is assembled from events, with lanes and provenance", async () => {
  const t = await memberTimeline(RISK);
  assert.ok(t.entries.length >= 2);
  const hardStop = t.entries.find((e) => e.type === "session.hard_stopped")!;
  assert.equal(hardStop.lane, "care");
  assert.match(hardStop.headline, /HARD STOP/);
  assert.match(hardStop.headline, /Distress rated 9\/10/);
  assert.ok(hardStop.occurredAt);
  assert.ok(hardStop.recordedAt);
});

test("a point-in-time timeline does not leak later facts", async () => {
  const all = await memberTimeline(RISK);
  const cut = all.entries.map((e) => e.recordedAt).sort()[0];
  const asOf = await memberTimeline(RISK, { asOf: cut });
  assert.ok(asOf.entries.length <= all.entries.length);
  for (const e of asOf.entries) {
    assert.ok(e.recordedAt <= cut, "an entry recorded after the cut appeared in the reconstruction");
  }
});

test("companion memory is governed by policy, and withholding is disclosed", async () => {
  await appendEvent({
    personId: CALM, type: "memory.recorded",
    payload: { memoryType: "grounding_tool", key: "calm place", source: "user_message" },
  });

  const def = await memberTimeline(CALM); // default: escalation only
  assert.equal(def.entries.some((e) => e.lane === "ai"), false, "routine access must not show memory");
  assert.ok(def.withheld.count > 0);
  assert.match(def.withheld.reason, /withheld by policy/,
    "withholding must be disclosed, not silent");

  const open = await memberTimeline(CALM, {
    policy: { ...T1_DEFAULT_POLICY, companionVisibility: "always" },
  });
  assert.ok(open.entries.some((e) => e.lane === "ai"));
  assert.equal(open.withheld.count, 0);
});

test("protected content never reaches the timeline, even if a payload carries it", async () => {
  await appendEvent({
    personId: CALM, type: "memory.recorded",
    payload: { memoryType: "note", key: "k", source: "user_message", value: "SECRET TRANSCRIPT TEXT" },
  });
  const t = await memberTimeline(CALM, {
    policy: { ...T1_DEFAULT_POLICY, companionVisibility: "always" },
  });
  const json = JSON.stringify(t);
  assert.equal(json.includes("SECRET TRANSCRIPT TEXT"), false,
    "a payload value leaked to the clinician surface");
});

// ---------- Summary ----------

test("every displayed claim cites resolvable evidence", async () => {
  const t = await memberTimeline(CALM);
  const s = buildSummary(t);
  const known = new Set(originalEvidence(t).map((e) => e.eventId));

  assert.ok(s.claims.length > 0, "the summary produced nothing to check");
  for (const claim of s.claims) {
    assert.ok(claim.citations.length > 0, `uncited claim displayed: "${claim.text}"`);
    for (const id of claim.citations) {
      assert.ok(known.has(id), `claim cites an unknown event: "${claim.text}"`);
    }
  }
});

test("an uncitable claim is suppressed and reported, not displayed", () => {
  const evidence = [{ eventId: "e1" }] as never as Parameters<typeof validateSummary>[1];
  const claims: Claim[] = [
    { kind: "state_trend", text: "Cited and fine.", citations: ["e1"] },
    { kind: "risk", text: "Sounds plausible, rests on nothing.", citations: [] },
  ];
  const { kept, omitted } = validateSummary(claims, evidence);
  assert.equal(kept.length, 1);
  assert.equal(omitted.length, 1);
  assert.match(omitted[0].reason, /no citation/);
});

test("a citation that does not resolve is treated as fabrication", () => {
  const evidence = [{ eventId: "e1" }] as never as Parameters<typeof validateSummary>[1];
  const claims: Claim[] = [
    { kind: "risk", text: "Cites an event that does not exist.", citations: ["e1", "ghost"] },
  ];
  const { kept, omitted } = validateSummary(claims, evidence);
  assert.equal(kept.length, 0, "a claim citing a non-existent event was displayed");
  assert.match(omitted[0].reason, /fabricated/);
});

test("reconstructed history is excluded from evidence and the exclusion is stated", async () => {
  const c = await data();
  // A genesis event: payload_version 0, source_system 'backfill'.
  await c.run(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id, actor_type,
        occurred_at, source_system, provenance)
     VALUES (?, ?, ?, 'daily_checkin.completed', 0, ?, ?, 'patient',
             '2026-08-01 09:00:00', 'backfill', ?)`,
    [newId().replace(/-/g, "").slice(0, 26).toUpperCase(), PLATFORM_TENANT_ID, CALM,
     JSON.stringify({ projectionId: newId(), checkinDate: "2026-08-01", activation: 9 }),
     CALM, JSON.stringify({ reconstructed: true })]
  );

  const t = await memberTimeline(CALM);
  assert.ok(t.reconstructedCount > 0);
  const s = buildSummary(t);
  const reconstructedIds = new Set(t.entries.filter((e) => e.reconstructed).map((e) => e.eventId));
  for (const claim of s.claims) {
    for (const id of claim.citations) {
      assert.equal(reconstructedIds.has(id), false,
        `a claim cited reconstructed history: "${claim.text}"`);
    }
  }
  assert.ok(s.provenance.excluded.some((x) => /reconstructed/.test(x)),
    "the summary must say what it did not look at");
});

test("the summary states gaps rather than smoothing over them", async () => {
  const t = await memberTimeline(CALM);
  const s = buildSummary(t);
  assert.ok(s.provenance.excluded.some((x) => /encrypted/.test(x)),
    "encrypted content must be named as excluded");
  assert.ok(s.provenance.generator);
  assert.ok(s.provenance.retrievalScope.length > 0, "provenance must record what was in scope");
});

// ---------- Alerts ----------

test("deadlines respect the coverage model", () => {
  const fridayEvening = new Date("2026-08-21T18:00:00Z"); // Friday, after hours

  const roundClock = deadlineFrom(fridayEvening, 4, { ...T1_DEFAULT_POLICY, coverage: "24_hour" });
  assert.equal(roundClock.toISOString(), "2026-08-21T22:00:00.000Z");

  // Business hours: Friday 18:00 + 4 covered hours lands Monday morning, not
  // Saturday — which is what the rota can actually deliver.
  const business = deadlineFrom(fridayEvening, 4, { ...T1_DEFAULT_POLICY, coverage: "business_hours" });
  assert.equal(business.getUTCDay(), 1, "business-hours deadline should land on Monday");
  assert.equal(business.getUTCHours(), 13);
});

test("the alert queue bands, dates, and orders by urgency", async () => {
  const q = await alertQueue({ tenantId: PLATFORM_TENANT_ID, now: new Date("2026-08-22T11:00:00Z") });
  assert.ok(q.length > 0);
  const hs = q.find((a) => a.type === "session_hard_stop")!;
  assert.equal(hs.band, "immediate");
  assert.ok(hs.dueAt, "an immediate alert must carry a deadline");
  assert.equal(hs.requiresDocumentedAction, true);
});

test("an immediate alert cannot be closed with an acknowledgement", async () => {
  const q = await alertQueue({ tenantId: PLATFORM_TENANT_ID });
  const hs = q.find((a) => a.type === "session_hard_stop")!;

  await assert.rejects(
    () => closeAlert({ alertId: hs.id, clinicianId: CLIN, tenantId: PLATFORM_TENANT_ID, resolution: "ok" }),
    AlertClosureError,
    "a token resolution closed an immediate-band alert"
  );

  const closed = await closeAlert({
    alertId: hs.id, clinicianId: CLIN, tenantId: PLATFORM_TENANT_ID,
    resolution: "Called member same day; dissociative spike after poor sleep. Grounding-only week agreed; review Friday.",
  });
  assert.equal(closed.status, "reviewed");
  assert.ok(closed.resolution && closed.resolution.length > 10);
});

test("an alert in another tenant does not exist rather than being forbidden", async () => {
  const q = await alertQueue({ tenantId: PLATFORM_TENANT_ID, includeResolved: true });
  const any = q[0];
  await assert.rejects(
    () => closeAlert({
      alertId: any.id, clinicianId: CLIN, tenantId: "some-other-tenant",
      resolution: "Attempting to close another tenant's alert.",
    }),
    /not found/,
    "the response must not distinguish a foreign alert from a nonexistent one"
  );
});

test("alert pressure is measurable, because dismissal rate is a safety signal", async () => {
  const q = await alertQueue({ tenantId: PLATFORM_TENANT_ID, includeResolved: true });
  const p = alertPressure(q);
  assert.ok(typeof p.overdueTotal === "number");
  assert.ok(Object.keys(p.byType).length > 0);
});

// ---------- Review actions ----------

test("approve records review without changing the record", async () => {
  const before = (await readEvents({ personId: CALM })).length;
  const r = await approve({
    clinicianId: CLIN, personId: CALM, tenantId: PLATFORM_TENANT_ID,
    subject: "summary", evidenceIds: ["e1", "e2"], note: "Consistent with the timeline.",
  });
  assert.equal(r.changedRecord, false);
  assert.equal((await readEvents({ personId: CALM })).length, before + 1,
    "the approval itself is recorded");
});

test("correct supersedes by reference and never erases", async () => {
  const events = await readEvents({ personId: CALM });
  const target = events.find((e) => e.event_type === "daily_checkin.completed")!;

  await assert.rejects(
    () => correct({
      clinicianId: CLIN, personId: CALM, tenantId: PLATFORM_TENANT_ID,
      supersedesEventId: target.id, rationale: "wrong", correction: { activation: 4 },
    }),
    ReviewError, "a correction without a real rationale was accepted"
  );

  const r = await correct({
    clinicianId: CLIN, personId: CALM, tenantId: PLATFORM_TENANT_ID,
    supersedesEventId: target.id,
    rationale: "Member reported the value was mis-entered; corrected during review.",
    correction: { activation: 4 },
  });
  assert.equal(r.changedRecord, true);

  const after = await readEvents({ personId: CALM });
  assert.ok(after.some((e) => e.id === target.id), "the original event was removed");
  assert.ok(after.some((e) => e.supersedes_event_id === target.id), "no superseding event was appended");
});

test("SAFETY: an override relaxes pacing and can never relax a safety stop", async () => {
  for (const target of ["daily_checkin_read", "crisis_routing", "cooldown", "daily_cap", "kill_switch"]) {
    await assert.rejects(
      () => override({
        clinicianId: CLIN, personId: CALM, tenantId: PLATFORM_TENANT_ID,
        target, reason: "Clinically justified in my judgement for this member.",
      }),
      /cannot be overridden/,
      `${target} was overridable`
    );
  }

  const r = await override({
    clinicianId: CLIN, personId: CALM, tenantId: PLATFORM_TENANT_ID,
    target: "module_unlock",
    reason: "Prerequisites met in supervised sessions; readiness confirmed on 2026-08-22.",
  });
  assert.equal(r.action, "override");
  assert.equal(r.changedRecord, true);
});

test("an override without a reason is refused", async () => {
  await assert.rejects(
    () => override({
      clinicianId: CLIN, personId: CALM, tenantId: PLATFORM_TENANT_ID,
      target: "module_unlock", reason: "ok",
    }),
    ReviewError
  );
});

test("harmful feedback is a safety signal, not a product-quality one", async () => {
  const harmful = await recordFeedback({
    clinicianId: CLIN, personId: CALM, tenantId: PLATFORM_TENANT_ID,
    category: "harmful_if_acted_on", subject: "summary",
    provenance: { generator: "deterministic-v1" },
  });
  assert.equal(harmful.requiresImmediateReview, true);

  const routine = await recordFeedback({
    clinicianId: CLIN, personId: CALM, tenantId: PLATFORM_TENANT_ID,
    category: "incomplete", subject: "summary",
    provenance: { generator: "deterministic-v1" },
  });
  assert.equal(routine.requiresImmediateReview, false);
});
