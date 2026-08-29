// The aggregate boundary (§30.6, §29.1, §26's organization acceptance).
//
// The organization role reads a population. It must never be able to read a
// person, and every proportion it is shown must carry the denominator that
// makes it interpretable. Both rules are easy to state, easy to agree with,
// and easy to break with one well-meaning line — a `person_id` added so a bar
// can be clicked, or a `Math.round(n / total * 100)` inlined because a card
// looked cluttered.
//
// So neither rule lives only in review. This file fails the build.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ORG_APP = path.join(ROOT, "src", "app", "organization");
const INTEL_LIB = path.join(ROOT, "src", "lib", "intelligence");
const CHARTS = path.join(ROOT, "src", "components", "charts", "aggregate.tsx");

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function walk(dir: string, ext = ".tsx"): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext) || e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Strip comments, so a rule can be DISCUSSED in prose without tripping the
 *  check that enforces it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

// ---------------------------------------------------------------------------
// No person reaches an aggregate surface
// ---------------------------------------------------------------------------

test("no organization screen selects or renders a person identifier", () => {
  const offenders: string[] = [];
  for (const f of [...walk(ORG_APP), ...walk(INTEL_LIB, ".ts")]) {
    const src = code(read(f));
    // `assertAggregate` names these to reject them; that is the guard, not a
    // violation of it.
    if (f.endsWith(path.join("intelligence", "organization.ts"))) {
      // Only the banned-key regex may mention them, and it is one line.
      const lines = src.split("\n").filter((l) => /person_?id|display_?name/i.test(l));
      const allowed = lines.every((l) => /banned|COUNT\(DISTINCT|GROUP BY|JOIN|WHERE|ON /i.test(l));
      if (!allowed) offenders.push(`${path.relative(ROOT, f)} — references a person identifier outside an aggregate`);
      continue;
    }
    if (/\bperson_?id\b|\bdisplay_?name\b|\buser_?id\b/i.test(src)) {
      offenders.push(`${path.relative(ROOT, f)} — mentions a person identifier`);
    }
  }
  assert.deepEqual(offenders, [], "an aggregate surface reached for a person:\n  " + offenders.join("\n  "));
});

test("every organization projection is passed through assertAggregate", () => {
  const src = read(path.join(INTEL_LIB, "organization.ts"));
  assert.ok(src.length > 0, "src/lib/intelligence/organization.ts is missing");

  // Every builder that returns data must launder it. `empty` carries no data,
  // so it is exempt by construction rather than by exception.
  const builders = [...src.matchAll(/export async function (build\w+)\(/g)].map((m) => m[1]);
  assert.ok(builders.length >= 6, `only ${builders.length} organization projections found`);

  const bodies = src.split(/export async function /).slice(1);
  const unlaundered = bodies
    .filter((b) => /\b(ready|partial|stale)\(/.test(b) && !/assertAggregate</.test(b))
    .map((b) => b.slice(0, b.indexOf("(")));
  assert.deepEqual(unlaundered, [],
    `these projections return data without assertAggregate: ${unlaundered.join(", ")}`);
});

test("assertAggregate actually rejects a person-shaped field", async () => {
  const { assertAggregate } = await import("../src/lib/intelligence/organization");
  assert.throws(() => assertAggregate({ rows: [{ personId: "abc", n: 1 }] }), /reports on a population/);
  assert.throws(() => assertAggregate({ nested: { deep: [{ display_name: "x" }] } }), /reports on a population/);
  // A count is not an identifier, and the check must not be so eager that it
  // blocks ordinary aggregate fields.
  assert.doesNotThrow(() => assertAggregate({ rows: [{ label: "North", n: 12, of: 100 }] }));
});

// ---------------------------------------------------------------------------
// No percentage without its denominator (§29.1)
// ---------------------------------------------------------------------------

test("percentages on aggregate screens come from pct(), which requires a denominator", () => {
  const offenders: string[] = [];
  for (const f of walk(ORG_APP)) {
    const src = code(read(f));
    // A literal percent sign next to arithmetic is the shape of a hand-rolled
    // proportion. `pct()` and `cell()` are the only sanctioned renderings, and
    // both take a Count.
    if (/\*\s*100\b/.test(src) || /toFixed\(\s*\d\s*\)\s*}?\s*%/.test(src)) {
      offenders.push(path.relative(ROOT, f));
    }
  }
  assert.deepEqual(offenders, [],
    "these screens compute a percentage inline instead of using pct(): " + offenders.join(", ") +
    "\npct() takes a Count, so the denominator cannot be forgotten.");
});

test("pct and cell always render numerator and denominator", async () => {
  const { pct, cell, SMALL_CELL } = await import("../src/components/charts/aggregate");
  const out = pct({ n: 3470, of: 4820 });
  assert.match(out, /72%/);
  assert.match(out, /3,470/, "the numerator is missing");
  assert.match(out, /4,820/, "the denominator is missing");

  // A zero denominator says so rather than rendering NaN% or 0%.
  assert.match(pct({ n: 0, of: 0 }), /no denominator/);

  // Small cells are withheld, and the denominator survives — hiding it would
  // make the suppression itself invisible.
  const small = cell({ n: SMALL_CELL - 1, of: 4820 });
  assert.match(small, new RegExp(`under ${SMALL_CELL}`));
  assert.match(small, /4,820/);
  assert.doesNotMatch(small, new RegExp(`\\b${SMALL_CELL - 1}\\b`), "the suppressed count leaked");

  // At the threshold it reports normally.
  assert.match(cell({ n: SMALL_CELL, of: 4820 }), /11/);
});

// ---------------------------------------------------------------------------
// Missing data stays visible (§29.1, §31.6's release gate)
// ---------------------------------------------------------------------------

test("the outcomes projection keeps missing follow-up inside the denominator", () => {
  const src = read(path.join(INTEL_LIB, "organization.ts"));
  const body = src.slice(src.indexOf("buildOrgOutcomes"));
  assert.match(body, /Missing follow-up/,
    "the outcomes projection has no missing slice — a cohort chart without one is the " +
    "clean chart hiding incomplete data that blocks a release");
  assert.match(body, /started - \(improved \+ stable \+ worsened\)/,
    "missing follow-up is not computed from the people who started care");
});

test("a gap in a trend is a gap, not an interpolation", () => {
  const chart = read(CHARTS);
  assert.match(chart, /p\.y === null/, "the line chart does not handle a null point");
  assert.match(chart, /runs\.push/,
    "the line chart draws one continuous path — a null must break it, or a month with no " +
    "data is drawn as a line through it");
});

// ---------------------------------------------------------------------------
// No predictive risk score (§29.1, §30.7)
// ---------------------------------------------------------------------------

test("the safety operations screen reports volume and response, never a rate per site", () => {
  const src = read(path.join(INTEL_LIB, "organization.ts"));
  const body = src.slice(src.indexOf("buildOrgSafetyOps"), src.indexOf("org_locations"));
  assert.doesNotMatch(code(body), /risk|score|predict|likelihood|propensity/i,
    "the safety projection mentions risk or prediction — §29.1 forbids a predictive risk score");
  // Volume per site divided by population, sorted, is a risk ranking whatever
  // it is called. The projection returns neither.
  assert.doesNotMatch(code(body), /byLocation|ORDER BY n DESC/,
    "the safety projection ranks sites — a gate rate per site sorted descending is a risk ranking");
});

// ---------------------------------------------------------------------------
// Support paths belong where a person is present
// ---------------------------------------------------------------------------

test("crisis links do not appear on aggregate surfaces, and never leave member ones", () => {
  const view = read(path.join(ROOT, "src", "components", "presentation", "EnvelopeView.tsx"));
  assert.match(view, /audience === "person" && <SupportPaths/,
    "support paths are not gated on audience");
  assert.match(view, /audience = "person"/,
    "audience does not default to person — a surface that forgets must keep the way out");

  // Every organization screen that renders an envelope says it is operations.
  const missing = walk(ORG_APP)
    .filter((f) => /<EnvelopeView/.test(read(f)) && !/audience="operations"/.test(read(f)))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(missing, [],
    "these organization screens would offer an analyst grounding and crisis links: " + missing.join(", "));

  // And no member surface may claim to be operations.
  const wrong = walk(path.join(ROOT, "src", "app", "app"))
    .filter((f) => /audience="operations"/.test(read(f)))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(wrong, [],
    "these member surfaces suppress their own support paths: " + wrong.join(", "));
});

// ---------------------------------------------------------------------------
// Every chart states its window and can be read without seeing it
// ---------------------------------------------------------------------------

test("Figure requires a summary and a footnote", () => {
  const chart = read(CHARTS);
  const sig = chart.slice(chart.indexOf("export function Figure"), chart.indexOf("export interface Stage"));
  assert.match(sig, /summary: string;/, "summary is optional — a chart with no accessible summary can ship");
  assert.match(sig, /footnote: string;/, "footnote is optional — §29.1 requires the window and refresh time");
});

test("every chart rendered on an organization screen is inside a Figure", () => {
  const offenders: string[] = [];
  const CHART_TAGS = ["<Funnel", "<BarList", "<GroupedBars", "<StackedAllocation", "<Line"];
  for (const f of walk(ORG_APP)) {
    const src = read(f);
    if (!CHART_TAGS.some((t) => src.includes(t))) continue;
    // Count them: a chart outside a Figure has no window, no denominator note
    // and no screen-reader summary.
    const charts = CHART_TAGS.reduce((n, t) => n + src.split(t).length - 1, 0);
    const figures = src.split("<Figure").length - 1;
    if (figures < charts) offenders.push(`${path.relative(ROOT, f)} — ${charts} chart(s), ${figures} Figure(s)`);
  }
  assert.deepEqual(offenders, [], "charts rendered without a Figure:\n  " + offenders.join("\n  "));
});
