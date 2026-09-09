process.env.EMDR_DATA_DIR = `/tmp/steady-readiness-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

// The reviewer decision flow (handoff 09 §7.1, §7.2, §10 Package 6).
//
// Package 6's exit evidence: "Version conflict and presentation access tests
// pass. Evidence-fingerprint mutation reopens approval in test and demo."
//
// TWO OF THE FOUR THINGS THIS PACKAGE FIXED WERE DEFECTS, not absences, and
// the guards below are written against those two first.
//
//   EVERY ATTESTATION SHARED ONE DEPENDENCY SET. All three were fingerprinted
//   over {safetyConfigVersion, claimsVersion}, so publishing a corrected
//   sentence in the public claims registry reopened the ACCESSIBILITY
//   attestation — which is about keyboard and screen-reader paths. §7.1: "A
//   decorative token change must not reopen unrelated attestations." The cost
//   is not the extra click: an attestation that reopens for unrelated reasons
//   trains its owner to re-approve without rereading.
//
//   A STALE SUBMISSION WAS RECORDED RATHER THAN REFUSED. The form carried the
//   fingerprint the page was rendered with and the action wrote it straight
//   into the record, so a reviewer who approved after the evidence moved wrote
//   a decision that silently did nothing — it never read as approved, because
//   the fingerprint matched nothing current. A reviewer who believes they have
//   signed off and has not is worse off than one told to look again.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  DEPENDENCY_KEYS, DEPENDENCY_LABEL, GATE_DEPENDENCIES, GATE_BRIEFS,
  BLOCKER_KINDS, BLOCKER_LABEL,
  releaseScope, dependencyFacts, reopenedBy, assertDependencies, briefFor,
  blockers, releaseClear, groupFailures, checkSubmission,
  ReadinessError, type GateRow,
} from "../src/lib/review/release-readiness";
import { RELEASE_GATES, fingerprint, type GateEvidence } from "../src/lib/review/gates";
import { REGISTER_COMMIT, REGISTER_DATE } from "../src/lib/app/route-register";

const SRC = path.join(__dirname, "..", "src");
const read = (p: string) => fs.readFileSync(path.join(SRC, p), "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function row(over: Partial<GateRow> = {}): GateRow {
  return {
    gateId: "authorization",
    name: "Authorization",
    status: "pass",
    evidenceClass: "attested",
    inForce: null,
    superseded: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §7.1 — explicit dependency fingerprints
// ---------------------------------------------------------------------------

test("no two attestations stand on the same things", () => {
  // The defect, stated as a property. If all three declare the same
  // dependencies they are not explicit dependencies, they are one shared set
  // with three names.
  const attested = RELEASE_GATES.filter((g) => g.evidenceClass === "attested");
  assert.ok(attested.length >= 2, "there is nothing to distinguish");
  const sets = attested.map((g) => (GATE_DEPENDENCIES[g.id] ?? []).slice().sort().join(","));
  assert.ok(
    new Set(sets).size > 1,
    `every attestation depends on the same things (${sets[0]}), so any change reopens all of them`
  );
});

test("each attestation declares exactly what it stands on", () => {
  // THE "DIFFER" CHECK ABOVE IS NOT ENOUGH ON ITS OWN. Three sets can all be
  // distinct while one of them is still wrong — adding claimsRegistry to
  // authorization keeps them distinct and reintroduces the defect, because an
  // attack suite is not affected by a corrected sentence. §7.1's word is
  // "explicit", so the declarations are written down twice: once where they
  // are used, once here, and the two have to agree.
  const expected: Record<string, string[]> = {
    authorization: ["routeSurface"],
    accessibility: ["routeSurface"],
    analytics_integrity: ["claimsRegistry"],
  };
  for (const [gate, keys] of Object.entries(expected)) {
    assert.deepEqual(
      [...(GATE_DEPENDENCIES[gate] ?? [])].sort(), [...keys].sort(),
      `${gate} stands on something it was not declared to stand on`
    );
  }
  // And nothing declares a dependency on the safety configuration: a threshold
  // change moves what the numbers SAY, which is the safety gate's business
  // rather than an attestation's.
  for (const gate of Object.keys(GATE_DEPENDENCIES)) {
    assert.ok(!GATE_DEPENDENCIES[gate].includes("safetyConfig"),
      `${gate} reopens on a safety-config bump it has no relationship to`);
  }
});

test("a claims change does not reopen the accessibility attestation", () => {
  // §7.1's own example, near enough: a corrected sentence in the public claims
  // registry has nothing to do with a keyboard path.
  assert.ok(!GATE_DEPENDENCIES.accessibility.includes("claimsRegistry"),
    "accessibility reopens when claims copy changes");
  assert.ok(!reopenedBy("claimsRegistry").includes("accessibility"));
  // And it DOES reopen the one it should.
  assert.ok(reopenedBy("claimsRegistry").includes("analytics_integrity"),
    "a claims change leaves the analytics attestation standing");
});

test("a screen appearing or disappearing reopens the gates about screens", () => {
  for (const gate of ["authorization", "accessibility"]) {
    assert.ok(GATE_DEPENDENCIES[gate].includes("routeSurface"),
      `${gate} does not reopen when the set of screens changes`);
  }
});

test("no attestation depends on everything, and none depends on nothing", () => {
  // Both ends are failures. Depending on nothing is a signature with no
  // expiry; depending on everything is the arrangement that trains its owner
  // to re-approve without rereading.
  assert.doesNotThrow(() => assertDependencies());
  for (const gate of RELEASE_GATES.filter((g) => g.evidenceClass === "attested")) {
    const keys = GATE_DEPENDENCIES[gate.id];
    assert.ok(keys && keys.length > 0, `${gate.id} declares no dependencies`);
    assert.ok(keys.length < DEPENDENCY_KEYS.length, `${gate.id} depends on everything`);
  }
});

test("a gate with no declared dependency is refused rather than fingerprinted", () => {
  assert.throws(() => dependencyFacts("a_gate_nobody_declared"), ReadinessError);
});

test("the fingerprint changes when a declared dependency changes, and not otherwise", () => {
  // The mechanism, exercised rather than asserted. Two gates, one shared
  // dependency between them, and a change to the other's dependency must not
  // move this one's fingerprint.
  const before = fingerprint(dependencyFacts("accessibility"));
  const same = fingerprint(dependencyFacts("accessibility"));
  assert.equal(before, same, "the fingerprint is not deterministic");

  // Different gates fingerprint differently even on the same dependency set,
  // because the gate id is in the facts — otherwise one sign-off would satisfy
  // two gates.
  assert.notEqual(
    fingerprint(dependencyFacts("accessibility")),
    fingerprint(dependencyFacts("authorization")),
    "two gates share a fingerprint, so signing one signs the other"
  );
});

test("every dependency key has a label a reviewer can read", () => {
  for (const k of DEPENDENCY_KEYS) {
    assert.ok(DEPENDENCY_LABEL[k]?.length > 0, `${k} has no label`);
    assert.ok(!/version|hash|fingerprint/i.test(DEPENDENCY_LABEL[k]),
      `"${DEPENDENCY_LABEL[k]}" reads as an identifier rather than a thing`);
  }
});

test("the gate evidence uses the declared dependencies, not its own set", () => {
  const src = code("lib/review/gates.ts");
  assert.match(src, /function attestedFacts[\s\S]{0,200}dependencyFacts\(gateId\)/);
  // And no longer builds its own.
  assert.ok(
    !/attestedFacts[\s\S]{0,200}safetyConfigVersion: SAFETY_CONFIG_VERSION,[\s\S]{0,80}claimsVersion/.test(src),
    "attestedFacts still assembles one shared dependency set"
  );
});

// ---------------------------------------------------------------------------
// §7.1 — the stale submission
// ---------------------------------------------------------------------------

test("a submission against moved evidence is stale, and says what moved", () => {
  // §7.1: "reject the stale submission with a comparison and a review-again
  // route." A refusal that says only "the evidence changed" leaves the
  // reviewer to diff two hex strings, and they will approve again without
  // reading rather than do that.
  const result = checkSubmission({
    submittedFingerprint: "aaaa",
    currentFingerprint: "bbbb",
    submittedFacts: { failed: 0, total: 10, configVersion: "v1" },
    currentFacts: { failed: 2, total: 10, configVersion: "v1" },
    reopened: ["safety_regression"],
  });
  assert.equal(result.stale, true);
  assert.deepEqual(result.changed, [{ fact: "failed", was: "0", is: "2" }]);
  assert.deepEqual(result.reopened, ["safety_regression"]);
  // The facts that did NOT move are not listed, or the comparison is a dump.
  assert.ok(!result.changed.some((c) => c.fact === "total"));
});

test("a matching submission is not stale and has nothing to compare", () => {
  const result = checkSubmission({
    submittedFingerprint: "aaaa",
    currentFingerprint: "aaaa",
    submittedFacts: { failed: 0 },
    currentFacts: { failed: 2 },
  });
  assert.equal(result.stale, false);
  // No comparison when the fingerprints agree, even though the facts passed in
  // differ — the fingerprint is the authority, not a field-by-field guess.
  assert.deepEqual(result.changed, []);
});

test("a fact that appeared or vanished is reported rather than skipped", () => {
  const result = checkSubmission({
    submittedFingerprint: "a", currentFingerprint: "b",
    submittedFacts: { a: 1 },
    currentFacts: { a: 1, b: 2 },
  });
  assert.deepEqual(result.changed, [{ fact: "b", was: "—", is: "2" }]);
});

test("the sign-off action refuses a stale submission instead of recording it", () => {
  // The defect: the form's fingerprint went straight into the record.
  const src = code("lib/review/actions.ts");
  const body = src.slice(src.indexOf("export async function recordGateSignoff"));
  const check = body.indexOf("currentFingerprint(gateId)");
  const write = body.indexOf("await record({");
  assert.ok(check > 0, "the action never re-resolves the current fingerprint");
  assert.ok(check < write, "the fingerprint is checked after the decision is recorded");
  assert.match(body.slice(check, write), /redirect\(`\/review\/release\?stale=/,
    "a stale submission is not refused");
  // BRANCHED ON THE PURE RULE, not on an inline comparison. `if (false)` in
  // place of an inline condition leaves the source looking correct and the
  // behaviour gone; routing through `checkSubmission` means the rule this
  // file tests directly is the rule the action runs.
  assert.match(body, /checkSubmission\(\{/, "the action reimplements the staleness rule inline");
  assert.match(body, /if \(current && submission\.stale\)/,
    "the action does not branch on the pure rule's answer");
  // Re-resolved on the SERVER. Anything the browser sends is a claim about the
  // past.
  assert.match(src, /async function currentFingerprint/);
  assert.match(src, /resolveEvidence/);
});

