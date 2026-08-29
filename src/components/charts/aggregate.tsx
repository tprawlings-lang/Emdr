// Aggregate chart primitives (§29).
//
// §29.1 sets eight rules for every chart, and most of them are the kind a
// component either enforces or quietly loses:
//
//   Denominator   never a percentage without its numerator and denominator
//   Range         always the window, the comparison anchor and the refresh time
//   Missing data  missing, incomplete, late, rejected and suppressed stay visible
//   Scale         no overlay of different clinical scales
//   Events        annotations mark events; they never imply cause
//   Safety        no predictive risk score
//   Accessibility direct labels, non-colour encoding, screen-reader summary
//   Export        export matches current filters and writes an audit event
//
// Three of those are encoded here as required parameters rather than
// documented as guidance. `Count` cannot be constructed without a denominator.
// Every chart requires a `summary` and a `footnote`. And the bar charts are
// built from HTML and CSS with real text in the DOM rather than from SVG, so
// the number beside every bar IS the accessible representation — there is no
// second description to drift from the picture. Only the line chart needs SVG,
// and it carries a visually-hidden table of its own values.
//
// Colour never carries meaning alone: every series is also named in text next
// to its own mark, which is what "direct labels, non-colour encoding" asks for
// and is why there are no legends here.

import type { ReactNode } from "react";

/** A number that cannot be rendered without what it is out of. §29.1's first
 *  rule, as a type: `share` can only be computed from both parts, so a
 *  percentage with no denominator is not representable. */
export interface Count {
  n: number;
  of: number;
}

export function share(c: Count): number {
  return c.of === 0 ? 0 : c.n / c.of;
}

/** "72% (3,470 / 4,820)" — the only rendering of a proportion in this codebase.
 *  §29.1: never show a percentage without numerator and denominator in the
 *  same view. */
export function pct(c: Count): string {
  if (c.of === 0) return `no denominator (0 / 0)`;
  return `${Math.round(share(c) * 100)}% (${c.n.toLocaleString()} / ${c.of.toLocaleString()})`;
}

export function num(n: number): string {
  return n.toLocaleString();
}

/**
 * Small-cell suppression (§30.6 step 6, §26's organization acceptance).
 *
 * Below the threshold a count is not rounded or blurred, it is withheld — and
 * the DENOMINATOR still shows, because "3 of 4,820" is disclosive while "under
 * 11, out of 4,820" is not, and hiding the denominator too would make the
 * suppression itself invisible. §29.1 requires suppressed data to remain
 * visible as suppressed.
 */
export const SMALL_CELL = 11;

export function suppressed(c: Count): boolean {
  return c.n > 0 && c.n < SMALL_CELL;
}

