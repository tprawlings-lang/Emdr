process.env.EMDR_DATA_DIR = `/tmp/steady-aggscope-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

// Aggregate scope and evidence (handoff 09 §6, §8.5, §10 Package 5).
//
// Package 5's exit evidence: "Screen and export parity. Aggregate-only,
// denominator, and observed/modelled guards pass."
//
// THE SENTENCE THAT DECIDES THE DESIGN is §6's: "A user must never have to
// open a drawer to learn a number is modelled." A drawer is where this always
// ends up — the value is small and the method is long, so the method goes
// behind a disclosure and the value goes on the card. Then somebody
// screenshots the card. So the guards below check that the provenance word
// cannot be absent: `presentValue` stamps it, a caller cannot supply it, and
// the component renders it in the same visual field as the number.
//
// AND "SCREEN AND EXPORT PARITY" IS ONE FUNCTION, NOT TWO THAT AGREE. A
// suppressed cell has no `value` field at all, so neither a renderer nor a CSV
// writer has anything to format as zero. That is what makes §6's "the state
// survives export" a property rather than a discipline: the export path
// consumes the same discriminated union the screen does.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  PROVENANCE, PROVENANCE_LABEL, PROVENANCE_NOTE, SCOPE_PARAMS, MAX_LEADING_CHANGES,
  CAUSAL_WORDS, AGGREGATE_OWNERSHIP_EXISTS, NO_OWNERSHIP_NOTE,
  presentValue, exportCell, isNumeric, scopeChanges, drilldownHref, carriesScope,
  scopeToParams, compare, leadWith, causalLanguage, mayOfferOwnership,
  AggregateError,
  type Scope, type PresentInput,
} from "../src/lib/experience/aggregate";
import {
  EXPORT_STATES, STATE_LABEL, STATE_NOTE, DOWNLOAD_WINDOW_HOURS,
} from "../src/lib/intelligence/export-job";
import {
  PERIOD_OPTIONS, DEFAULT_PERIOD_DAYS, periodHref,
} from "../src/lib/intelligence/aggregate-scope";

const SRC = path.join(__dirname, "..", "src");
const read = (p: string) => fs.readFileSync(path.join(SRC, p), "utf8");
/** A file with its commentary removed — a guard over source has to read what
 *  RUNS, or a file is punished for explaining itself. */
const code = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SCOPE: Scope = {
  organizationId: "org-1",
  organizationLabel: "North Network",
  period: { start: "2026-06-11", end: "2026-09-09", label: "Last 90 days" },
  freshness: { refreshedAt: "2026-09-09 04:00:00", dataVersion: "org-projections-2026-08-a" },
};

function input(over: Partial<PresentInput> = {}): PresentInput {
  return {
    label: "Engaged",
    unit: "people",
    period: "Last 90 days",
    denominator: 240,
    materialLagDays: 0,
    provenance: "observed",
    value: 148,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §6 — observed and modelled
// ---------------------------------------------------------------------------

test("a number cannot reach a screen without saying how it was derived", () => {
  for (const p of PROVENANCE) {
    const shown = presentValue(input({ provenance: p }));
    assert.equal(shown.provenance, p);
    assert.ok(shown.provenanceLabel.length > 0, `${p} rendered no label`);
    assert.equal(shown.provenanceLabel, PROVENANCE_LABEL[p]);
  }
  // Both words are non-empty. An empty "observed" would make the label
  // optional in practice — a component renders {label} and produces nothing,
  // and the distinction survives only where somebody remembered it.
  assert.equal(PROVENANCE_LABEL.modelled, "modelled");
  assert.equal(PROVENANCE_LABEL.observed, "observed");
});

test("the provenance label is stamped, not supplied", () => {
  // A caller-supplied label is a label somebody sets to "" for a card that
  // felt cluttered. `PresentInput` has no such field, and the type is the
  // guard — this checks the type has not quietly grown one.
  const src = code("lib/experience/aggregate.ts");
  const iface = src.slice(src.indexOf("export interface PresentInput"), src.indexOf("export function presentValue"));
  // The Omit<> that EXCLUDES it names it, so the check is for a declared
  // member rather than for the word appearing anywhere in the block.
  assert.ok(
    !/^\s*provenanceLabel\s*[?:]/m.test(iface),
    "a caller can now supply the provenance label"
  );
  assert.match(iface, /Omit<ValueView, "provenanceLabel">/);
  assert.match(src, /provenanceLabel: PROVENANCE_LABEL\[input\.provenance\]/);
});

test("the modelled word renders beside the value, never only in a drawer", () => {
  // §6's sentence, as a property of the component: the label is inside the
  // same paragraph as the number, and there is no <details> between them.
  const src = code("components/aggregate/AggregateValue.tsx");
  const valueAt = src.indexOf("shown.value.toLocaleString()");
  const labelAt = src.indexOf("{shown.provenanceLabel}");
  assert.ok(valueAt > 0 && labelAt > valueAt, "the provenance label does not render after the value");
  const between = src.slice(valueAt, labelAt);
  assert.ok(!/<details|<summary/.test(between), "the provenance label is behind a disclosure");
  // And unit, period, denominator and lag are all beside it (§6 lists four).
  for (const field of ["shown.unit", "shown.period", "shown.denominator", "shown.materialLagDays"]) {
    assert.ok(src.includes(field), `${field} is not rendered beside the value`);
  }
});

test("every provenance has a note explaining the difference", () => {
  for (const p of PROVENANCE) {
    assert.ok(PROVENANCE_NOTE[p]?.length > 0, `${p} has no note`);
  }
  assert.match(PROVENANCE_NOTE.modelled, /not counted/i);
});

// ---------------------------------------------------------------------------
// §6 — withheld is never zero, and survives export
// ---------------------------------------------------------------------------

test("a suppressed cell has no value field to format as zero", () => {
  // THE FAILURE THIS PREVENTS is `{value ?? 0}` in a template: a suppressed
  // cohort of four people rendering as a confident zero. The union has no
  // `value` on the withheld branch, so there is nothing to coalesce.
  const shown = presentValue(input({ suppressed: true, suppressedBelow: 11, value: 4 }));
  assert.equal(shown.kind, "withheld");
  assert.ok(!("value" in shown), "a withheld cell still carries its value");
  assert.equal(isNumeric(shown), false);
  assert.match(shown.kind === "withheld" ? shown.reason : "", /not a count of zero/i);
});

test("withheld survives the export as a word, not an empty field", () => {
  // §6: "the state survives export." An empty CSV field is what a spreadsheet
  // renders as zero, which is the same defect one layer down.
  const withheld = presentValue(input({ suppressed: true, suppressedBelow: 11, value: 4 }));
  assert.equal(exportCell(withheld), "withheld");
  assert.equal(exportCell(presentValue(input({ value: 148 }))), "148");
  assert.equal(exportCell(presentValue(input({ unavailable: "no denominator" }))), "unavailable");
  // Nothing renders as an empty string, ever.
  for (const p of [
    presentValue(input({ suppressed: true })),
    presentValue(input({ value: null })),
    presentValue(input({ unavailable: "x" })),
    presentValue(input({ value: 0 })),
  ]) {
    assert.ok(exportCell(p).length > 0, `${p.kind} exported as an empty cell`);
  }
});

test("a real zero and a withheld cell are different answers", () => {
  const zero = presentValue(input({ value: 0 }));
  const withheld = presentValue(input({ suppressed: true, value: 4 }));
  assert.equal(zero.kind, "value");
  assert.equal(withheld.kind, "withheld");
  assert.notEqual(exportCell(zero), exportCell(withheld));
});

test("a missing denominator states a reason rather than rendering a dash", () => {
  const shown = presentValue(input({ value: null }));
  assert.equal(shown.kind, "unavailable");
  assert.match(shown.kind === "unavailable" ? shown.reason : "", /no denominator/i);
});

test("screen and export read the same function", () => {
  // "Screen and export parity" is one implementation both consume, not two
  // that agree. A second formatter is what drifts.
  const component = code("components/aggregate/AggregateValue.tsx");
  assert.match(component, /Presented/);
  assert.ok(
    !/suppressed|withheld.*\?\s*0|\?\?\s*0/.test(component),
    "the component recomputes suppression instead of reading the presented value"
  );
});

// ---------------------------------------------------------------------------
// §6 — the scope strip
// ---------------------------------------------------------------------------

test("the scope travels as one thing, into every drilldown", () => {
  // The failure this prevents: a drilldown that keeps the organization and
  // silently widens the period, producing a chart that is not comparable with
  // the one it was opened from, with nothing on screen saying so.
  assert.deepEqual([...SCOPE_PARAMS], ["org", "from", "to", "v"]);
  const href = drilldownHref("/organization/outcomes", SCOPE);
  assert.ok(carriesScope(href), `${href} lost part of the scope`);
  for (const p of SCOPE_PARAMS) {
    assert.ok(new URL(href, "http://x").searchParams.get(p), `${p} is missing`);
  }
  // And an existing query string is preserved rather than replaced.
  assert.ok(carriesScope(drilldownHref("/organization/outcomes?tab=b", SCOPE)));
  assert.match(drilldownHref("/organization/outcomes?tab=b", SCOPE), /tab=b/);
});

test("a link without the full scope is not treated as carrying it", () => {
  assert.equal(carriesScope("/organization/outcomes"), false);
  assert.equal(carriesScope("/organization/outcomes?org=org-1"), false);
  assert.equal(carriesScope("/organization/outcomes?org=org-1&from=a&to=b"), false);
  assert.equal(carriesScope("/organization/outcomes?org=&from=a&to=b&v=1"), false);
});

test("a scope change says what it costs, not that something will change", () => {
  // §6 asks for "a warning before change". A dialog that says "are you sure?"
  // is a dialog people click through.
  const widened: Scope = {
    ...SCOPE,
    period: { start: "2025-09-09", end: "2026-09-09", label: "Last 12 months" },
  };
  const changes = scopeChanges(SCOPE, widened);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, "period");
  assert.match(changes[0].consequence, /different LENGTH/i);
  assert.match(changes[0].consequence, /not comparable/i);

  // A same-length window that moves is a different warning, because it is a
  // different problem: counts stay comparable, seasonality does not.
  const moved: Scope = {
    ...SCOPE,
    period: { start: "2026-03-13", end: "2026-06-11", label: "Previous 90 days" },
  };
  const shift = scopeChanges(SCOPE, moved);
  assert.match(shift[0].consequence, /seasonal/i);
  assert.ok(!/different LENGTH/i.test(shift[0].consequence));
});

test("changing organization warns that nothing carries over", () => {
  const other: Scope = { ...SCOPE, organizationId: "org-2", organizationLabel: "South Network" };
  const changes = scopeChanges(SCOPE, other);
  assert.equal(changes[0].field, "organization");
  assert.match(changes[0].consequence, /Nothing you are looking at now can be compared/i);
  assert.match(changes[0].consequence, /different population/i);
});

test("an unchanged scope warns about nothing", () => {
  assert.deepEqual(scopeChanges(SCOPE, { ...SCOPE }), []);
});

test("the strip renders all three fields and an obvious reset", () => {
  const src = code("components/aggregate/ScopeStrip.tsx");
  assert.match(src, /scope\.organizationLabel/);
  assert.match(src, /scope\.period\.label/);
  assert.match(src, /scope\.freshness\.refreshedAt/);
  assert.match(src, /resetHref/);
  // The reset is a visible link, not a menu item behind a control.
  assert.match(src, /<Link href=\{resetHref\}/);
});

test("the strip is in the shell, so every drilldown carries it", () => {
  // "Carried into every drilldown" is not a thing ten pages remember to do.
  for (const shell of ["components/app/OrgPage.tsx", "components/app/PayerPage.tsx"]) {
    const src = code(shell);
    assert.match(src, /<ScopeStrip/, `${shell} does not render the scope strip`);
    // Above the standing header: §6 opens with "scope before charts", and
    // those cards are charts.
    const strip = src.indexOf("<Scope />");
    const header = src.indexOf("<StandingHeader />");
    assert.ok(strip > 0 && header > strip, `${shell} renders charts before scope`);
  }
});

test("the organization is never taken from the URL", () => {
  // A console that let ?org= choose the population would be a cross-tenant
  // read with a query parameter for a key.
  const src = code("lib/intelligence/aggregate-scope.ts");
  const body = src.slice(src.indexOf("export async function scopeFrom"), src.indexOf("async function tenantLabel"));
  assert.ok(!/params\?\.org/.test(body), "scopeFrom reads the organization from the URL");
  assert.match(body, /const base = await defaultScope\(args\)/);
  assert.ok(scopeToParams(SCOPE).org === SCOPE.organizationId);
  // And the request-scoped reader takes the tenant as an argument rather than
  // from the header it reads the period from.
  const forRequest = src.slice(src.indexOf("export async function scopeForRequest"));
  assert.match(forRequest, /scopeForRequest\(tenantId: string\)/);
  assert.match(forRequest, /scopeFrom\(\{ tenantId, params \}\)/);
});

// ---------------------------------------------------------------------------
// §6 — comparison limits
// ---------------------------------------------------------------------------

const P90 = { start: "2026-06-11", end: "2026-09-09" };
const P90_PRIOR = { start: "2026-03-13", end: "2026-06-11" };

test("a comparable pair produces a delta", () => {
  const c = compare({
    current: { value: 62, cohortVersion: "c1", period: P90, dataVersion: "d1" },
    previous: { value: 55, cohortVersion: "c1", period: P90_PRIOR, dataVersion: "d1" },
  });
  assert.equal(c.delta, 7);
  assert.deepEqual(c.limits, []);
  assert.equal(c.mayShowDelta, true);
});

test("a changed cohort definition states a limit instead of a silent comparison", () => {
  // §6: "A changed cohort definition, period length, or data source produces a
  // stated limit rather than a silent comparison." Nobody sets out to compare
  // two incomparable periods — it happens because the screen offers a delta
  // and the delta renders whatever arithmetic allows.
  const c = compare({
    current: { value: 62, cohortVersion: "c2", period: P90, dataVersion: "d1" },
    previous: { value: 55, cohortVersion: "c1", period: P90_PRIOR, dataVersion: "d1" },
  });
  assert.equal(c.mayShowDelta, false, "a delta was offered across a cohort change");
  assert.equal(c.limits.length, 1);
  assert.match(c.limits[0], /different people/i);
  // The arithmetic is still available; the surface has to decide to print it
  // against a stated reason.
  assert.equal(c.delta, 7);
});

test("each of the three named causes produces its own limit", () => {
  const lengths = compare({
    current: { value: 1, cohortVersion: "c1", period: { start: "2026-01-01", end: "2026-09-09" }, dataVersion: "d1" },
    previous: { value: 1, cohortVersion: "c1", period: P90_PRIOR, dataVersion: "d1" },
  });
  assert.match(lengths.limits.join(" "), /different lengths/i);

  const source = compare({
    current: { value: 1, cohortVersion: "c1", period: P90, dataVersion: "d2" },
    previous: { value: 1, cohortVersion: "c1", period: P90_PRIOR, dataVersion: "d1" },
  });
  assert.match(source.limits.join(" "), /different dataset builds/i);

  // All three at once produces all three.
  const all = compare({
    current: { value: 1, cohortVersion: "c2", period: { start: "2026-01-01", end: "2026-09-09" }, dataVersion: "d2" },
    previous: { value: 1, cohortVersion: "c1", period: P90_PRIOR, dataVersion: "d1" },
  });
  assert.equal(all.limits.length, 3);
  assert.equal(all.mayShowDelta, false);
});

test("a missing value produces no delta and no false comparison", () => {
  const c = compare({
    current: { value: null, cohortVersion: "c1", period: P90, dataVersion: "d1" },
    previous: { value: 55, cohortVersion: "c1", period: P90_PRIOR, dataVersion: "d1" },
  });
  assert.equal(c.delta, null);
  assert.equal(c.mayShowDelta, false);
});

// ---------------------------------------------------------------------------
// §6, §8.5 — what changed, and the language it uses
// ---------------------------------------------------------------------------

test("the leading list is capped and says how many it left out", () => {
  // §6: "Lead with two or three meaningful changes, then the supporting
  // table." A list of eleven is the supporting table with a different heading.
  const many = Array.from({ length: 9 }, (_, i) => ({
    label: `Change ${i}`, statement: "Moved.", provenance: "observed" as const, href: "/x",
  }));
  const { leading, remaining } = leadWith(many);
  assert.equal(leading.length, MAX_LEADING_CHANGES);
  assert.equal(MAX_LEADING_CHANGES, 3);
  assert.equal(remaining, 6);
  // Nothing is hidden: the count of what else moved is stated.
  const src = code("components/aggregate/WhatChanged.tsx");
  assert.match(src, /remaining > 0/);
  assert.match(src, /tableHref/);
});

test("fewer changes than the cap leaves nothing over", () => {
  const { leading, remaining } = leadWith([
    { label: "a", statement: "s", provenance: "observed", href: "/x" },
  ]);
  assert.equal(leading.length, 1);
  assert.equal(remaining, 0);
});

test("causal language is detectable, so a guard can refuse it", () => {
  // §8.5: "Avoid causal language unless the design supports causal inference.
  // Prefer observed alongside, changed during, recorded after." No aggregate
  // screen in this product supports causal inference.
  assert.ok(CAUSAL_WORDS.length > 0);
  assert.deepEqual(causalLanguage("Engagement improved by the new pathway"), ["improved by"]);
  assert.deepEqual(causalLanguage("Engagement changed during this period"), []);
  assert.deepEqual(causalLanguage("Fewer stops recorded after the change"), []);
});

test("no aggregate surface asserts a cause", () => {
  for (const file of [
    "components/aggregate/WhatChanged.tsx",
    "components/aggregate/AggregateValue.tsx",
    "components/aggregate/ScopeStrip.tsx",
  ]) {
    const visible = code(file);
    const found = causalLanguage(visible);
    assert.deepEqual(found, [], `${file} asserts a cause: ${found.join(", ")}`);
  }
});

// ---------------------------------------------------------------------------
// §6 — no decorative ownership
// ---------------------------------------------------------------------------

test("ownership is not offered while no ownership workflow exists", () => {
  // §6: "An owner chip that implies someone accepted responsibility, when
  // nobody did, is a clinical-safety misstatement wearing a UI costume."
  assert.equal(AGGREGATE_OWNERSHIP_EXISTS, false);
  assert.equal(mayOfferOwnership(), false);
  // And the absence is STATED rather than left open. An absent chip and a
  // stated absence read very differently to somebody deciding whether to act.
  assert.match(NO_OWNERSHIP_NOTE, /No one is assigned/i);
  const src = code("components/aggregate/WhatChanged.tsx");
  assert.match(src, /!mayOfferOwnership\(\)/);
  assert.match(src, /NO_OWNERSHIP_NOTE/);
  // No assignment control anywhere in the aggregate components.
  for (const file of [
    "components/aggregate/WhatChanged.tsx",
    "components/aggregate/AggregateValue.tsx",
    "components/aggregate/ScopeStrip.tsx",
  ]) {
    assert.ok(
      !/Assign|owner chip|Take this|Claim/i.test(code(file).replace(/mayOfferOwnership|NO_OWNERSHIP_NOTE/g, "")),
      `${file} offers an ownership control`
    );
  }
});

// ---------------------------------------------------------------------------
// §6 — export is a job
// ---------------------------------------------------------------------------

test("an export has a lifecycle, and the three refusals are distinguishable", () => {
  // §6: "expired, failed, and superseded outputs identified." One
  // "unavailable" would make three different answers into one.
  assert.deepEqual(
    [...EXPORT_STATES],
    ["requested", "running", "ready", "downloaded", "failed", "expired", "superseded"]
  );
  const labels = new Set(EXPORT_STATES.map((s) => STATE_LABEL[s]));
  assert.equal(labels.size, EXPORT_STATES.length, "two states render the same word");
  for (const s of EXPORT_STATES) {
    assert.ok(STATE_LABEL[s]?.length > 0, `${s} has no label`);
    assert.ok(STATE_NOTE[s]?.length > 0, `${s} has no note`);
  }
  assert.match(STATE_NOTE.superseded, /replaced/i);
  assert.match(STATE_NOTE.expired, /window/i);
  assert.match(STATE_NOTE.failed, /Nothing was disclosed/i);
});

test("authorization is rechecked at download, on the server", () => {
  // §6: "authorization rechecked at download… Browser success is not a
  // disclosure audit record." Authorization at request time answers "may they
  // ask"; this answers "may they have it", and between the two an account can
  // change tenant or lose a role.
  const src = code("lib/intelligence/export-job.ts");
  const body = src.slice(src.indexOf("export async function authorizeDownload"));
  assert.match(body, /job\.tenant_id !== args\.actorTenantId/, "the download does not recheck the tenant");
  assert.match(body, /readJob\(args\.jobId\)/, "the state is passed in rather than read fresh");
  // The count and the audit row are written server-side, in recordDownload.
  const record = src.slice(src.indexOf("export async function recordDownload"));
  assert.match(record, /download_count = download_count \+ 1/);
  assert.match(record, /type: "export_downloaded"/);
});

test("a later export of the same filter supersedes the earlier one", () => {
  // Same tenant, same surface, same FILTER HASH. Two exports of different
  // filters from one screen are two disclosures and neither replaces the other.
  const src = code("lib/intelligence/export-job.ts");
  const body = src.slice(src.indexOf("export async function supersedeEarlier"));
  assert.match(body, /tenant_id = \? AND surface = \? AND filter_hash = \?/);
  assert.match(body, /state IN \('ready','downloaded'\)/,
    "a downloaded export is not superseded, so the console calls the wrong file current");
  assert.match(body, /id != \?/, "the new export supersedes itself");
});

test("creating an export supersedes before it opens its own window", () => {
  // Superseding first would leave a moment with no current export of that
  // filter; opening the window first would leave a moment where two are
  // downloadable and both claim to be current.
  const src = code("lib/intelligence/export.ts");
  const insertAt = src.indexOf("INSERT INTO export_jobs");
  const supersedeAt = src.indexOf("supersedeEarlier(");
  const openAt = src.indexOf("openDownloadWindow(");
  assert.ok(insertAt > 0 && supersedeAt > insertAt, "the new row is written after superseding");
  assert.ok(openAt > supersedeAt, "the window opens before earlier exports are superseded");
});

test("the download window is short enough to be tracked", () => {
  // A disclosure that can be fetched a year later is a disclosure nobody is
  // tracking.
  assert.ok(DOWNLOAD_WINDOW_HOURS > 0 && DOWNLOAD_WINDOW_HOURS <= 24 * 14,
    `${DOWNLOAD_WINDOW_HOURS} hours is not a window`);
});

test("the export history identifies the state of every row", () => {
  const src = code("components/app/ExportPanel.tsx");
  assert.match(src, /STATE_LABEL\[h\.state\]/);
  assert.match(src, /h\.downloadCount/);
  assert.ok(
    !/history\.map[\s\S]{0,400}h\.state \?/.test(src) || /STATE_LABEL/.test(src),
    "the panel invents its own state vocabulary"
  );
});

test("no new export format was added", () => {
  // §6: "Add no new export formats during shell work." This package changes
  // WHEN a file may be handed over, never what is in it.
  const src = code("lib/intelligence/export.ts");
  assert.ok(!/xlsx|json_export|application\/pdf|\.pdf|\.xlsx/i.test(src), "a new export format appeared");
  const job = code("lib/intelligence/export-job.ts");
  assert.ok(!/csv|xlsx|pdf/i.test(job), "the lifecycle module knows about file formats");
});

// ---------------------------------------------------------------------------
// The layer's own rules
// ---------------------------------------------------------------------------

test("the aggregate contract is pure and client-safe", () => {
  const src = code("lib/experience/aggregate.ts");
  const imports = [
    ...[...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/^import "([^"]+)"/gm)].map((m) => m[1]),
  ];
  assert.deepEqual(imports, [], "the aggregate contract imports something; it is meant to be standalone");
  assert.ok(!/\bSELECT\b|\bINSERT\b/.test(src), "the contract contains SQL");
});

test("no aggregate surface renders a section mark", () => {
  for (const file of [
    "components/aggregate/ScopeStrip.tsx",
    "components/aggregate/AggregateValue.tsx",
    "components/aggregate/WhatChanged.tsx",
  ]) {
    assert.ok(!/§/.test(code(file)), `${file} renders a section mark`);
  }
});

test("a provenance with no label is refused rather than rendered blank", () => {
  assert.throws(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => presentValue(input({ provenance: "guessed" as any })),
    AggregateError
  );
});

// ---------------------------------------------------------------------------
// The period control, without which the strip is decorative
// ---------------------------------------------------------------------------

test("a reader can change the window, and the control is on the strip", () => {
  // FOUND BY DRIVING IT. The strip rendered, the reset link and the warning
  // were implemented and tested — and nothing on any screen could change the
  // scope, so both were unreachable code. On this project that is the same as
  // not built.
  const strip = code("components/aggregate/ScopeStrip.tsx");
  assert.match(strip, /periods\.map/);
  assert.match(strip, /aria-current/);
  // ON THE ORGANIZATION CONSOLE ONLY, and that is the honest answer rather
  // than a gap. The payer projections take no window at all, so a control
  // there would move a label and no number — which is the "confidently wrong"
  // screen this package exists to prevent. The payer strip says so instead.
  assert.match(code("components/app/OrgPage.tsx"), /periods=\{periods\}/,
    "the organization console renders no period control");
  const payer = code("components/app/PayerPage.tsx");
  assert.ok(!/periods=\{periods\}/.test(payer), "the payer console offers a window it does not honour");
  assert.match(payer, /governs=/, "the payer strip does not say the window is not wired in");
});

test("the strip never implies the period governs more than it does", () => {
  // FOUND BY DRIVING IT. A period control produced "Last 251 days" in the
  // strip while every number underneath stayed exactly where it was: the
  // organization console has ONE windowed figure and the rest count over the
  // whole record. The fix is not to pretend the control governs more — it is
  // for the strip to say what it governs.
  const strip = code("components/aggregate/ScopeStrip.tsx");
  assert.match(strip, /governs &&/, "the strip cannot state what the period applies to");
  for (const shell of ["components/app/OrgPage.tsx", "components/app/PayerPage.tsx"]) {
    assert.match(code(shell), /governs=/, `${shell} states a period without saying what it covers`);
  }
  // And the header states the same window it was given, rather than a literal.
  const org = code("components/app/OrgPage.tsx");
  assert.match(org, /buildOrgHeader\(tenantId, periodDaysOf\(scope\)\)/);
  assert.match(org, /h\.windowDays/, "the header footnote hardcodes a window");
  assert.ok(!/Last 90 days against the 90 before it/.test(org), "the footnote states a fixed window");
});

test("the windows offered are named lengths, not an arbitrary picker", () => {
  // §6: a changed period LENGTH produces a stated limit. An arbitrary date
  // pair changes the length almost every time, so every comparison would carry
  // a limit and the limits would stop meaning anything.
  assert.ok(PERIOD_OPTIONS.length >= 2 && PERIOD_OPTIONS.length <= 4);
  assert.ok(PERIOD_OPTIONS.some((o) => o.days === DEFAULT_PERIOD_DAYS), "the default is not offered");
  const strip = code("components/aggregate/ScopeStrip.tsx");
  assert.ok(!/type="date"/.test(strip), "the strip offers a free date picker");
});

test("changing the window keeps the rest of the query", () => {
  // A reader who narrowed a table and then changed the period should not lose
  // the table.
  const href = periodHref("/organization/outcomes", "?tab=sites&from=x&to=y", 30, new Date("2026-09-09T00:00:00Z"));
  assert.match(href, /tab=sites/);
  assert.match(href, /from=2026-08-10/);
  assert.match(href, /to=2026-09-09/);
  assert.match(href, /^\/organization\/outcomes\?/);
});

test("the scope comes from the request, so every drilldown carries it", () => {
  // Next.js hands searchParams to pages only. Threading a prop through
  // twenty-three page components would make "carried into every drilldown"
  // true exactly as long as nobody adds a twenty-fourth.
  const proxy = code("proxy.ts");
  assert.match(proxy, /x-pathname/);
  assert.match(proxy, /x-search/);
  const scope = code("lib/intelligence/aggregate-scope.ts");
  assert.match(scope, /h\.get\("x-search"\)/);
  // Nothing decides ACCESS from the header.
  assert.ok(
    !/x-pathname|x-search/.test(code("lib/auth.ts")),
    "authentication reads a request header it cannot trust"
  );
});

test("freshness is read across the tenants the numbers came from", () => {
  // The strip said "rebuilt not yet built" over a console showing 9,000
  // events: an organization is a PARENT and its events live in the child
  // tenants its sites are.
  const src = code("lib/intelligence/aggregate-scope.ts");
  const body = src.slice(src.indexOf("async function freshness"));
  assert.match(body, /scopeIds\(tenantId\)/, "freshness reads only the parent tenant");
  assert.match(body, /tenant_id IN/);
});

test("no copy lives in the scope resolver", () => {
  // "not yet built" in the resolver became "rebuilt not yet built" once the
  // strip prefixed it. Null is the data layer's answer; the strip decides how
  // to say it.
  const src = code("lib/intelligence/aggregate-scope.ts");
  const body = src.slice(src.indexOf("async function freshness"));
  assert.match(body, /refreshedAt: row\?\.at \?\? null/);
  const strip = code("components/aggregate/ScopeStrip.tsx");
  assert.match(strip, /never built/);
});
