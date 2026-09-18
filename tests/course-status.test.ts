import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  measuresStatus, goalsStatus, responsesStatus, trajectoryStatus,
} from "../src/lib/clinical/course-status";

// The Course landing (17 September handoff, P4).
//
//   "Course — show actual status beside measures, goals, responses, and
//   trajectory. The landing page informs and links."
//
// It linked. Beside each link sat a sentence about the SCREEN — "the scored
// instruments over time" — which is the same sentence for every person on the
// caseload, so a clinician arriving at one person's record could not tell which
// of the four was worth opening without opening all four.
//
// What these tests hold is the line between informing and summarising: every
// sentence is about the RECORD (how much, how recent, what is outstanding) and
// none of them is about the findings. A landing that reported directions would
// be the composite score the four separate screens exist to refuse, assembled
// one line at a time.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");

const AS_OF = "2026-09-18T09:00:00.000Z";

// ---------------------------------------------------------------------------
// Each line says something that differs between two people
// ---------------------------------------------------------------------------

test("measures reports how many instruments and how long since the last one", () => {
  const s = measuresStatus({ instruments: 3, latest: "2026-07-02T10:00:00Z" }, AS_OF);
  assert.equal(s.recorded, true);
  assert.match(s.said, /3 instruments on file/);
  assert.match(s.said, /nothing scored in the 78 days since 2026-07-02/);
});

test("a reading taken today says so, rather than counting zero days", () => {
  const s = measuresStatus({ instruments: 1, latest: "2026-09-18T08:00:00Z" }, AS_OF);
  assert.match(s.said, /1 instrument on file/, "the count is pluralised at one");
  assert.match(s.said, /last scored today/);
  assert.doesNotMatch(s.said, /0 days/);
});

test("one day is not 1 days", () => {
  const s = measuresStatus({ instruments: 2, latest: "2026-09-17T08:00:00Z" }, AS_OF);
  assert.match(s.said, /since 2026-09-17/);
  assert.match(s.said, /1 day /);
  assert.doesNotMatch(s.said, /1 days/);
});

test("goals count what is set and what is waiting on a decision", () => {
  const s = goalsStatus({ total: 2, awaitingDecision: 1 });
  assert.equal(s.recorded, true);
  assert.match(s.said, /2 goals set/);
  assert.match(s.said, /1 observation waiting on a decision/);
});

test("goals with nothing outstanding say so rather than leaving it off", () => {
  // An omitted clause and a resolved one look identical, and only one of them
  // is a statement about the record.
  const s = goalsStatus({ total: 4, awaitingDecision: 0 });
  assert.match(s.said, /nothing waiting on a decision/);
});

test("responses name the windows nobody filled in", () => {
  const s = responsesStatus({ exposures: 11, windowsMissing: 4 });
  assert.equal(s.recorded, true);
  assert.match(s.said, /11 exposures recorded/);
  assert.match(s.said, /4 windows with nothing observed/);
});

test("a complete response record says every window was observed", () => {
  const s = responsesStatus({ exposures: 6, windowsMissing: 0 });
  assert.match(s.said, /every expected window observed/);
});

test("trajectory separates the domains that could be read from the ones held", () => {
  const s = trajectoryStatus({ read: 3, held: 2 });
  assert.equal(s.recorded, true);
  assert.match(s.said, /3 domains read/);
  assert.match(s.said, /2 held for want of readings/);
});

// ---------------------------------------------------------------------------
// Absence is a sentence, never a zero
// ---------------------------------------------------------------------------

test("nothing recorded reads as nothing recorded, not as a zero", () => {
  const none = [
    measuresStatus({ instruments: 0, latest: null }, AS_OF),
    goalsStatus({ total: 0, awaitingDecision: 0 }),
    responsesStatus({ exposures: 0, windowsMissing: 0 }),
    trajectoryStatus({ read: 0, held: 0 }),
  ];
  for (const s of none) {
    assert.equal(s.recorded, false, `"${s.said}" claims a record it does not have`);
    assert.doesNotMatch(s.said, /\b0\b/, `"${s.said}" reports a zero where it means absence`);
    assert.match(s.said, /^(No|Nothing)\b/, `"${s.said}" does not open by saying there is nothing`);
  }
});

test("an instrument count with no date is treated as no reading at all", () => {
  // Defensive: a row group with a null max date would otherwise print
  // "3 instruments on file, last scored null".
  const s = measuresStatus({ instruments: 3, latest: null }, AS_OF);
  assert.equal(s.recorded, false);
  assert.doesNotMatch(s.said, /null/);
});

test("domains that exist but cannot be compared are not counted as read", () => {
  // The distinction the trajectory policy spends its length on: "not enough to
  // compare" is a statement about the record, and rolling it into a count of
  // what was read would turn missing evidence into a finding.
  const s = trajectoryStatus({ read: 0, held: 4 });
  assert.equal(s.recorded, false);
  assert.match(s.said, /none with enough comparable readings/);
});

// ---------------------------------------------------------------------------
// The line these sentences must not cross
// ---------------------------------------------------------------------------

test("no sentence reports a direction, a state or a verdict", () => {
  const all = [
    measuresStatus({ instruments: 3, latest: "2026-07-02T00:00:00Z" }, AS_OF).said,
    goalsStatus({ total: 2, awaitingDecision: 1 }).said,
    responsesStatus({ exposures: 11, windowsMissing: 4 }).said,
    trajectoryStatus({ read: 3, held: 2 }).said,
  ].join(" | ");
  for (const word of [
    "improving", "improved", "worse", "worsening", "better", "declin",
    "stable", "progress", "on track", "off track", "good", "poor", "risk",
  ]) {
    assert.doesNotMatch(all.toLowerCase(), new RegExp(word),
      `the landing reports "${word}", which is a finding and belongs on the screen that can show its evidence`);
  }
});

// ---------------------------------------------------------------------------
// And the page actually renders them
// ---------------------------------------------------------------------------

test("the landing draws its lines from the record, not from a constant", () => {
  const page = code(read("src/app/clinician/member/[id]/course/page.tsx"));
  assert.match(page, /courseReadings\(ctx, id, \{ asOf \}\)/,
    "the page does not load this person's status");
  assert.doesNotMatch(page, /const SECTIONS/,
    "the page still carries a hard-coded section list, so the status can go stale against it");
  assert.match(page, /\{s\.said\}/, "the status sentence is never rendered");
  assert.match(page, /data-testid="course-status"/);
});

test("the days-since on the landing moves with the reading frame", () => {
  // Every other age on a clinician screen does. A landing that read the wall
  // clock would disagree with the screens it links to under a demo clock.
  const page = code(read("src/app/clinician/member/[id]/course/page.tsx"));
  assert.match(page, /readingFrame\(\)/);
  assert.doesNotMatch(page, /new Date\(\)/,
    "the landing reads the wall clock, so its ages disagree with the screens it links to");
});
