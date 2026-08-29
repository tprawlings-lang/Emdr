// Person-level charts (§29's clinician inventory).
//
// The aggregate charts' central rule is the denominator. These report on one
// person, and their central rule is the opposite: never imply a trend, a cause
// or a prediction from a handful of points about a human being.
//
// §29.1 states two of them outright — "annotations mark sessions, plan
// versions or care events; they do not imply cause" and "show fixed event
// timelines and response workflow; do not create a predictive risk score" —
// and both are the kind of rule a well-meaning improvement breaks. A fitted
// line through six sessions looks like rigour. A colour that says the closing
// reading is the good one looks like clarity.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CHART = path.join(ROOT, "src", "components", "charts", "clinical.tsx");

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

test("no person-level chart fits a line, projects, or scores", () => {
  // Comments AND the one sanctioned sentence come out first. The timeline
  // renders "No predictive risk score" on the screen deliberately — the next
  // test asserts it is there — so a naive scan for "predict" flags the
  // safeguard as the violation.
  const src = code(read(CHART)).replace(/No predictive risk score[^<]*/g, " ");
  assert.ok(src.length > 0, "clinical.tsx is missing");
  for (const banned of ["regression", "trendline", "forecast", "predict", "projected", "riskScore"]) {
    assert.ok(
      !new RegExp(banned, "i").test(src),
      `the person-level charts reference "${banned}" — §29.1 forbids a predictive risk score, ` +
      "and a fitted line through six sessions is the same claim drawn differently",
    );
  }
});

test("the safety timeline states that it carries no risk score, on the screen", () => {
  // In the rendered output, not in a comment. A reviewer reads the screen.
  const src = read(CHART);
  const timeline = src.slice(src.indexOf("export function EventTimeline"));
  assert.match(timeline, /No predictive risk score/,
    "the timeline does not tell its reader it is not a risk score");
});

test("a session with no close reading keeps its row and says why", () => {
  const src = read(CHART);
  const slope = src.slice(src.indexOf("export function Slope"), src.indexOf("EventTimeline"));
  // The row renders on a null close rather than being filtered out.
  assert.match(slope, /r\.close === null \?/,
    "the slope chart has no branch for a missing close — a dropped row makes every " +
    "remaining row a session that finished, which is a different population");
  assert.match(slope, /incomplete/,
    "a missing close is not explained, so it reads as 'did not change' rather than 'not measured'");
});

test("the slope chart's marks encode which reading, not whether it was good", async () => {
  const src = read(CHART);
  const slope = src.slice(src.indexOf("export function Slope"), src.indexOf("EventTimeline"));
  // The defect this replaced: close drawn in safe-green, so a session that
  // ended HIGHER put a green dot on the worst number in the row.
  // Targeted at the MARKS, not the row. "higher at close" is a legitimate
  // caution-coloured label on the value; a caution-coloured dot is not.
  const marks = slope.match(/(?:background|border)Color:\s*"var\(--color-[a-z-]+\)"/g) ?? [];
  assert.ok(marks.length >= 2, "the slope chart's marks are not styled where this can check them");
  const valenced = marks.filter((m) => /state-(safe|caution|support)/.test(m));
  assert.deepEqual(valenced, [],
    "the slope chart colours a mark by valence — on a session that ended higher, that " +
    "marks the worst number as the good one: " + valenced.join(", "));
  assert.match(slope, /border-2/,
    "open and close are not distinguished by shape, so the encoding depends on colour alone");
});

test("a session with no OPENING reading is counted and stated, not silently dropped", async () => {
  const lib = read(path.join(ROOT, "src", "lib", "clinical", "session-response.ts"));
  assert.match(lib, /noOpening/,
    "sessions that cannot be placed on the scale vanish into the gap between total and rows");
  const page = read(path.join(ROOT, "src", "app", "clinician", "member", "[id]", "sessions", "page.tsx"));
  assert.match(page, /noOpening/, "the screen never mentions the sessions it could not plot");
});

test("the session-response projection keeps a hard stop rather than treating it as missing", async () => {
  const { buildSessionResponse } = await import("../src/lib/clinical/session-response");
  assert.equal(typeof buildSessionResponse, "function");
  const lib = read(path.join(ROOT, "src", "lib", "clinical", "session-response.ts"));
  // A hard stop records both readings and is the most important row on the
  // chart — it is the session that went the wrong way.
  assert.doesNotMatch(code(lib), /status\s*!==\s*['"]hard_stop['"]|status\s*===\s*['"]completed['"]/,
    "the projection filters sessions by status — excluding a hard stop removes the one " +
    "session a clinician most needs to see");
});

test("the safety timeline is tenant scoped", () => {
  // The bug this exists to stop recurring: the measures page read by person id
  // alone, so any member id opened their record across tenants — and the
  // access was audited under the clinician's name, which makes it look
  // sanctioned.
  const lib = read(path.join(ROOT, "src", "lib", "clinical", "safety-timeline.ts"));
  assert.match(lib, /tenant_id\s*=\s*\?/,
    "the safety timeline queries by person id with no tenant predicate");
});

test("every person-level chart is inside a ClinicalFigure", () => {
  const offenders: string[] = [];
  const SCREENS = [
    ["clinician", "member", "[id]", "sessions", "page.tsx"],
    ["clinician", "member", "[id]", "safety", "page.tsx"],
  ];
  for (const parts of SCREENS) {
    const src = read(path.join(ROOT, "src", "app", ...parts));
    const charts = ["<Slope", "<EventTimeline"].reduce((n, t) => n + src.split(t).length - 1, 0);
    if (charts === 0) continue;
    const figures = src.split("<ClinicalFigure").length - 1;
    if (figures < charts) offenders.push(`${parts.join("/")} — ${charts} chart(s), ${figures} figure(s)`);
  }
  assert.deepEqual(offenders, [],
    "charts rendered without a figure, so with no window, no summary and no caveat:\n  " +
    offenders.join("\n  "));
});
