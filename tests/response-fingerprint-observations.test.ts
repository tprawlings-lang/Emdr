// Response observations (expansion handoff 02, Phase 2).
//
// The definition of done is one sentence — "mixed and missing outcomes remain
// visible" — and both halves fail silently when broken.
//
//   MIXED fails by NETTING. An immediate distress drop of four and a next-day
//   rise of three average to a mild improvement, and the resulting number looks
//   entirely reasonable. §6 forbids exactly that: "an immediate distress
//   decrease plus next-day worsening is displayed as mixed response, not netted
//   into one number."
//
//   MISSING fails by DEFAULTING. A session with no post-session check has no
//   recovery row, and every natural implementation of "did they recover?"
//   answers no-row as either "yes" or "nothing to report". §6 again: "missing
//   delayed follow-up is reported. Do not classify it as recovered."
//
// So the tests below are mostly about absences and disagreements, which are the
// two shapes this layer exists to preserve.

process.env.EMDR_DATA_DIR = `/tmp/steady-rfo-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "rfo-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "rfo-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { readEvents } from "../src/lib/events";
import {
  syncInterventionInstances, listInstances, recordClinicianIntervention,
} from "../src/lib/clinical/interventions";
import {
  OUTCOME_TYPES, WINDOW_TYPES, RESPONSE_EVIDENCE_CLASSES, SETTLING_DIRECTION,
  OUTCOME_LABEL, WINDOW_LABEL, EVIDENCE_LABEL, EXPECTED_WINDOWS,
  FUNCTIONAL_WINDOW_DAYS, ResponseObservationError,
  recordObservation, observationsForPerson, observationsForInstance,
  missingWindowsFor, isMixed, isSettling, syncResponseObservations,
  syncNextDayResponses, syncFunctionalResponses, DELAYED_RISK_ESCALATION,
} from "../src/lib/clinical/response-observations";
import {
  inWindowOrder, WINDOW_ORDER, describeObservation, type WindowType,
} from "../src/lib/clinical/response-vocabulary";

const db = getDb();
const T = {
  tenant: "tenant-rfo", other: "tenant-rfo-2",
  clinician: "clin-rfo", patient: "pat-rfo",
};
for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
for (const id of [T.clinician, T.patient]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
  db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'X', 'member', 'x')")
    .run(id, `${id}@example.test`);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const otherCtx: TenantContext = { tenantId: T.other, personId: T.clinician };

function aSession(args: {
  id: string; moduleId?: string; status?: string;
  pre: number | null; post: number | null; day: string; hardStopReason?: string | null;
}) {
  db.prepare(
    `INSERT OR REPLACE INTO therapy_sessions
       (id, user_id, tenant_id, module_id, status, pre_suds, post_suds, hard_stop_reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.id, T.patient, T.tenant, args.moduleId ?? "calm-place", args.status ?? "completed",
    args.pre, args.post, args.hardStopReason ?? null,
    `${args.day} 10:00:00`, `${args.day} 10:40:00`
  );
}