test("a refused sign-off is recorded as an event, not silently dropped", () => {
  const src = code("lib/review/actions.ts");
  const body = src.slice(src.indexOf("export async function recordGateSignoff"));
  assert.match(body, /type: "release_gate_signoff_stale"/);
});

test("the screen shows the comparison and a route back", () => {
  const src = code("app/review/release/page.tsx");
  assert.match(src, /staleRow &&/);
  assert.match(src, /You were shown/);
  assert.match(src, /It is now/);
  assert.match(src, /Read it again below/);
});

// ---------------------------------------------------------------------------
// §7.1 — open on scope, then blockers, not a percentage
// ---------------------------------------------------------------------------

test("the release scope names the environment, the commit and the evidence date", () => {
  const s = releaseScope();
  assert.ok(s.scope.length > 0);
  assert.equal(s.commit, REGISTER_COMMIT);
  assert.equal(s.evidenceDate, REGISTER_DATE);
  assert.ok(s.routeCount > 0);
  // A screen that says "production" because nobody set a variable is the worst
  // possible default for this field.
  assert.ok(!/^production$/i.test(s.environment), "an unlabelled environment reads as production");
});

test("the screen opens on scope and blockers rather than a tally", () => {
  const src = code("app/review/release/page.tsx");
  const scopeAt = src.indexOf('title="What is being released"');
  const blockersAt = src.indexOf('title="What needs action"');
  assert.ok(scopeAt > 0, "the screen does not open on the release scope");
  assert.ok(blockersAt > scopeAt, "blockers come before the scope");
  // The three-card tally is gone. Six of eight approved is a progress bar, and
  // a release conversation held over a progress bar asks how far along we are.
  assert.ok(!/<SummaryCards/.test(src), "the screen still opens on a tally");
  assert.ok(!/Approved at current evidence/.test(src));
});

