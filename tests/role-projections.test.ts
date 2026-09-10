// Six role projections over one ledger (handoff 07 §5.1 p46, §6.1 p52).
//
// p52's exit evidence for Wave 4 is one sentence — "the same events produce
// correct minimum-necessary views" — and it has two halves that need different
// checks.
//
//   SAME EVENTS. The clinician's number and the organization's must be
//   derivable from each other, because there is only one set of facts. A
//   per-role table, or a per-role query that happens to agree today, produces
//   consoles that disagree — and a disagreement between them is
//   indistinguishable from a bug in either.
//
//   MINIMUM NECESSARY. Enforced by two different mechanisms on purpose:
//   person-level views are scoped in the SQL so a caller cannot widen them,
//   and aggregate views are laundered through `assertAggregate`, which throws
//   rather than filters.

process.env.EMDR_DATA_DIR = `/tmp/steady-proj-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "proj-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "proj-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { buildClinicianPanel } from "../src/lib/clinical/panel";
import { buildPopulationOverview, populationTenants } from "../src/lib/intelligence/population";
import { DEMO_CLINICIAN_ID, ALEX_ID, SAM_ID } from "../src/lib/demo-seed";
import { orgTenantId, DEMO_CLINICIAN_CODE, clinicianPersonId } from "../src/lib/demo-population-seed";
import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/** Strip comments, so a rule can be DISCUSSED in prose without tripping the
 *  check that enforces it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * Drop sentences that DISOWN a term, keeping only affirmative claims.
 *
 * The same false positive has now bitten five guards in this codebase, and
 * this is the fix `tests/payer-boundary.test.ts` arrived at: a screen that says
 * "there is no score, no priority number" trips a naive scan for exactly the
 * thing it is refusing to do, so the safeguard reads as the violation.
 * Allowlisting one phrase at a time loses the next time somebody rewords the
 * disclaimer.
 *
 * A term inside a negated sentence is the product being careful. A term in an
 * affirmative one is the product making a claim, and only the second is what
 * these guards are for.
 */
function affirmative(src: string): string {
  return src
    // Whitespace is collapsed FIRST, so a sentence wrapped across source lines
    // rejoins before it is split. The previous version split on newlines too,
    // which severed "§29.1 forbids a predictive risk score, and a queue sorted
    // by one would be that score under a different name" in half — leaving a
    // second fragment with no negation in it, and a guard that reported the
    // disclaimer as the violation.
    .replace(/\s+/g, " ")
    // Split on sentence AND statement terminators. Prose ends in a full stop;
    // code ends in a semicolon or a brace. Without the second kind an entire
    // source file collapses into one chunk, and one negation anywhere in it
    // would excuse everything else.
    .split(/(?<=[.!?;}])\s+/)
    .filter((chunk) => !/\b(no|not|never|nothing|neither|without|forbids?)\b/i.test(chunk))
    .join(" ");
}

async function clinicianTenant(): Promise<string> {
  getDb();
  const c = await data();
  return ((await c.get("SELECT tenant_id AS t FROM users WHERE id = ?", [DEMO_CLINICIAN_ID])) as { t: string }).t;
}

// ---------------------------------------------------------------------------
// The clinician has a panel at all
// ---------------------------------------------------------------------------

test("the demo clinician is NE-C1, inside NE Care Network A, with a real panel", async () => {
  const t = await clinicianTenant();
  assert.equal(t, orgTenantId("NE", "A"),
    "the demo clinician is not in NE Care Network A, so their panel is empty over a population " +
    "that lives in organization tenants");

  // NE-C1 resolves to the account rather than to a thirteenth person standing
  // beside p11's twelve.
  assert.equal(clinicianPersonId(DEMO_CLINICIAN_CODE), DEMO_CLINICIAN_ID);

  const envelope = await buildClinicianPanel(t);
  assert.equal(envelope.state, "ready");
  const panel = envelope.state === "ready" ? envelope.data : undefined;
  assert.ok(panel && panel.rows.length >= 40,
    `the panel holds ${panel?.rows.length ?? 0} people; NE Care Network A should carry forty of ` +
    "the 240 plus the two narrative personas");
});

test("the reviews on the panel are the signed-in clinician's own", async () => {
  // The reason NE-C1 maps to the account: a console showing someone else's
  // reviews is a worse demonstration than one showing yours.
  getDb();
  const c = await data();
  const mine = (await c.get(
    "SELECT COUNT(*) AS n FROM longitudinal_events WHERE actor_id = ? AND event_type = 'clinician.reviewed'",
    [DEMO_CLINICIAN_ID])) as { n: number };
  assert.ok(Number(mine.n) > 20,
    `only ${mine.n} reviews are attributed to the demo clinician`);
});

test("Alex and Sam moved with the clinician, records and all", async () => {
  getDb();
  const c = await data();
  const t = await clinicianTenant();
  for (const [id, who] of [[ALEX_ID, "Alex"], [SAM_ID, "Sam"]] as const) {
    const u = (await c.get("SELECT tenant_id AS t FROM users WHERE id = ?", [id])) as { t: string };
    assert.equal(u.t, t, `${who}'s account did not move`);
    const p = (await c.get("SELECT tenant_id AS t FROM persons WHERE id = ?", [id])) as { t: string };
    assert.equal(p.t, t, `${who}'s person row did not move — the account and the spine disagree`);
    // Their records too, or a tenant-scoped read of their own history returns
    // nothing while the person is visible: the worst of both.
    const orphaned = (await c.get(
      "SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND tenant_id <> ?", [id, t])) as { n: number };
    assert.equal(Number(orphaned.n), 0, `${who} has check-ins left in the old tenant`);
  }
});

