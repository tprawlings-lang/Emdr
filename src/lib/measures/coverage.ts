// What a measure series does NOT contain (17 September handoff, P4).
//
//   "Measures — separate validated instruments from custom function
//   observations. Scale, direction, window, and missingness are explicit."
//
// Scale, direction and window were already on the page: each panel prints its
// unit and range, says whether lower or higher is better, and every panel is
// drawn on one shared date axis so a three-month gap is three months wide.
// MISSINGNESS WAS NOT. The figure said whether ANY instrument had been repeated
// and nothing about the individual series, so a PHQ-9 last taken in March sat
// beside a GAD-7 taken last week, both drawn with the same confidence, and the
// difference between them was something a reader had to work out from the
// pixels.
//
// A GAP IS NOT A DECLINE AND IT IS NOT A PLATEAU, and the gap this names is the
// one at the END. Each panel already prints its count, its first and its latest
// reading, so repeating those here put the same facts twice on one screen. What
// no panel can show is the distance between the last reading and today: the
// axis stops at the last point, so a series that ended in March and one that
// ended last week are drawn identically from their own right-hand edge.
//
// Pure, and takes `asOf` rather than reading a clock: the caller passes the
// page's reading frame, so a demo clock moves this the way it moves everything
// else, and a test can pass a literal.

export interface Reading {
  date: string;
  value: number;
}

export interface SeriesCoverage {
  label: string;
  readings: number;
  first: string | null;
  last: string | null;
  /** Days between the last reading and the reading frame. Null with no readings. */
  daysSinceLast: number | null;
  /** Whether there is more than one reading, which is what a trend needs. */
  repeated: boolean;
  /** The whole statement, in one sentence a clinician can act on. */
  said: string;
}

const DAY = 86400000;

function days(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY));
}

export function seriesCoverage(
  series: { label: string; points: Reading[] },
  asOf: string
): SeriesCoverage {
  const dates = series.points.map((p) => p.date).sort();
  const first = dates[0] ?? null;
  const last = dates[dates.length - 1] ?? null;
  const readings = dates.length;
  const repeated = readings > 1;
  const daysSinceLast = last ? days(last, asOf) : null;

  if (readings === 0) {
    return {
      label: series.label, readings, first, last, daysSinceLast, repeated,
      // NOT "no change" and not a blank. An instrument nobody has administered
      // is a different fact from one whose score has not moved.
      said: "Never taken, so there is nothing to read here — not a stable score.",
    };
  }

  // ONLY THE STALENESS, and this is the whole sentence on purpose.
  //
  // The first version also reported the count, the span and "one reading is not
  // a trend" — and every one of those is already printed inside the panel this
  // sits under: "First 15 on 2026-01-04 · Latest 13 on 2026-07-02 · All 8
  // readings", and "one reading, so there is no trend to read yet". Seen on the
  // rendered screen rather than in the source, it was the same facts twice, one
  // above the other, which is the duplication this codebase treats as a defect
  // rather than as thoroughness.
  //
  // What the panel cannot say is how long it has been since the last reading:
  // the axis ends at the last reading, so a series that stopped in March and
  // one that stopped last week are drawn identically from their own last point.
  const said =
    daysSinceLast === null ? `Last reading ${last}.`
    : daysSinceLast === 0 ? "Taken today."
    : `Nothing recorded in the ${daysSinceLast} day${daysSinceLast === 1 ? "" : "s"} since ${last}.`;

  return { label: series.label, readings, first, last, daysSinceLast, repeated, said };
}

/** Coverage for every series, for the list under a figure. */
export function coverageFor(
  series: ReadonlyArray<{ label: string; points: Reading[] }>,
  asOf: string
): SeriesCoverage[] {
  return series.map((s) => seriesCoverage(s, asOf));
}
