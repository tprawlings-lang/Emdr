// The route register's guard (handoff 09 Package 0).
//
// Package 0 asks for "one dated register distinguishing working, unavailable,
// proposed, and externally blocked" and, in §10's work column, to "block new
// top-level routes without a manifest entry". This file is what makes both
// enforceable rather than aspirational.
//
// THE FAILURE THIS EXISTS TO STOP is not a wrong entry — it is a register that
// silently stops describing the product. Both source documents carry
// carry-forward registers that were accurate when written and wrong within two
// commits, and both say so; handoff 09 §12 opens with "these entries carry
// forward the prior handoff's status at the baseline commit. They are not fresh
// assertions." A register in a PDF has no choice about that. One in code does.
//
// SO THE GUARDS ARE BIDIRECTIONAL. A route with no entry fails. An entry with
// no route fails. And — the one that actually catches drift — a route the
// register calls `working` that has quietly become a capability-absent page
// fails, because the state is checked against what the page SAYS rather than
// against what somebody remembered.
//
// THE LAST GUARD IS THE INTERESTING ONE. `PROMOTED_UNAVAILABLE` records the
// dead-end routes that navigation promotes today, which handoff 09 §1.1
// forbids. Package 0 is explicitly not allowed to fix them ("no product
// behavior change"), so the guard asserts the list matches the rails EXACTLY: a
// new dead-end promotion breaks the build, and fixing one of these requires
// deleting its entry here in the same commit. That is the difference between a
// known issue and an accepted one.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  ROUTE_REGISTER, RECONCILED, PROMOTED_UNAVAILABLE,
  REGISTER_DATE, REGISTER_COMMIT, SOURCE_BASELINE,
  routeEntry, byState, stateCounts, STATE_LABEL, STATE_NOTE,
  type CapabilityState,
} from "../src/lib/app/route-register";
import {
  MEMBER_RAIL, CLINICIAN_RAIL, REVIEW_RAIL, ORGANIZATION_RAIL,
  PAYER_RAIL, ADMIN_RAIL, personRail,
} from "../src/lib/app/rails";
import { CONSOLE_SCREENS } from "../src/components/clinical/ClinicianPage";

const root = process.cwd();

/** Every route Next will actually serve, from the filesystem. */
function actualRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx") {
        const route = p.slice(path.join(root, "src/app").length, -"/page.tsx".length);
        out.push(route === "" ? "/" : route);
      }
    }
  };
  walk(path.join(root, "src/app"));
  return out.sort();
}

function sourceOf(route: string): string {
  const rel = route === "/" ? "src/app/page.tsx" : `src/app${route}/page.tsx`;
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** Whether the page itself declares its capability absent. Matched on the
 *  phrases these pages actually use, so the check is against the shipped words
 *  rather than against a marker somebody could forget to add. */
function declaresAbsent(src: string): boolean {
  return /does not exist in this (environment|snapshot)|is not part of this environment|no message store|The capability does not exist/i.test(src);
}

// ---------------------------------------------------------------------------
// The register covers the product, and only the product
// ---------------------------------------------------------------------------

test("every route has a register entry", () => {
  // §10 Package 0: "block new top-level routes without a manifest entry."
  const missing = actualRoutes().filter((r) => !routeEntry(r));
  assert.deepEqual(
    missing, [],
    `these routes have no register entry: ${missing.join(", ")}\n` +
    "Add them to ROUTE_REGISTER with an audience, a one-line job, an owning workspace and a capability state."
  );
});

test("every register entry points at a route that exists", () => {
  const real = new Set(actualRoutes());
  const phantom = ROUTE_REGISTER.filter((r) => !real.has(r.path)).map((r) => r.path);
  assert.deepEqual(
    phantom, [],
    `these entries describe routes that do not exist: ${phantom.join(", ")}\n` +
    "A register that lists a route nobody can reach is the failure mode both source documents warn about."
  );
});

test("no route is registered twice", () => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const r of ROUTE_REGISTER) {
    if (seen.has(r.path)) dupes.push(r.path);
    seen.add(r.path);
  }
  assert.deepEqual(dupes, [], `registered more than once: ${dupes.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Every entry says something
// ---------------------------------------------------------------------------

test("every entry names a job in the reader's terms, not a page description", () => {
  for (const r of ROUTE_REGISTER) {
    // A low floor on purpose. "Sign in." is a complete job and a good one;
    // the check is for an empty or placeholder entry, not for length. The two
    // assertions below are the ones doing real work.
    assert.ok(r.job.length > 6, `${r.path} has no job: "${r.job}"`);
    assert.ok(r.job.endsWith("."), `${r.path}'s job is not a sentence: "${r.job}"`);
    // A job is what somebody comes to do. "Page", "screen" and "view" are
    // descriptions of the artefact, which is the thing the register is trying
    // not to be a list of.
    assert.ok(
      !/^(the |a |an )?(page|screen|view|list|table|dashboard)\b/i.test(r.job),
      `${r.path}'s job describes the artefact rather than the work: "${r.job}"`
    );
  }
});

