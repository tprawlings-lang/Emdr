process.env.EMDR_DATA_DIR = `/tmp/steady-accessenf-${process.pid}-${Date.now()}`;

// The permission and consent sequence, over every protected route
// (handoff 06 §30.6, §31.5).
//
// §31.5 asks Security for a PROOF rather than a capability: "prove tenant,
// role, consent, purpose and minimum-necessary enforcement for every protected
// endpoint". A claim about every endpoint cannot be made by reading a few of
// them, so the inventory reads all of them — and these guards are about the
// inventory being honest, in both directions.
//
// DISHONEST IN ONE DIRECTION is a wall of green: a walk that reaches `audit(`
// from anywhere within a few hops, or a marker invented for a step that has no
// mechanism. Three fidelity bugs were found by disbelieving cells and reading
// the code behind them, and each one had produced FALSE GAPS rather than false
// coverage:
//
//   THE LAYOUT CHAIN. Four of the five consoles are guarded by their layout —
//   `src/app/clinician/layout.tsx` calls `requireClinician` once and no page
//   beneath it repeats it. Reading only page.tsx reported twenty-nine routes as
//   unguarded, which was Next.js working and the scan being wrong.
//
//   THE MODULE'S OWN HELPERS. The organization console calls `buildOrgOverview`,
//   and the small-cell threshold is applied by a helper inside that module.
//
//   JSX IS NOT A CALL. `<Figure />` never matches `Figure(`, and the aggregate
//   consoles suppress inside exactly such components.
//
// DISHONEST IN THE OTHER DIRECTION is a model that owes every step to every
// route: step 8 is a versioned payload crossing a boundary, and a
// server-rendered page has no such return. Owing it everywhere made 104 of 108
// routes read as gaps, which said nothing except that the model was wrong.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { ROUTE_REGISTER } from "../src/lib/app/route-register";
import {
  ACCESS_STEPS, ACCESS_EXEMPTIONS, STATIC_PROOF_LIMIT, PROJECTION_ROUTES,
  isProtected, stepsFor, exemption, readsAnotherPerson, isAggregate,
} from "../src/lib/governance/access-sequence";
import { inventory, layoutsFor } from "../src/lib/governance/access-evidence";
import { ACCESS_INVENTORY } from "../src/lib/governance/access-inventory.generated";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const inv = inventory();

// ---------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------

test("the eight steps of the sequence are the eight the handoff names", () => {
  assert.deepEqual(ACCESS_STEPS.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const s of ACCESS_STEPS) {
    assert.ok(s.check.trim().length > 10, `step ${s.n} has no check`);
    assert.ok(s.onFailure.trim().length > 10, `step ${s.n} does not say what happens on failure`);
    // A step nothing attacks is a step nobody has tried to break.
    assert.ok(s.attackedBy.length > 0, `step ${s.n} names no test that attacks it`);
    for (const t of s.attackedBy) {
      assert.ok(fs.existsSync(path.join(ROOT, t)), `step ${s.n} names ${t}, which does not exist`);
    }
  }
});

test("authenticating and confirming a role are different steps", () => {
  // Step 1 accepts `requireUser` — somebody is signed in. Step 2 does not: a
  // route whose only guard is authentication has confirmed no role, and
  // collapsing the two would let every signed-in account read as role-checked.
  const one = ACCESS_STEPS.find((s) => s.n === 1)!;
  const two = ACCESS_STEPS.find((s) => s.n === 2)!;
  assert.ok(one.evidence.includes("requireUser("), "step 1 no longer accepts plain authentication");
  assert.ok(!two.evidence.includes("requireUser("), "step 2 accepts authentication as a role check");
  assert.ok(two.evidence.every((e) => one.evidence.includes(e)), "a role guard that is not also an auth guard");
});

test("a step with no mechanism is reported as proven by attack, never given a marker", () => {
  // Minimum-necessary has no single named mechanism here: it is a property of
  // what the projections can return at all. Inventing a marker would turn its
  // absence into a green cell, which is the failure this whole file guards.
  const behavioural = ACCESS_STEPS.filter((s) => s.proof === "behaviourally");
  assert.ok(behavioural.length > 0, "every step now claims a static marker; check that is still true");
  for (const s of behavioural) {
    assert.deepEqual(s.evidence, [], `step ${s.n} is proven by attack and still carries markers`);
    assert.ok(s.attackedBy.length >= 2, `step ${s.n} rests on fewer than two attacking tests`);
  }
  // And it is never counted as a gap, because nothing was claimed.
  for (const s of behavioural) assert.equal(inv.gapsByStep[s.n], 0);
});

