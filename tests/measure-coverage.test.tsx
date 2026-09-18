import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { seriesCoverage } from "../src/lib/measures/coverage";
import { MeasureCoverage } from "../src/components/clinical/MeasureCoverage";

// Measures (17 September handoff, P4).
//
//   "Separate validated instruments from custom function observations. Scale,
//   direction, window, and missingness are explicit."
//
// Scale, direction and window were already on the page: every panel prints its
// unit and range, says whether lower or higher is better, and shares one date
// axis so a three-month gap is three months wide.
//
// THE OTHER TWO WERE NOT. The house measure was drawn inside a figure titled
// "Validated measures over time" and carried a per-panel note saying it had no
// validation to borrow — so the panel was disclaiming the authority the frame
// around it was granting. And missingness was left to the pixels: a PHQ-9 last
// taken in March sat beside a GAD-7 taken last week, both drawn with the same
// confidence, and telling them apart meant measuring spacing by eye.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const AS_OF = "2026-09-18";

// ---------------------------------------------------------------------------
// Missingness, said rather than drawn
// ---------------------------------------------------------------------------

test("a stale series says how long it has been", () => {
  const c = seriesCoverage({
    label: "PHQ-9",
    points: [
      { date: "2026-03-02", value: 14 },
      { date: "2026-03-30", value: 11 },
    ],
  }, AS_OF);

  assert.equal(c.readings, 2);
  assert.equal(c.repeated, true);
  assert.equal(c.first, "2026-03-02");
  assert.equal(c.last, "2026-03-30");
  assert.equal(c.daysSinceLast, 172);
  assert.match(c.said, /Nothing recorded in the 172 days since 2026-03-30/,
    "the gap since the last reading is left for the reader to measure off the axis");
});

test("the sentence says only what the panel above it cannot", () => {
  // THE PANEL ALREADY PRINTS THE COUNT AND THE DATES — "First 15 on 2026-01-04
  // · Latest 13 on 2026-07-02 · All 8 readings", and "one reading, so there is
  // no trend to read yet". The first version of this list repeated every one of
  // them, which was obvious on the rendered screen and invisible in the source.
  const c = seriesCoverage({ label: "GAD-7", points: [{ date: "2026-01-04", value: 8 }] }, AS_OF);
  assert.equal(c.repeated, false);
  assert.match(c.said, /Nothing recorded in the 257 days since 2026-01-04/);
  for (const repeated of [/1 reading|Taken once/, /not a trend/, /\(\d+ days\)/]) {
    assert.doesNotMatch(c.said, repeated,
      `the coverage line repeats something the panel already says: ${c.said}`);
  }
});

test("taken today reads as today, not as zero days", () => {
  const c = seriesCoverage({ label: "PCL-5", points: [{ date: AS_OF, value: 30 }] }, AS_OF);
  assert.equal(c.daysSinceLast, 0);
  assert.match(c.said, /Taken today/);
  assert.doesNotMatch(c.said, /0 days/, "a same-day reading reads as a zero-length gap");
});

test("never taken is a different fact from a score that has not moved", () => {
  const c = seriesCoverage({ label: "ITQ", points: [] }, AS_OF);
  assert.equal(c.readings, 0);
  assert.equal(c.daysSinceLast, null);
  assert.match(c.said, /Never taken/);
  assert.match(c.said, /not a stable score/,
    "an unadministered instrument could be read as an unchanged one");
});

test("the span between first and last is stated, not just the endpoints", () => {
  const c = seriesCoverage({
    label: "PHQ-9",
    points: [
      { date: "2026-01-05", value: 20 },
      { date: "2026-05-05", value: 12 },
      { date: "2026-09-05", value: 9 },
    ],
  }, AS_OF);
  // The span belongs to the panel; this line carries the end gap.
  assert.equal(c.first, "2026-01-05");
  assert.equal(c.last, "2026-09-05");
  assert.match(c.said, /Nothing recorded in the 13 days since 2026-09-05/);
});