test("every state that is not `working` carries its evidence", () => {
  // A state nobody has to justify is a state that drifts.
  for (const r of ROUTE_REGISTER) {
    if (r.state === "working") continue;
    assert.ok(
      r.evidence && r.evidence.length > 20,
      `${r.path} is "${r.state}" with no evidence for it`
    );
  }
});

test("the register is dated and attributed to a commit", () => {
  assert.match(REGISTER_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(REGISTER_COMMIT, /^[0-9a-f]{40}$/);
  assert.match(SOURCE_BASELINE, /^[0-9a-f]{40}$/);
  assert.notEqual(
    REGISTER_COMMIT, SOURCE_BASELINE,
    "the register claims to be compiled against the same commit the source documents saw, which would make the reconciliation below vacuous"
  );
});

test("every state has a label and a note", () => {
  const states: CapabilityState[] = ["working", "unavailable", "proposed", "externally_blocked", "redirect"];
  for (const s of states) {
    assert.ok(STATE_LABEL[s].length > 0, `${s} has no label`);
    assert.ok(STATE_NOTE[s].length > 30, `${s} has no note`);
  }
  const counts = stateCounts();
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0), ROUTE_REGISTER.length,
    "the counts do not add up to the register"
  );
});

// ---------------------------------------------------------------------------
// The state matches what the page actually says
// ---------------------------------------------------------------------------
//
// This is the guard that catches drift. Everything above checks the register
// against the filesystem; this checks it against the CONTENT.

test("every route registered `unavailable` says so on the page", () => {
  for (const r of byState("unavailable")) {
    assert.ok(
      declaresAbsent(sourceOf(r.path)),
      `${r.path} is registered as capability-absent but the page does not say so. ` +
      "A route recorded as a dead end must be one, or the register is describing an intention."
    );
  }
});

test("no route registered `working` is quietly a dead end", () => {
  // The inverse, and the one that matters more: a page that became a
  // capability notice without the register noticing would be promoted in
  // navigation as though it worked.
  const lying = ROUTE_REGISTER
    .filter((r) => r.state === "working" && declaresAbsent(sourceOf(r.path)))
    .map((r) => r.path);
  assert.deepEqual(
    lying, [],
    `these routes declare their capability absent but are registered as working: ${lying.join(", ")}`
  );
});

