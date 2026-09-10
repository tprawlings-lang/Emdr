process.env.EMDR_DATA_DIR = `/tmp/steady-enrollgate-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "enroll-gate-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "enroll-gate-test-secret-not-a-real-secret";

// The enrollment gate: a shared code, a hard cap, and both doors asking.
//
// WHAT §12 CLOSED AND WHY THIS IS NOT THAT. The retail signup form let anybody
// who found the page put a real name and a real address into a review
// environment, and no reset could keep up with it. A pilot gate is a different
// object: a code stops the open internet, a cap makes the exposure a number
// somebody chose, and the count makes it readable. Take away any one of the
// three and it is the old door again.
//
// THE THING THESE GUARDS ARE REALLY PROTECTING is not the account table. Two
// screens after this form, a real person is asked whether they have had
// suicidal thoughts in the past thirty days. Every refusal below is between the
// open internet and that question.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { collectEnvIssues as collectEnvIssuesSync } from "../src/lib/env-guard";
import { getDb } from "../src/lib/db";
import { resetDemoData } from "../src/lib/demo-reset";
import {
  checkEnrollment, enrolledCount, enrollmentOpen, enrollmentState, pilotTenantId,
  verifyEnrollmentCode, ENROLLMENT_LIMIT, PILOT_TENANT_ID,
} from "../src/lib/enrollment/gate";

const CODE = "pilot-code-for-tests";
const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

/** Run `fn` with the gate configured, and put the environment back either way. */
async function withCode<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const was = process.env.EMDR_ENROLLMENT_CODE;
  if (value === undefined) delete process.env.EMDR_ENROLLMENT_CODE;
  else process.env.EMDR_ENROLLMENT_CODE = value;
  try { return await fn(); } finally {
    if (was === undefined) delete process.env.EMDR_ENROLLMENT_CODE;
    else process.env.EMDR_ENROLLMENT_CODE = was;
  }
}

/** A real person, written straight to the tables. The action's own path is
 *  covered end to end by tests/e2e/enrollment.spec.ts; what the cap needs is
 *  bodies to count. */
function seedRealPerson(id: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status)
     VALUES (?, ?, 'Pilot Person', 'member', 'x', 'active')`
  ).run(id, `${id}@example.test`);
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Pilot Person', 'real')"
  ).run(id, "00000000000000000000000000");
}

// ---------------------------------------------------------------------------
// Unset means closed
// ---------------------------------------------------------------------------

test("with no code configured, enrollment is closed", async () => {
  await withCode(undefined, async () => {
    assert.equal(enrollmentOpen(), false);
    // And it refuses whatever is presented — including an empty string, which
    // is what an unset variable and a blank field both look like.
    for (const attempt of ["", "anything", CODE]) {
      const v = await checkEnrollment(attempt);
      assert.equal(v.ok, false, `an unconfigured gate admitted "${attempt}"`);
      assert.match((v as { reason: string }).reason, /closed/i);
    }
    assert.equal(verifyEnrollmentCode(""), false, "an unset code matched an empty string");
  });
});

test("the environment is read at call time, so a build cannot freeze the gate open", () => {
  // A `const OPEN = process.env.EMDR_ENROLLMENT_CODE` at module scope is baked
  // into the bundle, and an image built where the variable was set would carry
  // enrollment open into every environment it was then deployed to.
  const src = code("src/lib/enrollment/gate.ts");
  // ANCHORED AT COLUMN ZERO. `^\s*const` also matches an indented const inside
  // a function — `verifyEnrollmentCode` has one — so the first version of this
  // failed against a file that was correct. Module scope is the absence of
  // indentation here, and that is the thing being asserted.
  assert.doesNotMatch(
    src, /^const\s+\w+\s*=\s*process\.env\.EMDR_ENROLLMENT_CODE/m,
    "the code is captured at module scope, so the build freezes the gate's state"
  );
  assert.match(src, /function enrollmentOpen\(\)[\s\S]{0,140}process\.env\.EMDR_ENROLLMENT_CODE/);
});

