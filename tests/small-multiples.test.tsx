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
