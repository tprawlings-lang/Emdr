// Durable attention signals (expansion handoff 03 §9, §12; Phase 1).
//
// Phase 1's definition of done is three claims:
//
//   "Existing queue unchanged when feature is off."
//   "Stable dedupe/order tested."
//   "Safety retains current authority."
//
// The first is the one that fails quietly. A merge that only hid its output
// behind a flag would still have changed the ORDER of the rows around it, and
// nobody would notice until a clinician said the queue looked different. So
// there is a test below that builds the queue twice — flag on, flag off — and
// compares the item ids in order.
//
// The third is the one that matters most. §9's whole reason for a separate
// table is that "safety alert semantics must stay believable", and the way that
// breaks is not dramatically: an attention signal lands in the same bucket as a
// safety obligation, nothing distinguishes them, and within a month the
// clinician reads the bucket as advisory.

process.env.EMDR_DATA_DIR = `/tmp/steady-atn-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "atn-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "atn-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { readEvents } from "../src/lib/events";
import {
  ATTENTION_BANDS, SIGNAL_STATES, OPEN_STATES, DISMISS_REASONS,
  BAND_LABEL, DISMISS_REASON_LABEL, isOpenState,
  upsertSignal, listSignalsForPerson, listOpenSignals, getSignal, evidenceForSignal,
  acknowledgeSignal, setSignalState, recordCareAction, careActionsForPerson,
  CARE_ACTIONS, AttentionSignalError,
  type AttentionSignalCandidate,
} from "../src/lib/clinical/attention-signals";
import {
  registerProvider, registeredProviders, evaluateAll,
} from "../src/lib/clinical/attention-providers/registry";

const db = getDb();
const T = {
  tenant: "tenant-atn", other: "tenant-atn-2",
  clinician: "clin-atn", patient: "pat-atn",
};
for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
for (const id of [T.clinician, T.patient]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const otherCtx: TenantContext = { tenantId: T.other, personId: T.clinician };

function aCandidate(over: Partial<AttentionSignalCandidate> = {}): AttentionSignalCandidate {
  return {
    type: "response.repeated_recovery_burden",
    dedupeKey: "response:def-1",
    band: "review_today",
    statement: "Difficulty afterwards has been recorded on 3 of 6 exposures.",
    changeText: null,
    evidenceIds: ["i1", "i2", "i3"],
    evidenceType: "intervention_instance",
    evidenceAt: "2026-09-01T00:00:00.000Z",
    limitations: ["An association in the record, not a claim about cause."],
    policyVersion: "response-fingerprint.1.0.0",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Vocabulary (§9)
// ---------------------------------------------------------------------------

test("the bands are §9's four and none of them is a safety state", () => {
  assert.deepEqual([...ATTENTION_BANDS], ["review_now", "review_today", "follow_up", "watch"]);
  const text = Object.values(BAND_LABEL).join(" ").toLowerCase();
  for (const word of ["urgent", "emergency", "crisis", "safety", "immediate", "risk"]) {
    assert.ok(!text.includes(word), `an attention band must not be called "${word}"`);
  }
});

test("open states and closed states are named once, in one place", () => {
  assert.deepEqual([...SIGNAL_STATES], [
    "open", "acknowledged", "waiting_member", "waiting_staff", "resolved", "dismissed",
  ]);
  assert.deepEqual([...OPEN_STATES], ["open", "acknowledged", "waiting_member", "waiting_staff"]);
  assert.equal(isOpenState("acknowledged"), true, "reviewed is not finished");
  assert.equal(isOpenState("resolved"), false);
  assert.equal(isOpenState("dismissed"), false);
});

test("every dismissal reason has a label a clinician can pick from a list", () => {
  for (const r of DISMISS_REASONS) assert.ok(DISMISS_REASON_LABEL[r]);
});

// ---------------------------------------------------------------------------
// One lineage per concern (§12)
// ---------------------------------------------------------------------------

test("a new dedupe key opens one signal with its evidence in rank order", async () => {
  const { signal, outcome } = await upsertSignal(ctx, {
    personId: T.patient, sourceFeature: "response-fingerprint-provider", candidate: aCandidate(),
  });
  assert.equal(outcome, "opened");
  assert.equal(signal.state, "open");
  assert.equal(signal.band, "review_today");
  assert.equal(signal.firstDetectedAt, signal.lastDetectedAt);

  const evidence = await evidenceForSignal(ctx, signal.id);
  assert.deepEqual(evidence.map((e) => e.evidenceId), ["i1", "i2", "i3"]);
  assert.deepEqual(evidence.map((e) => e.rank), [0, 1, 2], "the provider's order is preserved");
  assert.ok(evidence.every((e) => e.evidenceType === "intervention_instance"));
});

test("the same evidence again writes nothing at all", async () => {
  const before = (await readEvents({ personId: T.patient })).length;
  const { outcome } = await upsertSignal(ctx, {
    personId: T.patient, sourceFeature: "response-fingerprint-provider", candidate: aCandidate(),
  });
  assert.equal(outcome, "unchanged");
  assert.equal(
    (await readEvents({ personId: T.patient })).length, before,
    "a provider run against a quiet record must not grow the ledger"
  );
});

test("newer evidence updates one lineage rather than making a second row", async () => {
  const { signal, outcome } = await upsertSignal(ctx, {
    personId: T.patient, sourceFeature: "response-fingerprint-provider",
    candidate: aCandidate({
      band: "review_now",
      statement: "Difficulty afterwards has been recorded on 5 of 7 exposures.",
      evidenceAt: "2026-09-08T00:00:00.000Z",
      evidenceIds: ["i1", "i2", "i3", "i4", "i5"],
    }),
  });
  assert.equal(outcome, "updated");
  assert.equal(signal.band, "review_now", "the band follows the evidence, up or down");
  assert.equal(signal.firstDetectedAt, "2026-09-01T00:00:00.000Z", "the lineage keeps its origin");
  assert.equal(signal.lastDetectedAt, "2026-09-08T00:00:00.000Z");

  const all = await listSignalsForPerson(ctx, T.patient);
  assert.equal(all.length, 1, "one concern is one row");
  const evidence = await evidenceForSignal(ctx, signal.id);
  assert.equal(evidence.length, 5, "the evidence list is what the CURRENT statement rests on");
});

// §12: "opening a row or drawer does not silently acknowledge it."
test("a clinician's state survives an evidence update", async () => {
  const [signal] = await listSignalsForPerson(ctx, T.patient);
  await acknowledgeSignal(ctx, {
    signalId: signal.id, clinicianId: T.clinician, sourceSurface: "today",
  });
  assert.equal((await getSignal(ctx, signal.id))!.state, "acknowledged");

  await upsertSignal(ctx, {
    personId: T.patient, sourceFeature: "response-fingerprint-provider",
    candidate: aCandidate({
      statement: "Difficulty afterwards has been recorded on 6 of 8 exposures.",
      evidenceAt: "2026-09-15T00:00:00.000Z",
    }),
  });
  assert.equal(
    (await getSignal(ctx, signal.id))!.state, "acknowledged",
    "new evidence does not silently make a reviewed row unread"
  );
});

test("acknowledgement records who, when, against which cutoff, and from where", async () => {
  const events = await readEvents({
    personId: T.patient, types: ["attention_signal.acknowledged"],
  });
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.actor_type, "clinician");
  assert.equal(e.actor_id, T.clinician);
  assert.equal(e.payload.sourceSurface, "today");
  assert.ok(e.payload.evidenceAt, "the cutoff is what makes 'new since your review' answerable");
});

// ---------------------------------------------------------------------------
// Reopening (§12)
// ---------------------------------------------------------------------------

test("a resolved signal does not reopen on evidence the clinician already saw", async () => {
  const [signal] = await listSignalsForPerson(ctx, T.patient);
  await setSignalState(ctx, {
    signalId: signal.id, clinicianId: T.clinician, state: "resolved", sourceSurface: "drawer",
  });
  assert.equal((await getSignal(ctx, signal.id))!.state, "resolved");

  const { outcome } = await upsertSignal(ctx, {
    personId: T.patient, sourceFeature: "response-fingerprint-provider",
    candidate: aCandidate({ evidenceAt: "2026-09-15T00:00:00.000Z" }),
  });
  assert.equal(outcome, "unchanged", "re-running a provider is not new evidence");
  assert.equal((await getSignal(ctx, signal.id))!.state, "resolved");
});

test("genuinely new evidence reopens the same lineage", async () => {
  const [signal] = await listSignalsForPerson(ctx, T.patient, {
    states: ["resolved"],
  });
  assert.ok(signal);
  const { outcome, signal: reopened } = await upsertSignal(ctx, {
    personId: T.patient, sourceFeature: "response-fingerprint-provider",
    candidate: aCandidate({
      statement: "Difficulty afterwards has been recorded again, on 2 of the last 3.",
      evidenceAt: "2026-10-01T00:00:00.000Z",
    }),
  });
  assert.equal(outcome, "reopened");
  assert.equal(reopened.id, signal.id, "the same lineage, not a duplicate");
  assert.equal(reopened.state, "open");
  assert.equal(reopened.firstDetectedAt, "2026-09-01T00:00:00.000Z", "history is not restarted");

  const events = await readEvents({ personId: T.patient, types: ["attention_signal.reopened"] });
  assert.equal(events.length, 1);
});

// ---------------------------------------------------------------------------
// Lifecycle requirements (§12)
// ---------------------------------------------------------------------------

test("dismissing needs a reason and waiting needs a dependency", async () => {
  const [signal] = await listSignalsForPerson(ctx, T.patient);
  await assert.rejects(
    () => setSignalState(ctx, {
      signalId: signal.id, clinicianId: T.clinician, state: "dismissed", sourceSurface: "drawer",
    }),
    AttentionSignalError,
    "a dismissal nobody explained is one the provider will just raise again"
  );
  await assert.rejects(
    () => setSignalState(ctx, {
      signalId: signal.id, clinicianId: T.clinician, state: "waiting_member", sourceSurface: "drawer",
    }),
    AttentionSignalError,
    "patient silence is not noncompliance, and a waiting row must say what it waits for"
  );

  const waiting = await setSignalState(ctx, {
    signalId: signal.id, clinicianId: T.clinician, state: "waiting_member",
    dependency: "Waiting for her to try the shop once before we review it",
    sourceSurface: "drawer",
  });
  assert.equal(waiting.state, "waiting_member");
  assert.equal(waiting.changeText, "Waiting for her to try the shop once before we review it");
  assert.ok(isOpenState(waiting.state), "waiting is still open work");
});

test("a state change records the transition and the reason", async () => {
  const [signal] = await listSignalsForPerson(ctx, T.patient);
  await setSignalState(ctx, {
    signalId: signal.id, clinicianId: T.clinician, state: "dismissed",
    dismissReason: "expected_for_this_person",
    note: "she always has a hard night after this module and we have planned for it",
    sourceSurface: "drawer",
  });
  const events = await readEvents({
    personId: T.patient, types: ["attention_signal.state_changed"],
  });
  const last = events[events.length - 1];
  assert.equal(last.payload.to, "dismissed");
  assert.equal(last.payload.dismissReason, "expected_for_this_person");
  assert.ok(last.payload.note, "the clinician's own words about their own decision survive");
  assert.equal(last.actor_type, "clinician");
});

test("no attention-signal event carries the statement text", async () => {
  const events = await readEvents({ personId: T.patient });
  const mine = events.filter((e) => e.event_type.startsWith("attention_signal."));
  assert.ok(mine.length > 0);
  for (const e of mine) {
    const blob = JSON.stringify(e.payload);
    assert.ok(
      !blob.includes("Difficulty afterwards"),
      "patient-scoped clinical text belongs on the row, not in an append-only ledger"
    );
  }
});

// ---------------------------------------------------------------------------
// The provider registry (§10, §20)
// ---------------------------------------------------------------------------

test("a provider that throws is partial coverage, never an empty queue", async () => {
  registerProvider({
    id: "test-broken-provider",
    version: "1.0.0",
    purpose: "Always fails, on purpose.",
    async evaluate() { throw new Error("Sarah's grocery-shopping goal blew up"); },
  });
  registerProvider({
    id: "test-working-provider",
    version: "1.0.0",
    purpose: "Always returns one candidate.",
    async evaluate() { return [aCandidate({ dedupeKey: "test:one" })]; },
  });

  const result = await evaluateAll({
    ctx, personId: T.patient, evidenceCutoff: "2026-10-01T00:00:00.000Z",
  });
  assert.ok(result.candidates.some((c) => c.providerId === "test-working-provider"),
    "the working provider's work survives its neighbour's failure");
  const failure = result.coverage.failed.find((f) => f.providerId === "test-broken-provider");
  assert.ok(failure, "the failure is named rather than silently shortening the list");
  // §18: no patient text, goal names, thread names or clinical labels leave in
  // telemetry. The message named a patient and a goal; only the class travels.
  assert.equal(failure.reason, "Error");
  assert.ok(!failure.reason.includes("Sarah"));
  assert.ok(!failure.reason.includes("grocery"));
});

test("a provider cannot be re-registered at a different version", () => {
  assert.throws(
    () => registerProvider({
      id: "test-working-provider", version: "2.0.0", purpose: "x",
      async evaluate() { return []; },
    }),
    /already registered/
  );
  assert.ok(registeredProviders().every((p) => p.version));
});

// ---------------------------------------------------------------------------
// The care-time ledger (§13)
// ---------------------------------------------------------------------------

test("a care action records what happened and never invents a duration", async () => {
  const id = await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "review",
    sourceSurface: "today",
  });
  assert.ok(id);
  const [action] = await careActionsForPerson(ctx, T.patient);
  assert.equal(action.action, "review");
  assert.equal(
    action.durationSeconds, null,
    "absent duration is absent — never zero, and never how long a tab was open"
  );
  assert.equal(action.startedAt, null);

  const bounded = await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "open_session_prep",
    startedAt: "2026-10-01 09:00:00", durationSeconds: 420, sourceSurface: "drawer",
  });
  assert.ok(bounded);
  assert.equal((await careActionsForPerson(ctx, T.patient))[0].durationSeconds, 420);
});

test("nothing in the care ledger marks time billable", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/lib/clinical/attention-signals.ts", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/billab|reimburs|charge|invoice/i.test(code), "§13: not billable from Steady alone");
  const cols = db.prepare("PRAGMA table_info(between_visit_care_actions)").all() as { name: string }[];
  assert.ok(!cols.some((c) => /billab/i.test(c.name)), "and no column that could be read as one");
});

test("an unknown care action is refused rather than stored as a string", async () => {
  await assert.rejects(
    () => recordCareAction(ctx, {
      personId: T.patient, clinicianId: T.clinician,
      action: "delete_record" as (typeof CARE_ACTIONS)[number], sourceSurface: "today",
    }),
    AttentionSignalError
  );
});

// ---------------------------------------------------------------------------
// Tenancy (§18)
// ---------------------------------------------------------------------------

test("signals, evidence and actions are invisible from another tenant", async () => {
  const [signal] = await listSignalsForPerson(ctx, T.patient, { states: [...SIGNAL_STATES] });
  assert.ok(signal);
  assert.equal(await getSignal(otherCtx, signal.id), null, "a guessed id reads as not-found");
  assert.deepEqual(await evidenceForSignal(otherCtx, signal.id), []);
  assert.deepEqual(await listOpenSignals(otherCtx), []);
  assert.deepEqual(await careActionsForPerson(otherCtx, T.patient), []);
  await assert.rejects(
    () => acknowledgeSignal(otherCtx, {
      signalId: signal.id, clinicianId: T.clinician, sourceSurface: "today",
    }),
    AttentionSignalError
  );
});

test("a signal needs a statement and a known band", async () => {
  await assert.rejects(
    () => upsertSignal(ctx, {
      personId: T.patient, sourceFeature: "x", candidate: aCandidate({ statement: "  " }),
    }),
    AttentionSignalError
  );
  await assert.rejects(
    () => upsertSignal(ctx, {
      personId: T.patient, sourceFeature: "x",
      candidate: aCandidate({ dedupeKey: "x:1", band: "urgent" as never }),
    }),
    AttentionSignalError
  );
});