test("a clear release has an empty blocker list, and a stuck one names each", () => {
  const clean: GateRow[] = RELEASE_GATES.map((g) => row({
    gateId: g.id, name: g.name, status: "pass",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inForce: { decision: "approved" } as any,
  }));
  assert.deepEqual(blockers(clean), []);
  assert.equal(releaseClear(clean), true);

  const stuck = [...clean];
  stuck[0] = row({ gateId: "demo_identity", name: "Demo identity", status: "fail" });
  assert.equal(releaseClear(stuck), false);
  assert.equal(blockers(stuck).length, 1);
  assert.equal(blockers(stuck)[0].kind, "evidence_failing");
});

test("not-run and undecided are different blockers", () => {
  // §7.1 names "not-run checks" as their own item. One needs somebody to run
  // something; the other needs somebody to decide.
  assert.equal(blockers([row({ status: "unavailable", inForce: null })])[0].kind, "not_run");
  assert.equal(blockers([row({ status: "pass", inForce: null })])[0].kind, "undecided");
  for (const k of BLOCKER_KINDS) assert.ok(BLOCKER_LABEL[k]?.length > 0, `${k} has no label`);
  assert.equal(new Set(BLOCKER_KINDS.map((k) => BLOCKER_LABEL[k])).size, BLOCKER_KINDS.length,
    "two blocker kinds render the same words");
});

