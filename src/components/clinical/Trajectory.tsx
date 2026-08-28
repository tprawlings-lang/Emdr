import type { Trajectory, Series, Rail, RailEvent, Point } from "@/lib/clinical/trajectory";
import { direction, READING_LABEL } from "@/lib/clinical/trajectory";

// The longitudinal trajectory — hand-built inline SVG, server-rendered.
//
// Form: lanes sharing one time axis, each lane a single series on its own
// scale. Check-ins run 0–10, PCL-5 runs 0–80; putting them on one y-axis would
// invent crossings that mean nothing, so they never share an axis.
//
// Colour was computed rather than chosen, and the computation changed the
// design twice:
//
//   The brand palette FAILS as a categorical palette — the greens sit below the
//   chroma floor and read as grey, and olive↔ground are indistinguishable even
//   to full-colour vision. That is fine here, because a single-series lane needs
//   no categorical palette at all. It is why the form came first.
//
//   Olive lines with red safety markers — the obvious choice — collapse to
//   ΔE 2.6 under protanopia: a protanope would not see the safety marks at all.
//   Lines are therefore ground ink (#2f3a33), which separates from support
//   (#9a4f42) at ΔE 13.2 simulated and 21.4 normal, both above the gates.
//
// Identity on the rails comes from SHAPE and LABEL. Colour carries severity
// only, two states, because most rail events are types rather than judgements —
// colouring a completed session "good" would assert something the system has
// not concluded.
//
// No JavaScript: hover is native <title>, and the table view below carries
// every value, which is also the mandated relief for marks under 3:1.

const INK = "#2f3a33";        // ground — lines, ordinary marks
const SEVERE = "#9a4f42";     // support — safety only
const GRID = "#a8b8a1";       // sage — hairline, recessive
const SURFACE = "#fbf8f2";    // linen — the ring/gap colour

const LANE_H = 56;
const RAIL_H = 34;
const GAP = 14;
const PAD_L = 92;
const PAD_R = 20;
const PAD_T = 10;
const PAD_B = 26;
const W = 760;

function fmtDate(iso: string): string {
  return (iso.split(/[ T]/)[0] ?? iso);
}

function fmtVal(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function MemberTrajectory({ trajectory }: { trajectory: Trajectory }) {
  const { series, rails, from, to } = trajectory;

  if (series.length === 0 && rails.length === 0) {
    return (
      <p className="mt-3 text-sm text-olive">
        Not enough history to plot a trajectory yet. Two or more observations of the same
        measure are needed before a line means anything.
      </p>
    );
  }

  const span = Math.max(1, to - from);
  const plotW = W - PAD_L - PAD_R;
  const x = (t: number) => PAD_L + ((t - from) / span) * plotW;

  // Lay the lanes out top to bottom, tracking each one's vertical offset.
  const blocks: Array<{ kind: "series"; s: Series; y: number; h: number }
    | { kind: "rail"; r: Rail; y: number; h: number }> = [];
  let y = PAD_T;
  for (const s of series) { blocks.push({ kind: "series", s, y, h: LANE_H }); y += LANE_H + GAP; }
  for (const r of rails) { blocks.push({ kind: "rail", r, y, h: RAIL_H }); y += RAIL_H + GAP; }
  const H = y - GAP + PAD_B;

  // Hollow markers distinguish reconstructed from observed. That encoding only
  // earns its place when BOTH are present — in a demo every point is
  // reconstructed, and thirty hollow rings would be pure noise carrying no
  // distinction. When it is uniform the caption states it once instead.
  const allPoints = [
    ...series.flatMap((s) => s.points.map((p) => p.reconstructed)),
    ...rails.flatMap((r) => r.events.map((e) => e.reconstructed)),
  ];
  const mixed = allPoints.some(Boolean) && allPoints.some((v) => !v);
  const allReconstructed = allPoints.length > 0 && allPoints.every(Boolean);

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => from + (span * i) / tickCount);

  return (
    <figure className="mt-4">
      <div className="overflow-x-auto rounded-2xl border border-ground/10 bg-linen/40 px-2 py-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ minWidth: 560 }}
          role="img"
          aria-label={
            `Trajectory over ${trajectory.days} days: ` +
            series.map((s) => s.label).join(", ") +
            (rails.length ? `, with ${rails.map((r) => r.label.toLowerCase()).join(" and ")} events` : "")
          }
        >
          {/* Time ticks — hairline, solid, recessive. Drawn first so every
              mark sits above the chrome. */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={x(t)} x2={x(t)} y1={PAD_T} y2={H - PAD_B}
                stroke={GRID} strokeWidth={1} opacity={0.45}
              />
              <text
                x={x(t)} y={H - PAD_B + 16}
                textAnchor={i === 0 ? "start" : i === tickCount ? "end" : "middle"}
                fontSize={11} fill={INK} opacity={0.7}
              >
                {fmtDate(new Date(t).toISOString())}
              </text>
            </g>
          ))}

          {blocks.map((b) =>
            b.kind === "series"
              ? <SeriesLane key={b.s.id} s={b.s} y={b.y} h={b.h} x={x} markProvenance={mixed} />
              : <EventRail key={b.r.id} r={b.r} y={b.y} h={b.h} x={x} markProvenance={mixed} />
          )}
        </svg>
      </div>

      <figcaption className="mt-2 text-xs text-olive">
        {trajectory.days} days · each measure keeps its own scale, so lanes are never
        compared against one another.{" "}
        {allReconstructed ? (
          <>
            <strong>All history shown is reconstructed</strong> — assembled from existing
            records rather than observed as it happened, so none of it is original evidence.
          </>
        ) : mixed ? (
          <>
            Hollow markers are <strong>reconstructed</strong> history — assembled from
            existing records rather than observed as it happened, and not original evidence.
          </>
        ) : null}
      </figcaption>

      <TrajectoryTable trajectory={trajectory} />
    </figure>
  );
}

