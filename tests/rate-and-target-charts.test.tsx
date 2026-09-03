// The two chart primitives §29's inventory needed and this codebase did not
// have: a rate compared across categories, and an observed value against an
// agreed target.
//
// Both replaced a table, and both exist because of a specific way the table
// was better than a careless chart would be. A table does not rescale, and it
// does not put two different units on one axis. Any chart that replaces one
// has to keep those properties on purpose.
//
// So these guards RENDER the components and read the marks, rather than
// reading the source for a formula. A width computed from the wrong
// denominator is the whole failure, and it is invisible in a source match.

import { strict as assert } from "node:assert";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RateBars, TargetBars } from "../src/components/charts/aggregate";

const widths = (html: string): number[] =>
  [...html.matchAll(/width:\s*([0-9.]+)%/g)].map((m) => Number(m[1]));

// ---------------------------------------------------------------------------
// RateBars — the axis is fixed
// ---------------------------------------------------------------------------

test("a rate is drawn against 100%, not against the largest row", () => {
  // THE BUG THIS PRIMITIVE EXISTS TO PREVENT. `BarList` scales to the largest
  // value, which is right for counts and wrong for shares: four sites at 61,
  // 58, 55 and 52 per cent rescaled to their own maximum draw as a dramatic
  // staircase, and a nine-point spread reads as a collapse.
  const html = renderToStaticMarkup(
    <RateBars
      rates={[
        { label: "North", count: { n: 61, of: 100 } },
        { label: "Central", count: { n: 58, of: 100 } },
        { label: "East", count: { n: 55, of: 100 } },
        { label: "West", count: { n: 52, of: 100 } },
      ]}
    />,
  );
  assert.deepEqual(widths(html), [61, 58, 55, 52],
    "the bars were rescaled — the largest row is not 100% of the track");
});

test("the same rate draws the same bar whatever else is in the chart", () => {
  // The property a fixed axis buys, stated directly: a site's mark cannot move
  // because a different site changed. With a max-scaled axis it would.
  const alone = renderToStaticMarkup(
    <RateBars rates={[{ label: "North", count: { n: 30, of: 100 } }]} />);
  const beside = renderToStaticMarkup(
    <RateBars rates={[
      { label: "North", count: { n: 30, of: 100 } },
      { label: "Central", count: { n: 90, of: 100 } },
    ]} />);
  assert.equal(widths(alone)[0], widths(beside)[0],
    "adding another row changed the first row's bar");
});

test("each rate carries its own denominator, and they need not match", () => {
  // Sites are not the same size. A rate compared without its denominator is
  // the comparison people get wrong, so §29.1's first rule is enforced by
  // `cell()` on every row rather than by a footnote.
  const html = renderToStaticMarkup(
    <RateBars
      rates={[
        { label: "Big", count: { n: 600, of: 1000 } },
        { label: "Small", count: { n: 30, of: 50 } },
      ]}
    />,
  );
  assert.match(html, /600 \/ 1,000/, "the large site's denominator is missing");
  assert.match(html, /30 \/ 50/, "the small site's denominator is missing");
  // Same rate, same bar — which is the point of drawing shares at all.
  assert.deepEqual(widths(html), [60, 60]);
});

test("a suppressed row stays in the comparison, as suppressed", () => {
  // §29.1: missing, incomplete and suppressed data remain visible. A site
  // dropped for being small is a site whose absence nobody can see.
  const html = renderToStaticMarkup(
    <RateBars
      rates={[
        { label: "Large", count: { n: 500, of: 1000 } },
        { label: "Tiny", count: { n: 3, of: 40 } },
      ]}
    />,
  );
  assert.equal(widths(html).length, 2, "the suppressed row was not drawn");
  assert.match(html, /under 11 \(of 40\)/, "the suppressed row leaks its count");
  assert.doesNotMatch(html, /3 \/ 40/, "the suppressed count is shown anyway");
});

// ---------------------------------------------------------------------------
// TargetBars — no shared axis, and a miss reads as plainly as a hit
// ---------------------------------------------------------------------------

const CONTRACT = [
  { label: "Started care", unit: "%", observed: 62, target: 55, better: "higher" as const, met: true },
  { label: "Median wait", unit: "days", observed: 21, target: 14, better: "lower" as const, met: false },
  { label: "ED visits", unit: "per 1,000", observed: null, target: 40, better: "lower" as const,
    met: null, withheld: "two months of claims have not arrived" },
];

test("every measure is drawn against its own target, not a shared axis", () => {
  // §29.1 forbids overlaying different clinical scales, and a contract's
  // measures are a rate, a duration and a count per thousand. So 62 and 21 —
  // numbers that mean nothing beside each other — must not land on one axis.
  // Each row is normalised to ITS target, which is why 62-against-55 draws
  // longer than 21-against-14 does not.
  const html = renderToStaticMarkup(<TargetBars rows={CONTRACT} />);
  const w = widths(html);
  assert.equal(w.length, 2, "a row with no observed value drew a bar anyway");

  // 62/(2*55) = 56%, 21/(2*14) = 75%. Not 62 and 21, which is what a shared
  // axis would have produced.
  assert.deepEqual(w, [56, 75]);
});

test("the target sits at the same place on every row", () => {
  // That is what makes the rows comparable at all: the only thing these five
  // numbers share is a distance from their own target.
  const html = renderToStaticMarkup(<TargetBars rows={CONTRACT} />);
  const ticks = [...html.matchAll(/left:\s*50%/g)];
  assert.equal(ticks.length, CONTRACT.length,
    "not every row carries a target tick at the midpoint");
});

test("a miss is exactly as legible as a hit, in words as well as colour", () => {
  const html = renderToStaticMarkup(<TargetBars rows={CONTRACT} />);
  assert.match(html, /met/);
  assert.match(html, /not met/);
  // Non-colour encoding: §29.1 requires direct labels and a channel other than
  // colour, so the verdict is a word and a glyph, not a green bar.
  assert.match(html, /◆/, "the met glyph is missing");
  assert.match(html, /▲/, "the missed glyph is missing");
});

test("a measure with no observed value keeps its row and says why", () => {
  // The failure mode this prevents: a contract report that silently shows four
  // measures because the fifth had no data, which reads as a four-measure
  // contract.
  const html = renderToStaticMarkup(<TargetBars rows={CONTRACT} />);
  assert.match(html, /ED visits/, "the unreported measure was dropped from the chart");
  assert.match(html, /not reported/);
  assert.match(html, /two months of claims have not arrived/,
    "the reason the measure is unreported is not shown");
});

test("direction is stated, because a short bar is good for a lower-is-better measure", () => {
  const html = renderToStaticMarkup(<TargetBars rows={CONTRACT} />);
  assert.match(html, /lower is better/);
  assert.match(html, /higher is better/);
});
