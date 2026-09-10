// The intervention ontology and instance reconstruction (expansion handoff 02,
// Phase 1).
//
// Phase 1's definition of done is two claims, and only one of them is the kind
// a passing screen demonstrates:
//
//   "Instances reconstruct from source events."
//   "No benefit labels yet."
//
// The second is the one that needs a test, because nothing fails when it is
// broken. A module that starts quietly recording "improved" alongside an
// exposure looks exactly like one that does not, until §6's thresholds are
// bypassed by a number that was already there. So the tests below check what
// the instance layer REFUSES to carry as carefully as what it carries.
//
// And one that matters more than it looks: a hard-stopped session is an
// intervention instance. §13 requires hard stops and missing closes to stay
// visible, and the easy, natural, wrong implementation of "reconstruct sessions"
// is `WHERE status = 'completed'` — which produces a record of the sessions that
// went well, under the name "sessions".

process.env.EMDR_DATA_DIR = `/tmp/steady-rfi-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "rfi-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "rfi-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { readEvents } from "../src/lib/events";
import {
  INTERVENTION_CLASSES, CLASS_LABEL, CLASS_NOTE, isInterventionClass,
  normalizeCanonicalKey, nativeKey, InterventionError,
  ensureDefinition, listDefinitions, renameDefinition,
  recordInstance, listInstances, getInstance, confirmInstance, remapInstance,
  syncSessionInstances, syncPracticeInstances, syncInterventionInstances,
  recordClinicianIntervention,
} from "../src/lib/clinical/interventions";

const db = getDb();
const T = {
  tenant: "tenant-rfi", other: "tenant-rfi-2",
  clinician: "clin-rfi", patient: "pat-rfi", stranger: "pat-rfi-other",
};
for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
for (const id of [T.clinician, T.patient, T.stranger]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
  db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'X', 'member', 'x')")
    .run(id, `${id}@example.test`);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const otherCtx: TenantContext = { tenantId: T.other, personId: T.clinician };

function aSession(args: {
  id: string; moduleId: string; status: string;
  pre: number | null; post: number | null; startedAt: string; endedAt?: string | null;
  hardStopReason?: string | null; userId?: string;
}) {
  db.prepare(
    `INSERT OR REPLACE INTO therapy_sessions
       (id, user_id, tenant_id, module_id, status, pre_suds, post_suds, hard_stop_reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.id, args.userId ?? T.patient, T.tenant, args.moduleId, args.status,
    args.pre, args.post, args.hardStopReason ?? null, args.startedAt, args.endedAt ?? null
  );
}