test("the signup route still redirects when the gate is unconfigured", () => {
  // The §12 behaviour, unchanged. A deployment that has never heard of this
  // variable behaves exactly as it did before the feature existed.
  const page = code("src/app/signup/page.tsx");
  assert.match(page, /if \(!state\.open\) redirect\("\/request-review/,
    "the signup page no longer redirects when enrollment is closed");
});

// ---------------------------------------------------------------------------
// The code itself
// ---------------------------------------------------------------------------

test("a wrong code is refused, and the right one is not", async () => {
  await withCode(CODE, async () => {
    assert.equal(enrollmentOpen(), true);
    assert.equal((await checkEnrollment(CODE)).ok, true, "the correct code was refused");
    for (const wrong of ["", " ", "wrong", CODE.toUpperCase(), CODE + "x", CODE.slice(0, -1)]) {
      const v = await checkEnrollment(wrong);
      assert.equal(v.ok, false, `the gate admitted "${wrong}"`);
    }
  });
});

test("surrounding whitespace is forgiven, because people paste codes", async () => {
  await withCode(CODE, () => {
    assert.equal(verifyEnrollmentCode(`  ${CODE}\n`), true);
  });
});

test("the comparison is constant-time and does not throw on a length mismatch", async () => {
  // `crypto.timingSafeEqual` throws when the buffers differ in length, so a
  // naive call turns a short guess into a 500 rather than a refusal — and a
  // 500 is itself an answer about the code's length.
  await withCode(CODE, () => {
    assert.doesNotThrow(() => verifyEnrollmentCode("x"));
    assert.equal(verifyEnrollmentCode("x"), false);
    const src = code("src/lib/enrollment/gate.ts");
    assert.match(src, /timingSafeEqual/, "the code is compared with ===, which leaks it by timing");
  });
});

test("a refusal does not say whether a code exists to guess at", async () => {
  // "No code configured" and "wrong code" answering differently tells somebody
  // probing which environments are worth probing.
  await withCode(CODE, async () => {
    const wrong = await checkEnrollment("nope");
    assert.equal(wrong.ok, false);
    assert.doesNotMatch((wrong as { reason: string }).reason, /configur|unset|environment variable/i,
      "the refusal describes the server's configuration");
  });
});

// ---------------------------------------------------------------------------
// The cap
// ---------------------------------------------------------------------------

test("the cap refuses the twenty-sixth person, with the correct code", async () => {
  const db = getDb();
  resetDemoData(db);
  await withCode(CODE, async () => {
    assert.equal(await enrolledCount(), 0, "the seeded population contains a real person");
    for (let i = 0; i < ENROLLMENT_LIMIT; i += 1) seedRealPerson(`pilot-${i}`);
    assert.equal(await enrolledCount(), ENROLLMENT_LIMIT);

    const v = await checkEnrollment(CODE);
    assert.equal(v.ok, false, "the cap admitted one past the limit");
    // Says the number, so the person on the other side can tell a full pilot
    // from a fault.
    assert.match((v as { reason: string }).reason, new RegExp(String(ENROLLMENT_LIMIT)));
    assert.match((v as { reason: string }).reason, /full/i);
  });
  resetDemoData(db);
});

test("the cap counts real people, not fabricated ones", async () => {
  // The seeded population is 240-odd fabricated profiles. If the count included
  // them the pilot would be full before it opened — and if it counted by email
  // shape instead of provenance there would be two disagreeing definitions of
  // the same thing.
  const db = getDb();
  resetDemoData(db);
  await withCode(CODE, async () => {
    const fabricated = (db.prepare(
      "SELECT COUNT(*) AS n FROM persons WHERE provenance = 'fabricated'"
    ).get() as { n: number }).n;
    assert.ok(fabricated > 100, `expected a seeded population, found ${fabricated}`);
    assert.equal(await enrolledCount(), 0, "fabricated people are being counted against the cap");
    assert.equal((await checkEnrollment(CODE)).ok, true);
  });
});

test("the state a screen renders agrees with the gate that refuses", async () => {
  const db = getDb();
  resetDemoData(db);
  await withCode(CODE, async () => {
    let s = await enrollmentState();
    assert.equal(s.open, true);
    assert.equal(s.full, false);
    assert.equal(s.remaining, ENROLLMENT_LIMIT);

    for (let i = 0; i < ENROLLMENT_LIMIT; i += 1) seedRealPerson(`state-${i}`);
    s = await enrollmentState();
    assert.equal(s.full, true, "the screen would offer a form the gate refuses");
    assert.equal(s.remaining, 0, "a full pilot still advertises places");
  });
  resetDemoData(db);
});

// ---------------------------------------------------------------------------
// Both doors
// ---------------------------------------------------------------------------

test("the mobile signup API asks the same gate, before it validates anything", () => {
  // THE DOOR THAT WAS OPEN. §12 closed /signup on the web and this route kept
  // creating accounts with no code and no cap.
  const src = code("src/lib/mobile/onboarding.ts");
  const at = src.indexOf("export async function signupMobile");
  assert.ok(at > 0, "signupMobile is gone");
  // BOUNDED BY THE FUNCTION'S OWN CLOSING BRACE, which is a `}` alone on a
  // line. Searching for "\n}" instead found the closing brace of the
  // destructured PARAMETER TYPE 154 characters in, so the slice ended before
  // any of the body and the guard reported a gate that was there as missing.
  const end = src.indexOf("\n}\n", at);
  assert.ok(end > at, "could not find the end of signupMobile");
  const body = src.slice(at, end);
  // THE CALL, NOT THE DESTRUCTURE. `const { checkEnrollment } = await
  // import(...)` stays behind when the call below it is deleted, so matching
  // the bare identifier would pass against an ungated route.
  assert.match(body, /await checkEnrollment\(/,
    "the mobile signup path does not ask the enrollment gate");
  assert.match(body, /if \(!gate\.ok\)/, "the mobile path never acts on the gate's verdict");

  // BEFORE the duplicate-address check, or a client with no code can use the
  // error messages to enumerate who is registered.
  const gateAt = body.indexOf("await checkEnrollment(");
  const existsAt = body.indexOf("SELECT id FROM users WHERE email");
  assert.ok(existsAt > 0, "the duplicate-address check is gone");
  assert.ok(gateAt < existsAt,
    "the gate runs after the address check, so a caller without a code can enumerate accounts");
});

test("both doors mark the person real, and say so where a reader will see it", () => {
  // A human filled in the form, so their answers must never pool with the
  // fabricated population. It is the default; it is passed explicitly at both
  // call sites so that reading either file answers the question.
  for (const rel of ["src/lib/enrollment/actions.ts", "src/lib/mobile/onboarding.ts"]) {
    const src = code(rel);
    const at = src.indexOf("provisionPerson({");
    assert.ok(at > 0, `${rel} no longer provisions a person`);
    const call = src.slice(at, src.indexOf("});", at));
    assert.match(call, /provenance: "real"/,
      `${rel} does not state the person's provenance at the call site`);
  }
});

test("the web action gates before it validates, for the same reason", () => {
  const src = code("src/lib/enrollment/actions.ts");
  // THE CALL, NOT THE IMPORT. The first version searched for the bare
  // identifier, and `import { checkEnrollment } from "./gate"` sits at the top
  // of the file — trivially before the email query — so deleting the actual
  // check left this passing. A mutation proved it: removing the two lines that
  // gate the action survived the whole suite.
  const gateAt = src.indexOf("await checkEnrollment(");
  const existsAt = src.indexOf("SELECT id FROM users WHERE email");
  assert.ok(gateAt > 0, "the enrollment action never calls the gate");
  assert.ok(existsAt > 0, "the duplicate-address check is gone");
  assert.ok(gateAt < existsAt,
    "the form validates before it checks the code, so a visitor without one can enumerate accounts");
  // And the refusal is acted on rather than computed and dropped.
  const after = src.slice(gateAt, gateAt + 200);
  assert.match(after, /if \(!gate\.ok\)/, "the gate's verdict is never acted on");
});

test("the form collects an explicit, un-prechecked acknowledgement of both things", () => {
  // Compliance packet 3.4: never pre-checked. Two boxes, because "this is not
  // care" and "your safety answers are read by us" are different things to
  // agree to, and one box lets a reader agree to the half they noticed.
  const page = code("src/app/signup/page.tsx");
  for (const field of ["wellness_ack", "data_ack"]) {
    assert.match(page, new RegExp(`name="${field}" type="checkbox"`),
      `the form has no ${field} checkbox`);
  }
  assert.doesNotMatch(page, /type="checkbox"[^>]*\bchecked\b/, "an acknowledgement is pre-checked");
  assert.doesNotMatch(page, /defaultChecked/, "an acknowledgement is pre-checked");

  const action = code("src/lib/enrollment/actions.ts");
  for (const field of ["wellness_ack", "data_ack"]) {
    assert.match(action, new RegExp(`get\\("${field}"\\) !== "on"`),
      `${field} is collected on the form and never checked by the action`);
  }
});

test("the page says what the next screens will ask, before asking for a name", () => {
  // The access code is the smaller half of doing this responsibly. A person
  // deciding whether to type their name needs to know that two screens later
  // they will be asked about suicidal thoughts — and needs it above the field,
  // not under the button.
  const page = code("src/app/signup/page.tsx");
  const noticeAt = page.indexOf("Before you enter anything");
  const nameAt = page.indexOf('name="name"');
  assert.ok(noticeAt > 0, "the form does not say what it is about to ask for");
  assert.ok(nameAt > 0);
  assert.ok(noticeAt < nameAt, "the notice is below the name field");
  assert.match(page, /suicidal thoughts/i, "the page never says what the safety questions ask");
  assert.match(page, /not monitored in real time|no one is watching in real time/i,
    "the page does not say the environment is unmonitored");
  assert.match(page, /988/, "the page offers no crisis route");
});

// ---------------------------------------------------------------------------
// A reset would delete them
// ---------------------------------------------------------------------------

test("a reset refuses while enrolled people exist, unless deliberately acknowledged", () => {
  // resetDemoData runs DELETE FROM over users, persons, consents, checkins and
  // screenings unconditionally. That is right for a seeded population and
  // catastrophic for a pilot — and it reports success either way.
  const src = code("src/lib/demo-reset-actions.ts");
  assert.match(src, /enrolledCount\(\)/, "the reset never asks whether real people are here");
  assert.match(src, /if \(enrolled > 0 && !discardEnrolled\)/,
    "the reset does not refuse while enrolled people exist");
  assert.match(src, /demo_enrolled_discarded/,
    "discarding enrolled people is not recorded in the audit trail");

  // A SEPARATE checkbox from the walkthrough interrupt: different loss,
  // different deliberation.
  assert.match(src, /formData\.get\("discardEnrolled"\)/);
  assert.notEqual(
    src.indexOf('formData.get("discardEnrolled")'),
    src.indexOf('formData.get("interrupt")'),
    "the two acknowledgements are the same field"
  );

  // THE SCHEDULED PATH TOO. `runNightlyReset` calls `resetDemoData` directly
  // after only the walkthrough-lock check, so a job armed with
  // EMDR_DEMO_NIGHTLY_RESET=1 would delete every enrolled person at 9am UTC
  // with nobody awake to tick anything. A guard on the console alone would be
  // a guard on the door somebody is standing at.
  const nightly = code("src/lib/demo/nightly-reset.ts");
  assert.match(nightly, /enrolledCount\(\)/,
    "the nightly reset never asks whether real people are here");
  assert.match(nightly, /enrolled_present|enrolled/,
    "the nightly reset does not skip over enrolled people");

  // And the refusal is explainable: the console says the number and what goes.
  const page = code("src/app/admin/demo/page.tsx");
  assert.match(page, /would be deleted/, "the console never warns that a reset deletes them");
  assert.match(page, /name="discardEnrolled"/, "the console offers no way to proceed deliberately");
});

// ---------------------------------------------------------------------------
// The deployment says what it is holding
// ---------------------------------------------------------------------------

test("a deployment with enrollment open says so at boot", async () => {
  // The one setting that changes what KIND of data this instance holds. With it
  // on, real people answer the safety screener here; with it off, nothing here
  // is about anybody. That belongs in the log a person reads when they ask what
  // an instance is, rather than only in a file.
  const { collectEnvIssues } = await import("../src/lib/env-guard");
  const base = {
    NODE_ENV: "production",
    EMDR_SESSION_SECRET: "x".repeat(40),
    EMDR_DATA_KEY: "y".repeat(40),
    R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c",
    R2_BUCKET: "d", BACKUP_AGE_RECIPIENT: "e",
  } as NodeJS.ProcessEnv;

  const closed = collectEnvIssues(base);
  assert.equal(
    closed.filter((i) => i.key === "EMDR_ENROLLMENT_CODE").length, 0,
    "a deployment with enrollment closed is warned about enrollment"
  );

  const open = collectEnvIssues({ ...base, EMDR_ENROLLMENT_CODE: "a-long-enough-pilot-code" });
  const said = open.filter((i) => i.key === "EMDR_ENROLLMENT_CODE");
  assert.equal(said.length, 1, "an open deployment says nothing about it at boot");
  assert.match(said[0].message, /real people/i, "the warning does not say what changes");
  assert.match(said[0].message, /reset deletes them/i, "the warning does not mention the reset");
});

test("a short access code is fatal in production", () => {
  // It is the only thing between the open internet and a form that collects
  // health answers. A four-character code is a formality.
  const base = {
    EMDR_SESSION_SECRET: "x".repeat(40), EMDR_DATA_KEY: "y".repeat(40),
  };
  const prod = collectEnvIssuesSync({
    ...base, NODE_ENV: "production", EMDR_ENROLLMENT_CODE: "abc123",
  } as NodeJS.ProcessEnv);
  assert.ok(
    prod.some((i) => i.key === "EMDR_ENROLLMENT_CODE" && i.level === "fatal"),
    "a six-character code boots a production deployment"
  );
  // Not fatal outside production, where a short code is a convenience.
  const dev = collectEnvIssuesSync({
    ...base, NODE_ENV: "development", EMDR_ENROLLMENT_CODE: "abc123",
  } as NodeJS.ProcessEnv);
  assert.ok(
    !dev.some((i) => i.key === "EMDR_ENROLLMENT_CODE" && i.level === "fatal"),
    "a short code is fatal in development too"
  );
});

// ---------------------------------------------------------------------------
// The shell stops asserting things that stopped being true
// ---------------------------------------------------------------------------

test("the persona banner does not call a real person fabricated", () => {
  // FOUND BY DRIVING IT, not by reading it. The shell labelled whoever was
  // signed in "Fabricated persona: <name>", and after enrolling that read
  // "Fabricated persona: Pilot Tester" — telling a real person their own name
  // was invented, and telling anyone reading over their shoulder that a real
  // safety screener on the screen was synthetic data. The second is the one
  // that matters: the banner exists so a screenshot is not mistaken for a
  // record, and mislabelling this way makes a record look like a screenshot.
  const layout = code("src/app/layout.tsx");
  assert.match(layout, /personIsReal/,
    "the persona indicator never asks whether the person is real");
  assert.match(layout, /Pilot account:/,
    "there is no label for a real account");
  // Fabricated stays the fallback: every seeded person has a row, so an absent
  // one is a failed lookup rather than evidence about a human being.
  assert.match(layout, /catch\(\(\) => false\)/,
    "a failed provenance lookup does not fall back to the safe label");
});

test("the demo banner stops claiming everyone is invented once enrollment is open", () => {
  // A banner that asserts something the reader can see is untrue does not just
  // fail at its own job — it teaches people the notices on this product are
  // decoration. "Every person here is invented" was printed directly above a
  // form collecting a real person's name.
  const layout = code("src/app/layout.tsx");
  assert.match(layout, /const enrolling = Boolean\(process\.env\.EMDR_ENROLLMENT_CODE\)/,
    "the layout never asks whether enrollment is open");
  assert.match(layout, /pilot accounts are real people/i,
    "the banner has no wording for an environment with real accounts in it");
  // The unconditional claim is gone — it survives only inside the closed branch.
  const at = layout.indexOf("Every person, record, and clinician here is invented");
  assert.ok(at > 0, "the closed-environment wording is gone");
  assert.ok(
    layout.lastIndexOf("enrolling ?", at) > layout.lastIndexOf("</span>", at),
    "the 'everyone is invented' claim is not inside the enrollment conditional"
  );

  // And the header stays, because four specs and two guards read it as this
  // environment's name.
  assert.match(layout, /DEMO — FABRICATED DATA — NOT CLINICAL CARE/,
    "the demo banner's header changed, which several specs identify it by");
});

test("the login screen offers the way in when enrollment is open", () => {
  // ENROLLMENT SHIPPED WITH NOTHING LINKING TO IT. `/signup` was reachable only
  // by typing the address, which turns a pilot invitation into a scavenger
  // hunt — and the sign-in screen is the one place somebody told "go to the
  // site and sign up" is guaranteed to land.
  const page = code("src/app/login/page.tsx");
  assert.match(page, /enrollmentState\(\)/, "the login screen never asks whether enrollment is open");
  assert.match(page, /href="\/signup"/, "the login screen offers no route to enrollment");

  // Gated on the STATE, not the environment variable, so a full pilot says so
  // instead of offering a form the next screen refuses.
  const at = page.indexOf('href="/signup"');
  assert.ok(at > 0);
  const before = page.slice(0, at);
  assert.ok(
    before.lastIndexOf("{enrollment.open && (") > 0,
    "the enrollment link is not inside an enrollment.open block"
  );
  assert.match(page, /enrollment\.full \?/, "a full pilot still offers the form");
  assert.match(page, /enrollment\.remaining/, "the panel does not say how many places are left");
});

// ---------------------------------------------------------------------------
// One population per cohort
// ---------------------------------------------------------------------------

test("enrolled people get their own tenant, never the fabricated population's", async () => {
  // THE GUARD THAT CAUGHT THIS was `assertSingleProvenance`, and it caught it
  // in CI rather than here. The first version put enrollees in NE Care Network
  // A so the demo clinician's caseload would show them, and every aggregate
  // screen for that organization began answering 500:
  //
  //   cohort "all_eligible.v1" spans 42 fabricated people and 1 real ones.
  //
  // It refuses rather than filters on purpose — a filtered metric has an
  // undisclosed denominator — so the fix is the one it asks for: scope to one
  // population, at the tenant, which is what a cohort is drawn from.
  const db = getDb();
  resetDemoData(db);

  const tenant = await pilotTenantId();
  assert.equal(tenant, PILOT_TENANT_ID);

  // The tenant exists, is a valid kind, and is not one the seed populated.
  const row = db.prepare("SELECT kind, name FROM tenants WHERE id = ?").get(tenant) as
    | { kind: string; name: string } | undefined;
  assert.ok(row, "the pilot tenant was not created");
  assert.ok(
    ["platform", "organization", "facility", "program"].includes(row!.kind),
    `the pilot tenant's kind ${row!.kind} is outside the schema's closed set`
  );
  const fabricatedHere = (db.prepare(
    "SELECT COUNT(*) AS n FROM persons WHERE tenant_id = ? AND provenance = 'fabricated'"
  ).get(tenant) as { n: number }).n;
  assert.equal(fabricatedHere, 0,
    "the pilot tenant already holds fabricated people, so a cohort there spans both");

  // Idempotent: enrolling twice does not create a second tenant, and a reset
  // followed by an enrolment recreates it.
  assert.equal(await pilotTenantId(), tenant);
  resetDemoData(db);
  assert.equal(await pilotTenantId(), tenant);
});

test("both signup doors put people in the pilot tenant, not a seeded one", () => {
  // Stated at both call sites. The web action and the mobile route are the two
  // ways a real person gets an account, and one of them defaulting to the
  // platform tenant would make the same signup two different kinds of person.
  for (const rel of ["src/lib/enrollment/actions.ts", "src/lib/mobile/onboarding.ts"]) {
    const src = code(rel);
    assert.match(src, /pilotTenantId\(\)/, `${rel} does not use the pilot tenant`);
    assert.doesNotMatch(src, /orgTenantId\(/,
      `${rel} still places enrollees in a seeded organization's tenant`);
    // And the users row carries it, because that column is what the caseload
    // and every aggregate query read.
    const at = src.indexOf("INSERT INTO users");
    assert.ok(at > 0, `${rel} no longer inserts a user`);
    assert.match(src.slice(at, at + 320), /tenant_id/,
      `${rel} inserts a user without a tenant, so the column takes its default`);
  }
});

test("an event defaults to the person's own tenant, not the platform's", async () => {
  // THE DEFECT CLASS, not the instance. `appendEvent` defaulted `tenant_id` to
  // PLATFORM_TENANT_ID, which is right only for people who live there — so
  // every recorder that does not thread a tenant through (recordConsent among
  // them) tagged an event about a person in one tenant with another.
  //
  // `runQualityChecks`' "Cross-tenant references" counts exactly that and
  // expects zero. Enrolling four people produced nine, the DATA_QUALITY rule
  // fired, and the planning console blocked its own release — which is the
  // system working, over a fault this introduced.
  const db = getDb();
  resetDemoData(db);
  const tenant = await pilotTenantId();

  const { provisionPerson, grantConsent } = await import("../src/lib/spine");
  const id = "tenant-default-probe";
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES (?, 'tenant-probe@example.test', 'Probe', 'member', 'x', 'active', ?)`
  ).run(id, tenant);
  await provisionPerson({
    userId: id, name: "Probe", email: "tenant-probe@example.test",
    role: "member", tenantId: tenant, provenance: "real",
  });
  // The consent recorder takes no tenant — which is the point. It has to land
  // in the person's tenant anyway.
  await grantConsent({ userId: id, policyVersion: "probe-v1", scope: "wellness_acknowledgment" });

  const rows = db.prepare(
    "SELECT event_type, tenant_id FROM longitudinal_events WHERE person_id = ?"
  ).all(id) as { event_type: string; tenant_id: string }[];
  assert.ok(rows.length >= 2, "the probe wrote no events");
  for (const r of rows) {
    assert.equal(
      r.tenant_id, tenant,
      `${r.event_type} was written to ${r.tenant_id} for a person in ${tenant} — a cross-tenant reference`
    );
  }

  // And the environment's own check agrees.
  const { runQualityChecks } = await import("../src/lib/demo-quality");
  const cross = runQualityChecks(db).find((c) => c.check === "Cross-tenant references");
  assert.ok(cross, "the cross-tenant check is gone");
  assert.equal(cross!.pass, true, `cross-tenant references: ${cross!.actual}`);

  resetDemoData(db);
});