// ---------------------------------------------------------------------------
// Minimum necessary
// ---------------------------------------------------------------------------

test("the aggregate projection refuses a person identifier rather than hiding one", async () => {
  const tenants = await populationTenants();
  const envelope = await buildPopulationOverview(tenants);
  assert.equal(envelope.state, "ready");

  // Nothing person-shaped anywhere in the returned tree. Checked on the actual
  // value rather than on the type, because a type is erased at runtime and the
  // thing that reaches a cache or a log is the value.
  const json = JSON.stringify(envelope.state === "ready" ? envelope.data : {});
  for (const banned of ["personId", "person_id", "userId", "user_id", "display_name", "email"]) {
    assert.doesNotMatch(json, new RegExp(banned, "i"),
      `the population overview carries "${banned}"`);
  }
  // And no fabricated NAME leaked in as a value.
  assert.doesNotMatch(json, /fabricated\)/,
    "a person's display name appears in the aggregate projection");
});

test("the aggregate projection is laundered, and the launder throws", () => {
  const src = read("src/lib/intelligence/population.ts");
  assert.match(src, /assertAggregate\(overview\)/,
    "the population overview is not passed through assertAggregate");
  // The clinician panel deliberately is NOT — it is ABOUT people, and a
  // clinician reading their own panel has the care relationship that makes a
  // name appropriate. It also lives OUTSIDE src/lib/intelligence, because the
  // aggregate-boundary guard treats that whole directory as a population
  // surface and is right to.
  const panelFn = read("src/lib/clinical/panel.ts");
  // Comments stripped: the exemption is DOCUMENTED inside this function, and a
  // naive scan reads the sentence explaining why the launder is absent as the
  // launder being present.
  assert.doesNotMatch(code(panelFn), /assertAggregate/,
    "the clinician panel is laundered — it is about people, and a clinician has the care " +
    "relationship that makes a name appropriate");
  assert.match(panelFn, /NOT laundered/, "the exemption is undocumented");
});

test("every aggregate population route uses an aggregate guard, never a clinical one", () => {
  for (const [route, guard] of [
    ["src/app/organization/population/page.tsx", "resolveOrgTenant"],
    ["src/app/payer/population/page.tsx", "resolvePayerTenant"],
  ] as const) {
    const src = read(route);
    assert.match(src, new RegExp(guard), `${route} does not resolve its own scope`);
    assert.doesNotMatch(src, /requireClinician|buildClinicianPanel/,
      `${route} reaches for a person-level projection`);
  }
  const clinical = read("src/app/clinician/population/page.tsx");
  assert.match(clinical, /requireClinician/, "the clinician population view is not guarded");
  assert.doesNotMatch(clinical, /buildPopulationOverview/,
    "the clinician view reads the aggregate projection instead of its own");
});

test("the organization sees its own tenant, not every tenant holding demo people", async () => {
  // p6: an organization "cannot see payer-wide data or unrelated
  // organizations". The scope is the enforcement — the projection takes a
  // tenant LIST and reads exactly that, so a caller cannot widen it by asking
  // differently.
  const all = await populationTenants();
  assert.ok(all.length >= 8, `only ${all.length} tenants hold demo population`);

  const one = await buildPopulationOverview([orgTenantId("NE", "A")]);
  const every = await buildPopulationOverview(all);
  // `Envelope.data` is optional independently of `state` — narrowing on the
  // state does not narrow the payload, which is right: a stale envelope has
  // both, a failed one has neither.
  const oneCovered = one.data?.covered ?? -1;
  const allCovered = every.data?.covered ?? -1;
  assert.ok(oneCovered > 0 && oneCovered < allCovered,
    `one organization reports ${oneCovered} against ${allCovered} for all of them — the scope ` +
    "argument is not being honoured");
});

