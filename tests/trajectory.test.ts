// Longitudinal trajectory (Phase 4 presentation layer).
//
// A chart is a claim about data. These assert the claims this one makes are
// the ones the data supports — the failure mode for a visualization is not a
// crash, it is a plausible picture of something that is not there.

import { strict as assert } from "node:assert";
import test from "node:test";
import { buildTrajectory, direction, type Series } from "../src/lib/clinical/trajectory";
import type { Timeline, TimelineEntry } from "../src/lib/clinical/timeline";

let seq = 0;
function entry(over: Partial<TimelineEntry> & { type: string; occurredAt: string }): TimelineEntry {
  return {
    eventId: `e${seq++}`,
    lane: "state",
    recordedAt: over.occurredAt,
    actorType: "member",
    actorId: null,
    headline: "something happened",
    detail: {},
    reconstructed: false,
    aiProduced: false,
    correlationId: null,
    ...over,
  } as TimelineEntry;
}

function timeline(entries: TimelineEntry[]): Timeline {
  return {
    personId: "member-1",
    entries,
    laneCounts: {} as Timeline["laneCounts"],
    withheld: { count: 0, reason: "" },
    reconstructedCount: entries.filter((e) => e.reconstructed).length,
    policyVersion: "test-policy",
    asOf: null,
  } as Timeline;
}

