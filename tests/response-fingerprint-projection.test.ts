// The fingerprint projection (expansion handoff 02, Phase 3).
//
// Two claims are the definition of done — "minimum evidence thresholds
// enforced" and "every pattern opens evidence" — and a third rule underneath
// them decides whether the numbers are honest at all: §6's "use robust
// descriptive statistics: median change and observed range/IQR rather than a
// fragile mean when sample size is small."
//
// The mean is the interesting failure. At n = 4 it looks entirely reasonable,
// moves a point and a half on one hard session, and is the number a clinician
// would then carry into a decision. So there is a test below that constructs a
// sample where the mean and the median disagree and asserts which one comes
// back.
//
// The other failures this file is aimed at:
//
//   A statistic computed below threshold and then hidden. §6 sets three
//   exposures before anything is displayed; a summary that computes the median
//   anyway and lets the surface decide has already lost, because a number that
//   exists is a number something eventually renders.
//
//   A favorable label earned on the first reading alone. An exposure that
//   settles someone in the room and costs them the night must not count toward
//   "settling has been observed repeatedly" — §5: "delayed cost can coexist
//   with immediate benefit."
//
//   A snapshot with no evidence rows. "Every pattern opens evidence" is not a
//   UI feature; the rows are what the number was made of.

process.env.EMDR_DATA_DIR = `/tmp/steady-rfp-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "rfp-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "rfp-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { readEvents } from "../src/lib/events";
import { syncInterventionInstances, listInstances } from "../src/lib/clinical/interventions";
import { syncResponseObservations } from "../src/lib/clinical/response-observations";
import {
  median, range, iqr, patternStateFor, computeFingerprints, displayable,
  saveSnapshot, evidenceFor, reviewPattern, fingerprintLine,
  RESPONSE_POLICY, PATTERN_STATES, PATTERN_STATE_LABEL, PATTERN_STATE_NOTE,
  type ResponsePolicy,
} from "../src/lib/clinical/response-fingerprint";

const db = getDb();
const T = {
  tenant: "tenant-rfp", other: "tenant-rfp-2",
  clinician: "clin-rfp", patient: "pat-rfp", second: "pat-rfp-2",
};
for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
for (const id of [T.clinician, T.patient, T.second]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
  db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'X', 'member', 'x')")
    .run(id, `${id}@example.test`);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const otherCtx: TenantContext = { tenantId: T.other, personId: T.clinician };

function aSession(args: {
  id: string; person?: string; moduleId?: string; status?: string;
  pre: number; post: number | null; day: string;
}) {
  db.prepare(
    `INSERT OR REPLACE INTO therapy_sessions
       (id, user_id, tenant_id, module_id, status, pre_suds, post_suds, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.id, args.person ?? T.patient, T.tenant, args.moduleId ?? "calm-place",
    args.status ?? "completed", args.pre, args.post,
    `${args.day} 10:00:00`, `${args.day} 10:40:00`
  );
}

function aCheckin(args: { id: string; person?: string; date: string; activation: number; sleep?: number }) {
  db.prepare(
    `INSERT OR REPLACE INTO checkins
       (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
        dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, ?, ?, ?, 2, 0, 1, 1, ?, 0, 'practice', ?)`
  ).run(
    args.id, args.person ?? T.patient, T.tenant, args.date, args.activation,
    args.sleep ?? 5, `${args.date} 08:00:00`
  );
}

async function rebuild(person = T.patient) {
  await syncInterventionInstances(ctx, person);
  await syncResponseObservations(ctx, person);
}

// ---------------------------------------------------------------------------
// Robust statistics (§6)
// ---------------------------------------------------------------------------

test("the summary uses a median, and it is not the mean", () => {
  // Four ordinary sessions and one that went badly. The mean says -1.6; the
  // median says -3. Only one of those describes what usually happened.
  const changes = [-3, -3, -4, -3, 5];
  assert.equal(median(changes), -3);
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  assert.notEqual(median(changes), mean);
  assert.deepEqual(range(changes), { min: -4, max: 5 });
});

