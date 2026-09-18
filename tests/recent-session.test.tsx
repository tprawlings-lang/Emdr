import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  standingOf, describeSession, describeReadings, outstandingOn, STANDING_LABEL,
  READINGS_ARE_NOT_AN_OUTCOME,
} from "../src/lib/clinical/recent-session";
import { RecentSessionCard } from "../src/components/clinical/RecentSessionCard";

// The patient overview (17 September handoff, P4).
//
//   "Summarize changes, restrictions, work, goals, and recent session. Next
//   work is clear without opening many pages."
//
// Four of the five were there. GOALS were on a card that the page rendered only
// when there were goals, so a person with none got no goals section — which
// reads as "this product does not track goals" rather than "nobody has set
// one", and the card's empty state, which offers to add one, had never been
// reachable. THE RECENT SESSION was on no card at all: the engagement strip
// counts session DAYS ("0 carry a session"), which is a different fact and
// reads as one on a page where every other panel covers three weeks.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// How a session is named
// ---------------------------------------------------------------------------

test("a completed session says what it was and when", () => {
  const said = describeSession({
    moduleName: "Calm place", standing: "completed",
    startedAt: "2026-09-15T14:00:00Z", daysSince: 3,
  });
  assert.match(said, /Calm place/);
  assert.match(said, /3 days ago, 2026-09-15/);
  assert.match(said, /ran to the end/);
});

test("today and yesterday are said, not counted", () => {
  const base = { moduleName: "Calm place", standing: "completed" as const, startedAt: "2026-09-18T08:00:00Z" };
  assert.match(describeSession({ ...base, daysSince: 0 }), /today/);
  assert.match(describeSession({ ...base, daysSince: 1 }), /yesterday/);
});

test("a stopped session is never called incomplete", () => {
  // A session that ended when somebody decided to end it is the safety system
  // working. "Incomplete" reads as a failure of the person or the clinician,
  // and it is neither.
  const words = Object.values(STANDING_LABEL).join(" ").toLowerCase();
  for (const bad of ["incomplete", "failed", "abandoned", "unsuccessful", "did not finish"]) {
    assert.ok(!words.includes(bad), `a standing reads as "${bad}"`);
  }
  assert.equal(standingOf("hard_stop", "2026-09-15T14:30:00Z"), "stopped_early");
  assert.match(STANDING_LABEL.stopped_early, /stopped early/);
});

test("an open session is distinguished from one with no ending recorded", () => {
  // They look identical in a status column and mean different things: one is
  // happening now, the other is a row nobody closed.
  assert.equal(standingOf("in_progress", null), "in_progress");
  assert.equal(standingOf("abandoned", "2026-09-15T14:30:00Z"), "unfinished");
});

// ---------------------------------------------------------------------------
// The readings, and what their absence is
// ---------------------------------------------------------------------------

test("a session with no readings says so rather than reading as zero to zero", () => {
  const said = describeReadings({ preSuds: null, postSuds: null, peakSuds: null });
  assert.match(said, /No reading was recorded at either end/);
  assert.doesNotMatch(said, /\b0\b/);
});

test("a missing close reading is named as unknown, not as no change", () => {
  const said = describeReadings({ preSuds: 6, postSuds: null, peakSuds: null });
  assert.match(said, /Opened at 6/);
  assert.match(said, /change across it is unknown/);
  assert.doesNotMatch(said.toLowerCase(), /no change|unchanged|settled/);
});

test("both readings are given, and the line does not judge them", () => {
  const said = describeReadings({ preSuds: 7, postSuds: 3, peakSuds: 8 });
  assert.match(said, /7 at the start, 3 at the end, peaking at 8/);
  assert.doesNotMatch(said.toLowerCase(), /improv|better|worse|good/);
});

test("the caveat is a constant a surface prints once, not a clause on every row", () => {
  // It used to be the last clause of every readings line. On a card showing one
  // session that is right; on a list of twenty it printed twenty times, which
  // is how a sentence worth reading becomes one nobody sees.
  assert.doesNotMatch(
    describeReadings({ preSuds: 7, postSuds: 3, peakSuds: 8 }),
    /not an outcome/,
    "the caveat is back inside the per-row line",
  );
  assert.match(READINGS_ARE_NOT_AN_OUTCOME, /not an outcome/);
  const list = code(read("src/app/clinician/member/[id]/sessions/page.tsx"));
  assert.equal((list.match(/READINGS_ARE_NOT_AN_OUTCOME/g) ?? []).length, 2,
    "the sessions list prints the caveat other than once (import plus one use)");
  const card = code(read("src/components/clinical/RecentSessionCard.tsx"));
  assert.match(card, /READINGS_ARE_NOT_AN_OUTCOME/,
    "the overview card dropped the caveat when it left the line");
});