function aPractice(args: {
  id: string; practiceId: string; practiceType: string; durationSec: number; createdAt: string;
}) {
  db.prepare(
    `INSERT OR REPLACE INTO practice_completions
       (id, user_id, tenant_id, practice_id, practice_type, duration_sec, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(args.id, T.patient, T.tenant, args.practiceId, args.practiceType, args.durationSec, args.createdAt);
}

// ---------------------------------------------------------------------------
// The ontology (§2)
// ---------------------------------------------------------------------------

test("the ontology is §2's seven classes, closed", () => {
  assert.deepEqual([...INTERVENTION_CLASSES], [
    "grounding", "resourcing", "structured_practice", "session_intervention",
    "companion_support", "behavioral_action", "external_clinician_entered",
  ]);
  for (const cls of INTERVENTION_CLASSES) {
    assert.ok(CLASS_LABEL[cls], `${cls} needs a label`);
    assert.ok(CLASS_NOTE[cls], `${cls} needs a description a clinician can read`);
  }
  assert.equal(isInterventionClass("grounding"), true);
  assert.equal(isInterventionClass("effective"), false);
});

// §6: never use "works", "effective treatment", "caused improvement",
// "contraindicated" without an independent clinician-authored judgement. The
// vocabulary is what every surface renders, so the ban is checkable here rather
// than in a screenshot.
test("no class label or note carries a benefit or efficacy word", () => {
  const banned = [
    "works", "effective", "efficac", "caused", "causes", "contraindicat",
    "beneficial", "successful", "cure",
  ];
  const text = [
    ...Object.values(CLASS_LABEL), ...Object.values(CLASS_NOTE),
  ].join(" ").toLowerCase();
  for (const word of banned) {
    assert.ok(!text.includes(word), `the vocabulary must not say "${word}"`);
  }
});

test("canonical keys are deterministic and lossy in the same direction", () => {
  assert.equal(normalizeCanonicalKey("Cold  Water!"), "cold_water");
  assert.equal(normalizeCanonicalKey("cold water"), "cold_water");
  assert.equal(normalizeCanonicalKey("  Cold-Water  "), "cold_water");
  // Not synonymy: §8 reserves that judgement for a person.
  assert.notEqual(normalizeCanonicalKey("ice dive"), normalizeCanonicalKey("cold water"));
  assert.throws(() => normalizeCanonicalKey("   !!!  "), InterventionError);
});

test("native keys are namespaced so a clinician's wording cannot collide with a module", () => {
  assert.equal(nativeKey("module", "calm-place"), "module.calm_place");
  assert.equal(nativeKey("practice", "calm-place"), "practice.calm_place");
  assert.notEqual(nativeKey("module", "calm-place"), normalizeCanonicalKey("calm place"));
});

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test("ensureDefinition is idempotent within a tenant and separate across them", async () => {
  const a = await ensureDefinition(ctx, {
    canonicalKey: "cold_water", displayName: "Cold water", interventionClass: "grounding",
  });
  const b = await ensureDefinition(ctx, {
    canonicalKey: "cold_water", displayName: "Something else entirely", interventionClass: "resourcing",
  });
  assert.equal(a.id, b.id, "the same key in one tenant is the same definition");
  // A caller must not rename an intervention as a side effect of recording one.
  assert.equal(b.displayName, "Cold water");
  assert.equal(b.interventionClass, "grounding");

  const foreign = await ensureDefinition(otherCtx, {
    canonicalKey: "cold_water", displayName: "Cold water", interventionClass: "grounding",
  });
  assert.notEqual(foreign.id, a.id, "a canonical vocabulary is an organizational agreement");
  const mine = await listDefinitions(ctx);
  assert.ok(!mine.some((d) => d.id === foreign.id), "the other tenant's definition is invisible");
});

test("renaming moves the display name and never the key", async () => {
  const d = await ensureDefinition(ctx, {
    canonicalKey: "paced_breathing", displayName: "Paced breathing", interventionClass: "grounding",
  });
  await renameDefinition(ctx, d.id, "Slow breathing");
  const again = await ensureDefinition(ctx, {
    canonicalKey: "paced_breathing", displayName: "ignored", interventionClass: "grounding",
  });
  assert.equal(again.id, d.id);
  assert.equal(again.displayName, "Slow breathing");
  await assert.rejects(() => renameDefinition(ctx, d.id, "   "), InterventionError);
});

// ---------------------------------------------------------------------------
// Reconstruction (§10, §12 Phase 1)
// ---------------------------------------------------------------------------

test("sessions reconstruct into instances, and re-running does not duplicate them", async () => {
  aSession({ id: "s-1", moduleId: "calm-place", status: "completed", pre: 6, post: 3, startedAt: "2026-08-01 10:00:00", endedAt: "2026-08-01 10:40:00" });
  aSession({ id: "s-2", moduleId: "calm-place", status: "completed", pre: 7, post: 4, startedAt: "2026-08-08 10:00:00", endedAt: "2026-08-08 10:35:00" });

  const first = await syncSessionInstances(ctx, T.patient);
  assert.equal(first.length, 2);
  const again = await syncSessionInstances(ctx, T.patient);
  assert.equal(again.length, 2);

  const stored = await listInstances(ctx, T.patient);
  assert.equal(
    stored.filter((i) => i.sourceType === "therapy_session").length, 2,
    "a support count must not be a function of how often the adapter ran"
  );
});

// The one that matters. §13: "session response keeps hard stops and missing
// closes visible."
test("a hard-stopped session is an instance, with its status in context", async () => {
  aSession({
    id: "s-3", moduleId: "resourcing", status: "hard_stop", pre: 8, post: 9,
    startedAt: "2026-08-15 10:00:00", endedAt: "2026-08-15 10:12:00",
    hardStopReason: "distress rose across two sets",
  });
  aSession({
    id: "s-4", moduleId: "resourcing", status: "abandoned", pre: 5, post: null,
    startedAt: "2026-08-22 10:00:00",
  });

  await syncSessionInstances(ctx, T.patient);
  const stored = await listInstances(ctx, T.patient);

  const hardStop = stored.find((i) => i.sourceId === "s-3");
  assert.ok(hardStop, "a hard stop is an exposure that happened");
  assert.equal(hardStop.context.hardStop, true);
  assert.equal(hardStop.context.hardStopReason, "distress rose across two sets");

  const abandoned = stored.find((i) => i.sourceId === "s-4");
  assert.ok(abandoned, "a session left early is still a session that happened");
  assert.equal(abandoned.context.missingClose, true);
  assert.equal(abandoned.context.completed, false);
});

// §12 Phase 1: "no benefit labels yet." The close reading is an OUTCOME and
// belongs to Phase 2's windowed observations. If it leaks into an instance's
// context, a Phase 1 surface can render a before-and-after with no threshold,
// no window and no evidence class in front of it.
test("an instance carries the circumstances and never the outcome", async () => {
  await syncSessionInstances(ctx, T.patient);
  const stored = await listInstances(ctx, T.patient);
  for (const i of stored.filter((x) => x.sourceType === "therapy_session")) {
    const keys = Object.keys(i.context).concat(Object.keys(i.dose)).join(" ").toLowerCase();
    const blob = JSON.stringify({ dose: i.dose, context: i.context }).toLowerCase();
    for (const banned of ["post_suds", "postsuds", "activationatclose", "change", "improve", "benefit", "helped", "effective"]) {
      assert.ok(!keys.includes(banned) && !blob.includes(`"${banned}"`), `an instance must not carry "${banned}"`);
    }
    assert.ok(
      !("activationAtClose" in i.context),
      "the close reading is a Phase 2 response observation, not Phase 1 context"
    );
  }
});

test("practices reconstruct with a class that follows function, not delivery format", async () => {
  aPractice({ id: "p-1", practiceId: "orienting-to-now", practiceType: "meditation", durationSec: 180, createdAt: "2026-08-02 08:00:00" });
  aPractice({ id: "p-2", practiceId: "container", practiceType: "meditation", durationSec: 240, createdAt: "2026-08-03 21:00:00" });

  await syncPracticeInstances(ctx, T.patient);
  const defs = await listDefinitions(ctx);
  const orienting = defs.find((d) => d.canonicalKey === "practice.orienting_to_now");
  const container = defs.find((d) => d.canonicalKey === "practice.container");

  assert.ok(orienting && container);
  // Both are `type: "meditation"` in the catalog. They are not the same class.
  assert.equal(orienting.interventionClass, "grounding");
  assert.equal(container.interventionClass, "resourcing");
});

// The demo population generator writes its own coarse practice vocabulary. A
// grounding exercise filed as a structured practice would put thousands of
// generated people's evidence in the wrong class — and §6 strata are computed
// per intervention, so the error would be invisible rather than loud.
test("the population generator's own practice vocabulary is classified", async () => {
  aPractice({ id: "p-5", practiceId: "grounding", practiceType: "grounding", durationSec: 300, createdAt: "2026-08-05 08:00:00" });
  aPractice({ id: "p-6", practiceId: "breathing", practiceType: "breathing", durationSec: 300, createdAt: "2026-08-05 09:00:00" });
  aPractice({ id: "p-7", practiceId: "learning", practiceType: "learning", durationSec: 300, createdAt: "2026-08-05 10:00:00" });
  await syncPracticeInstances(ctx, T.patient);
  const defs = await listDefinitions(ctx);
  assert.equal(defs.find((d) => d.canonicalKey === "practice.grounding")!.interventionClass, "grounding");
  assert.equal(defs.find((d) => d.canonicalKey === "practice.breathing")!.interventionClass, "grounding");
  assert.equal(defs.find((d) => d.canonicalKey === "practice.learning")!.interventionClass, "structured_practice");
});

test("an unknown practice does not land in resourcing by accident", async () => {
  aPractice({ id: "p-3", practiceId: "brand-new-thing", practiceType: "meditation", durationSec: 120, createdAt: "2026-08-04 08:00:00" });
  aPractice({ id: "p-4", practiceId: "another-new-breath", practiceType: "breathwork", durationSec: 90, createdAt: "2026-08-04 09:00:00" });
  await syncPracticeInstances(ctx, T.patient);
  const defs = await listDefinitions(ctx);
  assert.equal(defs.find((d) => d.canonicalKey === "practice.brand_new_thing")!.interventionClass, "structured_practice");
  assert.equal(defs.find((d) => d.canonicalKey === "practice.another_new_breath")!.interventionClass, "grounding");
});

test("a full sync returns one timeline, newest first", async () => {
  const all = await syncInterventionInstances(ctx, T.patient);
  assert.ok(all.length >= 6);
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i - 1].occurredAt >= all[i].occurredAt, "the timeline is ordered");
  }
});

// ---------------------------------------------------------------------------
// Normalization is provisional; the exposure is not (§8)
// ---------------------------------------------------------------------------

test("adapter-created instances are unconfirmed; a clinician's own entry is not", async () => {
  const stored = await listInstances(ctx, T.patient);
  for (const i of stored.filter((x) => x.sourceType !== "clinician_entry")) {
    assert.equal(i.clinicianConfirmed, false, "an inferred identity waits on a person");
  }

  const entered = await recordClinicianIntervention(ctx, {
    personId: T.patient, wording: "Cold water at the sink",
    interventionClass: "external_clinician_entered",
    occurredAt: "2026-08-20 14:00:00", clinicianId: T.clinician,
    note: "after a difficult phone call",
  });
  assert.equal(entered.clinicianConfirmed, true, "the person who named it is the reviewer");
});

test("two clinician entries of the same intervention are two exposures", async () => {
  const a = await recordClinicianIntervention(ctx, {
    personId: T.patient, wording: "Walk around the block",
    interventionClass: "behavioral_action",
    occurredAt: "2026-08-21 14:00:00", clinicianId: T.clinician,
  });
  const b = await recordClinicianIntervention(ctx, {
    personId: T.patient, wording: "Walk around the block",
    interventionClass: "behavioral_action",
    occurredAt: "2026-08-28 14:00:00", clinicianId: T.clinician,
  });
  assert.notEqual(a.id, b.id, "a second entry must not idempotently overwrite the first");
  assert.equal(a.definitionId, b.definitionId, "and both count toward the same intervention");
});

test("a re-run refreshes context but never un-confirms a clinician's review", async () => {
  await confirmInstance(ctx, (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-4")!.id, T.clinician);
  // The session has since closed.
  aSession({ id: "s-4", moduleId: "resourcing", status: "completed", pre: 5, post: 2, startedAt: "2026-08-22 10:00:00", endedAt: "2026-08-22 10:30:00" });
  await syncSessionInstances(ctx, T.patient);
  const refreshed = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "s-4")!;
  assert.equal(refreshed.context.missingClose, false, "the context caught up");
  assert.equal(refreshed.clinicianConfirmed, true, "a person's review is not an adapter's to undo");
});

test("a correction appends the definition it moved away from", async () => {
  const inst = (await listInstances(ctx, T.patient)).find((i) => i.sourceId === "p-1")!;
  const target = await ensureDefinition(ctx, {
    canonicalKey: "cold_water", displayName: "Cold water", interventionClass: "grounding",
  });
  const before = inst.definitionId;
  await remapInstance(ctx, {
    instanceId: inst.id, toDefinitionId: target.id, clinicianId: T.clinician,
    reason: "she was describing the sink, not the app",
  });

  const after = await getInstance(ctx, inst.id);
  assert.equal(after!.definitionId, target.id);
  assert.equal(after!.clinicianConfirmed, true, "a correction is a review");

  const events = await readEvents({ personId: T.patient, types: ["response_fingerprint.pattern_corrected"] });
  const ev = events.find((e) => e.payload.instanceId === inst.id);
  assert.ok(ev, "the correction is in the ledger");
  assert.equal(ev.payload.fromDefinitionId, before, "what Steady used to believe survives");
  assert.equal(ev.payload.toDefinitionId, target.id);
});

// ---------------------------------------------------------------------------
// Events (§7)
// ---------------------------------------------------------------------------

test("one event per new exposure, and none for a re-run", async () => {
  const before = (await readEvents({ personId: T.patient, types: ["intervention.instance_recorded"] }))
    .filter((e) => e.payload.confirmed !== true).length;
  await syncInterventionInstances(ctx, T.patient);
  const after = (await readEvents({ personId: T.patient, types: ["intervention.instance_recorded"] }))
    .filter((e) => e.payload.confirmed !== true).length;
  assert.equal(after, before, "a projection refresh is not a new clinical fact");
});

test("no instance event is attributed to the model", async () => {
  const events = await readEvents({ personId: T.patient, types: ["intervention.instance_recorded"] });
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.notEqual(e.actor_type, "model", "§8: the model may propose an identity, never mint one");
    assert.ok(!JSON.stringify(e.payload).toLowerCase().includes("effective"));
  }
});

// ---------------------------------------------------------------------------
// Tenancy (§13's provenance, ADR 0011)
// ---------------------------------------------------------------------------

test("instances are invisible from another tenant", async () => {
  const inst = (await listInstances(ctx, T.patient))[0];
  assert.ok(inst);
  assert.equal(await getInstance(otherCtx, inst.id), null);
  assert.deepEqual(await listInstances(otherCtx, T.patient), []);
  await assert.rejects(
    () => confirmInstance(otherCtx, inst.id, T.clinician), InterventionError,
    "a foreign id must read as if the row did not exist"
  );
});

test("recording an intervention needs a name with something in it", async () => {
  await assert.rejects(
    () => recordClinicianIntervention(ctx, {
      personId: T.patient, wording: "   ", interventionClass: "grounding",
      occurredAt: "2026-08-20 14:00:00", clinicianId: T.clinician,
    }),
    InterventionError
  );
});

test("recordInstance requires a definition that exists in this tenant", async () => {
  const foreign = await ensureDefinition(otherCtx, {
    canonicalKey: "foreign_thing", displayName: "Foreign", interventionClass: "grounding",
  });
  await assert.rejects(
    () => recordInstance(ctx, {
      personId: T.patient, definitionId: foreign.id,
      sourceType: "clinician_entry", sourceId: "x-1", occurredAt: "2026-08-20 14:00:00",
    }),
    "a foreign definition is not a definition here"
  );
});
