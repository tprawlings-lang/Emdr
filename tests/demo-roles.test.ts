// The six demo roles (handoff 07 §1.2 p6, §1.3 p7, §1.4 p8, §5.5 p50).
//
// The role model is the piece of this handoff that everything else stands on,
// and it is the piece most easily undone by one convenient line. `admin` had
// already been that line: it started as a notional superuser, quietly became
// the aggregate reporting role, and for a while was admitted to the clinical
// console "for convenience" — which handed a reporting account every patient
// record. An e2e spec caught it, months later.
//
// So the rules live here, where they fail the build.

process.env.EMDR_DATA_DIR = `/tmp/steady-roles-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "roles-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "roles-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { ROLES, DEMO_ROLES, AGGREGATE_ROLES, PERMISSIONS, landingFor, isRole, isAggregateRole } from "../src/lib/roles";
import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";

const ROOT = process.cwd();
function read(p: string): string {
  return fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), "utf8") : "";
}

// ---------------------------------------------------------------------------
// The six roles, and the one that is gone
// ---------------------------------------------------------------------------

test("all six demo roles exist, each with a landing page and both halves of its scope", () => {
  assert.equal(DEMO_ROLES.length, 6, "handoff 07 p6 specifies six demo roles");
  for (const r of DEMO_ROLES) {
    assert.ok(isRole(r.role), `${r.role} is not in the Role union`);
    assert.ok(r.landing.startsWith("/"), `${r.label} has no landing route`);
    assert.ok(r.sees.length > 10, `${r.label} does not say what it can see`);
    // The half that matters at a demonstration. A catalogue that lists only
    // capabilities cannot answer "what is this role prevented from doing",
    // which is the question a reviewer actually asks.
    assert.ok(r.cannotSee.length > 10, `${r.label} does not say what it CANNOT see`);
  }
});

test("every demo role's landing page exists as a route", () => {
  const missing = DEMO_ROLES
    .map((r) => r.landing)
    .filter((route) => {
      const p = path.join(ROOT, "src", "app", route.replace(/^\//, ""), "page.tsx");
      return !fs.existsSync(p);
    });
  assert.deepEqual(missing, [],
    "these roles land on a route that does not exist: " + missing.join(", ") +
    "\np6 requires a presenter to reach the correct landing page in two actions; a 404 is not one.");
});

test("`admin` is gone from the role model, the schema and every guard", () => {
  // Not a cosmetic rename. In this codebase `admin` meant the AGGREGATE
  // reporting role and served BOTH the organization and payer consoles; in
  // handoff 07 "Demo Admin" means something close to its opposite. Leaving the
  // name in place would have left that ambiguity sitting in a CHECK constraint.
  assert.ok(!(ROLES as readonly string[]).includes("admin"), "`admin` is still a role");

  const db = read("src/lib/db.ts");
  const checks = [...db.matchAll(/role TEXT NOT NULL CHECK \(role IN \(([^)]*)\)\)/g)].map((m) => m[1]);
  assert.ok(checks.length >= 2, "the role CHECK constraints are not where this expects them");
  for (const c of checks) {
    assert.doesNotMatch(c, /'admin'/, `a CHECK constraint still admits 'admin': ${c}`);
    assert.match(c, /'demo_admin'/, `a CHECK constraint does not admit 'demo_admin': ${c}`);
  }

  const auth = read("src/lib/auth.ts");
  assert.doesNotMatch(
    auth.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " "),
    /"admin"/,
    "an auth guard still compares against \"admin\"",
  );
});

test("the seeded database holds exactly one account per role, and no `admin`", async () => {
  getDb();
  const c = await data();
  const rows = (await c.all(
    "SELECT role, COUNT(*) AS n FROM users GROUP BY role ORDER BY role", [],
  )) as { role: string; n: number }[];
  const byRole = Object.fromEntries(rows.map((r) => [r.role, Number(r.n)]));

  assert.equal(byRole.admin, undefined, "an `admin` account survived the migration");
  for (const r of ROLES) {
    assert.ok((byRole[r] ?? 0) >= 1, `no seeded account holds the ${r} role`);
  }
  // p7: "do not use one account with a mutable role claim." The two aggregate
  // roles in particular must be two accounts — one served both for as long as
  // `admin` existed, and the boundary between them was therefore untestable.
  assert.equal(byRole.organization, 1, "there is not exactly one organization account");
  assert.equal(byRole.payer, 1, "there is not exactly one payer account");
});

// ---------------------------------------------------------------------------
// Authorization never comes from the client (p4, p7)
// ---------------------------------------------------------------------------

test("the login screen renders the role selector and grants nothing from it", () => {
  const page = read("src/app/login/page.tsx");
  assert.match(page, /name="role"/, "the login form has no role selector");
  // The catalogue is imported rather than transcribed, so a role added to the
  // model cannot go missing from the dropdown.
  assert.match(page, /DEMO_ROLES/, "the selector does not read the role catalogue");
  // And no credential reaches a public, unauthenticated page.
  assert.doesNotMatch(page, /@steady\.local/, "the login page names a demo address");
  assert.doesNotMatch(page, /password.*=.*["'][a-z0-9]{6,}["']/i, "the login page contains a password");
});

test("the server re-derives the role and never trusts the submitted one", () => {
  const actions = read("src/lib/actions.ts");
  const login = actions.slice(actions.indexOf("export async function login"), actions.indexOf("export async function logout"));

  // The submitted role may only ever be COMPARED against the stored one.
  assert.match(login, /user\?\.role !== selectedRole|user\.role !== selectedRole/,
    "the submitted role is not compared against the stored role");
  // The landing page comes from the STORED role.
  assert.match(login, /landingFor\(user\.role/,
    "the landing page is not derived from the stored role");
  assert.doesNotMatch(login, /landingFor\(selectedRole|redirect\(.*selectedRole/,
    "the submitted role reaches a redirect — p7: never calculate authorization from the dropdown");
});

test("a role mismatch fails exactly like a wrong password", () => {
  // p8's first required negative test. A distinct message, a distinct redirect
  // or a distinct status would turn the dropdown into an oracle for which role
  // an address holds — and the addresses are published in docs/demo.
  const actions = read("src/lib/actions.ts");
  const login = actions.slice(actions.indexOf("export async function login"), actions.indexOf("export async function logout"));

  const failures = [...login.matchAll(/redirect\("\/login\?error=([a-z0-9]+)"\)/g)].map((m) => m[1]);
  // Two distinct outcomes only: a generic failure, and the lockout — which is
  // about the account's state rather than about the credentials.
  assert.deepEqual([...new Set(failures)].sort(), ["1", "locked"],
    "the login action has more than one credential-failure response: " + failures.join(", "));

  const guard = login.slice(login.indexOf("const roleMismatch"), login.indexOf("await setSessionCookie"));
  assert.match(guard, /!user \|\| !verifyPassword[\s\S]*roleMismatch/,
    "a role mismatch is answered separately from a bad password");
});

// ---------------------------------------------------------------------------
// The aggregate boundary, now that it is two roles (p50)
// ---------------------------------------------------------------------------

test("the organization and payer consoles use their own guards, not the shared one", () => {
  const org = read("src/app/organization/layout.tsx");
  const payer = read("src/app/payer/layout.tsx");
  assert.match(org, /requireOrganization/, "the organization console admits any aggregate role");
  assert.match(payer, /requirePayer/, "the payer console admits any aggregate role");
  // The shared guard still exists for surfaces that genuinely serve both, but
  // it must not be what stands in front of a console.
  assert.doesNotMatch(org, /requireIntelligence/, "the organization console uses the shared guard");
  assert.doesNotMatch(payer, /requireIntelligence/, "the payer console uses the shared guard");
});

test("no aggregate role is admitted to a clinical or member surface", () => {
  const auth = read("src/lib/auth.ts");
  const clinician = auth.slice(auth.indexOf("export async function requireClinician"), auth.indexOf("export async function requireIntelligence"));
  assert.match(clinician, /user\.role !== "clinician"/,
    "requireClinician admits something other than a clinician");
  for (const r of AGGREGATE_ROLES) {
    assert.doesNotMatch(clinician, new RegExp(`role === "${r}"`),
      `requireClinician special-cases the ${r} role`);
  }
});

test("the permission matrix denies rather than omits", () => {
  // p50 written as data. "no" is spelled out for every capability a role
  // lacks, because an absent row and a denied one read identically in a table
  // and only one of them is a decision.
  for (const [capability, grants] of Object.entries(PERMISSIONS)) {
    for (const role of ROLES) {
      assert.ok(grants[role] !== undefined,
        `capability "${capability}" says nothing about the ${role} role`);
    }
  }
  // The rows p50 makes absolute.
  assert.equal(PERMISSIONS.cost_model.member, "no", "a patient can reach the cost model");
  assert.equal(PERMISSIONS.cost_model.clinician, "no", "a clinician can reach the payer cost model");
  assert.equal(PERMISSIONS.own_person_view.organization, "no", "an organization can reach a person");
  assert.equal(PERMISSIONS.own_person_view.payer, "no", "a payer can reach a person");
  assert.equal(PERMISSIONS.reset_data.reviewer, "no", "a reviewer can reset the dataset");
  // Demo admin is broad, and only inside the fabricated environment.
  assert.equal(PERMISSIONS.reset_data.demo_admin, "yes");
  assert.ok(isAggregateRole("demo_admin"), "demo_admin is not treated as an aggregate role");
});

test("landingFor covers every role, and never lands an aggregate role on a person", () => {
  for (const r of ROLES) {
    const l = landingFor(r);
    assert.ok(l.startsWith("/"), `${r} has no landing route`);
    if (isAggregateRole(r)) {
      assert.doesNotMatch(l, /^\/app\/|^\/clinician\//,
        `the ${r} role lands on a person-level surface`);
    }
  }
});

// ---------------------------------------------------------------------------
// Passwords (p5, p7)
// ---------------------------------------------------------------------------

test("every role's password is distinct and overridable from the environment", async () => {
  const { DEMO_PASSWORDS, demoPassword } = await import("../src/lib/demo-seed");
  const values = Object.values(DEMO_PASSWORDS);
  assert.equal(new Set(values).size, values.length,
    "two roles share a password — 'which role am I signed in as' then has no answer on screen");
  assert.equal(Object.keys(DEMO_PASSWORDS).length, 6, "a role has no password");

  // p7: storable outside source control, rotatable before an external review
  // cycle. The environment wins, so a rotation is a deploy variable.
  process.env.EMDR_DEMO_PASSWORD_PAYER = "rotated-for-this-test";
  try {
    assert.equal(demoPassword("payer"), "rotated-for-this-test",
      "the environment does not override the committed default");
  } finally {
    delete process.env.EMDR_DEMO_PASSWORD_PAYER;
  }
});

test("the demo logins document lists every role and its landing page", () => {
  const doc = read("docs/demo/demo-logins.md");
  assert.ok(doc.length > 0, "docs/demo/demo-logins.md is missing");
  for (const r of DEMO_ROLES) {
    assert.match(doc, new RegExp(r.landing.replace(/\//g, "\\/")),
      `the logins document does not name ${r.label}'s landing page`);
  }
  // A document that lists credentials and not their limits is a key ring.
  assert.match(doc, /[Cc]annot (see|reach)/,
    "the logins document does not say what each role cannot reach");
  assert.match(doc, /EMDR_DEMO_PASSWORD_/,
    "the logins document does not say how to rotate the passwords");
});
