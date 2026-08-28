// Longitudinal trajectory — turning a timeline into plottable series.
//
// This is the layer the product was missing. Everything else assembles the
// record correctly and then renders it as a list, which is the one shape that
// cannot answer the question a longitudinal platform exists to answer: is this
// person getting better, and when did it change?
//
// Two decisions are load-bearing, and both came out of the visualization pass
// rather than taste:
//
//   SEPARATE SCALES GET SEPARATE LANES. Check-in values run 0–10, PCL-5 runs
//   0–80, PHQ-9 runs 0–27. Plotting them against one y-axis would invent a
//   correlation that is not in the data — the axis alignment would be arbitrary
//   and the reader would see crossings that mean nothing. So each measure gets
//   its own lane and its own scale, sharing only the time axis.
//
//   HONESTY SURVIVES THE REDESIGN. Reconstructed history and observed history
//   look different on the chart, and the difference is carried by shape (a
//   hollow marker) and by a stated caption — never by colour alone, which a
//   restyle can quietly flatten. A chart that smooths over provenance is worse
//   than the list it replaced, because it is more persuasive.

import type { Timeline, TimelineEntry } from "./timeline";

/** One plotted observation. */
export interface Point {
  /** Milliseconds, for positioning. */
  t: number;
  /** ISO instant, for labels and the table view. */
  at: string;
  v: number;
  /** Genesis events were reconstructed after the fact, not observed. */
  reconstructed: boolean;
  eventId: string;
}

/** A continuous measure over time, with its own scale. */
export interface Series {
  id: string;
  /** Names the series — a single-series lane needs no legend box. */
  label: string;
  /** What the number means, for the axis and the table. */
  unit: string;
  domain: [number, number];
  points: Point[];
  /** Which direction is improvement, so the summary can say so in words
   *  rather than leaving the reader to infer it from a slope. */
  betterWhen: "lower" | "higher";
}

/** A discrete thing that happened, drawn on a rail rather than as a value. */
export interface RailEvent {
  t: number;
  at: string;
  eventId: string;
  /** Identity comes from the shape and the label, never from colour. */
  shape: "session" | "stop" | "alert" | "decision" | "consent";
  label: string;
  /** Only safety-consequential events carry the severity colour. Routine care
   *  events are ink: colouring them would imply a good/bad judgement the
   *  system has not made. */
  severe: boolean;
  reconstructed: boolean;
}

export interface Rail {
  id: string;
  label: string;
  events: RailEvent[];
}