function SeriesLane({
  s, y, h, x, markProvenance,
}: { s: Series; y: number; h: number; x: (t: number) => number; markProvenance: boolean }) {
  const [lo, hi] = s.domain;
  const range = Math.max(1e-6, hi - lo);
  const yv = (v: number) => y + h - ((v - lo) / range) * h;

  const path = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t)},${yv(p.v)}`).join(" ");
  const area =
    `M${x(s.points[0].t)},${y + h} ` +
    s.points.map((p) => `L${x(p.t)},${yv(p.v)}`).join(" ") +
    ` L${x(s.points[s.points.length - 1].t)},${y + h} Z`;

  const d = direction(s);
  const last = s.points[s.points.length - 1];
  // Label the endpoint and the extreme only. A value on every point is chaos
  // and goes unread.
  const extreme = s.points.reduce((a, p) =>
    (s.betterWhen === "lower" ? p.v > a.v : p.v < a.v) ? p : a, s.points[0]);

  return (
    <g>
      {/* Lane baseline and top rule, hairline. */}
      <line x1={PAD_L} x2={W - PAD_R} y1={y + h} y2={y + h} stroke={GRID} strokeWidth={1} opacity={0.7} />

      {/* Lane title and scale — a single series needs no legend box, the title
          names it. Text wears ink, never the mark colour. */}
      <text x={PAD_L - 10} y={y + 12} textAnchor="end" fontSize={12} fill={INK} fontWeight={500}>
        {s.label}
      </text>
      <text x={PAD_L - 10} y={y + 27} textAnchor="end" fontSize={10} fill={INK} opacity={0.6}>
        {s.unit}
      </text>
      {d && (
        <text x={PAD_L - 10} y={y + 42} textAnchor="end" fontSize={10} fill={INK} opacity={0.6}>
          {READING_LABEL[d.reading]}
        </text>
      )}

      {/* Area wash at ~10%, never a saturated block. */}
      <path d={area} fill={INK} opacity={0.08} />
      <path d={path} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {s.points.map((p) => (
        <Marker
          key={p.eventId}
          cx={x(p.t)} cy={yv(p.v)}
          reconstructed={markProvenance && p.reconstructed}
          color={INK}
          title={`${s.label} ${fmtVal(p.v)} (${s.unit}) · ${fmtDate(p.at)}${p.reconstructed ? " · reconstructed" : ""}`}
        />
      ))}

      {/* Endpoint value, and the extreme only when it says something the
          endpoint does not. Repeating the same number twice on one lane is
          noise, and labels work because they are sparing. */}
      <ValueLabel x={x(last.t)} y={yv(last.v)} v={last.v} anchor="end" />
      {extreme.eventId !== last.eventId && extreme.v !== last.v && (
        <ValueLabel x={x(extreme.t)} y={yv(extreme.v)} v={extreme.v} anchor="middle" />
      )}
    </g>
  );
}

/** A marker with a 2px surface ring, so it stays legible where it crosses the
 *  line. Hollow when the observation was reconstructed — shape, not colour,
 *  carries provenance, because a restyle can flatten a colour. */
function Marker({
  cx, cy, reconstructed, color, title,
}: { cx: number; cy: number; reconstructed: boolean; color: string; title: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={5.5} fill={SURFACE} />
      <circle
        cx={cx} cy={cy} r={4}
        fill={reconstructed ? SURFACE : color}
        stroke={color}
        strokeWidth={reconstructed ? 1.5 : 0}
      />
      <title>{title}</title>
    </g>
  );
}

function ValueLabel({
  x, y, v, anchor,
}: { x: number; y: number; v: number; anchor: "start" | "middle" | "end" }) {
  // An end label normally sits to the right of the final point. Near the right
  // edge that would overflow the viewBox and clip, so it flips inside instead.
  // Text is never clipped by its own chart — the value stays readable either
  // way, and the table view carries it regardless.
  const flip = anchor === "end" && x > W - PAD_R - 26;
  const tx = anchor === "end" ? (flip ? x - 8 : x + 8) : x;
  const ta = anchor === "end" ? (flip ? "end" : "start") : anchor;
  return (
    <text x={tx} y={y - 9} textAnchor={ta} fontSize={11} fill={INK} fontWeight={500}>
      {fmtVal(v)}
    </text>
  );
}

function EventRail({
  r, y, h, x, markProvenance,
}: { r: Rail; y: number; h: number; x: (t: number) => number; markProvenance: boolean }) {
  const cy = y + h / 2;
  return (
    <g>
      <line x1={PAD_L} x2={W - PAD_R} y1={cy} y2={cy} stroke={GRID} strokeWidth={1} opacity={0.7} />
      <text x={PAD_L - 10} y={cy + 4} textAnchor="end" fontSize={12} fill={INK} fontWeight={500}>
        {r.label}
      </text>
      {r.events.map((e) => (
        <EventMark
          key={e.eventId}
          e={markProvenance ? e : { ...e, reconstructed: false }}
          cx={x(e.t)} cy={cy}
        />
      ))}
    </g>
  );
}

/** Identity by shape; colour carries severity only. Every mark also has a
 *  <title>, and every event is listed in the table below, so nothing is
 *  encoded by colour alone. */
function EventMark({ e, cx, cy }: { e: RailEvent; cx: number; cy: number }) {
  const color = e.severe ? SEVERE : INK;
  const title = `${e.label} · ${fmtDate(e.at)}${e.reconstructed ? " · reconstructed" : ""}`;
  const fill = e.reconstructed ? SURFACE : color;
  const strokeW = e.reconstructed ? 1.5 : 0;

  return (
    <g>
      {/* Surface ring: part of the mark's hit target, not just spacing. */}
      <circle cx={cx} cy={cy} r={8} fill={SURFACE} />
      {e.shape === "session" && (
        <circle cx={cx} cy={cy} r={5} fill={fill} stroke={color} strokeWidth={strokeW} />
      )}
      {e.shape === "stop" && (
        <rect x={cx - 4.5} y={cy - 4.5} width={9} height={9} rx={1.5}
          fill={fill} stroke={color} strokeWidth={strokeW} />
      )}
      {e.shape === "alert" && (
        <path d={`M${cx},${cy - 6} L${cx + 5.5},${cy + 4.5} L${cx - 5.5},${cy + 4.5} Z`}
          fill={fill} stroke={color} strokeWidth={strokeW || 1} strokeLinejoin="round" />
      )}
      {e.shape === "decision" && (
        <path d={`M${cx},${cy - 5.5} L${cx + 5.5},${cy} L${cx},${cy + 5.5} L${cx - 5.5},${cy} Z`}
          fill={fill} stroke={color} strokeWidth={strokeW} />
      )}
      {/* A filled bar, not a hollow circle. Hollow has one meaning on this
          chart — reconstructed rather than observed — and a shape that is
          hollow for a different reason would make the provenance encoding
          ambiguous exactly where it matters. */}
      {e.shape === "consent" && (
        <rect x={cx - 2} y={cy - 6} width={4} height={12} rx={2}
          fill={fill} stroke={color} strokeWidth={strokeW} />
      )}
      <title>{title}</title>
    </g>
  );
}

/** The table view. Mandated twice over: as the accessibility path for an SVG,
 *  and as the relief that lets a mark sit below 3:1 contrast. It is also the
 *  honest answer to "what is the actual number" — nothing is gated behind a
 *  hover a keyboard user cannot reach. */
function TrajectoryTable({ trajectory }: { trajectory: Trajectory }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-olive">
        Show every plotted value as a table
      </summary>
      <div className="mt-2 space-y-4">
        {trajectory.series.map((s) => (
          <div key={s.id} className="overflow-x-auto">
            <table className="w-full min-w-[22rem] border-collapse text-xs">
              <caption className="text-left text-xs font-medium text-ground">
                {s.label} ({s.unit}) — lower is better{s.betterWhen === "higher" ? " does not apply; higher is better" : ""}
              </caption>
              <thead>
                <tr className="border-b border-ground/15 text-left text-olive">
                  <th scope="col" className="py-1 pr-4 font-medium">Date</th>
                  <th scope="col" className="py-1 pr-4 font-medium">Value</th>
                  <th scope="col" className="py-1 font-medium">Provenance</th>
                </tr>
              </thead>
              <tbody className="text-ground/80">
                {s.points.map((p: Point) => (
                  <tr key={p.eventId} className="border-b border-ground/5">
                    <td className="py-1 pr-4">{fmtDate(p.at)}</td>
                    <td className="py-1 pr-4">{fmtVal(p.v)}</td>
                    <td className="py-1">{p.reconstructed ? "reconstructed" : "observed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {trajectory.rails.map((r) => (
          <div key={r.id} className="overflow-x-auto">
            <table className="w-full min-w-[22rem] border-collapse text-xs">
              <caption className="text-left text-xs font-medium text-ground">{r.label} events</caption>
              <thead>
                <tr className="border-b border-ground/15 text-left text-olive">
                  <th scope="col" className="py-1 pr-4 font-medium">Date</th>
                  <th scope="col" className="py-1 font-medium">Event</th>
                </tr>
              </thead>
              <tbody className="text-ground/80">
                {r.events.map((e) => (
                  <tr key={e.eventId} className="border-b border-ground/5">
                    <td className="py-1 pr-4">{fmtDate(e.at)}</td>
                    <td className="py-1">
                      {e.label}
                      {e.reconstructed && <span className="ml-1 text-olive">(reconstructed)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </details>
  );
}

/** The shape key. Identity is never colour-alone, so the key is drawn with the
 *  same marks the chart uses rather than colour swatches. */
export function TrajectoryKey() {
  const items: Array<[RailEvent["shape"], string, boolean]> = [
    ["session", "Session completed", false],
    ["stop", "Session hard-stopped", true],
    ["alert", "Safety event", true],
    ["decision", "Clinical decision", false],
    ["consent", "Consent change", false],
  ];
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-olive">
      {items.map(([shape, label, severe]) => (
        <li key={shape} className="flex items-center gap-1.5">
          <svg width={16} height={16} aria-hidden>
            <EventMark
              e={{ shape, severe, label, t: 0, at: "", eventId: "key", reconstructed: false }}
              cx={8} cy={8}
            />
          </svg>
          {label}
        </li>
      ))}
    </ul>
  );
}