test("an account with no population tenant gets partial, not a silent zero", async () => {
  // A console that reports 0 covered lives when it is simply out of scope has
  // told the reader something false. §30.8's `partial` state exists for
  // exactly this: say what is missing and whether that is expected.
  const envelope = await buildPopulationOverview([]);
  assert.equal(envelope.state, "partial");
  assert.ok(envelope.missing && envelope.missing.length > 0,
    "a partial envelope with nothing missing is a ready envelope");
  assert.match(envelope.missing![0].reason, /configuration gap, not an empty result/);
});

// ---------------------------------------------------------------------------
// The same events
// ---------------------------------------------------------------------------

test("the panel and the overview agree, because they read the same rows", async () => {
  // The heart of Wave 4. If these could disagree, one of them would be wrong
  // and nothing would say which.
  const t = await clinicianTenant();
  const panel = await buildClinicianPanel(t);
  const overview = await buildPopulationOverview([t]);
  assert.equal(panel.state, "ready");
  assert.equal(overview.state, "ready");
  assert.ok(panel.data && overview.data, "a ready envelope carries no data");
  const p = panel.data!;
  const o = overview.data!;

  assert.equal(p.population, o.covered,
    `the clinician counts ${p.population} people and the organization counts ` +
    `${o.covered} in the same tenant`);

  // The improvement count is derivable from the panel's own rows.
  const improvedFromPanel = p.rows.filter(
    (r) => r.baseline !== null && r.latest !== null && r.latest < r.baseline).length;
  assert.equal(improvedFromPanel, o.improved.n,
    `${improvedFromPanel} people improved by the panel's reckoning and ` +
    `${o.improved.n} by the organization's`);

  // And so is the missed-measure count.
  const missedFromPanel = p.rows.reduce((s, r) => s + r.missing, 0);
  assert.equal(missedFromPanel, o.missedMeasures.n,
    "the panel and the overview count different numbers of missed measures");
});

test("every proportion the overview reports carries its denominator", async () => {
  const overview = await buildPopulationOverview(await populationTenants());
  const d = overview.data;
  assert.ok(d, `the overview rendered ${overview.state} with no data`);
  for (const [label, count] of [
    ["active", d.active], ["measuredTwice", d.measuredTwice],
    ["improved", d.improved], ["missedMeasures", d.missedMeasures],
  ] as const) {
    assert.ok(typeof count.of === "number" && count.of > 0,
      `${label} has no denominator, so the number is uninterpretable`);
    assert.ok(count.n <= count.of, `${label} reports ${count.n} of ${count.of}`);
  }
  // Missed measures are counted against everything that came DUE, not against
  // people — the two slices have to sum to the denominator or a chart silently
  // drops an absence.
  assert.ok(d.missedMeasures.of > d.missedMeasures.n,
    "every measure that came due was missed, which is not a denominator");
});

test("a group smaller than the small-cell threshold is withheld whole", async () => {
  // Reporting "under 11 of 2" — which the first version produced for a
  // two-person group — suppresses nothing: the reader already knows the count
  // is at most two, and the phrasing implies a larger number than the truth.
  const src = read("src/lib/intelligence/population.ts");
  assert.match(src, /withheld — group of/,
    "a group below the threshold is reported as a suppressed numerator over a tiny denominator");

  const overview = await buildPopulationOverview(await populationTenants());
  assert.ok(overview.data, `the overview rendered ${overview.state} with no data`);
  for (const r of overview.data!.byRegion) {
    if (r.covered < 11) {
      assert.match(r.active, /withheld/, `${r.label} has ${r.covered} people and reports "${r.active}"`);
    }
  }
});

test("the panel groups work by fixed state, never by a score", () => {
  // §29.1 forbids a predictive risk score, and a queue ordered by one would be
  // that score under a different name.
  const src = read("src/app/clinician/population/page.tsx");
  // Comments stripped AND negated sentences dropped. The screen states the
  // rule it obeys — "there is no score, no priority number" — and a scan that
  // counted that sentence would be reporting the safeguard as the breach.
  assert.doesNotMatch(affirmative(code(src)), /\brisk\b|\bscore\b|\bpriority\b|\bpredict/i,
    "the clinician population view ranks people");
  // The groups are fixed states, and a person may be in more than one — which
  // is only true if they are filters rather than a single ordering.
  assert.match(src, /may appear in more than one group/,
    "the screen does not say that the groups overlap, so they read as a ranking");
});