test("every route registered `redirect` actually redirects and nothing else", () => {
  for (const r of byState("redirect")) {
    const src = sourceOf(r.path);
    assert.match(src, /redirect\(/, `${r.path} is registered as a redirect and does not redirect`);
    assert.ok(
      src.split("\n").length < 40,
      `${r.path} is registered as a redirect but is ${src.split("\n").length} lines — a redirect that also renders is a route with two jobs`
    );
  }
});

// ---------------------------------------------------------------------------
// §1.1: navigation may not promise what does not exist
// ---------------------------------------------------------------------------

/**
 * Every destination any PRIMARY NAVIGATION promotes.
 *
 * THE RAILS ARE NOT THE WHOLE OF NAVIGATION, and the first version of this
 * guard assumed they were. `CONSOLE_SCREENS` in ClinicianPage.tsx renders a
 * second row under the title — the layer nav — and it is primary navigation by
 * every test that matters: it is on every clinician screen, it is above the
 * content, and a clinician reads it as the list of places they can go. Reading
 * only `rails.ts` recorded one dead-end promotion and missed four.
 *
 * §1.1's ruling is about promises, not about which file a promise lives in.
 */
function railDestinations(): Array<{ path: string; rail: string }> {
  const rails: Array<[string, Record<string, string | undefined>]> = [
    ["MEMBER_RAIL", MEMBER_RAIL],
    ["CLINICIAN_RAIL", CLINICIAN_RAIL],
    ["REVIEW_RAIL", REVIEW_RAIL],
    ["ORGANIZATION_RAIL", ORGANIZATION_RAIL],
    ["PAYER_RAIL", PAYER_RAIL],
    ["ADMIN_RAIL", ADMIN_RAIL],
    ["personRail", personRail("[id]") as Record<string, string | undefined>],
  ];
  const out: Array<{ path: string; rail: string }> = [];
  for (const [name, rail] of rails) {
    for (const [layer, dest] of Object.entries(rail)) {
      if (dest) out.push({ path: dest, rail: `${name}.${layer}` });
    }
  }
  // The clinician layer nav, which is the row a clinician actually reads.
  for (const s of CONSOLE_SCREENS) {
    out.push({ path: s.href, rail: `CONSOLE_SCREENS.${s.layer}` });
  }
  return out;
}

test("every rail destination is a route the register knows", () => {
  const unknown = railDestinations()
    .filter((d) => !routeEntry(d.path))
    .map((d) => `${d.rail} -> ${d.path}`);
  assert.deepEqual(unknown, [], `navigation promotes routes with no register entry: ${unknown.join(", ")}`);
});

test("the dead-end promotions match PROMOTED_UNAVAILABLE exactly", () => {
  // §1.1's ruling, enforced without fixing it — which is Package 0's whole
  // posture. A NEW dead-end promotion fails here; clearing one of the recorded
  // ones requires deleting its entry in the same commit.
  const found = railDestinations()
    .filter((d) => routeEntry(d.path)?.state === "unavailable")
    .map((d) => `${d.rail} -> ${d.path}`)
    .sort();
  const recorded = PROMOTED_UNAVAILABLE
    .map((p) => `${p.promotedBy} -> ${p.path}`)
    .sort();
  assert.deepEqual(
    found, recorded,
    "navigation's dead-end promotions and PROMOTED_UNAVAILABLE disagree.\n" +
    `Navigation promotes: ${found.join(", ") || "(none)"}\n` +
    `The register records: ${recorded.join(", ") || "(none)"}\n` +
    "§1.1: a navigation item is a promise. Either record the new one with the package that closes it, or remove an entry that is no longer true."
  );
});

test("every recorded promotion names who promotes it and which package closes it", () => {
  for (const p of PROMOTED_UNAVAILABLE) {
    assert.ok(routeEntry(p.path), `${p.path} is not in the register`);
    assert.equal(routeEntry(p.path)!.state, "unavailable");
    assert.ok(p.promotedBy.includes("."), `${p.path} does not name the exact rail layer: "${p.promotedBy}"`);
    assert.match(p.due, /Package \d/, `${p.path} has no package that closes it: "${p.due}"`);
  }
});

// ---------------------------------------------------------------------------
// The reconciliation is real
// ---------------------------------------------------------------------------

test("every reconciliation names a claim, what is actually true, and where to look", () => {
  assert.ok(RECONCILED.length > 0, "nothing was reconciled, which cannot be right two feature commits past the baseline");
  for (const r of RECONCILED) {
    assert.ok(r.claim.length > 20, `a reconciliation with no claim: ${JSON.stringify(r)}`);
    assert.ok(r.actual.length > 30, `"${r.claim}" has no statement of what is actually true`);
    assert.ok(r.evidence.length > 15, `"${r.claim}" cites nothing`);
    // A reconciliation whose evidence is another document is not evidence.
    assert.ok(
      /src\/|tests\/|docs\//.test(r.evidence),
      `"${r.claim}" cites no file: "${r.evidence}"`
    );
  }
});

test("the reconciled features are registered as working, not deferred", () => {
  // The specific correction handoff 09 §12 and Astra §11 both need: these two
  // are recorded as not started / deferred at the baseline, and both exist.
  for (const p of ["/clinician/member/[id]/trajectory", "/clinician/member/[id]/load"]) {
    const e = routeEntry(p);
    assert.ok(e, `${p} is not registered`);
    assert.equal(e!.state, "working", `${p} is registered as ${e!.state}`);
    assert.match(
      e!.evidence ?? "", /RECONCILED/,
      `${p} does not record that the source documents disagree with it`
    );
  }
});

// ---------------------------------------------------------------------------
// §1.5: one owner per job
// ---------------------------------------------------------------------------

test("no two workspaces claim the same route", () => {
  // Trivially true given one entry per path, so this checks the thing §1.5
  // actually rules on: that the ambiguity is RECORDED where it exists.
  const caseload = routeEntry("/clinician/caseload")!;
  assert.equal(caseload.workspace, "patients");
  assert.match(
    caseload.evidence ?? "", /Package 2/,
    "§1.5's Command Center / Patients ownership conflict must be recorded with the package that resolves it"
  );
});

test("the audiences are the seven roles plus the investor presentation audience", () => {
  const audiences = new Set(ROUTE_REGISTER.map((r) => r.audience));
  // §1.9: investor is a presentation audience, never an account role — so it
  // must own no route of its own. A route registered to it would be exactly
  // the privileged surface the ruling forbids.
  assert.ok(!audiences.has("investor"), "a route is registered to the investor audience, which §1.9 forbids");
  for (const a of ["public", "member", "clinician", "organization", "payer", "reviewer", "demo_admin"]) {
    assert.ok(audiences.has(a as never), `no route is registered to ${a}`);
  }
});