test("median, range and IQR are reproducible by hand from the listed values", () => {
  assert.equal(median([]), null);
  assert.equal(median([2]), 2);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(range([]), null);
  assert.equal(iqr([1, 2, 3]), null, "IQR needs four values to mean anything");
  assert.deepEqual(iqr([1, 2, 3, 4]), { q1: 1.5, q3: 3.5 });
  assert.deepEqual(iqr([1, 2, 3, 4, 5]), { q1: 1.5, q3: 4.5 });
});

// ---------------------------------------------------------------------------
// The five states (§6)
// ---------------------------------------------------------------------------

test("the states are §6's five and none of them makes an efficacy claim", () => {
  assert.deepEqual([...PATTERN_STATES], [
    "insufficient_data", "mixed", "favorable_observed_pattern",
    "limited_observed_pattern", "recovery_burden_observed",
  ]);
  const text = [
    ...Object.values(PATTERN_STATE_LABEL), ...Object.values(PATTERN_STATE_NOTE),
  ].join(" ").toLowerCase();
  for (const word of ["works", "effective", "efficac", "contraindicat", "cure", "treats"]) {
    assert.ok(!text.includes(word), `no pattern state may say "${word}"`);
  }
  // "caused" is allowed exactly once, and only inside a denial of it.
  assert.ok(
    !/(?<!not a claim that the intervention )caused improvement/.test(text),
    "no state may assert that an intervention caused improvement"
  );
});

test("the state is a total, deterministic function of the counts", () => {
  const p = RESPONSE_POLICY;
  assert.equal(
    patternStateFor({ supportCount: 2, mixedCount: 0, recoveryBurdenCount: 0, towardSettledCount: 2 }),
    "insufficient_data",
    "two encounters is an anecdote"
  );
  assert.equal(
    patternStateFor({ supportCount: 6, mixedCount: 0, recoveryBurdenCount: 2, towardSettledCount: 6 }),
    "recovery_burden_observed",
    "repeated delayed cost outranks a settled room"
  );
  assert.equal(
    patternStateFor({ supportCount: 6, mixedCount: 3, recoveryBurdenCount: 0, towardSettledCount: 6 }),
    "mixed"
  );
  assert.equal(
    patternStateFor({ supportCount: 6, mixedCount: 0, recoveryBurdenCount: 0, towardSettledCount: 5 }),
    "favorable_observed_pattern"
  );
  assert.equal(
    patternStateFor({ supportCount: 4, mixedCount: 0, recoveryBurdenCount: 0, towardSettledCount: 4 }),
    "limited_observed_pattern",
    `four is under the ${p.repeatedPatternThreshold} a repeated pattern needs`
  );
  assert.equal(
    patternStateFor({ supportCount: 6, mixedCount: 0, recoveryBurdenCount: 0, towardSettledCount: 1 }),
    "limited_observed_pattern"
  );
});

// ---------------------------------------------------------------------------
// The display threshold (§6)
// ---------------------------------------------------------------------------

test("under three exposures nothing is computed, not merely hidden", async () => {
  aSession({ id: "t-1", moduleId: "trigger-map", pre: 7, post: 3, day: "2026-07-01" });
  aSession({ id: "t-2", moduleId: "trigger-map", pre: 6, post: 2, day: "2026-07-08" });
  await rebuild();

  const all = await computeFingerprints(ctx, T.patient);
  const f = all.find((s) => s.definition.canonicalKey === "module.trigger_map")!;
  assert.equal(f.patternState, "insufficient_data");
  assert.deepEqual(f.windows, [], "no descriptive statistic exists below the threshold");
  assert.deepEqual(f.strata, []);
  assert.ok(!displayable(all).some((s) => s.definition.id === f.definition.id));
});

