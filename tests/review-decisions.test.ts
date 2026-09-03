// The review decision record, and the four screens built on it
// (§26 p44, §31.6 p99).
//
// The property under test is the one the whole design rests on: A DECISION IS
// BOUND TO THE VERSION IT WAS MADE AGAINST. Approving a release gate approves
// the evidence that was on the screen, not the gate's name — so when the
// evidence moves, the approval stops applying and the gate reopens by itself.
//
// That is what makes §26 p44's "release gates cannot be bypassed from ordinary
// admin controls" a mechanism rather than a rule someone has to remember. The
// bypass it forecloses is not a villain editing a database; it is the ordinary
// sequence where somebody signs off a gate on Monday, the evidence changes on
// Tuesday, and nothing anywhere says so.

process.env.EMDR_DATA_DIR = `/tmp/steady-reviewdec-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { decisionsAt, decisionHistory, progress } from "../src/lib/review/decisions";
import { RELEASE_GATES, fingerprint, gateById } from "../src/lib/review/gates";
import { reviewableSurfaces, copyVersion } from "../src/lib/review/clinical-copy";
import { gateCopyFor, GATE_STATES, memberCopyFor } from "../src/lib/clinical/gate-review";
import { registryVersion, COHORTS } from "../src/lib/metrics/cohorts";
import { data } from "../src/lib/data";
import { newId } from "../src/lib/db";

async function put(kind: string, subjectId: string, version: string, decision: string, actorRole = "reviewer") {
  const c = await data();
  await c.run(
    `INSERT INTO review_decisions (id, subject_kind, subject_id, subject_version, decision, rationale, evidence_json, actor_id, actor_role)
     VALUES (?, ?, ?, ?, ?, NULL, '{}', NULL, ?)`,
    [newId(), kind, subjectId, version, decision, actorRole]
  );
}

// ---------------------------------------------------------------------------
// The version binding
// ---------------------------------------------------------------------------

test("a decision recorded at one version is absent at another", async () => {
  await put("release_gate", "demo_identity", "fp-aaa", "approved");

  const atSame = await decisionsAt("release_gate", "fp-aaa");
  assert.equal(atSame.get("demo_identity")?.decision, "approved", "should be in force at the version it was recorded against");

  const atOther = await decisionsAt("release_gate", "fp-bbb");
  assert.equal(atOther.get("demo_identity"), undefined, "an approval must not carry across to different evidence");
});

test("the history survives the version moving on", async () => {
  const history = await decisionHistory("release_gate", "demo_identity");
  assert.equal(history.length, 1);
  assert.equal(history[0].subjectVersion, "fp-aaa");
  // This is what lets the screen say "approved on Monday, evidence changed on
  // Tuesday" instead of showing the gate as though nobody ever looked at it.
});

test("a reversal is a new row, and the earlier decision stays readable", async () => {
  await put("release_gate", "safety_regression", "fp-ccc", "approved");
  await put("release_gate", "safety_regression", "fp-ccc", "blocked");

  const inForce = await decisionsAt("release_gate", "fp-ccc");
  assert.equal(inForce.get("safety_regression")?.decision, "blocked", "last write wins");

  const history = await decisionHistory("release_gate", "safety_regression");
  assert.equal(history.length, 2, "the approval it replaced must still be there");
  assert.equal(history[0].decision, "approved");
});

test("progress counts undecided from the subject list, not from rows", () => {
  const decided = new Map([["a", { decision: "approved" } as never]]);
  const p = progress(["a", "b", "c"], decided as never);
  assert.equal(p.approved, 1);
  assert.equal(p.undecided, 2, "subjects with no decision at this version are undecided, not missing");
});

// ---------------------------------------------------------------------------
// The fingerprint
// ---------------------------------------------------------------------------

test("the fingerprint ignores key order and reacts to any value", () => {
  const a = fingerprint({ severity: "clean", findings: 0, scanned: 100 });
  const b = fingerprint({ scanned: 100, findings: 0, severity: "clean" });
  assert.equal(a, b, "key order must not change the hash, or a gate reopens for no reason");

  const c = fingerprint({ severity: "clean", findings: 1, scanned: 100 });
  assert.notEqual(a, c, "a changed fact must change the hash, or a sign-off outlives its evidence");
});

test("every gate p99 names is present, with its owner and blocking condition", () => {
  assert.equal(RELEASE_GATES.length, 8, "§31.6 p99 lists eight gates");
  for (const g of RELEASE_GATES) {
    assert.ok(g.owner.length > 0, `${g.id} needs the owner p99 assigns it`);
    assert.ok(g.blockingCondition.length > 0, `${g.id} needs its blocking condition`);
    assert.ok(["measured", "on_demand", "attested"].includes(g.evidenceClass));
  }
  // The three the system genuinely cannot check must be declared as
  // attestations. Marking one "measured" would put a person's word behind a
  // badge that says the system verified it.
  for (const id of ["authorization", "accessibility", "analytics_integrity"]) {
    assert.equal(gateById(id)?.evidenceClass, "attested", `${id} is not machine-checkable and must say so`);
  }
});

// ---------------------------------------------------------------------------
// The clinical copy is the SHIPPING copy
// ---------------------------------------------------------------------------

test("every reviewable surface quotes the module that ships it", () => {
  const surfaces = reviewableSurfaces();
  assert.ok(surfaces.length >= GATE_STATES.length, "all six gate states are reviewable");

  for (const state of GATE_STATES) {
    const s = surfaces.find((x) => x.id === `gate.${state}`);
    assert.ok(s, `gate.${state} must be reviewable — it is what a member reads when told no`);
    // The point of the whole registry: the words on the review screen are the
    // words the product says. A transcription would pass a "renders text" test
    // and approve a sentence nobody reads.
    assert.equal(s.copy, memberCopyFor(state), `gate.${state} must quote the shipping copy, not a transcription`);
    assert.equal(s.copy, gateCopyFor(state).member);
  }
});

test("a safety stop is reviewed as a safety claim, not an availability one", () => {
  const surfaces = reviewableSurfaces();
  assert.equal(surfaces.find((s) => s.id === "gate.safety_stop")?.claimClass, "safety");
  assert.equal(surfaces.find((s) => s.id === "gate.review_needed")?.claimClass, "care_process");
  // §31.6 blocks on an "unsupported diagnosis, readiness or care claim", so the
  // class the reviewer checks against has to be the right one per surface.
});

test("the copy version spans every policy that governs the words", () => {
  const v = copyVersion();
  assert.ok(v.includes("+"), "composite — a decision tracking one policy survives a change to the others");
  assert.ok(v.split("+").length >= 3);
});

// ---------------------------------------------------------------------------
// The cohort registry version
// ---------------------------------------------------------------------------

test("the registry version is derived from the cohorts in it", () => {
  const before = registryVersion();
  const added = { ...COHORTS[0], id: "temp_probe.v1", version: "1.0.0" };
  COHORTS.push(added);
  try {
    assert.notEqual(registryVersion(), before, "adding a cohort must change the identity of files produced from the set");
  } finally {
    COHORTS.pop();
  }
  assert.equal(registryVersion(), before, "and removing it must restore it — the version is a function of the registry");
});

// ---------------------------------------------------------------------------
// The routes exist
// ---------------------------------------------------------------------------

test("all thirteen of §26 p44's review screens exist", () => {
  const ROUTES = [
    "", "access", "clinical", "autonomous", "bls", "testing", "safety",
    "audit", "lineage", "research", "release", "demo-data", "status",
  ];
  for (const r of ROUTES) {
    const p = path.join(process.cwd(), "src/app/review", r, "page.tsx");
    assert.ok(fs.existsSync(p), `§26 p44 specifies /review/${r} — missing ${p}`);
  }
});

test("the four new screens are in the console nav", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/ReviewPage.tsx"), "utf8");
  for (const r of ["/review/access", "/review/clinical", "/review/release", "/review/research"]) {
    assert.ok(src.includes(`"${r}"`), `${r} must be reachable from the console rail, not only by typing the URL`);
  }
});

// ---------------------------------------------------------------------------
// The refusals, read from the action source
// ---------------------------------------------------------------------------

test("the write path refuses the four things that would hollow these screens out", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/review/actions.ts"), "utf8");

  // A reviewer approving their own access request is the failure the screen exists to prevent.
  assert.ok(src.includes("self_approval"), "self-approval must be refused");
  assert.ok(/row\.requested_by === user\.id/.test(src), "…by comparing the requester to the actor");

  // A refusal nobody can act on.
  assert.ok(src.includes("reason_required"), "blocking without a reason must be refused");

  // An attestation with nothing behind it.
  assert.ok(src.includes("evidence_required"), "approving an attested gate needs a pointer to the evidence");

  // An unbounded grant is not a scope.
  assert.ok(src.includes("bad_expiry"), "a request with no or absurd expiry must be refused");

  // Every action is reviewer-gated: §26 p44's "release gates cannot be
  // bypassed from ordinary admin controls" starts here.
  const exported = src.match(/export async function (\w+)/g) ?? [];
  assert.ok(exported.length >= 4, "expected the four write actions");
  const gates = src.match(/requireReviewer\(\)/g) ?? [];
  assert.equal(gates.length, exported.length, "every exported action must be reviewer-gated");
});

test("the decision write records actor, role, version, evidence and time", async () => {
  const c = await data();
  const cols = (await c.all("PRAGMA table_info(review_decisions)")) as { name: string }[];
  const names = new Set(cols.map((x) => x.name));
  // §26 p44's role-level acceptance, as columns rather than as a convention.
  for (const required of ["actor_id", "actor_role", "subject_version", "evidence_json", "created_at"]) {
    assert.ok(names.has(required), `p44 requires ${required} on every decision`);
  }
});