test("the limit of a static scan is stated where the inventory is built", () => {
  assert.match(STATIC_PROOF_LIMIT, /does not\s+prove the guard is correct/);
  assert.match(STATIC_PROOF_LIMIT, /attacking the boundary/);
  // And RENDERED on the screen, not merely imported by it. Matching the
  // identifier anywhere in the file passes on the import line, which is the
  // weakness this codebase has had to fix in five separate guards.
  assert.match(code("src/app/review/security/page.tsx"), /\{STATIC_PROOF_LIMIT\}/);
});

// ---------------------------------------------------------------------------
// What each route owes
// ---------------------------------------------------------------------------

test("a member reading their own record owes no care-relationship check", () => {
  // §30.6 step 3's failure behaviour is "no routine person view WITHOUT
  // RELATIONSHIP". A member opening their own progress page has no relationship
  // to resolve — they are the person. Owing it to them made thirty-six member
  // routes read as gaps.
  const mine = ROUTE_REGISTER.find((r) => r.path === "/app/progress")!;
  assert.ok(!readsAnotherPerson(mine));
  assert.ok(!stepsFor(mine).includes(3), "a member owes a relationship check on their own page");

  // Asserted against a CONSTRUCTED route as well, because no member route in
  // the register today carries a person id in its path — so the audience rule
  // is the only thing that would decide such a route, and a test that only
  // reads the register cannot see whether it works.
  const futureMemberRoute = { ...mine, path: "/app/member/[id]/notes" };
  assert.ok(
    !readsAnotherPerson(futureMemberRoute),
    "a member route with a person id in its path would owe a relationship check to themselves"
  );
  assert.ok(
    readsAnotherPerson({ ...futureMemberRoute, audience: "clinician" as const }),
    "the same path read by a clinician owes no relationship check"
  );
  // But a clinician reading somebody else's chart does.
  const theirs = ROUTE_REGISTER.find((r) => r.path === "/clinician/member/[id]")!;
  assert.ok(readsAnotherPerson(theirs));
  assert.ok(stepsFor(theirs).includes(3), "a clinician owes no relationship check on a chart");
});

test("only a route that serves a versioned payload owes the projection step", () => {
  // A server-rendered page has no DTO to version. Step 8 belongs to the API
  // boundary and to the projection consumers the handoff names.
  const page = ROUTE_REGISTER.find((r) => r.path === "/app/plan")!;
  assert.ok(!stepsFor(page).includes(8), "an ordinary page owes a projection version");
  for (const p of PROJECTION_ROUTES) {
    const entry = ROUTE_REGISTER.find((r) => r.path === p);
    assert.ok(entry, `${p} is named as a projection consumer and is not in the register`);
    assert.ok(stepsFor(entry).includes(8), `${p} serves a projection and does not owe step 8`);
  }
});

test("suppression is owed by aggregate roles and by nobody else", () => {
  const org = ROUTE_REGISTER.find((r) => r.path === "/organization/overview")!;
  assert.ok(isAggregate(org));
  assert.ok(stepsFor(org).includes(6));
  const chart = ROUTE_REGISTER.find((r) => r.path === "/clinician/member/[id]")!;
  assert.ok(!stepsFor(chart).includes(6), "a person's chart owes small-cell suppression");
});

test("a public route owes nothing, and every protected one owes at least the first two steps", () => {
  for (const entry of ROUTE_REGISTER) {
    const owed = stepsFor(entry);
    if (!isProtected(entry)) {
      assert.deepEqual(owed, [], `${entry.path} is public and owes ${owed.join(",")}`);
      continue;
    }
    assert.ok(owed.includes(1) && owed.includes(2), `${entry.path} owes neither authentication nor a role`);
  }
});

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

test("every protected route in the register resolves to a file", () => {
  // A register entry with no file is a claim about a route that does not exist,
  // and it would silently drop out of every count on the screen.
  assert.deepEqual(inv.unresolved, [], `these routes have no file: ${inv.unresolved.join(", ")}`);
  assert.ok(inv.protectedCount > 100, `only ${inv.protectedCount} protected routes checked`);
});

test("the walk follows the layout chain", () => {
  // Four of the five consoles are guarded once, in a layout. A walk that reads
  // only page.tsx reports all of them as unguarded.
  assert.ok(layoutsFor("/clinician/today").some((l) => l === "app/clinician/layout.tsx"));
  assert.ok(layoutsFor("/review/audit").some((l) => l === "app/review/layout.tsx"));
  // And the consoles come out clean on the two steps that layout carries.
  for (const p of ["/clinician/caseload", "/organization/outcomes", "/payer/cohorts", "/review/audit"]) {
    const row = inv.routes.find((r) => r.path === p);
    assert.ok(row, `${p} is not in the inventory`);
    assert.ok((row.found[1] ?? []).length > 0, `${p} shows no authentication`);
    assert.ok((row.found[2] ?? []).length > 0, `${p} shows no role check`);
  }
});