test("a reopened gate is a blocker in its own right", () => {
  // "Nobody has reviewed this" and "somebody reviewed this and then the
  // evidence moved" are different situations and only one is anybody's fault.
  const r = blockers([row({
    status: "pass", inForce: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    superseded: { decision: "approved" } as any,
  })]);
  assert.equal(r[0].kind, "reopened");
});

test("blockers are ordered worst first", () => {
  const mixed: GateRow[] = [
    row({ gateId: "a", status: "pass", inForce: null }),
    row({ gateId: "b", status: "fail" }),
  ];
  assert.equal(blockers(mixed)[0].gateId, "b", "an undecided gate outranks a failing one");
});

// ---------------------------------------------------------------------------
// §7.1 — grouped failures, without hiding the gates
// ---------------------------------------------------------------------------

function ev(over: Partial<GateEvidence> = {}): GateEvidence {
  return { status: "fail", summary: "s", facts: {}, ...over };
}

test("repeated failures group by cause and still name every gate", () => {
  // A grouping that says "3 gates failing for one reason" and does not name
  // them has replaced eight rows with one and lost what the reviewer needed.
  const rows: GateRow[] = [
    row({ gateId: "demo_identity", status: "fail" }),
    row({ gateId: "other", status: "fail" }),
  ];
  const evidence = new Map<string, GateEvidence>([
    ["demo_identity", ev({ facts: { qualityFailed: 3 } })],
    ["other", ev({ facts: { qualityFailed: 1 } })],
  ]);
  const groups = groupFailures(rows, evidence);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].gateIds.sort(), ["demo_identity", "other"]);
  assert.match(groups[0].cause, /manifest/i);
});

test("a group of one is not a group", () => {
  // Two gates failing for unrelated reasons are two problems, and pretending
  // otherwise is the same collapse in the other direction.
  const rows: GateRow[] = [
    row({ gateId: "a", status: "fail" }),
    row({ gateId: "b", status: "fail" }),
  ];
  const evidence = new Map<string, GateEvidence>([
    ["a", ev({ facts: { qualityFailed: 1 } })],
    ["b", ev({ facts: { diffs: 4 } })],
  ]);
  assert.deepEqual(groupFailures(rows, evidence), []);
});

test("passing gates never appear in a failure group", () => {
  const rows: GateRow[] = [row({ gateId: "a", status: "pass" }), row({ gateId: "b", status: "pass" })];
  const evidence = new Map<string, GateEvidence>([
    ["a", ev({ status: "pass", facts: { qualityFailed: 1 } })],
    ["b", ev({ status: "pass", facts: { qualityFailed: 1 } })],
  ]);
  assert.deepEqual(groupFailures(rows, evidence), []);
});

// ---------------------------------------------------------------------------
// §7.1 — the question, the authority, the allowed decisions
// ---------------------------------------------------------------------------