test("the reading frame decides how stale a series is", () => {
  // Not `new Date()`: "how long since the last reading" is a derived age, and
  // the clock contract puts every one of those on the reading frame.
  const points = [{ date: "2026-03-30", value: 11 }];
  const today = seriesCoverage({ label: "PHQ-9", points }, "2026-09-18").daysSinceLast;
  const backThen = seriesCoverage({ label: "PHQ-9", points }, "2026-04-06").daysSinceLast;
  assert.equal(today, 172);
  assert.equal(backThen, 7, "the staleness does not move with the frame it is read in");

  const src = code(read("src/lib/measures/coverage.ts"));
  assert.doesNotMatch(src, /new Date\(\)|Date\.now\(\)/,
    "the coverage module reads a clock of its own");
  const page = code(read("src/app/clinician/member/[id]/measures/page.tsx"));
  assert.match(page, /readingFrame\(\)/, "the page does not take its as-of from the reading frame");
});

// ---------------------------------------------------------------------------
// Rendered
// ---------------------------------------------------------------------------

test("every series on a figure gets a line, including the ones with little in them", () => {
  const html = renderToStaticMarkup(
    <MeasureCoverage
      asOf={AS_OF}
      series={[
        { label: "PHQ-9", points: [{ date: "2026-03-02", value: 14 }, { date: "2026-03-30", value: 11 }] },
        { label: "GAD-7", points: [{ date: "2026-09-17", value: 8 }] },
      ]}
    />
  );
  const body = text(html);
  assert.ok(body.includes("PHQ-9"), "a series is missing from the coverage list");
  assert.ok(body.includes("GAD-7"));
  assert.match(body, /Nothing recorded in the 172 days since/);
  assert.match(body, /Nothing recorded in the 1 day since 2026-09-17/);
  assert.match(body, /How current each reading is/);
});

test("no series means no panel rather than an empty heading", () => {
  assert.equal(renderToStaticMarkup(<MeasureCoverage series={[]} asOf={AS_OF} />), "");
});

// ---------------------------------------------------------------------------
// The separation
// ---------------------------------------------------------------------------

test("the house measure is not drawn inside a figure that calls itself validated", () => {
  // THE DEFECT. The panel carried a note saying it had no validation to borrow,
  // inside a frame titled "Validated measures over time". A note inside a frame
  // does not undo the frame.
  const page = code(read("src/app/clinician/member/[id]/measures/page.tsx"));
  assert.doesNotMatch(page, /"Validated measures over time"/,
    "the frame still claims validation over a set that includes the house measure");
  assert.match(page, /validatedSeries = measureSeries\.filter\(\(m\) => m\.validated\)/,
    "the series are not split by whether they are validated");
  assert.match(page, /functionSeries = measureSeries\.filter\(\(m\) => !m\.validated\)/);

  // Each figure gets its own set — asserted as "the combined list never reaches
  // a chart", because the halves are named in two places each (the chart and
  // its coverage list) and a check for their PRESENCE passed a mutation that
  // pointed the validated figure back at everything.
  assert.doesNotMatch(page, /series=\{measureSeries\}/,
    "a figure is drawn from the combined list again, so the split is decorative");
  assert.match(page, /series=\{validatedSeries\}/);
  assert.match(page, /series=\{functionSeries\}/);

  // And the combined list survives only to derive the halves and the window.
  const uses = [...page.matchAll(/measureSeries/g)];
  assert.ok(uses.length <= 5,
    `measureSeries is referenced ${uses.length} times; it should only build the two halves, ` +
    "the shared window and the trend flag");
});

test("the function figure says what it is in its own title", () => {
  const page = read("src/app/clinician/member/[id]/measures/page.tsx");
  assert.match(page, /Function observations — not a validated instrument/,
    "the second figure does not say that it is not a validated instrument");
  assert.match(page, /no published norms, no cut-offs/,
    "the figure does not say what it lacks");
});

test("both figures share one window, so separating them did not scatter them", () => {
  // The shared date axis is the whole reason small multiples are worth drawing.
  // Splitting the figure must not cost the thing the split was protecting.
  const page = code(read("src/app/clinician/member/[id]/measures/page.tsx"));
  const uses = page.match(/from=\{windowFrom\}\s*\n\s*to=\{windowTo\}/g) ?? [];
  assert.equal(uses.length, 2,
    "the two figures are not drawn on the same window, so their dates no longer line up");
});
