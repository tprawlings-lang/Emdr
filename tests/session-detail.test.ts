import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  sessionEvents, sequenceGaps, SOURCE_LABEL,
  type SessionRow, type PostSessionCheck,
} from "../src/lib/clinical/session-detail";

// Session detail (17 September handoff, P4).
//
//   "Order events and connect notes to their sources. Timeline and provenance
//   are understandable."
//
// THE TIMES WERE PARTLY INVENTED. The sequence came off the session row alone,
// and the lines with no recorded time of their own borrowed the session's start
// — so "Highest during the session" was rendered in a monospace clock column at
// the minute the session opened. A reader counting down that column was reading
// a time nobody recorded.
//
// THE CHECK AFTERWARDS WAS NOT ON THE PAGE. It is a separate row with a real
// timestamp, and on a screen called Session response it is arguably the
// response.
//
// AND NOTHING SAID WHERE A LINE CAME FROM. "Distress after: 3 of 10" and "safe
// tonight: yes" are facts about the same session written at different moments
// by different people, and which is which is not recoverable from the
// sentences.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "s1", moduleId: "calm-place", moduleName: "Calm place", status: "completed",
  preSuds: 6, postSuds: 3, peakSuds: 8, hardStopReason: null,
  startedAt: "2026-09-15T15:00:00Z", endedAt: "2026-09-15T15:50:00Z",
  ...over,
});

const check = (over: Partial<PostSessionCheck> = {}): PostSessionCheck => ({
  id: "c1", distress: 4, oriented: true, safeTonight: true, delayedRisk: 2,
  recoveryConfirmed: true, escalated: false, createdAt: "2026-09-15T20:00:00Z",
  ...over,
});

// ---------------------------------------------------------------------------
// A time nobody recorded is not a time
// ---------------------------------------------------------------------------

test("the peak reading carries no time, because none was recorded", () => {
  const peak = sessionEvents(session(), []).find((e) => /Highest during/.test(e.text))!;
  assert.equal(peak.at, null,
    "the peak was stamped with a time, which puts it at a minute nobody recorded it at");
});

test("the readings that do have a time keep it", () => {
  const events = sessionEvents(session(), []);
  const before = events.find((e) => /Distress before/.test(e.text))!;
  const after = events.find((e) => /Distress after/.test(e.text))!;
  assert.equal(before.at, "2026-09-15T15:00:00Z");
  assert.equal(after.at, "2026-09-15T15:50:00Z");
});

test("a session with no ending leaves its closing lines undated", () => {
  const events = sessionEvents(session({ endedAt: null, postSuds: 5 }), []);
  const after = events.find((e) => /Distress after/.test(e.text))!;
  assert.equal(after.at, null, "a closing reading was dated from a session that never closed");
  assert.ok(!events.some((e) => e.text === "Session ended"));
});

// ---------------------------------------------------------------------------
// Order, and what comes from where
// ---------------------------------------------------------------------------

test("the sequence reads start, session, end, then the check afterwards", () => {
  const events = sessionEvents(session(), [check()]);
  const texts = events.map((e) => e.text);
  assert.ok(texts[0].startsWith("Session started"));
  assert.ok(texts[texts.length - 1].startsWith("Checked afterwards"),
    "the check written hours later is not last");
  assert.ok(
    texts.findIndex((t) => /Session ended/.test(t)) <
    texts.findIndex((t) => /Checked afterwards/.test(t))
  );
});

test("two checks read in the order they were written", () => {
  const events = sessionEvents(session(), [
    check({ id: "c2", createdAt: "2026-09-16T09:00:00Z", distress: 2 }),
    check({ id: "c1", createdAt: "2026-09-15T20:00:00Z", distress: 4 }),
  ]);
  const checks = events.filter((e) => /Checked afterwards/.test(e.text));
  assert.equal(checks.length, 2);
  assert.match(checks[0].text, /distress 4/);
  assert.match(checks[1].text, /distress 2/);
});

test("every line names where it came from", () => {
  for (const e of sessionEvents(session({ hardStopReason: "distress above the ceiling" }), [check()])) {
    assert.ok(SOURCE_LABEL[e.source], `"${e.text}" has no source`);
  }
});

test("a hard stop is attributed to the rule, not to the session record", () => {
  // The distinction the page has always made in words — "no model made or
  // cleared this" — made structural, so a reader can see it is a different
  // kind of fact from a reading somebody typed.
  const stop = sessionEvents(session({ hardStopReason: "distress above the ceiling" }), [])
    .find((e) => /Fixed rule/.test(e.text))!;
  assert.equal(stop.source, "safety_rule");
  assert.match(SOURCE_LABEL.safety_rule, /fixed safety rule/);
});

test("the check afterwards is attributed to itself", () => {
  const after = sessionEvents(session(), [check()]).find((e) => /Checked afterwards/.test(e.text))!;
  assert.equal(after.source, "post_session_check");
  assert.match(after.text, /safe tonight yes/);
  assert.match(after.text, /risk in the hours after 2 of 10/);
});

test("an escalation is said, not left to the reader", () => {
  const after = sessionEvents(session(), [check({ escalated: true })])
    .find((e) => /Checked afterwards/.test(e.text))!;
  assert.match(after.text, /escalated/);
});

// ---------------------------------------------------------------------------
// What the sequence does not establish
// ---------------------------------------------------------------------------

test("a missing close reading is named as missing, not as no change", () => {
  const gaps = sequenceGaps(session({ postSuds: null }), [check()]);
  assert.ok(gaps.some((g) => /missing measurement, not a zero change/.test(g)));
});

test("no check afterwards is its own gap", () => {
  const gaps = sequenceGaps(session(), []);
  assert.ok(gaps.some((g) => /how the hours afterwards went is unknown/.test(g)),
    "a session nobody checked after reads the same as one that went fine");
});

test("a clean, fully recorded session states no gaps it does not have", () => {
  const gaps = sequenceGaps(session({ peakSuds: null }), [check()]);
  assert.deepEqual(gaps, []);
});

// ---------------------------------------------------------------------------
// On the screen
// ---------------------------------------------------------------------------

test("the page renders times, sources and the checks it now loads", () => {
  const page = code(read("src/app/clinician/member/[id]/session/[sid]/page.tsx"));
  assert.match(page, /sessionEvents\(row, checks\)/);
  assert.match(page, /post_session_checks/, "the check afterwards is still not loaded");
  assert.match(page, /data-testid="event-source"/);
  assert.match(page, /e\.at \? e\.at\.slice\(11, 16\) : "—"/,
    "an event with no recorded time is still given one");
});

test("the notes already attached to this session are listed on it", () => {
  // The page offered a recorder and then linked to "all notes for <person>" —
  // the hunt through the record this screen is meant to end. A clinician could
  // attach a note here and had no way to see the ones already attached.
  const page = code(read("src/app/clinician/member/[id]/session/[sid]/page.tsx"));
  assert.match(page, /t\.sourceSessionId === s\.id/,
    "the page does not filter notes to this session");
  assert.match(page, /data-testid="attached-notes"/);
  assert.match(page, /Nothing has been recorded against this session yet/,
    "a session with no notes shows nothing at all, which reads as a missing feature");
});

test("a thought's words are not reprinted on this screen", () => {
  // The transcript is stored encrypted and read through the workspace that can
  // show its versions and its corrections. A flat copy here would be clinical
  // text with none of that around it.
  const page = code(read("src/app/clinician/member/[id]/session/[sid]/page.tsx"));
  assert.doesNotMatch(page, /currentTranscript|transcript\.text/,
    "the session screen reprints a thought's transcript");
});
