// The release definition has to answer itself, or it is a checklist again.
//
// P7's exit is a "dated acceptance package", and a checklist is the easiest
// artefact in software to lie with: every box is a sentence somebody ticks, and
// the tick is indistinguishable from the work. So each of the handoff's
// twenty-three lines says HOW it is answered, and this suite holds the four
// kinds apart — because the distinction between "computed from the product",
// "a test ran somewhere", "nobody has done this" and "somebody must decide" is
// the whole value of the artefact.

process.env.EMDR_DATA_DIR = `/tmp/steady-reldef-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "reldef-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "reldef-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  RELEASE_DEFINITION, answerItem, definitionSummary, type ReleaseItem,
} from "../src/lib/review/release-definition";
import { verifyDefinition, definitionDrift } from "../src/lib/review/release-definition-verify";

test("every attested line names a test that names it back", () => {
  assert.deepEqual(
    definitionDrift().map((d) => `${d.id}: ${d.problems.join("; ")}`),
    [],
    "the release definition claims evidence the repository does not carry",
  );
});

test("a test that does not name the line is not evidence for it", () => {
  // THE RULE THAT MAKES AN ATTESTED ROW WORTH ANYTHING. A file existing under a
  // plausible name is the weakest possible evidence and is exactly what a
  // checklist drifts into claiming.
  const findings = verifyDefinition([
    { id: "fake.unlinked", text: "x", answerable: "attested", evidence: ["tests/retry.test.ts"] },
    { id: "fake.missing", text: "x", answerable: "attested", evidence: ["tests/nope.test.ts"] },
    { id: "fake.nothing", text: "x", answerable: "attested", evidence: [] },
    { id: "fake.uncomputable", text: "x", answerable: "computed" },
  ] as ReleaseItem[]);
  assert.match(findings[0].problems.join(" "), /never names fake\.unlinked/);
  assert.match(findings[1].problems.join(" "), /does not exist/);
  assert.match(findings[2].problems.join(" "), /names no evidence/);
  assert.match(findings[3].problems.join(" "), /nothing to compute/);
});

test("a line waiting on a person names one, and says what is required of them", () => {
  // A row that says only "a human must do this" is a row nobody can pick up,
  // and it will still be open at the next release for that reason.
  const findings = verifyDefinition([
    { id: "fake.vague", text: "x", answerable: "human", asks: "Somebody should look at it." },
  ] as ReleaseItem[]);
  assert.match(findings[0].problems.join(" "), /names nobody/);
  assert.match(findings[0].problems.join(" "), /does not say what is actually required/);

  for (const item of RELEASE_DEFINITION) {
    if (item.answerable === "human" || item.answerable === "decision") {
      assert.ok(item.owner, `${item.id} waits on nobody in particular`);
      assert.ok((item.asks ?? "").length > 40, `${item.id} does not say what is required`);
    }
  }
});

test("outstanding is not failing, and the summary keeps them apart", () => {
  // A package that rendered "manual accessibility is recorded" in the same
  // colour as a broken guard would flatten the difference between nobody having
  // done something yet and something being wrong — which is the distinction the
  // person reading an acceptance package most needs.
  const answers = RELEASE_DEFINITION.map(answerItem);
  const summary = definitionSummary(answers);

  assert.equal(summary.total, RELEASE_DEFINITION.length);
  assert.equal(summary.met + summary.failing + summary.outstanding, summary.total);

  for (const [i, item] of RELEASE_DEFINITION.entries()) {
    const met = answers[i].met;
    if (item.answerable === "human" || item.answerable === "decision") {
      assert.equal(met, null, `${item.id} was answered by something other than a person`);
    } else {
      assert.notEqual(met, null, `${item.id} claims to be answerable and answered nothing`);
    }
  }

  // AND THE HUMAN ROWS REALLY ARE THERE. A definition that quietly computed all
  // twenty-three would be the lie this file exists to prevent.
  assert.ok(summary.outstanding > 0, "nothing is waiting on a person, which is not true of this release");
  assert.ok(
    RELEASE_DEFINITION.some((i) => i.id === "accessibility.manual-and-human-testing" && i.answerable === "human"),
    "manual accessibility testing is being reported as something a machine did",
  );
});

test("every computed line gives a reason a reader can check", () => {
  for (const item of RELEASE_DEFINITION) {
    if (item.answerable !== "computed") continue;
    const a = item.answer!();
    assert.ok(a.because.length > 20, `${item.id} answers without saying why`);
    // A reason that is just the line restated tells a reader nothing.
    assert.notEqual(a.because.trim(), item.text.trim(), `${item.id} restates the line instead of answering it`);
  }
});

test("the lines are the handoff's, and each is answered exactly one way", () => {
  const ids = RELEASE_DEFINITION.map((i) => i.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), "two lines share an id");
  assert.equal(RELEASE_DEFINITION.length, 23, "the handoff's release definition has twenty-three lines");
  for (const item of RELEASE_DEFINITION) {
    assert.ok(item.text.trim().length > 20, `${item.id} has no line to answer`);
    const ways = [
      item.answerable === "computed" && Boolean(item.answer),
      item.answerable === "attested" && Boolean(item.evidence?.length),
      item.answerable === "human" || item.answerable === "decision",
    ].filter(Boolean);
    assert.equal(ways.length, 1, `${item.id} is answered ${ways.length} ways`);
  }
});

test("a computed line reports a real failure rather than rounding it off", () => {
  // The build-identity line is the one that fails when evidence is gathered
  // somewhere that cannot say which build it is. It has to be able to say no —
  // a definition whose computed rows can only say yes is decoration.
  const item = RELEASE_DEFINITION.find((i) => i.id === "build.identifies-itself")!;
  const saved = { render: process.env.RENDER_GIT_COMMIT, baked: process.env.EMDR_BUILD_COMMIT };
  delete process.env.RENDER_GIT_COMMIT;
  delete process.env.EMDR_BUILD_COMMIT;
  try {
    const a = item.answer!();
    assert.equal(a.met, false, "a build that cannot identify itself was accepted as evidence");
    assert.match(a.because, /cannot be tied to a build/);
  } finally {
    if (saved.render) process.env.RENDER_GIT_COMMIT = saved.render;
    if (saved.baked) process.env.EMDR_BUILD_COMMIT = saved.baked;
  }

  process.env.EMDR_BUILD_COMMIT = "0123456789abcdef0123456789abcdef01234567";
  try {
    assert.equal(item.answer!().met, true);
  } finally {
    if (saved.baked) process.env.EMDR_BUILD_COMMIT = saved.baked;
    else delete process.env.EMDR_BUILD_COMMIT;
  }
});
