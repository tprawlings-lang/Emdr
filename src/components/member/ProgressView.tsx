import type { MemberProgress, ProgressSeries } from "@/lib/member/progress";

// Member Progress (Web GUI handoff §10.2, §13).
//
// §10.2 fixes the opening order and the order is the safeguard:
//
//   1. Plain-language change statement.
//   2. Current period compared with prior period.
//   3. One primary trend.
//   4. Event markers that may explain movement.
//   5. Measure cards and session history.
//
// The sentence comes first so the number arrives as support for a description
// rather than as a bare value the member has to interpret into a grade. A chart
// at the top of this screen would be the same defect §3.6 found: "'Lower is
// calmer' explains direction, but not meaning."
//
// §13's chart contract applies to the sparkline: direct labels, the scale and
// its unit, the time range, missing-data behaviour, and an accessible table.
// The table is not a fallback — it is how this screen is read by anyone using a
// screen reader, and by anyone for whom a 40-pixel sparkline is not legible.

const DIRECTION_GLYPH: Record<MemberProgress["direction"], string> = {
  improving: "↓", harder: "↑", steadier: "→", mixed: "↕", unclear: "·",
};

/** A minimal series line.
 *
 *  Deliberately small and deliberately unlabelled with values: §10.2 wants one
 *  primary trend, not a dashboard, and the numbers live in the table below
 *  where they can carry their scale. No axis ticks, because an axis implies a
 *  precision this data does not have at this size. */
function Sparkline({ series }: { series: ProgressSeries }) {
  const pts = series.points;
  if (pts.length < 2) return null;
  const w = 560, h = 90, pad = 6;
  const span = Math.max(1, series.bounds.max - series.bounds.min);
  const step = (w - pad * 2) / (pts.length - 1);
  const y = (v: number) => h - pad - ((v - series.bounds.min) / span) * (h - pad * 2);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${pad + i * step} ${y(p.value)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-3 w-full"
      role="img"
      aria-label={`${series.label} across ${pts.length} measurements, on a ${series.bounds.min} to ${series.bounds.max} scale. The table below lists every value.`}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} className="text-state-info" />
      {pts.map((p, i) => (
        <circle key={i} cx={pad + i * step} cy={y(p.value)} r={3} className="fill-state-info" />
      ))}
    </svg>
  );
}

function SeriesCard({ series, days }: { series: ProgressSeries; days: number }) {
  return (
    <section className="rounded-3xl border border-ground/10 bg-linen p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-ground">{series.label}</h3>
        {/* §13: scale and unit, always. A value with no range is unreadable. */}
        <p className="text-xs text-olive">
          scale {series.bounds.min}–{series.bounds.max} · {series.lowerIsBetter ? "lower is calmer" : "higher is better"}
        </p>
      </div>

      <Sparkline series={series} />

      {/* §30.8 and §13: missing data is stated, not smoothed over. */}
      {series.missingDays > 0 && (
        <p className="mt-2 text-xs text-state-caution">
          Measured on {days - series.missingDays} of {days} days. Gaps are not zeros.
        </p>
      )}

      {/* §13's accessible table. Not a fallback — the primary reading path for
          anyone the sparkline does not serve. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-state-info underline">
          See the values
        </summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{series.label} measurements</caption>
          <thead>
            <tr className="text-left text-olive">
              <th scope="col" className="py-1 font-medium">Date</th>
              <th scope="col" className="py-1 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {series.points.map((p) => (
              <tr key={p.at} className="border-t border-ground/10">
                <td className="py-1">{p.at}</td>
                <td className="py-1">{p.value} of {series.bounds.max}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export function ProgressView({ progress }: { progress: MemberProgress }) {
  const p = progress;
  return (
    <div className="space-y-6">
      {/* 1. The plain-language statement, first and largest. */}
      <section className="rounded-3xl border border-ground/10 bg-linen p-6">
        <p className="type-identity text-xl leading-snug text-ground">
          {/* No glyph when there is no direction to point in — a lone dot in
              front of the sentence reads as a rendering artifact, and "we do
              not know yet" should not be decorated as though it were a result. */}
          {p.direction !== "unclear" && (
            <span aria-hidden className="mr-2 text-olive">{DIRECTION_GLYPH[p.direction]}</span>
          )}
          {p.statement}
        </p>
        {/* 2. The comparison window, named. §10.2: current period compared with
            prior period — a change with no window is an assertion. */}
        <p className="mt-2 text-sm text-olive">
          {p.window.from} to {p.window.to}, compared with {p.priorWindow.from} to {p.priorWindow.to}.
        </p>
      </section>

      {/* What the member did. Activity, not achievement: no streak, no target,
          no comparison against anyone else or against their own past self. */}
      <section className="grid grid-cols-3 gap-3">
        {[
          { label: "Check-ins", n: p.activity.checkins },
          { label: "Activities", n: p.activity.activities },
          { label: "Sessions", n: p.activity.sessions },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-olive">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-ground">{s.n}</p>
            <p className="text-xs text-olive">in the last {p.window.days} days</p>
          </div>
        ))}
      </section>

      {/* 3. The trends. */}
      {p.series.length > 0 ? (
        <div className="space-y-4">
          {p.series.map((s) => (
            <SeriesCard key={s.instrument} series={s} days={p.window.days} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-olive">
          No measurements in this window yet. Patterns need a few weeks before they mean anything.
        </p>
      )}
    </div>
  );
}
