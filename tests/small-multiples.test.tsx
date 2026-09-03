// Aligned small multiples — the clinician measures chart (p76).
//
// THE DEFECT THIS REPLACED, and the reason the guards below read positions out
// of the rendered marks rather than checking the source for a formula.
//
// The previous chart placed a reading by its INDEX in its own series:
// `x = PAD + i * (W - 2*PAD) / (n - 1)`. Every consequence of that is invisible
// in a code review and obvious in a rendered panel:
//
//   * Two instruments measured on different days put the SAME DATE in
//     different places, so reading across the panels — the only thing small
//     multiples are for — compared positions that meant nothing.
//   * A series of three readings stretched across the same width as one of
//     twelve.
//   * A three-month gap drew exactly as wide as a one-week gap, which turns an
//     absence of data into a smooth decline.
//
// And one rule pulls the other way: §29.1 forbids overlaying different
// clinical scales, so the panels must NOT share a y axis even though they
// share an x.

import { strict as assert } from "node:assert";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SmallMultiples, type MeasureSeries } from "../src/components/charts/clinical";

/** The visible words, with markup removed. Checks about what a READER is told
 *  belong here rather than against the HTML: the first version of the
 *  arithmetic guard below matched `translateX(-50%)` in a style attribute. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

/** The circle centres, in document order, as [x, y] pairs. */
function marks(html: string): [number, number][] {
  return [...html.matchAll(/<circle[^>]*cx="([0-9.]+)"[^>]*cy="([0-9.]+)"/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
}

const FROM = "2026-01-01";
const TO = "2026-07-01";

// Two instruments, measured on DIFFERENT days and a different number of times
// — which is the ordinary case and the one the index axis got wrong.
const TWO: MeasureSeries[] = [
  {
    label: "PHQ-9", unit: "total, 0–27", max: 27, lowerIsBetter: true,
    points: [
      { date: "2026-01-01", value: 18 },
      { date: "2026-04-01", value: 12 },
      { date: "2026-07-01", value: 9 },
    ],
  },
  {
    // Deliberately ENDS EARLIER than PHQ-9 and has fewer readings. The first
    // version of this fixture gave both series the same first and last dates,
    // and an index axis agrees with a date axis at the endpoints — so the
    // shared-date guard below passed against the very defect it names. A
    // fixture that cannot distinguish the two axes is not a fixture.
    label: "PCL-5", unit: "total, 0–80", max: 80, lowerIsBetter: true,
    points: [
      { date: "2026-01-01", value: 52 },
      { date: "2026-04-01", value: 44 },
    ],
  },
];

test("the same date is in the same place on every panel", () => {
  // The property the form exists for. With an index axis PCL-5's second
  // reading — 1 July — landed at the far right of its panel while PHQ-9's
  // second reading — 1 April — landed at the far right of ITS panel, so the
  // two panels disagreed about where July was.
  const pts = marks(renderToStaticMarkup(<SmallMultiples series={TWO} from={FROM} to={TO} />));
  assert.equal(pts.length, 5);

  const phq = pts.slice(0, 3).map((p) => p[0]);
  const pcl = pts.slice(3).map((p) => p[0]);

  assert.equal(phq[0], pcl[0], "1 January is in two different places");
  // 1 April is PHQ-9's MIDDLE reading and PCL-5's LAST. On an index axis the
  // second lands at the right-hand edge of its panel and the first at the
  // middle of its own, so the panels disagree about where April is.
  assert.equal(phq[1], pcl[1], "1 April is in two different places");
  // And PHQ-9 goes on past where PCL-5 stops, rather than both being stretched
  // to fill the same width.
  assert.ok(phq[2] > pcl[1], "PHQ-9's July reading is not past PCL-5's April one");
});

test("a reading's position comes from its date, not from its place in the list", () => {
  // PHQ-9's middle reading is 1 April: three months into a six-month window,
  // so it belongs at the MIDPOINT. On an index axis it would also land at the
  // midpoint here — three evenly spaced readings — which is exactly why the
  // bug survived: it is only wrong when the readings are not evenly spaced.
  const uneven: MeasureSeries[] = [{
    ...TWO[0],
    points: [
      { date: "2026-01-01", value: 18 },
      { date: "2026-02-01", value: 15 },  // one month in, not halfway
      { date: "2026-07-01", value: 9 },
    ],
  }];
  const [a, b, c] = marks(renderToStaticMarkup(
    <SmallMultiples series={uneven} from={FROM} to={TO} />)).map((p) => p[0]);

  const halfway = a + (c - a) / 2;
  assert.ok(b < halfway - 1,
    `the second reading sits at ${b}, at or past the midpoint ${halfway} — it is being placed ` +
    "by its index, so a one-month gap draws as wide as a five-month one");
});

test("a long gap is drawn long, so an absence of data cannot read as a smooth decline", () => {
  const sparse: MeasureSeries[] = [{
    ...TWO[0],
    points: [
      { date: "2026-01-01", value: 18 },
      { date: "2026-01-08", value: 17 },
      { date: "2026-07-01", value: 9 },
    ],
  }];
  const xs = marks(renderToStaticMarkup(
    <SmallMultiples series={sparse} from={FROM} to={TO} />)).map((p) => p[0]);

  const week = xs[1] - xs[0];
  const rest = xs[2] - xs[1];
  assert.ok(rest > week * 10,
    `a one-week gap drew ${week} and a six-month gap drew ${rest} — the axis is not time`);
});

test("each panel keeps its own scale — a PHQ-9 and a PCL-5 do not share a y axis", () => {
  // §29.1: do not overlay different clinical scales. 18/27 and 52/80 are close
  // as PROPORTIONS of their own instruments, so if the panels are correctly
  // scaled their first marks sit at a similar height — and on a shared axis
  // running to 80, the PHQ-9 would be squashed against the floor.
  const pts = marks(renderToStaticMarkup(<SmallMultiples series={TWO} from={FROM} to={TO} />));
  const phqFirst = pts[0][1];
  const pclFirst = pts[3][1];
  assert.ok(Math.abs(phqFirst - pclFirst) < 6,
    `18 of 27 drew at ${phqFirst} and 52 of 80 at ${pclFirst} — the panels are sharing a scale`);
});

test("an instrument taken once keeps its panel and draws no line through nothing", () => {
  const once: MeasureSeries[] = [{ ...TWO[1], points: [{ date: "2026-03-01", value: 52 }] }];
  const html = renderToStaticMarkup(<SmallMultiples series={once} from={FROM} to={TO} />);
  assert.equal(marks(html).length, 1);
  assert.doesNotMatch(html, /<polyline/,
    "a single reading was joined to itself — a trend drawn from one point");
});

test("the readings are in the text, not only in the picture", () => {
  // §29.1's accessibility rule. The values ARE the accessible representation
  // rather than a description of one, so there is no second copy to drift.
  const html = renderToStaticMarkup(<SmallMultiples series={TWO} from={FROM} to={TO} />);
  for (const p of TWO[0].points) {
    assert.ok(html.includes(`${p.value} (${p.date})`),
      `the reading ${p.value} on ${p.date} is only in the drawing`);
  }
  assert.match(html, /lower is better/,
    "direction is not stated, so a falling line could be read either way");
});

test("no fitted line, no projection, no score", () => {
  // The person-level rule: never imply a trend, a cause or a prediction from a
  // handful of points about a human being. The marks are the readings taken;
  // the segments join consecutive readings and nothing more.
  const html = renderToStaticMarkup(<SmallMultiples series={TWO} from={FROM} to={TO} />);
  const segments = [...html.matchAll(/<polyline[^>]*points="([^"]+)"/g)]
    .map((m) => m[1].trim().split(/\s+/).length);
  assert.deepEqual(segments, [3, 2],
    "a path has more vertices than the person has readings — something is being interpolated");
});

// ---------------------------------------------------------------------------
// Annotations — the plan-response half of the progress view
// ---------------------------------------------------------------------------

const PLAN_MARKS = [
  { date: "2026-02-01", label: "Plan written" },
  { date: "2026-05-01", label: "Plan revised (version 2)" },
];

test("a plan version is marked at its date on every panel", () => {
  // §29.1: annotations mark plan versions and care events. Marked on EVERY
  // panel, at the same x, because that is what the shared axis is for —
  // reading down the panels to see what each instrument was doing either side
  // of a revision.
  const html = renderToStaticMarkup(
    <SmallMultiples series={TWO} from={FROM} to={TO} annotations={PLAN_MARKS} />);

  // x1 comes BEFORE stroke-dasharray in the rendered attribute order; a regex
  // that assumed the reverse matched nothing and passed by finding zero marks
  // where zero was also the failure.
  const rules = [...html.matchAll(/<line[^>]*x1="([0-9.]+)"[^>]*stroke-dasharray/g)]
    .map((m) => Number(m[1]));
  // Two marks on each of two panels.
  assert.equal(rules.length, PLAN_MARKS.length * TWO.length,
    "the marks are not drawn on every panel");
  // And at the same two positions on both.
  assert.deepEqual(rules.slice(0, 2), rules.slice(2),
    "the same plan version is at different places on different panels");
});

test("a plan version is placed by its date, on the same axis as the readings", () => {
  const html = renderToStaticMarkup(
    <SmallMultiples series={TWO} from={FROM} to={TO} annotations={[PLAN_MARKS[1]]} />);
  const rule = Number(/<line[^>]*x1="([0-9.]+)"[^>]*stroke-dasharray/.exec(html)![1]);
  const readings = marks(html).map((p) => p[0]);
  // 1 May sits between the readings of 1 April and 1 July.
  assert.ok(rule > readings[1] && rule < readings[2],
    `the 1 May mark at ${rule} is not between the April and July readings`);
});

test("the marks cannot be shown without the sentence that says they are not a cause", () => {
  // THE RULE THIS ENFORCES STRUCTURALLY. "Annotations ... do not imply cause."
  // A page could print that sentence and a later edit could drop it, so the
  // component prints it: the marks and the caveat are the same decision.
  const html = renderToStaticMarkup(
    <SmallMultiples series={TWO} from={FROM} to={TO} annotations={PLAN_MARKS} />);
  assert.match(html, /not evidence/,
    "plan versions are marked with no statement that a change after one is not caused by it");
  for (const a of PLAN_MARKS) {
    assert.ok(html.includes(a.label), `${a.label} is drawn but never named`);
  }
});

test("no annotations, no caveat and no marks", () => {
  // The sentence is about marks that are present. A chart with none should not
  // carry a disclaimer for something it does not show.
  const html = renderToStaticMarkup(<SmallMultiples series={TWO} from={FROM} to={TO} />);
  assert.doesNotMatch(html, /not evidence/);
  assert.doesNotMatch(html, /stroke-dasharray/);
});

test("nothing shades, splits or compares the periods either side of a mark", () => {
  // The failure this guards. A "plan response" chart that shades after the
  // revision, or reports a before-and-after difference, has stopped marking an
  // event and started making an argument about it — from an uncontrolled
  // comparison, on one person.
  const html = renderToStaticMarkup(
    <SmallMultiples series={TWO} from={FROM} to={TO} annotations={PLAN_MARKS} />);
  assert.doesNotMatch(html, /<rect/, "a period either side of a mark is being shaded");

  // Structural, not a word search. The first version forbade the word "after",
  // which appears in the component's own caveat — "a change AFTER one of them
  // is not evidence" — so the guard failed on the sentence it exists to
  // require. What must not appear is ARITHMETIC across a mark: a point
  // difference, a percentage, an arrow.
  assert.doesNotMatch(text(html), /[-+±]\s?\d+(\.\d+)?\s*(points?|%)/i,
    "a difference across the plan version is being computed and shown");

  // And no mark beyond the readings themselves: a summary point for each
  // period would be the same comparison drawn instead of written.
  assert.equal(marks(html).length, TWO[0].points.length + TWO[1].points.length,
    "there are more marks than the person has readings");
});

// ---------------------------------------------------------------------------
// A measure this project wrote itself, drawn beside ones it did not
// ---------------------------------------------------------------------------

test("a house measure carries its disclosure on its own panel", () => {
  // THE HARM THIS PREVENTS. A panel drawn beside PHQ-9 and PCL-5 borrows their
  // authority: same frame, same marks, same axis, same page. For a validated
  // instrument that is fine. For a measure with no research behind it the
  // borrowed authority IS the harm — so the disclosure is a property of the
  // series rather than a note the page might remember, and it renders on the
  // panel, not in a footnote a reader scanning one series never reaches.
  const house = {
    label: "Everyday function (Steady house measure)",
    unit: "total, 0–16", max: 16, lowerIsBetter: false,
    disclosure: "Written by Steady, not a validated instrument.",
    points: [{ date: "2026-01-01", value: 6 }, { date: "2026-07-01", value: 11 }],
  };
  const html = renderToStaticMarkup(
    <SmallMultiples series={[TWO[0], house]} from={FROM} to={TO} />);

  assert.ok(html.includes(house.disclosure), "the house measure is drawn with nothing said");
  // Beside the panel it belongs to, before the axis labels at the bottom.
  assert.ok(html.indexOf(house.label) < html.indexOf(house.disclosure),
    "the disclosure is not attached to the measure it is about");

  // And a validated instrument does not acquire one.
  assert.equal(
    (html.match(/not a validated instrument/g) ?? []).length, 1,
    "the disclosure is repeated onto panels it is not about");
});

test("higher-is-better is stated, because this one runs the other way", () => {
  // Every validated instrument on this screen falls as things improve. The
  // house measure rises. A reader who assumes the house direction reads
  // improvement as decline, so the direction is words on every panel.
  const html = renderToStaticMarkup(
    <SmallMultiples
      series={[TWO[0], {
        label: "Everyday function", unit: "total, 0–16", max: 16, lowerIsBetter: false,
        points: [{ date: "2026-01-01", value: 6 }],
      }]}
      from={FROM} to={TO} />);
  assert.match(html, /lower is better/);
  assert.match(html, /higher is better/);
});