test("three exposures is limited, five settling ones is a repeated pattern", async () => {
  for (const [n, day] of [["a", "2026-07-02"], ["b", "2026-07-09"], ["c", "2026-07-16"]] as const) {
    aSession({ id: `c-${n}`, moduleId: "calm-place", pre: 7, post: 3, day });
  }
  await rebuild();
  let f = (await computeFingerprints(ctx, T.patient))
    .find((s) => s.definition.canonicalKey === "module.calm_place")!;
  assert.equal(f.supportCount, 3);
  assert.equal(f.patternState, "limited_observed_pattern");
  assert.ok(f.windows.length > 0, "at threshold the statistics exist");

  for (const [n, day] of [["d", "2026-07-23"], ["e", "2026-07-30"]] as const) {
    aSession({ id: `c-${n}`, moduleId: "calm-place", pre: 8, post: 4, day });
  }
  await rebuild();
  f = (await computeFingerprints(ctx, T.patient))
    .find((s) => s.definition.canonicalKey === "module.calm_place")!;
  assert.equal(f.supportCount, 5);
  assert.equal(f.patternState, "favorable_observed_pattern");

  const immediate = f.windows.find((w) => w.windowType === "immediate")!;
  assert.equal(immediate.medianChange, -4);
  assert.deepEqual(immediate.range, { min: -4, max: -4 });
  assert.equal(immediate.towardSettled, 5);
});

// §5: "delayed cost can coexist with immediate benefit." An exposure that
// settled the room and cost the night must not count toward "settling has been
// observed repeatedly".
test("an exposure with later worsening does not count toward the favorable pattern", async () => {
  aCheckin({ id: "k-1", date: "2026-07-23", activation: 3 });
  aCheckin({ id: "k-2", date: "2026-07-24", activation: 9 });
  aCheckin({ id: "k-3", date: "2026-07-30", activation: 3 });
  aCheckin({ id: "k-4", date: "2026-07-31", activation: 9 });
  await rebuild();

  const f = (await computeFingerprints(ctx, T.patient))
    .find((s) => s.definition.canonicalKey === "module.calm_place")!;
  assert.equal(f.supportCount, 5);
  assert.equal(f.mixedCount, 2, "the two with next-day worsening disagree with themselves");
  assert.notEqual(
    f.patternState, "favorable_observed_pattern",
    "the first reading alone does not earn the label"
  );
});

// ---------------------------------------------------------------------------
// Missingness and limitations (§6)
// ---------------------------------------------------------------------------

test("missing follow-up is counted and named as unknown, never as recovery", async () => {
  const f = (await computeFingerprints(ctx, T.patient))
    .find((s) => s.definition.canonicalKey === "module.calm_place")!;
  assert.ok(f.missingFollowupCount > 0);
  const said = f.limitations.join(" ").toLowerCase();
  assert.ok(
    said.includes("unknown, not recovered"),
    "the absence is named, and named as unknown"
  );
  // The failure this guards is the opposite phrasing — an absence described as
  // a clean outcome. Every occurrence of "recovered" must be inside a denial.
  for (const m of said.matchAll(/recovered/g)) {
    assert.ok(
      said.slice(Math.max(0, m.index - 5), m.index).includes("not "),
      "an absence must never be described as recovery"
    );
  }
});

test("a session with no close reading is absent from the within-encounter figures and said to be", async () => {
  aSession({ id: "c-f", moduleId: "calm-place", status: "abandoned", pre: 7, post: null, day: "2026-08-06" });
  await rebuild();
  const f = (await computeFingerprints(ctx, T.patient))
    .find((s) => s.definition.canonicalKey === "module.calm_place")!;
  const immediate = f.windows.find((w) => w.windowType === "immediate")!;
  assert.equal(f.supportCount, 6);
  assert.equal(immediate.observedOn, 5, "the unclosed session contributes no reading");
  assert.ok(f.limitations.some((l) => l.includes("no close reading")));
});

// ---------------------------------------------------------------------------
// Context strata (§6)
// ---------------------------------------------------------------------------

test("a stratum below the support threshold is folded in and named, not shown", async () => {
  const f = (await computeFingerprints(ctx, T.patient))
    .find((s) => s.definition.canonicalKey === "module.calm_place")!;
  // Three exposures opened at 7 (mid band) and two at 8 (high band).
  const mid = f.strata.find((s) => s.key === "mid");
  assert.ok(mid, "the band with enough support is separated out");
  assert.ok(mid.supportCount >= RESPONSE_POLICY.stratumThreshold);
  assert.ok(!f.strata.some((s) => s.key === "high"), "two exposures is not a stratum");
  assert.ok(
    f.limitations.some((l) => l.includes("too few")),
    "the suppressed group is named rather than silently dropped"
  );
});