function aPostCheck(args: {
  id: string; sessionId: string; distress: number; recovered: boolean;
  delayedRisk?: number; day: string;
}) {
  db.prepare(
    `INSERT OR REPLACE INTO post_session_checks
       (id, session_id, user_id, tenant_id, distress, oriented, safe_tonight, delayed_risk, recovery_confirmed, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
  ).run(
    args.id, args.sessionId, T.patient, T.tenant, args.distress,
    args.delayedRisk ?? 0, args.recovered ? 1 : 0, `${args.day} 14:00:00`
  );
}

function aCheckin(args: { id: string; date: string; activation: number; sleep: number }) {
  db.prepare(
    `INSERT OR REPLACE INTO checkins
       (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
        dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, ?, ?, ?, 2, 0, 1, 1, ?, 0, 'practice', ?)`
  ).run(args.id, T.patient, T.tenant, args.date, args.activation, args.sleep, `${args.date} 08:00:00`);
}

// ---------------------------------------------------------------------------
// Vocabulary (§5)
// ---------------------------------------------------------------------------

test("the dimensions are §5's seven and the windows are §4's six", () => {
  assert.deepEqual([...OUTCOME_TYPES], [
    "within_encounter", "recovery_burden", "sleep_after", "function_after",
    "patient_helpfulness", "engagement_reuse", "adverse_or_hard_stop",
  ]);
  assert.deepEqual([...WINDOW_TYPES], [
    "immediate", "post_session", "same_day", "next_day", "multi_day", "functional",
  ]);
  for (const o of OUTCOME_TYPES) {
    assert.ok(OUTCOME_LABEL[o] && SETTLING_DIRECTION[o]);
  }
  for (const w of WINDOW_TYPES) assert.ok(WINDOW_LABEL[w]);
  for (const e of RESPONSE_EVIDENCE_CLASSES) assert.ok(EVIDENCE_LABEL[e]);
});

test("no label in the response vocabulary carries a benefit or efficacy word", () => {
  const text = [
    ...Object.values(OUTCOME_LABEL), ...Object.values(WINDOW_LABEL), ...Object.values(EVIDENCE_LABEL),
  ].join(" ").toLowerCase();
  for (const word of ["works", "effective", "efficac", "caused", "contraindicat", "benefit", "cure"]) {
    assert.ok(!text.includes(word), `the vocabulary must not say "${word}"`);
  }
});

// The one dimension whose sign runs the other way. A single hard-coded "lower
// is better" anywhere in the aggregator would call a good night's sleep a
// deterioration.
test("sleep quality settles upward and distress settles downward", () => {
  assert.equal(SETTLING_DIRECTION.sleep_after, "increase");
  assert.equal(SETTLING_DIRECTION.within_encounter, "decrease");
  assert.equal(SETTLING_DIRECTION.function_after, "increase");
  assert.equal(isSettling("within_encounter", "decrease"), true);
  assert.equal(isSettling("sleep_after", "decrease"), false);
  assert.equal(isSettling("sleep_after", "increase"), true);
  assert.equal(isSettling("within_encounter", "unchanged"), null);
  assert.equal(isSettling("within_encounter", null), null);
});

// ---------------------------------------------------------------------------
// The immediate window
// ---------------------------------------------------------------------------

test("a closed session produces one measured immediate observation", async () => {
  aSession({ id: "s-a", pre: 7, post: 3, day: "2026-08-01" });
  await syncInterventionInstances(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);

  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-a")!;
  const obs = await observationsForInstance(ctx, inst.id);
  const immediate = obs.find((o) => o.windowType === "immediate" && o.outcomeType === "within_encounter")!;
  assert.ok(immediate);
  assert.equal(immediate.evidenceClass, "measured");
  assert.equal(immediate.direction, "decrease");
  assert.equal(immediate.valueNum, -4);
  assert.equal(immediate.valueText, "7 to 3", "the raw readings survive, not just the delta");
});

// §6, one window earlier: a missing close is not "no change" and not recovery.
test("a session with no close produces no immediate observation and reports the gap", async () => {
  aSession({ id: "s-b", status: "abandoned", pre: 6, post: null, day: "2026-08-05" });
  await syncInterventionInstances(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);

  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-b")!;
  const obs = await observationsForInstance(ctx, inst.id);
  assert.equal(
    obs.filter((o) => o.outcomeType === "within_encounter").length, 0,
    "no close reading means no immediate observation — not a zero"
  );
  assert.ok(
    missingWindowsFor(inst, obs).includes("immediate"),
    "the absence is reported rather than silent"
  );
});

test("a hard stop keeps its own adverse observation beside the reading", async () => {
  aSession({
    id: "s-c", status: "hard_stop", pre: 8, post: 5, day: "2026-08-08",
    hardStopReason: "distress rose across two sets",
  });
  await syncInterventionInstances(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);

  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-c")!;
  const obs = await observationsForInstance(ctx, inst.id);
  const adverse = obs.find((o) => o.outcomeType === "adverse_or_hard_stop")!;
  assert.ok(adverse, "a hard stop whose distress fell must still read as a hard stop");
  assert.equal(adverse.valueText, "distress rose across two sets");
  assert.equal(adverse.evidenceClass, "system_event");
  // Both rows stand. Nothing reconciles them.
  assert.ok(obs.some((o) => o.outcomeType === "within_encounter" && o.direction === "decrease"));
});

// ---------------------------------------------------------------------------
// Missingness (§6)
// ---------------------------------------------------------------------------

test("a session with no post-session check reports the window, never recovery", async () => {
  await syncInterventionInstances(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);
  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-a")!;
  const obs = await observationsForInstance(ctx, inst.id);

  assert.ok(missingWindowsFor(inst, obs).includes("post_session"));
  assert.equal(
    obs.filter((o) => o.windowType === "post_session").length, 0,
    "an absent check must not manufacture a recovery row"
  );
});

test("a check that says NOT recovered is recorded as such, not as a gap", async () => {
  aPostCheck({ id: "pc-1", sessionId: "s-a", distress: 6, recovered: false, day: "2026-08-01" });
  await syncResponseObservations(ctx, T.patient);
  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-a")!;
  const obs = await observationsForInstance(ctx, inst.id);

  const recovery = obs.find((o) => o.unit === "recovery_confirmed")!;
  assert.ok(recovery);
  assert.equal(recovery.valueNum, 0);
  assert.equal(recovery.direction, "increase", "not having come back yet is burden, not relief");
  assert.ok(!missingWindowsFor(inst, obs).includes("post_session"), "a recorded 'no' is not missing");
});

// delayed_risk is a 0-10 scale ("how likely are nightmares, urges, or shutdown
// tonight?"), not a flag. Treating any non-zero answer as adverse would mark
// almost every session, which §11 forbids: "do not turn a single difficult
// session into a Command Center work item."
test("a delayed-risk score below the escalation threshold is a reading, not an adverse event", async () => {
  aPostCheck({ id: "pc-2", sessionId: "s-c", distress: 7, recovered: false, delayedRisk: 3, day: "2026-08-08" });
  await syncResponseObservations(ctx, T.patient);
  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-c")!;
  const obs = await observationsForInstance(ctx, inst.id);

  const reading = obs.find((o) => o.unit === "delayed_risk")!;
  assert.ok(reading, "the number is recorded as a number");
  assert.equal(reading.valueNum, 3);
  assert.equal(reading.outcomeType, "recovery_burden");
  assert.ok(
    !obs.some((o) => o.outcomeType === "adverse_or_hard_stop" && o.sourceType === "post_session_check_risk_high"),
    "a 3 out of 10 is not an adverse event"
  );
});

test("a delayed-risk score at the app's own escalation threshold is adverse", async () => {
  assert.equal(DELAYED_RISK_ESCALATION, 8, "the response record must not invent a second threshold");
  aSession({ id: "s-risk", pre: 6, post: 5, day: "2026-08-10" });
  await syncInterventionInstances(ctx, T.patient);
  aPostCheck({ id: "pc-3", sessionId: "s-risk", distress: 7, recovered: false, delayedRisk: 9, day: "2026-08-10" });
  await syncResponseObservations(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);
  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-risk")!;
  const obs = await observationsForInstance(ctx, inst.id);
  assert.ok(obs.some((o) => o.outcomeType === "adverse_or_hard_stop" && o.windowType === "post_session"));
});

// Reading a response backwards makes an immediate drop look like a next-day
// recovery, which is a different clinical story told with the same rows.
test("observations read in window order, not newest first", async () => {
  // The order is asserted against the LITERAL sequence, not against
  // WINDOW_ORDER itself — comparing the table with itself passes whatever the
  // table says, including backwards.
  assert.deepEqual(
    (Object.keys(WINDOW_ORDER) as WindowType[]).sort((a, b) => WINDOW_ORDER[a] - WINDOW_ORDER[b]),
    ["immediate", "post_session", "same_day", "next_day", "multi_day", "functional"],
    "during it, then the hours after, then the days, then their life"
  );

  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-a")!;
  const ordered = inWindowOrder(await observationsForInstance(ctx, inst.id));
  const first = ordered.findIndex((o) => o.windowType === "immediate");
  const later = ordered.findIndex((o) => o.windowType === "post_session");
  assert.ok(first >= 0 && later >= 0);
  assert.ok(first < later, "what happened during it is read before what happened after it");
});

// §6's forbidden words, on the strings a clinician actually reads.
test("no rendered observation makes a claim about the intervention", async () => {
  const all = await observationsForPerson(ctx, T.patient);
  assert.ok(all.length > 0);
  for (const o of all) {
    const text = describeObservation(o).toLowerCase();
    for (const word of ["work", "effective", "caused", "helped", "because", "due to", "thanks to"]) {
      assert.ok(!text.includes(word), `"${text}" must not say "${word}"`);
    }
  }
});

test("a clinician's own entry expects no windows and is never called incomplete", async () => {
  const entry = await recordClinicianIntervention(ctx, {
    personId: T.patient, wording: "Cold water at the sink",
    interventionClass: "external_clinician_entered",
    occurredAt: "2026-08-11 14:00:00", clinicianId: T.clinician,
  });
  assert.deepEqual(EXPECTED_WINDOWS.clinician_entry, undefined);
  assert.deepEqual(missingWindowsFor(entry, []), []);
});

// ---------------------------------------------------------------------------
// Mixed (§6's exact case)
// ---------------------------------------------------------------------------

test("an immediate decrease plus next-day worsening reads as mixed and is never netted", async () => {
  aSession({ id: "s-d", pre: 8, post: 3, day: "2026-08-14" });
  aCheckin({ id: "ck-1", date: "2026-08-14", activation: 4, sleep: 6 });
  aCheckin({ id: "ck-2", date: "2026-08-15", activation: 8, sleep: 3 });
  await syncInterventionInstances(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);

  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-d")!;
  const obs = await observationsForInstance(ctx, inst.id);

  const immediate = obs.find((o) => o.windowType === "immediate")!;
  const nextDay = obs.find((o) => o.windowType === "next_day" && o.outcomeType === "recovery_burden")!;
  assert.equal(immediate.direction, "decrease");
  assert.equal(nextDay.direction, "increase");
  assert.equal(isMixed(obs), true);

  // The two readings stay two readings. There is no row, and no function, that
  // turns -5 and +4 into one number.
  assert.equal(immediate.valueNum, -5);
  assert.equal(nextDay.valueNum, 8);
  assert.notEqual(immediate.windowType, nextDay.windowType);
});

// Compared through isSettling, not the raw sign — otherwise a settled night
// after a settled session reads as a disagreement.
test("sleep improving alongside distress falling is not mixed", async () => {
  aSession({ id: "s-e", pre: 7, post: 4, day: "2026-08-18" });
  aCheckin({ id: "ck-3", date: "2026-08-18", activation: 6, sleep: 3 });
  aCheckin({ id: "ck-4", date: "2026-08-19", activation: 4, sleep: 7 });
  await syncInterventionInstances(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);

  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-e")!;
  const obs = await observationsForInstance(ctx, inst.id);
  const sleep = obs.find((o) => o.outcomeType === "sleep_after")!;
  assert.equal(sleep.direction, "increase");
  assert.equal(isSettling("sleep_after", sleep.direction), true);
  assert.equal(isMixed(obs), false, "both dimensions moved toward settled");
});

test("a next-day check-in with no day-of reading has a state and no direction", async () => {
  aSession({ id: "s-f", pre: 5, post: 4, day: "2026-08-22" });
  aCheckin({ id: "ck-5", date: "2026-08-23", activation: 7, sleep: 4 });
  await syncInterventionInstances(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);

  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-f")!;
  const obs = await observationsForInstance(ctx, inst.id);
  const nextDay = obs.find((o) => o.windowType === "next_day" && o.outcomeType === "recovery_burden")!;
  assert.equal(nextDay.valueNum, 7);
  assert.equal(nextDay.direction, null, "there is nothing to compare it against");
  assert.equal(nextDay.valueText, null);
});

// ---------------------------------------------------------------------------
// The functional window (§5, §10)
// ---------------------------------------------------------------------------

test("only accepted goal observations reach the functional window", async () => {
  db.prepare(
    `INSERT OR IGNORE INTO return_to_life_goals
       (id, tenant_id, person_id, title, patient_statement, domain, status, created_by_person_id)
     VALUES ('g-1', ?, ?, 'x', 'x', 'daily_living', 'active', ?)`
  ).run(T.tenant, T.patient, T.clinician);
  const insObs = db.prepare(
    `INSERT OR REPLACE INTO return_to_life_observations
       (id, tenant_id, person_id, goal_id, observed_level, evidence_class, source_type,
        source_id, occurred_at, status)
     VALUES (?, ?, ?, 'g-1', ?, ?, 'manual', 'x', ?, ?)`
  );
  insObs.run("go-acc", T.tenant, T.patient, 0, "clinician_observed", "2026-08-20 09:00:00", "accepted");
  insObs.run("go-prop", T.tenant, T.patient, 1, "model_candidate", "2026-08-21 09:00:00", "proposed");

  await syncInterventionInstances(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);
  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-e")!;
  const obs = await observationsForInstance(ctx, inst.id);
  const functional = obs.filter((o) => o.windowType === "functional");

  assert.ok(functional.some((o) => o.sourceId === "go-acc"), "an accepted observation attaches");
  assert.ok(
    !functional.some((o) => o.sourceId === "go-prop"),
    "a model candidate proposes evidence and must not become response evidence"
  );
  assert.equal(functional.find((o) => o.sourceId === "go-acc")!.evidenceClass, "clinician_observation");
  assert.equal(functional.find((o) => o.sourceId === "go-acc")!.direction, null);
});

test("a functional observation outside the window does not attach", async () => {
  db.prepare(
    `INSERT OR REPLACE INTO return_to_life_observations
       (id, tenant_id, person_id, goal_id, observed_level, evidence_class, source_type,
        source_id, occurred_at, status)
     VALUES ('go-far', ?, ?, 'g-1', 1, 'clinician_observed', 'manual', 'x', '2026-12-01 09:00:00', 'accepted')`
  ).run(T.tenant, T.patient);
  await syncResponseObservations(ctx, T.patient);
  const all = await observationsForPerson(ctx, T.patient);
  assert.ok(
    !all.some((o) => o.sourceId === "go-far"),
    `nothing ${FUNCTIONAL_WINDOW_DAYS}+ days later attaches to an exposure`
  );
});

// ---------------------------------------------------------------------------
// Idempotency, events, tenancy
// ---------------------------------------------------------------------------

test("re-running the adapters does not double the evidence behind a pattern", async () => {
  const before = (await observationsForPerson(ctx, T.patient)).length;
  await syncResponseObservations(ctx, T.patient);
  await syncResponseObservations(ctx, T.patient);
  assert.equal((await observationsForPerson(ctx, T.patient)).length, before);
});

test("one event per new observation, carrying the window and never a magnitude", async () => {
  const events = await readEvents({ personId: T.patient, types: ["intervention.response_observed"] });
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.ok(WINDOW_TYPES.includes(e.payload.windowType as never), "the window travels");
    assert.ok(
      !("valueNum" in e.payload) && !("value" in e.payload),
      "a magnitude in the ledger is a magnitude something can net"
    );
    assert.notEqual(e.actor_type, "model");
  }
});

test("observations are invisible from another tenant", async () => {
  const obs = (await observationsForPerson(ctx, T.patient))[0];
  assert.ok(obs);
  assert.deepEqual(await observationsForPerson(otherCtx, T.patient), []);
  assert.deepEqual(await observationsForInstance(otherCtx, obs.instanceId), []);
});

test("an observation cannot be attached to another tenant's exposure", async () => {
  const inst = (await listInstances(ctx, T.patient))[0];
  await assert.rejects(
    () => recordObservation(otherCtx, {
      personId: T.patient, instanceId: inst.id,
      outcomeType: "within_encounter", windowType: "immediate",
      evidenceClass: "measured", sourceType: "x", sourceId: "x",
      occurredAt: "2026-08-01 10:00:00",
    }),
    ResponseObservationError
  );
});

test("a person with no check-ins gets no next-day rows invented for them", async () => {
  const instances = await listInstances(ctx, T.patient);
  const made = await syncNextDayResponses(ctx, "nobody-at-all", instances);
  assert.deepEqual(made, []);
  const fn = await syncFunctionalResponses(ctx, "nobody-at-all", []);
  assert.deepEqual(fn, []);
});
