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
import { inventory, layoutsFor, reachableSource } from "../src/lib/governance/access-evidence";
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

test("a member reading their own record owes no access audit either", () => {
  // The same correction step 3 needed, for the same reason. An access audit
  // records who looked at WHOSE record; a member is the subject rather than a
  // third party, and logging every page view of somebody's own data turns an
  // accountability record into a log of what they read about themselves.
  //
  // Thirty-four member routes were being counted against this before the
  // distinction was drawn.
  const mine = ROUTE_REGISTER.find((r) => r.path === "/app/progress")!;
  assert.ok(!stepsFor(mine).includes(7), "a member owes an access audit on their own page");
  const theirs = ROUTE_REGISTER.find((r) => r.path === "/clinician/member/[id]")!;
  assert.ok(stepsFor(theirs).includes(7), "a clinician owes no access audit on somebody else's chart");
  const aggregate = ROUTE_REGISTER.find((r) => r.path === "/payer/overview")!;
  assert.ok(stepsFor(aggregate).includes(7), "an aggregate console owes no access audit");
});

test("an access audit is not any audit", () => {
  // THE MARKER PRODUCED FALSE COVERAGE BEFORE IT WAS NARROWED. It was
  // `audit(`, which matches every event this product records — so member routes
  // inherited one from `subscriptionActive`, whose module writes
  // `subscription_ended` and `subscription_renewed`. A billing lifecycle event
  // is not evidence that somebody's record was read.
  const seven = ACCESS_STEPS.find((s) => s.n === 7)!;
  assert.ok(!seven.evidence.includes("audit("), "any audit counts as an access audit again");
  assert.ok(
    seven.evidence.some((e) => e.includes("security")),
    "the security family is no longer accepted as an access audit"
  );
  assert.ok(
    seven.evidence.some((e) => /_viewed|_opened|_accessed|_read/.test(e)),
    "an event that says what was looked at is no longer accepted"
  );
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

test("the walk follows a server action handed to a component", () => {
  // A FIFTH FORM OF USE, and the most consequential one it was blind to.
  //
  // `action={requestOrgExport}` is neither a call nor a JSX element, and what
  // it hands over is the one write path that produces a governed export. The
  // reports screen renders no figure of its own — its suppression lives
  // entirely in the file that action produces — so at call-and-JSX detection
  // only it reported no suppression while being the single route on the
  // console whose whole job is a disclosure.
  for (const path of ["/organization/reports", "/payer/contract"]) {
    const row = inv.routes.find((r) => r.path === path);
    assert.ok(row, `${path} is not in the register`);
    assert.ok(
      (row!.found[6] ?? []).length > 0,
      `${path} produces a governed export and shows no suppression`
    );
  }

  // The marker it finds is the CALLER'S half of the contract. `createExport`
  // cannot suppress a column it has not been told is a count of people, and
  // the type makes every caller name them — including naming none, which is
  // what the contract report does and why it is a declaration rather than an
  // omission.
  const actions = code("src/lib/intelligence/export-actions.ts");
  assert.match(actions, /countColumns: \["referred", "contacted", "started"\]/,
    "the site export no longer names its count columns");
  assert.match(actions, /countColumns: \[\]/,
    "the contract export no longer declares that it has no count columns");
  assert.match(code("src/lib/intelligence/export.ts"), /req\.countColumns\.includes\(col\)/,
    "the export path no longer suppresses the columns its caller named");
});

test("the walk finds a body that opens inside a call's parentheses", () => {
  // A FOURTH FIDELITY BUG, and the first one caught by disbelieving a
  // regression rather than a cell.
  //
  // `recordAggregateAccess` was rewritten from a function declaration to
  // `const recordAggregateAccess = cache(async (…) => { … })` — the shape
  // request-scoped memoisation takes — and twenty aggregate routes went from
  // audited to unaudited without a line of their own changing. The walk's
  // brace-matcher took the first `{` at paren depth zero, and an arrow body
  // inside `cache(` sits at depth one, so it read the function as having no
  // body and none of its markers reached the routes.
  //
  // Asserted on the routes rather than on the matcher, because the matcher is
  // private and the thing that matters is the answer, not the mechanism.
  const aggregate = inv.routes.filter(
    (r) => r.path.startsWith("/organization/") || r.path.startsWith("/payer/")
  );
  assert.ok(aggregate.length > 10, "the aggregate consoles are missing from the register");
  const unaudited = aggregate
    .filter((r) => r.owed.includes(7) && !r.exempt.includes(7) && (r.found[7] ?? []).length === 0)
    .map((r) => r.path);
  assert.deepEqual(
    unaudited, [],
    `these aggregate consoles show no access audit: ${unaudited.join(", ")}`
  );
});

test("the walk does not reach through the whole codebase", () => {
  // THE FAILURE THAT WOULD MAKE THIS SCREEN WORTHLESS: a walk deep enough to
  // find `audit(` from anywhere, so every route reads green regardless of what
  // it actually calls.
  //
  // THIS USED TO BE CHECKED BY "SOME ROUTE STILL HAS A GAP", and that stopped
  // working the moment the last gap closed. It was a proxy, and a bad one in
  // both directions: it would have passed a hopelessly deep walk over a
  // codebase with one unguarded route, and it failed a correctly-bounded walk
  // over a codebase with none. A test that a codebase can only pass by staying
  // imperfect is a test that will be deleted the week it finally fails.
  //
  // WHAT REPLACES IT IS A NEGATIVE CONTROL. `/app/ground` is a member page
  // three hops from the aggregate consoles: its layout, its own imports and
  // their bodies contain nothing from `lib/intelligence`. If a marker that
  // lives there turns up in its reachable source, the walk is transitive and
  // every green cell on the screen is meaningless.
  const ground = reachableSource("app/app/ground/page.tsx", "/app/ground");
  assert.ok(ground.length > 0, "the walk found no source at all for /app/ground");
  for (const foreign of [
    "aggregate_console_viewed",  // lib/intelligence/scope.ts
    "suppressSmallCells(",       // the aggregate suppression helpers
    "countColumns:",             // lib/intelligence/export-actions.ts
  ]) {
    assert.ok(
      !ground.includes(foreign),
      `the walk reached "${foreign}" from a member page; it is following imports transitively`
    );
  }

  // And the other direction on the same route: the walk is not empty either.
  // A bounded walk that finds nothing anywhere would also pass the check above.
  assert.match(ground, /requireMember\(/, "the walk missed the member layout's own guard");
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

test("an exemption beats the evidence, rather than filling in behind it", () => {
  // A CORRECTION THE MEMBER LAYOUT FORCED. The exemption used to run only when
  // no evidence was found. Then the member tree got a layout — and because a
  // layout's source is part of every route beneath it, the walk began finding
  // `requireMember(` and `hasConsent(` on /app/ground, which takes that
  // layout's OPEN branch and calls neither. The inventory reported grounding as
  // authenticated: false coverage, which is worse than a false gap, because a
  // reviewer reads a guard that does not run.
  //
  // A static walk cannot see which branch a layout takes. A declared exemption
  // can say what the route owes, so it is checked first.
  const row = inv.routes.find((r) => r.path === "/app/ground");
  assert.ok(row);
  for (const n of [1, 2, 4]) {
    assert.ok(row.exempt.includes(n), `grounding no longer declares step ${n} as exempt`);
    assert.deepEqual(row.found[n], [], `grounding reports evidence for step ${n} that never runs`);
  }
  // The rule in general: nothing declared exempt is also reported as shown.
  const contradictions: string[] = [];
  for (const r of inv.routes) {
    for (const n of r.exempt) {
      if ((r.found[n] ?? []).length > 0) contradictions.push(`${r.path} step ${n}`);
    }
  }
  assert.deepEqual(contradictions, [], `exempt and shown at once: ${contradictions.join(", ")}`);
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

test("the open questions moved into the exemption list rather than disappearing", () => {
  // WHAT THIS SCREEN SHIPPED WITH: fifty-seven routes reading a protected
  // record with no access audit event, nineteen member care routes with no
  // consent check, twenty-four aggregate consoles reading a population without
  // recording that anybody had, and two projections handing out an unversioned
  // payload. Every one of those is closed, and this test used to assert they
  // were open — a record of a state, which stopped being true.
  //
  // THE OPEN QUESTIONS DID NOT GO AWAY. They changed form. A route that shows
  // every step it owes may still owe a step somebody DECIDED it does not, and
  // that decision is the thing a reviewer should argue with. So the assertion
  // is that the decisions are still on the screen and still attached to
  // reasons, rather than that some cell is still empty.
  const exempted = inv.routes.filter((r) => r.exempt.length > 0);
  assert.ok(exempted.length > 0, "no route declares an exemption, which no real codebase looks like");
  for (const r of exempted) {
    for (const n of r.exempt) {
      const e = exemption(r.path, n);
      assert.ok(e, `${r.path} is exempt from step ${n} with no entry behind it`);
      assert.ok(
        e!.reason.length > 120,
        `${r.path} step ${n} is exempt on a one-liner; an exemption is an argument, not a label`
      );
    }
  }

  // And the screen has to say so when nothing is missing, rather than going
  // quiet. A blank Open questions panel reads as "not checked".
  const page = code("src/app/review/security/page.tsx");
  assert.match(page, /withGaps\.length === 0/, "the screen has no empty state for a complete walk");
});

test("reading somebody else's record is audited at the one place every tab passes through", () => {
  // Eight of the fifteen clinician person tabs read a chart without recording
  // that anybody had, and the two that did each wrote their own event from
  // their own page — the same shape as the five prefixes of the member gate
  // chain, one layer down.
  //
  // It goes where the tenant scope already goes: a sub-route cannot ship
  // unscoped by forgetting the WHERE clause, and should not be able to ship
  // unaudited by forgetting a line.
  const header = code("src/lib/clinical/person-header.ts");
  assert.match(header, /type: "person_record_viewed"/, "the person header records no access");
  assert.match(header, /family: "security"/);
  // AFTER the lookup: a person outside this tenant returns null above, and
  // recording a refused read would put the subject's id in the trail on the
  // strength of somebody guessing it.
  const nullReturn = header.indexOf("if (!person) return null;");
  const record = header.indexOf("recordAccess(");
  assert.ok(nullReturn > 0 && record > nullReturn, "a refused read is audited as an access");
  // And no person page keeps its own generic copy.
  const generic: string[] = [];
  const dir = path.join(ROOT, "src/app/clinician/member/[id]");
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== "page.tsx") continue;
      if (/type: "member_record_viewed"|type: "person_record_viewed"/.test(
        code(path.relative(ROOT, p))
      )) generic.push(path.relative(ROOT, p));
    }
  };
  walk(dir);
  assert.deepEqual(generic, [], `these pages write their own generic access event: ${generic.join(", ")}`);
});

test("an aggregate console records its read once per request, not once per call", () => {
  // A drilldown is a disclosure whether or not it names anybody, and
  // twenty-four organization and payer routes read a population without
  // recording that anybody had.
  //
  // ONCE PER REQUEST. A console resolves its tenant from the page and again
  // from the components beneath it, and the first version wrote twelve
  // identical rows for four page views. An access trail with three entries for
  // one read is harder to answer a question from than one with a single entry.
  const scope = code("src/lib/intelligence/scope.ts");
  assert.match(scope, /type: "aggregate_console_viewed"/, "the aggregate scope records no access");
  assert.match(scope, /cache\(/, "the aggregate access event is not memoised per request");
  // Recorded with the tenant that was actually resolved, so a refused request
  // puts nothing in the trail.
  assert.match(scope, /if \(!tenantId\) return;/, "a refused scope is recorded as an access");
});

test("a projection version says which POLICY produced it, not only which build", () => {
  // §30.6 step 8 asks for "the projection version", and a version that names
  // only the schema answers the wrong question here.
  //
  // The person record's `band` is computed by the priority policy. Two records
  // stamped `clinician_patient.v1` under different policies are not comparable
  // — the same member is "elevated" on one and "routine" on the other, and
  // nothing on either screen says why. So the policy version is joined INTO
  // the projection version rather than parked in a field beside it, which is
  // the same shape the clinician queue already uses.
  const header = code("src/lib/clinical/person-header.ts");
  assert.match(
    header, /projectionVersion: `\$\{CLINICIAN_PATIENT_SCHEMA\}\+\$\{policy\.version\}`/,
    "the person record's projection version does not carry the policy that computed its band"
  );
  // The watermark is the evidence behind the band, not the render time — a
  // watermark equal to `now` on every request carries no information at all.
  assert.match(
    header, /sourceWatermark: head\?\.evidenceAt \?\? null/,
    "the person record's watermark is not the evidence it reflects"
  );

  // AND IT REACHES THE SCREEN. A version held in a payload nobody renders
  // settles no argument about a screenshot, which is the argument it exists
  // to settle.
  assert.match(
    code("src/components/clinical/PersonShell.tsx"), /\{person\.meta\.projectionVersion\}/,
    "the person header computes a projection version and never shows it"
  );

  // The audit trace, on the same terms. Its chain state is what changes the
  // meaning of the rows, so that is what travels in its version.
  const trace = code("src/lib/clinical/audit-history.ts");
  assert.match(
    trace, /chain:\$\{chain\.ok \? "verified" : "broken"\}/,
    "the audit trace's version does not say whether the chain verified"
  );
  assert.match(
    code("src/app/review/audit/page.tsx"), /\{feed\.meta\.projectionVersion\}/,
    "the audit console never renders the version of the trace it is showing"
  );
});

test("an access audit never fails a read", () => {
  // §30.6's fail-closed rule is about protected EVIDENCE and high-impact
  // actions — the envelope's `audit_unavailable` state — not about withholding
  // a chart from a clinician who is with a member.
  for (const rel of ["src/lib/clinical/person-header.ts", "src/lib/intelligence/scope.ts"]) {
    const src = code(rel);
    const at = src.indexOf("family: \"security\"");
    assert.ok(at > 0, `${rel} writes no access event`);
    assert.match(src.slice(at, at + 600), /catch/, `${rel} lets a failed audit throw into a render`);
  }
});