export interface Trajectory {
  /** Shared time axis for every lane. */
  from: number;
  to: number;
  series: Series[];
  rails: Rail[];
  /** True when any plotted point was reconstructed rather than observed. */
  hasReconstructed: boolean;
  /** Days covered, for the caption. */
  days: number;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function ms(iso: string): number {
  // Stored timestamps are "YYYY-MM-DD HH:MM:SS" (SQLite) or ISO. Normalise
  // both, and treat a bare space form as UTC so the axis does not shift with
  // the reader's timezone.
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t : 0;
}

/** Instrument display metadata. An unlisted instrument still plots — it just
 *  uses its observed range, which is honest about not knowing the ceiling. */
const INSTRUMENT: Record<string, { label: string; max: number; betterWhen: "lower" | "higher" }> = {
  "pcl-5": { label: "PCL-5", max: 80, betterWhen: "lower" },
  "phq-9": { label: "PHQ-9", max: 27, betterWhen: "lower" },
  "gad-7": { label: "GAD-7", max: 21, betterWhen: "lower" },
  itq: { label: "ITQ", max: 48, betterWhen: "lower" },
  "pc-ptsd-5": { label: "PC-PTSD-5", max: 5, betterWhen: "lower" },
};

/** Check-in dimensions worth plotting, in the order a clinician reads them. */
const CHECKIN_SERIES: Array<{
  key: string; id: string; label: string; betterWhen: "lower" | "higher";
}> = [
  { key: "activation", id: "activation", label: "Activation", betterWhen: "lower" },
  { key: "dissociation", id: "dissociation", label: "Dissociation", betterWhen: "lower" },
  { key: "sleepQuality", id: "sleep", label: "Sleep quality", betterWhen: "higher" },
];

const RAIL_FOR: Record<string, { shape: RailEvent["shape"]; severe: boolean; rail: string }> = {
  "session.completed": { shape: "session", severe: false, rail: "care" },
  "session.hard_stopped": { shape: "stop", severe: true, rail: "safety" },
  "safety_rule.triggered": { shape: "alert", severe: true, rail: "safety" },
  "safety_state.changed": { shape: "alert", severe: true, rail: "safety" },
  "crisis.routed": { shape: "alert", severe: true, rail: "safety" },
  "module_unlock.decided": { shape: "decision", severe: false, rail: "care" },
  "clinician.reviewed": { shape: "decision", severe: false, rail: "care" },
  "consent.granted": { shape: "consent", severe: false, rail: "care" },
  "consent.withdrawn": { shape: "consent", severe: false, rail: "care" },
};

/** Build the plottable trajectory from an assembled timeline.
 *
 *  Reads only `detail`, which the timeline has already stripped of protected
 *  content — so nothing can reach the chart that was withheld from the list. */
export function buildTrajectory(timeline: Timeline): Trajectory {
  const checkins = new Map<string, Point[]>();
  for (const s of CHECKIN_SERIES) checkins.set(s.id, []);
  const instruments = new Map<string, Point[]>();
  const rails = new Map<string, RailEvent[]>([["care", []], ["safety", []]]);

  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  let hasReconstructed = false;

  const note = (t: number) => {
    if (t < from) from = t;
    if (t > to) to = t;
  };

  for (const e of timeline.entries) {
    const t = ms(e.occurredAt);
    if (!t) continue;

    if (e.type === "daily_checkin.completed") {
      for (const s of CHECKIN_SERIES) {
        const v = num(e.detail[s.key]);
        if (v === null) continue;
        checkins.get(s.id)!.push(point(e, t, v));
        note(t);
      }
      if (e.reconstructed) hasReconstructed = true;
      continue;
    }

    if (e.type === "assessment.scored") {
      const instrument = String(e.detail.instrument ?? "unknown").toLowerCase();
      const v = num(e.detail.totalScore ?? e.detail.score ?? e.detail.total);
      if (v === null) continue;
      if (!instruments.has(instrument)) instruments.set(instrument, []);
      instruments.get(instrument)!.push(point(e, t, v));
      note(t);
      if (e.reconstructed) hasReconstructed = true;
      continue;
    }

    const rail = RAIL_FOR[e.type];
    if (rail) {
      rails.get(rail.rail)!.push({
        t, at: e.occurredAt, eventId: e.eventId,
        shape: rail.shape, severe: rail.severe,
        label: e.headline, reconstructed: e.reconstructed,
      });
      note(t);
      if (e.reconstructed) hasReconstructed = true;
    }
  }

  const series: Series[] = [];
  for (const s of CHECKIN_SERIES) {
    const pts = sortPoints(checkins.get(s.id)!);
    if (pts.length < 2) continue; // one point is not a trajectory
    series.push({
      id: s.id, label: s.label, unit: "0–10", domain: [0, 10],
      points: pts, betterWhen: s.betterWhen,
    });
  }
  for (const [instrument, raw] of instruments) {
    const pts = sortPoints(raw);
    if (pts.length < 2) continue;
    const meta = INSTRUMENT[instrument];
    const observedMax = Math.max(...pts.map((p) => p.v));
    series.push({
      id: `instrument:${instrument}`,
      label: meta?.label ?? instrument.toUpperCase(),
      unit: meta ? `0–${meta.max}` : `observed 0–${observedMax}`,
      domain: [0, meta?.max ?? Math.max(1, observedMax)],
      points: pts,
      betterWhen: meta?.betterWhen ?? "lower",
    });
  }

  const railList: Rail[] = [
    { id: "care", label: "Care", events: sortEvents(rails.get("care")!) },
    { id: "safety", label: "Safety", events: sortEvents(rails.get("safety")!) },
  ].filter((r) => r.events.length > 0);

  const finite = Number.isFinite(from) && Number.isFinite(to);
  return {
    from: finite ? from : 0,
    to: finite ? to : 0,
    series, rails: railList, hasReconstructed,
    days: finite ? Math.max(1, Math.round((to - from) / 86_400_000)) : 0,
  };
}

function point(e: TimelineEntry, t: number, v: number): Point {
  return { t, at: e.occurredAt, v, reconstructed: e.reconstructed, eventId: e.eventId };
}

function sortPoints(p: Point[]): Point[] {
  return [...p].sort((a, b) => a.t - b.t);
}
function sortEvents(e: RailEvent[]): RailEvent[] {
  return [...e].sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Reading the trajectory in words
// ---------------------------------------------------------------------------

export interface Direction {
  /** Change from first to last observation, in the series' own units. */
  delta: number;
  /** What that change means clinically, given which way is better. */
  reading: "improving" | "worsening" | "steady";
  first: Point;
  last: Point;
}

/** First-to-last direction.
 *
 *  Deliberately NOT a trend line. A fitted slope over a dozen fabricated
 *  check-ins would imply a statistical claim nobody has earned, and this
 *  platform's whole posture is that a claim carries its evidence or is not
 *  made. First-to-last is a description of two observations the reader can
 *  see on the chart and check. */
export function direction(s: Series): Direction | null {
  if (s.points.length < 2) return null;
  const first = s.points[0];
  const last = s.points[s.points.length - 1];
  const delta = last.v - first.v;

  // A threshold, so noise does not read as movement. Deliberately EXCLUSIVE:
  // a one-point move on a 0–10 self-report scale is ordinary day-to-day
  // variation, and calling it "improving" would manufacture a clinical reading
  // out of nothing. The same 10% floor on PCL-5 means an 8-point move, which is
  // the right order of magnitude for that instrument.
  const span = s.domain[1] - s.domain[0];
  const meaningful = Math.max(1, span * 0.1);

  let reading: Direction["reading"] = "steady";
  if (Math.abs(delta) > meaningful) {
    const better = s.betterWhen === "lower" ? delta < 0 : delta > 0;
    reading = better ? "improving" : "worsening";
  }
  return { delta, reading, first, last };
}

export const READING_LABEL: Record<Direction["reading"], string> = {
  improving: "Improving",
  worsening: "Worsening",
  steady: "Little change",
};
