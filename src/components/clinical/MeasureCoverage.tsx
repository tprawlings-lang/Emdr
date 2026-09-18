import { coverageFor, type Reading } from "@/lib/measures/coverage";

// How much of each series is actually there (17 September handoff, P4).
//
//   "Scale, direction, window, and missingness are explicit."
//
// The first three were: every panel prints its unit and range, says whether
// lower or higher is better, and shares one date axis so a three-month gap is
// three months wide. MISSINGNESS WAS LEFT TO THE PIXELS. A PHQ-9 last taken in
// March sat beside a GAD-7 taken last week, both drawn with the same
// confidence, and telling them apart meant measuring the spacing by eye.
//
// So it is said in words, per series, under the figure it belongs to — and ONLY
// the part the panel cannot show. The panel already prints the count, the first
// and the latest reading; repeating those here put the same facts twice on one
// screen, which was visible the moment the page was rendered and invisible in
// the source. What no panel can show is the distance between the last reading
// and today: the axis stops at the last point, so a series that ended in March
// and one that ended last week are drawn identically from their own edge.

export function MeasureCoverage({
  series, asOf,
}: {
  series: ReadonlyArray<{ label: string; points: Reading[] }>;
  asOf: string;
}) {
  if (series.length === 0) return null;
  const coverage = coverageFor(series, asOf);

  return (
    <div className="mt-4 border-t border-ground/10 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">
        How current each reading is
      </h3>
      <dl className="mt-2 space-y-1.5">
        {coverage.map((c) => (
          <div key={c.label} className="text-xs sm:flex sm:gap-3">
            <dt className="font-medium text-app-ink sm:w-44 sm:shrink-0">{c.label}</dt>
            <dd className="measure text-olive">{c.said}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