test("every gate states the question, the authority, and what may be recorded", () => {
  for (const g of RELEASE_GATES) {
    const b = briefFor(g.id);
    assert.ok(b, `${g.id} has no brief`);
    assert.match(b!.question, /\?$/, `${g.id}'s question is not a question`);
    assert.ok(b!.authority.length > 0, `${g.id} states no authority`);
    assert.ok(b!.allowed.length > 0, `${g.id} allows no decision`);
  }
  assert.equal(Object.keys(GATE_BRIEFS).length, RELEASE_GATES.length);
});

test("an attested gate's authority says the assertion is the reviewer's own", () => {
  // A reviewer at the accessibility gate is not being asked whether the
  // product is accessible. They are being asked whether they will assert it.
  for (const g of RELEASE_GATES.filter((x) => x.evidenceClass === "attested")) {
    assert.match(briefFor(g.id)!.authority, /you assert/i, `${g.id} does not say whose assertion it is`);
  }
  // And a measured gate's authority says what it does NOT cover, so an
  // approval is not read as a wider claim.
  assert.match(briefFor("safety_regression")!.authority, /not certifying/i);
});

test("the screen renders the brief with each gate", () => {
  const src = code("app/review/release/page.tsx");
  assert.match(src, /briefFor\(gate\.id\)!\.question/);
  assert.match(src, /briefFor\(gate\.id\)!\.authority/);
  assert.match(src, /You may record:/);
});

test("the screen says what reopens each attestation", () => {
  const src = code("app/review/release/page.tsx");
  assert.match(src, /Reopens when/);
  assert.match(src, /DEPENDENCY_LABEL\[k\]/);
  assert.match(src, /Nothing else reopens it/);
});

// ---------------------------------------------------------------------------
// §7.1 — the audit timeline is not called Decisions
// ---------------------------------------------------------------------------

test("the audit timeline is not labelled Decisions", () => {
  // §7.1: "Never label an audit timeline Decisions unless it supports finding
  // and recording decisions." The audit screen shows what happened; it has no
  // way to record a decision, so it must not claim to be where decisions live.
  const src = code("app/review/audit/page.tsx");
  const title = src.match(/title="([^"]+)"/)?.[1] ?? "";
  assert.ok(!/decision/i.test(title), `the audit screen is titled "${title}"`);
  // And the screen that DOES record decisions is reachable and says so.
  const release = code("app/review/release/page.tsx");
  assert.match(release, /recordGateSignoff/);
});

// ---------------------------------------------------------------------------
// §7.2 — presentation access adds no privilege
// ---------------------------------------------------------------------------

test("the reviewer's own decisions are never recorded by a presentation surface", () => {
  // §7.2: "No unbounded role switcher." Package 4 made a scenario structurally
  // unable to carry access; this is the other half — the walkthrough surfaces
  // must not be able to record a release decision either, or a presenter could
  // approve a gate while telling a story about it.
  for (const file of [
    "components/demo/WalkthroughGuide.tsx",
    "components/demo/EnvironmentHealth.tsx",
    "app/demo/scenarios/page.tsx",
    "lib/demo/scenario-actions.ts",
    "lib/demo/scenario-registry.ts",
  ]) {
    const src = code(file);
    assert.ok(
      !/recordGateSignoff|recordClinicalDecision|review_decisions|requireReviewer/.test(src),
      `${file} can reach the review decision path`
    );
  }
});

test("the release screen is reached through review access, not a scenario", () => {
  const src = code("app/review/release/page.tsx");
  assert.match(src, /await requireReviewAccess\(\)/);
  // The investor story may LINK to a review surface — that is §7.2's "real
  // working screens" — but the link confers nothing; the destination checks.
  // Asserted as the IMPORT GRAPH rather than as a word search, because the
  // word "grant" appears in `assertGrantsNothing`, which is the function that
  // proves the property rather than one that breaks it.
  const registry = code("lib/demo/scenario-registry.ts");
  const imports = [...registry.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  for (const imp of imports) {
    assert.ok(
      !/auth|session|review|roles/i.test(imp),
      `the scenario registry imports ${imp}, so a story could reach authorization`
    );
  }
});

test("the contract is pure", () => {
  const src = code("lib/review/release-readiness.ts");
  assert.ok(!/\bSELECT\b|\bINSERT\b|\bUPDATE\b/.test(src), "the readiness contract contains SQL");
  const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  for (const imp of imports) {
    assert.ok(!/\/(db|data|repo)$/.test(imp), `it imports ${imp}`);
  }
});