function checkin(day: string, activation: number, dissociation: number, sleep: number, reconstructed = false) {
  return entry({
    type: "daily_checkin.completed",
    occurredAt: `2026-08-${day} 09:15:00`,
    reconstructed,
    detail: { activation, dissociation, sleepQuality: sleep },
  });
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

test("measures on different scales never share a domain", () => {
  const t = buildTrajectory(timeline([
    checkin("01", 6, 4, 3),
    checkin("05", 4, 2, 6),
    entry({ type: "assessment.scored", occurredAt: "2026-08-01 10:00:00",
      detail: { instrument: "PCL-5", totalScore: 52 } }),
    entry({ type: "assessment.scored", occurredAt: "2026-08-05 10:00:00",
      detail: { instrument: "PCL-5", totalScore: 39 } }),
  ]));

  const checkinSeries = t.series.find((s) => s.id === "activation")!;
  const pcl = t.series.find((s) => s.id === "instrument:pcl-5")!;
  assert.deepEqual(checkinSeries.domain, [0, 10]);
  assert.deepEqual(pcl.domain, [0, 80]);

  // The point of separate lanes: a 0–10 measure and a 0–80 measure must never
  // be reconciled onto one axis, which would invent crossings that mean
  // nothing. Every series carries its own domain.
  const domains = new Set(t.series.map((s) => s.domain.join("-")));
  assert.ok(domains.size > 1, "every series collapsed onto a single shared domain");
});

test("an unknown instrument plots against its observed range, not an invented ceiling", () => {
  const t = buildTrajectory(timeline([
    entry({ type: "assessment.scored", occurredAt: "2026-08-01 10:00:00",
      detail: { instrument: "made-up-scale", totalScore: 9 } }),
    entry({ type: "assessment.scored", occurredAt: "2026-08-05 10:00:00",
      detail: { instrument: "made-up-scale", totalScore: 4 } }),
  ]));
  const s = t.series.find((x) => x.id === "instrument:made-up-scale")!;
  assert.equal(s.domain[1], 9, "an unknown scale was given a ceiling nobody knows");
  assert.match(s.unit, /observed/, "the unit does not disclose that the range is observed");
});

test("a single observation is not a trajectory", () => {
  const t = buildTrajectory(timeline([checkin("01", 6, 4, 3)]));
  assert.equal(t.series.length, 0, "one point was plotted as a line");
});

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

function series(values: number[], betterWhen: "lower" | "higher"): Series {
  return {
    id: "t", label: "T", unit: "0–10", domain: [0, 10], betterWhen,
    points: values.map((v, i) => ({
      t: i * 86_400_000, at: `2026-08-0${i + 1}`, v, reconstructed: false, eventId: `p${i}`,
    })),
  };
}

test("direction respects which way is better, not which way is up", () => {
  // Falling dissociation is improvement; falling sleep quality is not. A chart
  // that reads "down is good" everywhere would misreport half the measures.
  assert.equal(direction(series([8, 2], "lower"))!.reading, "improving");
  assert.equal(direction(series([2, 8], "lower"))!.reading, "worsening");
  assert.equal(direction(series([8, 2], "higher"))!.reading, "worsening");
  assert.equal(direction(series([2, 8], "higher"))!.reading, "improving");
});

test("movement below the noise threshold reads as little change", () => {
  // A single point on a 0–10 scale is not a direction, and calling it one
  // would manufacture a trend out of ordinary variation.
  assert.equal(direction(series([5, 4], "lower"))!.reading, "steady");
  assert.equal(direction(series([5, 3], "lower"))!.reading, "improving");
});

test("direction is first-to-last, never a fitted trend", () => {
  // A regression slope over a dozen points implies a statistical claim nobody
  // has earned. First and last are two observations the reader can see on the
  // chart and check for themselves.
  const s = series([9, 1, 9, 1, 9], "lower");
  const d = direction(s)!;
  assert.equal(d.delta, 0, "the reported delta is not last minus first");
  assert.equal(d.reading, "steady");
  assert.equal(d.first.v, 9);
  assert.equal(d.last.v, 9);
});

// ---------------------------------------------------------------------------
// Provenance and content
// ---------------------------------------------------------------------------

test("reconstructed history is carried onto the chart, never flattened", () => {
  const t = buildTrajectory(timeline([
    checkin("01", 6, 4, 3, true),
    checkin("05", 4, 2, 6, false),
  ]));
  const s = t.series.find((x) => x.id === "activation")!;
  assert.equal(s.points[0].reconstructed, true);
  assert.equal(s.points[1].reconstructed, false);
  assert.equal(t.hasReconstructed, true);
});

test("the chart reads only the stripped detail, so withheld content cannot reach it", () => {
  // memberTimeline() already removes protected fields. The trajectory takes its
  // values from `detail` and nothing else, so there is no second path by which
  // content could arrive on a chart after being withheld from the list.
  const t = buildTrajectory(timeline([
    checkin("01", 6, 4, 3),
    checkin("05", 4, 2, 6),
  ]));
  const serialised = JSON.stringify(t);
  for (const forbidden of ["transcript", "note_text", "answers", "message"]) {
    assert.ok(!serialised.includes(forbidden), `"${forbidden}" reached the trajectory`);
  }
});

// ---------------------------------------------------------------------------
// Rails
// ---------------------------------------------------------------------------

test("only safety-consequential events carry severity; care events are not judged", () => {
  const t = buildTrajectory(timeline([
    entry({ type: "session.completed", occurredAt: "2026-08-01 10:00:00" }),
    entry({ type: "session.hard_stopped", occurredAt: "2026-08-02 10:00:00" }),
    entry({ type: "consent.granted", occurredAt: "2026-08-03 10:00:00" }),
  ]));

  const care = t.rails.find((r) => r.id === "care")!;
  const safety = t.rails.find((r) => r.id === "safety")!;

  // Colouring a completed session "good" would assert a clinical judgement the
  // system has not made. Severity is reserved for safety.
  for (const e of care.events) {
    assert.equal(e.severe, false, `care event "${e.shape}" carries a severity colour`);
  }
  assert.ok(safety.events.every((e) => e.severe), "a safety event is not marked severe");
});

test("every rail event carries a shape and a label, so identity is never colour alone", () => {
  const t = buildTrajectory(timeline([
    entry({ type: "session.completed", occurredAt: "2026-08-01 10:00:00", headline: "Session completed" }),
    entry({ type: "crisis.routed", occurredAt: "2026-08-02 10:00:00", headline: "Routed to crisis resources" }),
    entry({ type: "module_unlock.decided", occurredAt: "2026-08-03 10:00:00", headline: "Module unlocked" }),
  ]));
  for (const rail of t.rails) {
    for (const e of rail.events) {
      assert.ok(e.shape, "a rail event has no shape");
      assert.ok(e.label.length > 0, "a rail event has no label");
    }
  }
});

test("events are ordered in time, and the axis spans the whole history", () => {
  const t = buildTrajectory(timeline([
    checkin("20", 4, 2, 6),
    checkin("01", 6, 4, 3),
    checkin("10", 5, 3, 5),
  ]));
  const s = t.series.find((x) => x.id === "activation")!;
  const ts = s.points.map((p) => p.t);
  assert.deepEqual([...ts].sort((a, b) => a - b), ts, "points are not in chronological order");
  assert.equal(t.from, ts[0]);
  assert.equal(t.to, ts[ts.length - 1]);
  assert.ok(t.days >= 19 && t.days <= 20, `span reported as ${t.days} days`);
});

test("an empty timeline produces an empty trajectory rather than throwing", () => {
  const t = buildTrajectory(timeline([]));
  assert.deepEqual(t.series, []);
  assert.deepEqual(t.rails, []);
  assert.equal(t.days, 0);
});