test("the walk sees a component used in JSX, not only a function that is called", () => {
  // `<Figure />` never matches `Figure(`, and the aggregate consoles apply
  // small-cell suppression inside exactly such components.
  const row = inv.routes.find((r) => r.path === "/organization/outcomes");
  assert.ok(row);
  assert.ok(
    (row.found[6] ?? []).length > 0,
    "an aggregate console that renders suppressing figures shows no suppression"
  );
});

test("the walk does not reach through the whole codebase", () => {
  // The failure that would make this screen worthless. If every route were
  // green, the walk would be finding evidence through imports rather than in
  // the code that runs.
  assert.ok(
    inv.complete < inv.protectedCount,
    "every protected route shows every step; the walk is almost certainly too deep"
  );
  assert.ok(
    Object.values(inv.gapsByStep).some((n) => n > 0),
    "no step has a single gap anywhere, which no real codebase looks like"
  );
});

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

test("every exemption names a real route that would really owe the step", () => {
  // An exemption for something never owed is a comment pretending to be a
  // control.
  for (const e of ACCESS_EXEMPTIONS) {
    const entry = ROUTE_REGISTER.find((r) => r.path === e.path);
    assert.ok(entry, `an exemption names ${e.path}, which is not a route`);
    assert.ok(
      stepsFor(entry).includes(e.step),
      `${e.path} is exempted from step ${e.step}, which it does not owe anyway`
    );
    assert.ok(
      e.reason.trim().length > 60,
      `the exemption on ${e.path} step ${e.step} does not explain itself`
    );
  }
});

test("an exemption is rendered, never subtracted", () => {
  // A reviewer who disagrees with one should find it in a list rather than by
  // noticing an absence.
  const page = code("src/app/review/security/page.tsx");
  assert.match(page, /ACCESS_EXEMPTIONS\.map\(/, "the exemptions are not on the screen");
  assert.match(page, /\{e\.reason\}/, "the exemptions are listed without their reasons");
  // And an exempt cell is distinguishable from a satisfied one.
  assert.match(page, /"exempt"/);
  assert.match(page, /"not shown"/);
});

test("grounding is reachable without an account, and says so rather than looking like a hole", () => {
  // The one exemption that matters most: there is no condition in which support
  // is withdrawn, and an inventory that reported this as a gap would invite
  // somebody to close it.
  const e = exemption("/app/ground", 1);
  assert.ok(e, "grounding no longer declares why it is open");
  assert.match(e.reason, /without signing in/i);
  const row = inv.routes.find((r) => r.path === "/app/ground");
  assert.ok(row);
  assert.ok(row.exempt.includes(1), "grounding reads as an unguarded route rather than an open one");
  assert.ok(!row.missing.includes(1));
});

test("the committed inventory matches a fresh walk", () => {
  // THE ARTEFACT NOBODY VERIFIES IS THE ARTEFACT THAT GOES STALE. The screen
  // renders a checked-in file rather than walking the tree, because the source
  // it is derived from is not present at runtime in a deployed build — and
  // because a dynamic filesystem read from a server component traces the whole
  // project into the server bundle, which deploys every source file to serve
  // one table.
  //
  // The cost of committing it is drift, and this is what stops it: change a
  // guard on any route and the suite fails until the file is regenerated.
  assert.deepEqual(
    ACCESS_INVENTORY, inv,
    "the committed inventory is stale — run: npx tsx scripts/gen-access-inventory.ts"
  );
});

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

test("the screen reports the open questions rather than only the coverage", () => {
  const page = code("src/app/review/security/page.tsx");
  assert.match(page, /Open questions/, "the gaps have no section");
  assert.match(page, /r\.missing\.includes\(s\.n\)/, "the screen cannot list which routes have a gap");
  assert.match(page, /requireReviewAccess\(/, "the screen is not behind review access");
  // And it renders the committed walk rather than reading the filesystem at
  // request time.
  assert.match(page, /ACCESS_INVENTORY/, "the screen no longer reads the committed inventory");
  assert.ok(!/from "@\/lib\/governance\/access-evidence"/.test(page),
    "the screen imports the walker, which reads the filesystem at request time");
  assert.match(code("src/lib/app/route-register.ts"), /path: "\/review\/security"/);
  assert.match(code("src/components/clinical/ReviewPage.tsx"), /href: "\/review\/security"/);
});

test("the inventory currently has open questions, and the screen will show them", () => {
  // Not an aspiration — a record of the state this shipped in. Fifty-seven
  // routes read a protected record without an access audit event, nineteen
  // member care routes have no consent check on them, and those are findings
  // this screen exists to make visible rather than numbers to tidy away.
  const withGaps = inv.routes.filter((r) => r.missing.length > 0);
  assert.ok(withGaps.length > 0, "there are no open questions; check the walk still works");
  assert.ok(inv.gapsByStep[7] > 0, "the audit gap closed without this test noticing");
});