// ---------------------------------------------------------------------------
// Snapshots and evidence (§4, §13)
// ---------------------------------------------------------------------------

test("every pattern opens its evidence, written with the snapshot", async () => {
  const f = (await computeFingerprints(ctx, T.patient))
    .find((s) => s.definition.canonicalKey === "module.calm_place")!;
  assert.ok(f.evidence.instanceIds.length > 0 && f.evidence.observationIds.length > 0);

  const snap = await saveSnapshot(ctx, T.patient, f);
  const evidence = await evidenceFor(ctx, snap.id);
  assert.equal(
    evidence.length,
    f.evidence.instanceIds.length + f.evidence.observationIds.length,
    "the rows are the record of what the number was made of"
  );
  assert.ok(evidence.some((e) => e.evidenceType === "intervention_instance"));
  assert.ok(evidence.some((e) => e.evidenceType === "response_observation"));
});

test("recomputing under the same policy and cutoff returns the same snapshot", async () => {
  const cutoff = "2026-09-01T00:00:00.000Z";
  const [f] = await computeFingerprints(ctx, T.patient, { asOf: cutoff });
  const a = await saveSnapshot(ctx, T.patient, f);
  const b = await saveSnapshot(ctx, T.patient, f);
  assert.equal(a.id, b.id, "one computation, one row — never a second opinion");
  assert.equal(a.policyVersion, RESPONSE_POLICY.version);
  assert.equal(a.evidenceCutoff, cutoff);
});

test("a policy change makes a new snapshot beside the old one, never a restatement", async () => {
  const cutoff = "2026-09-01T00:00:00.000Z";
  const stricter: ResponsePolicy = { ...RESPONSE_POLICY, version: "response-fingerprint.test.2", displayThreshold: 6 };
  const [before] = await computeFingerprints(ctx, T.patient, { asOf: cutoff });
  const [after] = await computeFingerprints(ctx, T.patient, { asOf: cutoff, policy: stricter });
  const a = await saveSnapshot(ctx, T.patient, before);
  const b = await saveSnapshot(ctx, T.patient, after);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.policyVersion, b.policyVersion);
});

test("the snapshot event carries the policy version and the evidence it rested on", async () => {
  const events = await readEvents({
    personId: T.patient, types: ["response_fingerprint.snapshot_computed"],
  });
  assert.ok(events.length > 0);
  const e = events[events.length - 1];
  assert.equal(e.payload.policyVersion, e.provenance.ruleVersion);
  assert.ok(Array.isArray(e.provenance.evidenceIds) && e.provenance.evidenceIds.length > 0);
  assert.equal(e.actor_type, "system", "deterministic aggregation is not a model act");
});

test("a clinician's reading of a pattern is a recorded fact", async () => {
  const f = (await computeFingerprints(ctx, T.patient))[0];
  const snap = await saveSnapshot(ctx, T.patient, f);
  await reviewPattern(ctx, {
    personId: T.patient, snapshotId: snap.id, definitionId: f.definition.id,
    clinicianId: T.clinician, decision: "agreed", note: "matches what I see in the room",
  });
  const events = await readEvents({
    personId: T.patient, types: ["response_fingerprint.pattern_reviewed"],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].actor_type, "clinician");
  assert.equal(events[0].payload.decision, "agreed");
});

// ---------------------------------------------------------------------------
// No future-data leakage
// ---------------------------------------------------------------------------

test("an earlier cutoff reconstructs what Steady could have said then", async () => {
  const early = await computeFingerprints(ctx, T.patient, { asOf: "2026-07-10T00:00:00.000Z" });
  const now = await computeFingerprints(ctx, T.patient);
  const earlyCalm = early.find((s) => s.definition.canonicalKey === "module.calm_place")!;
  const nowCalm = now.find((s) => s.definition.canonicalKey === "module.calm_place")!;
  assert.ok(earlyCalm.supportCount < nowCalm.supportCount);
  assert.equal(earlyCalm.patternState, "insufficient_data", "on 10 July there were two");
});

