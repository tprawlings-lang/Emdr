process.env.EMDR_DATA_DIR = `/tmp/steady-register-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "register-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "register-test-secret-not-real";

// The register has to be checkable, or it is the drift it replaces.
//
// A hand-maintained list of what is built goes stale exactly like the handoff
// paragraphs it exists to retire. So every claim is checked against the source
// and this suite fails when one stops being true.
//
// IT PAID FOR ITSELF ON THE FIRST RUN, which is the argument for it. Three of
// the eleven seeded entries were wrong as written — two pointed at test files
// that do not exist and one named a symbol that does not — and two real gaps
// came out of fixing them: `decideUnlock` was called by two screens and named
// by no test at all, and `runBackup` has no test either.

import { strict as assert } from "node:assert";
import test from "node:test";

import { WORK_REGISTER } from "../src/lib/governance/work-register";
import { verifyRegister, registerDrift, factsFor } from "../src/lib/governance/work-register-verify";

test("every entry's claim is supported by the source", () => {
  const drift = registerDrift();
  assert.deepEqual(
    drift.map((d) => `${d.id}: ${d.problems.join("; ")}`),
    [],
    "the register claims things the source does not support",
  );
});

test("ids are unique, so two entries cannot describe the same work differently", () => {
  const ids = WORK_REGISTER.map((e) => e.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort());
});

test("a held entry says why it is held", () => {
  // THROUGH THE VERIFIER, not by reading the register directly. Written the
  // direct way first, this passed while the verifier's own rule was deleted:
  // two implementations of one rule, and the test was exercising the copy
  // nothing else uses. The verifier is the single definition now.
  const findings = verifyRegister([
    { id: "fake.held-silent", title: "x", state: "held", code: null, test: null },
    { id: "fake.superseded-silent", title: "x", state: "superseded", code: null, test: null },
    { id: "fake.held-explained", title: "x", state: "held", code: null, test: null,
      note: "Unconfigured by decision; the environment variables are unset." },
  ]);
  assert.match(findings[0].problems.join(" "), /needs a note saying why/,
    "a held entry with no explanation is a to-do wearing a state");
  assert.match(findings[1].problems.join(" "), /needs a note saying why/);
  assert.deepEqual(findings[2].problems, []);

  // And the real register holds to it.
  for (const e of WORK_REGISTER) {
    if (e.state === "held" || e.state === "superseded") {
      assert.ok(e.note && e.note.length > 20, `${e.id} is ${e.state} with no explanation`);
    }
  }
});

test("the verifier catches a built, tested and unreachable feature", () => {
  // THE FAILURE THIS FILE WAS WRITTEN FOR. `requestUnlock` and `decideUnlock`
  // were fully built, had tests, and were referenced by no screen — recorded
  // as done and unreachable, found by accident weeks later. A check that only
  // asked "does the symbol exist" passed them the whole time.
  const findings = verifyRegister([{
    id: "fake.unreachable",
    title: "Something nothing calls",
    state: "reachable",
    // A symbol that exists and is exported, but which no other source file
    // names: the verifier's own `factsFor`, referenced only here and by its
    // own module.
    code: "src/lib/governance/work-register-verify.ts#EntryFacts",
    test: "tests/work-register.test.ts",
  }]);
  const problems = findings[0].problems.join(" ");
  assert.match(problems, /referenced by nothing outside/,
    "a feature nothing calls passes the register, which is the gap it exists to close");
});

test("the verifier catches a claim stronger than the evidence", () => {
  const findings = verifyRegister([
    { id: "fake.missing-file", title: "x", state: "built",
      code: "src/lib/does-not-exist.ts#nope", test: null },
    { id: "fake.missing-symbol", title: "x", state: "built",
      code: "src/lib/version.ts#thisIsNotExported", test: null },
    // A TEST FILE THAT GENUINELY DOES NOT NAME IT. The first version pointed
    // at this file, which mentions `versionReport` in the fixture literal
    // above — so the verifier correctly reported it as tested and the
    // assertion failed. The check was right; the fixture was reading the thing
    // next to the thing.
    { id: "fake.untested", title: "x", state: "tested",
      code: "src/lib/version.ts#versionReport", test: "tests/demo-daily-checkin.test.ts" },
  ]);
  assert.match(findings[0].problems.join(" "), /does not exist/);
  assert.match(findings[1].problems.join(" "), /does not define/);
  assert.match(findings[2].problems.join(" "), /never mentions versionReport/);
});

test("the three facts are independent, so 'wired but untested' is expressible", () => {
  // The first version walked defined -> tested -> wired and stopped at the
  // first failure, which made that state impossible to describe — and the
  // first real entry was in it. A model that cannot describe the state a thing
  // is in will be made to lie about it.
  const files = [
    { rel: "src/a.ts", src: "export function thing() {}" },
    { rel: "src/b.ts", src: "import { thing } from './a'; thing();" },
  ];
  const facts = factsFor(
    { id: "x", title: "x", state: "built", code: "src/a.ts#thing", test: null },
    files,
  );
  assert.deepEqual(facts, { defined: true, tested: false, wired: true });
});