// ---------------------------------------------------------------------------
// What is still outstanding on it
// ---------------------------------------------------------------------------

test("a stop carries its reason, and says when there is none", () => {
  assert.match(
    outstandingOn({ standing: "stopped_early", hardStopReason: "distress above the ceiling", preSuds: 7, postSuds: null })!,
    /Stopped: distress above the ceiling/
  );
  assert.match(
    outstandingOn({ standing: "stopped_early", hardStopReason: null, preSuds: 7, postSuds: null })!,
    /no reason recorded/
  );
});

test("a clean session leaves nothing outstanding", () => {
  assert.equal(
    outstandingOn({ standing: "completed", hardStopReason: null, preSuds: 7, postSuds: 3 }),
    null
  );
});

test("a completed session with no close reading is still outstanding", () => {
  assert.match(
    outstandingOn({ standing: "completed", hardStopReason: null, preSuds: 7, postSuds: null })!,
    /No close reading/
  );
});

// ---------------------------------------------------------------------------
// On the overview
// ---------------------------------------------------------------------------

test("no session on file is a sentence, not a missing card", () => {
  const t = text(renderToStaticMarkup(<RecentSessionCard personId="p1" session={null} />));
  assert.match(t, /No session has been run with this person/);
  assert.match(t, /fact about the record/);
});

test("the overview renders the goals card and the session card unconditionally", () => {
  const page = code(read("src/app/clinician/member/[id]/page.tsx"));
  assert.doesNotMatch(page, /goalRows\.length > 0 && \(/,
    "the goals card is gated again, so a person with none gets no goals section");
  assert.match(page, /<ReturnToLifeCard personId=\{id\} goals=\{goalRows\} \/>/);
  assert.match(page, /<RecentSessionCard personId=\{id\} session=\{lastSession\} \/>/);
});

test("the goals card has an empty state to render", () => {
  const card = read("src/components/clinical/ReturnToLifeCard.tsx");
  assert.match(card, /No life goals set with this person yet/,
    "the card has nothing to say when there are no goals, so rendering it always would be a blank box");
});

test("the session age moves with the reading frame, read once for the page", () => {
  const page = code(read("src/app/clinician/member/[id]/page.tsx"));
  assert.match(page, /recentSession\(id, \{ asOf \}\)/);
  const reads = [...page.matchAll(/readingFrame\(\)/g)].length;
  assert.equal(reads, 1,
    `the page reads the frame ${reads} times; two panels on two clocks can straddle midnight`);
});

test("the overview reads in the order the handoff names", () => {
  // "Changes, restrictions, work, goals, and recent session." The two new cards
  // went in where the gated goals block had been, which put them above the
  // trajectory — so the first thing on a record became what somebody wants to
  // get back to, before what has changed and what is restricted.
  const page = code(read("src/app/clinician/member/[id]/page.tsx"));
  const at = (s: string) => page.indexOf(s);
  assert.ok(at("<RecoveryTrajectoryCard") < at("<ReturnToLifeCard"),
    "goals sit above the changes they are read against");
  assert.ok(at("<TherapeuticLoadCard") < at("<ReturnToLifeCard"),
    "goals sit above the restrictions");
  assert.ok(at("<ReturnToLifeCard") < at("<RecentSessionCard"),
    "the last session sits above the goals");
});

// ---------------------------------------------------------------------------
// Two panels, one answer
// ---------------------------------------------------------------------------

test("an age in days is a difference of days, in both places that print one", () => {
  // The overview carried two. Session Prep measured from the session's END and
  // this card from its START, both flooring elapsed milliseconds, so the same
  // session read "65 days ago" in the brief and "66 days ago" in the card, one
  // above the other. Counting calendar days makes both answer the same, and
  // stops a session at 23:00 last night reading as "today".
  for (const f of ["src/lib/clinical/session-prep.ts", "src/lib/clinical/recent-session.ts"]) {
    const src = read(f);
    assert.match(src, /T00:00:00Z/,
      `${f} counts elapsed hours rather than calendar days`);
  }
});

test("a missing reading never reaches a brief as the word null", () => {
  // "SUDS 3 → null (peak null)" was on the person overview, inside Session
  // Prep's last-session line: a database value wearing the clothes of a
  // clinical fact, and "→ null" reads as a reading that was taken and was
  // nothing.
  const src = read("src/lib/clinical/timeline.ts");
  assert.match(src, /function reading\(v: unknown\): string/);
  assert.doesNotMatch(src, /SUDS \$\{p\.preSuds\}/,
    "a raw reading is still interpolated into a headline");
  assert.doesNotMatch(src, /\(peak \$\{p\.peakSuds\}\)/);
});