// ---------------------------------------------------------------------------
// Language and tenancy
// ---------------------------------------------------------------------------

test("the session-prep line describes the record, not the intervention", async () => {
  for (const f of await computeFingerprints(ctx, T.patient)) {
    const line = fingerprintLine(f).toLowerCase();
    for (const word of ["works", "effective", "caused", "helped", "because", "contraindicat"]) {
      assert.ok(!line.includes(word), `"${line}" must not say "${word}"`);
    }
    assert.ok(line.includes("recorded exposure"), "the denominator travels with the claim");
  }
});

test("a fingerprint is invisible from another tenant", async () => {
  assert.deepEqual(await computeFingerprints(otherCtx, T.patient), []);
  const f = (await computeFingerprints(ctx, T.patient))[0];
  const snap = await saveSnapshot(ctx, T.patient, f);
  assert.deepEqual(await evidenceFor(otherCtx, snap.id), []);
});

test("a person with no exposures gets no fingerprint invented for them", async () => {
  assert.deepEqual(await computeFingerprints(ctx, T.second), []);
});

test("ordering is stable: most evidence first, then by name", async () => {
  const a = await computeFingerprints(ctx, T.patient);
  const b = await computeFingerprints(ctx, T.patient);
  assert.deepEqual(a.map((s) => s.definition.id), b.map((s) => s.definition.id));
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i - 1].supportCount >= a[i].supportCount);
  }
});

test("no observation is counted for an intervention it does not belong to", async () => {
  const instances = await listInstances(ctx, T.patient);
  const summaries = await computeFingerprints(ctx, T.patient);
  const claimed = summaries.flatMap((s) => s.evidence.instanceIds);
  assert.equal(new Set(claimed).size, claimed.length, "no instance is counted twice");
  assert.equal(claimed.length, instances.length, "and none is dropped");
});

// ---------------------------------------------------------------------------
// The Session Prep adapter (§9)
// ---------------------------------------------------------------------------

test("the brief carries only what the detail screen would show", async () => {
  const { responseContextFor } = await import("../src/lib/clinical/response-fingerprint");
  const rows = await responseContextFor(ctx, T.patient);
  const shown = new Set(displayable(await computeFingerprints(ctx, T.patient)).map((f) => f.definition.id));
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(
      shown.has(r.definitionId),
      "a brief being shorter is not a licence for it to be looser than the screen"
    );
    assert.ok(r.citations.length > 0, "an uncited line would be withheld by the brief's validator");
  }
  assert.ok(rows.length <= 3, "the brief is a minute of reading, not a second responses page");
});

test("a pattern to watch is marked as one rather than left to the reader", async () => {
  const { responseContextFor } = await import("../src/lib/clinical/response-fingerprint");
  const rows = await responseContextFor(ctx, T.patient);
  const all = displayable(await computeFingerprints(ctx, T.patient));
  for (const r of rows) {
    const f = all.find((x) => x.definition.id === r.definitionId)!;
    const shouldWatch =
      f.patternState === "recovery_burden_observed" || f.patternState === "mixed";
    assert.equal(r.toWatch, shouldWatch);
  }
});

test("the brief's response wording comes from one place, not from the brief", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/lib/clinical/session-prep.ts", "utf8");
  // The loop body only — the comment above it is prose about the rule and is
  // allowed to name the words the code must not compose.
  const section = src.slice(
    src.indexOf("for (const r of responses) {"),
    src.indexOf("--- You wanted to revisit")
  );
  // The section may prefix "Watch:" and must otherwise pass the projection's
  // sentence through untouched — a second place that composes response
  // language is a second place that can drift into §6's forbidden words.
  assert.ok(section.includes("r.text"), "the sentence is the projection's");
  assert.ok(
    !/settl|helped|worked|effective/i.test(section.replace(/\/\/.*$/gm, "")),
    "no response wording is composed inside Session Prep"
  );
});
