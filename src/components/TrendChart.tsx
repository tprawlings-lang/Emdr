export interface TrendPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface TrendSeries {
  label: string;
  color: string;
  points: TrendPoint[];
}

const W = 320;
const H = 96;
const PAD = 10;

function coords(points: TrendPoint[], min: number, max: number): [number, number][] {
  const span = Math.max(max - min, 1);
  const n = points.length;
  return points.map((p, i) => [
    n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1),
    H - PAD - ((p.value - min) * (H - PAD * 2)) / span,
  ]);
}

// Server-rendered SVG line chart — no client JS, no chart library. Severity is
// always also conveyed in the accompanying text, never by color alone.
export default function TrendChart({
  title,
  series,
  max,
  lowerIsBetter = true,
}: {
  title: string;
  series: TrendSeries[];
  max: number;
  lowerIsBetter?: boolean;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const first = series[0].points;
  const latest = series.map((s) => s.points[s.points.length - 1]?.value);
  const delta =
    first.length > 1 ? first[first.length - 1].value - first[0].value : null;

  return (
    <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-olive">
          latest {latest.filter((v) => v !== undefined).join(" / ")} of {max}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full"
        role="img"
        aria-label={`${title}: ${series
          .map((s) => `${s.label} ${s.points.map((p) => p.value).join(", ")}`)
          .join("; ")}`}
      >
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#ded1be" />
        <line x1={PAD} y1={PAD} x2={W - PAD} y2={PAD} stroke="#ece2d2" />
        {series.map((s) => {
          const pts = coords(s.points, 0, max);
          return (
            <g key={s.label}>
              {pts.length > 1 && (
                <polyline
                  points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                />
              )}
              {pts.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={3} fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-olive">
        <span>
          {first[0]?.date}
          {first.length > 1 ? ` → ${first[first.length - 1]?.date}` : ""}
        </span>
        <span className="flex gap-3">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
          ))}
        </span>
      </div>
      {delta !== null && (
        <p className="mt-1 text-xs font-medium text-olive">
          {delta === 0
            ? "No change since baseline."
            : delta < 0
              ? `Down ${-delta} since baseline${lowerIsBetter ? " — moving in the right direction." : "."}`
              : `Up ${delta} since baseline${lowerIsBetter ? " — your care team watches for sustained rises." : "."}`}
        </p>
      )}
    </div>
  );
}