export function cell(c: Count): string {
  return suppressed(c) ? `under ${SMALL_CELL} (of ${num(c.of)})` : pct(c);
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

/**
 * Every chart sits in this. `summary` and `footnote` are required: the first
 * is what a screen reader is given before the marks, the second is §29.1's
 * range rule — the window, the anchor and when the numbers were computed.
 */
export function Figure({
  title, summary, footnote, children,
}: {
  title: string;
  /** One sentence stating what the chart shows and its denominator. */
  summary: string;
  /** Window, comparison anchor and refresh time. */
  footnote: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0">
      <figcaption>
        <span className="text-sm font-semibold text-app-ink">{title}</span>
        <span className="sr-only"> — {summary}</span>
      </figcaption>
      <div className="mt-4">{children}</div>
      <p className="mt-4 text-xs text-olive">{footnote}</p>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Horizontal funnel (p79) and bar list
// ---------------------------------------------------------------------------

export interface Stage {
  label: string;
  count: Count;
  /** Marks the stage where the largest drop occurred. Non-colour encoding:
   *  the row also says so in words. */
  attention?: boolean;
}

/**
 * The access funnel. Each stage carries its own denominator, so a reader never
 * has to hold the top number in their head to interpret the fourth bar — which
 * is the specific way funnels mislead.
 */
export function Funnel({ stages }: { stages: Stage[] }) {
  const top = Math.max(1, ...stages.map((s) => s.count.of));
  return (
    <ol className="space-y-3">
      {stages.map((s) => {
        const w = Math.max(1, Math.round((s.count.n / top) * 100));
        return (
          <li key={s.label} className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-4">
            <span className="text-sm text-ground">{s.label}</span>
            <span className="flex items-center gap-3">
              {/* The TRACK is the denominator, drawn. Without it a bar is a
                  length with nothing to be a fraction of, and the eye reads
                  the longest bar as full rather than as 74% — which is the
                  §29.1 denominator rule expressed in pixels rather than in
                  the label beside them. */}
              <span aria-hidden className="relative h-4 flex-1 rounded-full bg-moss/60">
                <span
                  className="absolute inset-y-0 left-0 min-w-1 rounded-full"
                  style={{
                    width: `${w}%`,
                    backgroundColor: s.attention ? "var(--color-state-caution)" : "var(--color-sage-deep)",
                  }}
                />
              </span>
              <span className="whitespace-nowrap text-sm text-ground">
                {cell(s.count)}
                {s.attention && (
                  <span className="ml-2 text-xs font-medium text-state-caution">largest drop</span>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface Bar {
  label: string;
  value: number;
  /** Shown after the value — a wait in days, a rate, whatever the row means. */
  detail?: string;
  attention?: boolean;
}

/** A plain comparison of one measure across categories (locations, teams). */
export function BarList({ bars, unit }: { bars: Bar[]; unit?: string }) {
  const top = Math.max(1, ...bars.map((b) => b.value));
  return (
    <ul className="space-y-3">
      {bars.map((b) => (
        <li key={b.label} className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-4">
          <span className="text-sm text-ground">{b.label}</span>
          <span className="flex items-center gap-3">
            <span aria-hidden className="relative h-4 flex-1 rounded-full bg-moss/60">
              <span
                className="absolute inset-y-0 left-0 min-w-1 rounded-full"
                style={{
                  width: `${Math.max(1, Math.round((b.value / top) * 100))}%`,
                  backgroundColor: b.attention ? "var(--color-state-caution)" : "var(--color-sage-deep)",
                }}
              />
            </span>
            <span className="whitespace-nowrap text-sm text-ground">
              {num(b.value)}{unit ? ` ${unit}` : ""}
              {b.detail && <span className="ml-2 text-olive">{b.detail}</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Grouped bars (p80)
// ---------------------------------------------------------------------------

export interface Group {
  label: string;
  /** Two named series. Named, not coloured: the name is beside its own value
   *  on every row, so the chart survives being printed in grey. */
  a: { name: string; value: number; observed: boolean };
  b: { name: string; value: number; observed: boolean } | null;
}

/**
 * Demand against supply, per location. §29.1 requires observed and modelled
 * values to use separate surfaces and labels, so `observed` is per-series and
 * a modelled series is drawn hatched AND labelled — never merely a different
 * colour.
 */
export function GroupedBars({ groups }: { groups: Group[] }) {
  const top = Math.max(1, ...groups.flatMap((g) => [g.a.value, g.b?.value ?? 0]));
  return (
    <ul className="space-y-4">
      {groups.map((g) => (
        <li key={g.label}>
          <p className="text-sm font-medium text-ground">{g.label}</p>
          <ul className="mt-1.5 space-y-1.5">
            {[g.a, g.b].filter(Boolean).map((s) => {
              const series = s as NonNullable<typeof g.b>;
              return (
                <li key={series.name} className="grid gap-1 sm:grid-cols-[7rem_1fr] sm:items-center sm:gap-3">
                  <span className="text-xs text-olive">{series.name}</span>
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="h-3.5 min-w-1 rounded-full"
                      style={{
                        width: `${Math.max(1, Math.round((series.value / top) * 100))}%`,
                        backgroundColor: series.observed
                          ? "var(--color-sage-deep)"
                          : "var(--color-mist-deep)",
                        backgroundImage: series.observed
                          ? undefined
                          : "repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 3px, transparent 3px 6px)",
                      }}
                    />
                    <span className="whitespace-nowrap text-sm text-ground">
                      {num(series.value)}
                      {!series.observed && (
                        <span className="ml-2 text-xs font-medium text-state-info">modelled</span>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Stacked allocation (p81)
// ---------------------------------------------------------------------------

export interface Slice {
  label: string;
  n: number;
  tone: "safe" | "info" | "caution" | "unknown";
}

/**
 * Outcome status across a cohort, with missing follow-up kept IN the total.
 *
 * That is the entire reason this is one bar rather than three: a missing row
 * dropped from the denominator turns "62% improved of those we measured" into
 * "62% improved", which is the release gate §31.6 calls "any clean chart hiding
 * incomplete data".
 */
export function StackedAllocation({ slices, total }: { slices: Slice[]; total: number }) {
  const TONE: Record<Slice["tone"], string> = {
    safe: "var(--color-state-safe)",
    info: "var(--color-state-info)",
    caution: "var(--color-state-caution)",
    unknown: "var(--color-state-unknown)",
  };
  // One row per status, every one on a track of the SAME length — the shared
  // denominator, drawn. This was a single stacked bar, which is a fine way to
  // show parts of a whole and a poor way to compare two small parts to each
  // other: "worsened" and "missing follow-up" ended up as two thin adjacent
  // slivers nobody could measure by eye. The page example uses rows, and rows
  // keep the shared denominator visible while making the four comparable.
  return (
    <ul className="space-y-3">
      {slices.map((s) => (
        <li key={s.label} className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-4">
          <span className="text-sm text-ground">{s.label}</span>
          <span className="flex items-center gap-3">
            <span aria-hidden className="relative h-4 flex-1 rounded-full bg-moss/60">
              <span
                className="absolute inset-y-0 left-0 min-w-1 rounded-full"
                style={{
                  width: `${Math.max(1, Math.round((s.n / Math.max(1, total)) * 100))}%`,
                  backgroundColor: TONE[s.tone],
                }}
              />
            </span>
            <span className="whitespace-nowrap text-sm text-ground">{cell({ n: s.n, of: total })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Interval — a modelled range, never an observed value (p83)
// ---------------------------------------------------------------------------

export interface Interval {
  label: string;
  low: number;
  point: number;
  high: number;
}

/**
 * Estimated ranges, one row per scenario.
 *
 * Everything about this component is shaped by one prohibition: "Never label
 * estimated value as observed savings." So it is drawn in a visibly different
 * register from every observed chart in this codebase — a hatched bar in the
 * modelled colour, never the solid sage of an observed series — and the RANGE
 * is the mark while the point estimate is a tick inside it, not the other way
 * round. A point drawn as the value with a range whispered underneath is how
 * "$8" leaves the room without "$5 to $13" attached.
 */
export function IntervalChart({
  intervals, unit, prefix = "",
}: {
  intervals: Interval[];
  unit: string;
  /** A currency symbol, where the value is money. */
  prefix?: string;
}) {
  const lo = Math.min(...intervals.map((i) => i.low), 0);
  const hi = Math.max(...intervals.map((i) => i.high), 1);
  const pos = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 100;

  return (
    <div>
      <ul className="space-y-4">
        {intervals.map((i) => (
          <li key={i.label} className="grid gap-1 sm:grid-cols-[7rem_1fr] sm:items-center sm:gap-4">
            <span className="text-sm text-ground">{i.label}</span>
            <span className="flex items-center gap-3">
              <span aria-hidden className="relative h-5 flex-1">
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ground/10" />
                <span
                  className="absolute top-1/2 h-4 -translate-y-1/2 rounded"
                  style={{
                    left: `${pos(i.low)}%`,
                    width: `${Math.max(1, pos(i.high) - pos(i.low))}%`,
                    backgroundColor: "var(--color-mist-deep)",
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 3px, transparent 3px 6px)",
                  }}
                />
                <span
                  className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pos(i.point)}%`, backgroundColor: "var(--color-ground)" }}
                />
              </span>
              <span className="w-36 shrink-0 whitespace-nowrap text-sm text-ground">
                {prefix}{i.low}–{prefix}{i.high}
                <span className="ml-2 text-olive">mid {prefix}{i.point}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <span className="font-medium text-state-info">modelled estimate, not observed</span>
        <span className="text-olive">{unit}</span>
      </p>

      <table className="sr-only">
        <caption>Modelled {unit} by scenario. Estimates, not observed values.</caption>
        <thead>
          <tr>
            <th scope="col">Scenario</th><th scope="col">Low</th>
            <th scope="col">Mid</th><th scope="col">High</th>
          </tr>
        </thead>
        <tbody>
          {intervals.map((i) => (
            <tr key={i.label}>
              <th scope="row">{i.label}</th>
              <td>{prefix}{i.low}</td><td>{prefix}{i.point}</td><td>{prefix}{i.high}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line (p76, p82)
// ---------------------------------------------------------------------------

export interface Series {
  name: string;
  points: { x: string; y: number | null }[];
  observed: boolean;
}

/**
 * One measure over time. ONE measure — §29.1 forbids overlaying different
 * clinical scales, so this takes a single unit and a caller wanting two scales
 * has to draw two charts, which is the intended friction.
 *
 * A null y is a gap and is drawn as one: the line breaks. Interpolating across
 * a missing month is the most common way a chart claims data it does not have.
 */
export function Line({ series, unit }: { series: Series[]; unit: string }) {
  const xs = series[0]?.points.map((p) => p.x) ?? [];
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((y): y is number => y !== null);
  const hi = Math.max(...ys, 0);
  const lo = Math.min(...ys, 0);
  // Pad the domain so a flat series sits in the middle of the plot rather than
  // pinned to its top edge, where it reads as "at the maximum" of a scale that
  // has no maximum. A steady three days is a finding; a line stuck to the
  // ceiling looks like a rendering bug or a ratio at 100%.
  const pad = Math.max(1, (hi - lo) * 0.25 || hi * 0.25 || 1);
  const max = hi + pad;
  const min = Math.max(0, lo - pad);
  const W = 640;
  const H = 200;
  const px = (i: number) => (xs.length < 2 ? W / 2 : (i / (xs.length - 1)) * (W - 60) + 40);
  const py = (y: number) => H - 34 - ((y - min) / Math.max(1, max - min)) * (H - 66);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-52 w-full min-w-[32rem]"
          role="img"
          aria-label={`${series.map((s) => s.name).join(" and ")}, ${unit}, by period`}
        >
          {series.map((s, si) => {
            // Break the path at every gap rather than bridging it.
            const runs: string[] = [];
            let cur: string[] = [];
            s.points.forEach((p, i) => {
              if (p.y === null) { if (cur.length) runs.push(cur.join(" ")); cur = []; return; }
              cur.push(`${cur.length ? "L" : "M"}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`);
            });
            if (cur.length) runs.push(cur.join(" "));
            const color = si === 0 ? "var(--color-sage-deep)" : "var(--color-state-caution)";
            return (
              <g key={s.name}>
                {runs.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray={s.observed ? undefined : "5 4"}
                  />
                ))}
                {s.points.map((p, i) =>
                  p.y === null ? null : (
                    <g key={i}>
                      <circle cx={px(i)} cy={py(p.y)} r={3} fill={color} />
                      {/* §29.1: direct labels. Without the value on the mark, a
                          flat line tells a reader that nothing changed and
                          nothing about what it did not change from. */}
                      <text
                        x={px(i)}
                        y={py(p.y) - 9}
                        textAnchor="middle"
                        className="fill-ground"
                        style={{ fontSize: 11 }}
                      >
                        {p.y}
                      </text>
                    </g>
                  ),
                )}
                {/* A gap is named, not merely absent: an unlabelled hole in a
                    line is indistinguishable from a shorter series. */}
                {s.points.map((p, i) =>
                  p.y !== null ? null : (
                    <text
                      key={`gap-${i}`}
                      x={px(i)}
                      y={H - 40}
                      textAnchor="middle"
                      className="fill-olive"
                      style={{ fontSize: 9 }}
                    >
                      no data
                    </text>
                  ),
                )}
              </g>
            );
          })}
          {/* The scale, stated. §29.1 requires the range to be visible; an
              unlabelled axis makes every value on the chart unreadable in
              absolute terms. */}
          <line x1={36} y1={H - 34} x2={W - 12} y2={H - 34} stroke="var(--color-ground)" strokeOpacity={0.12} />
          <text x={32} y={py(min) + 4} textAnchor="end" className="fill-olive" style={{ fontSize: 10 }}>
            {Math.round(min)}
          </text>
          <text x={32} y={py(max) + 4} textAnchor="end" className="fill-olive" style={{ fontSize: 10 }}>
            {Math.round(max)}
          </text>
          {xs.map((x, i) => (
            <text key={x} x={px(i)} y={H - 8} textAnchor="middle" className="fill-olive" style={{ fontSize: 10 }}>
              {x}
            </text>
          ))}
        </svg>
      </div>

      {/* The accessible representation. A sighted reader gets the shape; every
          reader gets the numbers, including the gaps, stated as gaps. */}
      <table className="sr-only">
        <caption>{series.map((s) => s.name).join(" and ")} by period, in {unit}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {xs.map((x, i) => (
            <tr key={x}>
              <th scope="row">{x}</th>
              {series.map((s) => (
                <td key={s.name}>{s.points[i]?.y === null || s.points[i]?.y === undefined ? "no data" : `${s.points[i].y} ${unit}`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        {series.map((s, si) => (
          <li key={s.name} className="flex items-center gap-2 text-xs text-ground">
            <span
              aria-hidden
              className="h-0.5 w-5"
              style={{ backgroundColor: si === 0 ? "var(--color-sage-deep)" : "var(--color-state-caution)" }}
            />
            {s.name}
            {!s.observed && <span className="font-medium text-state-info">modelled</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
