import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { exposureStanding, followUpGap } from "../src/lib/clinical/response-standing";
import { missingFollowupLimitation } from "../src/lib/clinical/response-fingerprint";
import type { InterventionInstance } from "../src/lib/clinical/interventions";
import type { ResponseObservation } from "../src/lib/clinical/response-vocabulary";

// Responses (17 September handoff, P4).
//
//   "Summarize patterns and allow exposure details to expand. Pattern,
//   evidence, and missing follow-up are distinct."
//
// All three were on the screen and none was distinct. The evidence was never
// collapsed — every exposure printed its context, its observations and its
// missing windows, all the time, and the list stopped at twelve with "and N
// earlier — the count above includes them", which is a sentence telling the
// reader that records exist and they cannot see them. And missing follow-up
// lived inside the pattern block, as one of the fingerprint's limitations, so a
// gap in OUR record-keeping read as part of what we had found about the person.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");

const inst = (o: Partial<InterventionInstance> = {}): InterventionInstance => ({
  id: "i1", personId: "p1", definitionId: "d1",
  sourceType: "therapy_session", sourceId: "s1",
  occurredAt: "2026-09-01T10:00:00Z", endedAt: "2026-09-01T10:45:00Z",
  dose: {}, context: {}, clinicianConfirmed: false,
  createdAt: "2026-09-01T10:45:00Z",
  ...o,
} as InterventionInstance);

const obs = (o: Partial<ResponseObservation> = {}): ResponseObservation => ({
  id: `o${Math.random()}`, personId: "p1", instanceId: "i1",
  outcomeType: "within_encounter", windowType: "immediate",
  valueNum: -2, valueText: null, unit: "suds", direction: "decrease",
  evidenceClass: "measured", sourceType: "therapy_session", sourceId: "s1",
  occurredAt: "2026-09-01T10:45:00Z", createdAt: "2026-09-01T10:45:00Z",
  ...o,
});

// ---------------------------------------------------------------------------
// One exposure's standing — the thing the scan line carries
// ---------------------------------------------------------------------------

test("a session with every expected window observed says so", () => {
  const s = exposureStanding(inst(), [
    obs({ windowType: "immediate" }),
    obs({ windowType: "post_session", outcomeType: "recovery_burden" }),
    obs({ windowType: "next_day", outcomeType: "recovery_burden" }),
  ]);
  assert.equal(s.state, "followed_up");
  assert.equal(s.outstanding, false);
  assert.match(s.said, /all 3 windows/);
});

test("a session nobody followed up names the windows, and is outstanding", () => {
  const s = exposureStanding(inst(), []);
  assert.equal(s.state, "not_followed_up");
  assert.equal(s.outstanding, true);
  assert.match(s.said, /Not followed up/);
  assert.match(s.said, /no check-in the next day/);
  // §6: an absence is reported. It is not "no change" and it is not recovery.
  assert.doesNotMatch(s.said.toLowerCase(), /no change|recovered|settled/);
});

test("a partly followed-up exposure counts the windows rather than naming them all", () => {
  const s = exposureStanding(inst(), [obs({ windowType: "immediate" })]);
  assert.equal(s.state, "partly_followed_up");
  assert.equal(s.outstanding, true);
  assert.match(s.said, /1 of 3 windows observed/);
});

test("mixed outranks incomplete, because mixed is the finding", () => {
  // THE LOAD-BEARING ONE. An exposure that settled someone in the room and left
  // them worse the next day is the thing a clinician needs to see. A scan line
  // reading "2 of 3 windows observed" would hide it behind bookkeeping.
  const s = exposureStanding(inst(), [
    obs({ windowType: "immediate", outcomeType: "within_encounter", direction: "decrease" }),
    obs({ windowType: "next_day", outcomeType: "recovery_burden", direction: "increase" }),
  ]);
  assert.equal(s.state, "mixed");
  assert.match(s.said, /Mixed/);
  assert.match(s.said, /did not agree/);
  // And it is still outstanding, because a window is still unobserved.
  assert.equal(s.outstanding, true);
});

test("a clinician entry expects nothing, and is never called incomplete", () => {
  // Steady auditing a clinician's judgement about what was worth recording is
  // exactly what EXPECTED_WINDOWS leaves out for this source.
  const s = exposureStanding(inst({ sourceType: "clinician_entry" }), []);
  assert.equal(s.state, "nothing_expected");
  assert.equal(s.outstanding, false);
  assert.doesNotMatch(s.said, /Not followed up/);
});

// ---------------------------------------------------------------------------
// The gap, as its own fact
// ---------------------------------------------------------------------------

test("the follow-up gap counts exposures and windows separately", () => {
  // One exposure missing three windows and three each missing one are different
  // facts, and a single number cannot tell them apart.
  const gap = followUpGap(
    [inst({ id: "a" }), inst({ id: "b" }), inst({ id: "c" })],
    [
      obs({ instanceId: "a", windowType: "immediate" }),
      obs({ instanceId: "a", windowType: "post_session", outcomeType: "recovery_burden" }),
      obs({ instanceId: "a", windowType: "next_day", outcomeType: "recovery_burden" }),
      obs({ instanceId: "b", windowType: "immediate" }),
    ]
  );
  assert.equal(gap.exposures, 3);
  assert.equal(gap.withMissing, 2);
  assert.equal(gap.windowsMissing, 5);
  assert.match(gap.said, /2 of 3 exposures have a window nobody recorded/);
  assert.match(gap.said, /5 windows in total/);
});

test("a complete record says it is complete rather than saying nothing", () => {
  const gap = followUpGap([inst({ sourceType: "clinician_entry" })], []);
  assert.equal(gap.outstanding, false);
  assert.match(gap.said, /Every exposure has an observation in each window it expected/);
});

test("the gap line does not repeat the page's caveat under every intervention", () => {
  // It is in the panel footnote once, above all of them. Six copies of "that is
  // unknown, not recovered" down one page is how a reader learns to skip the
  // row it is attached to. The fingerprint's stored limitations still carry the
  // sentence, so the record is unchanged.
  const gap = followUpGap([inst()], []);
  assert.doesNotMatch(gap.said, /unknown, not recovered/);
  const page = read("src/app/clinician/member/[id]/responses/page.tsx");
  const copies = [...page.matchAll(/it is not recovery|unknown, not recovered/g)].length;
  assert.equal(copies, 1, `the page states the caveat ${copies} times`);
});

test("the fingerprint still records the absence as unknown, not recovery", () => {
  // The one place the sentence must survive: §6's requirement is about the
  // stored summary, not about how a screen lays it out.
  assert.match(missingFollowupLimitation(4, 6), /unknown, not recovered/);
  assert.match(missingFollowupLimitation(4, 6), /4 of 6/);
});

// ---------------------------------------------------------------------------
// On the screen
// ---------------------------------------------------------------------------

test("no exposure is unreachable", () => {
  // It read "and N earlier — the count above includes them": a sentence saying
  // records exist and you cannot see them.
  const page = code(read("src/app/clinician/member/[id]/responses/page.tsx"));
  assert.doesNotMatch(page, /earlier — the count above includes them/,
    "the page still tells the reader about records it will not show them");
  assert.match(page, /list\.slice\(12\)/,
    "the exposures past the first twelve are not rendered anywhere");
});

test("the exposure detail is behind a disclosure, and the standing is not", () => {
  const row = code(read("src/components/clinical/ExposureRow.tsx"));
  assert.match(row, /<details/, "the exposure detail does not collapse");
  assert.match(row, /data-testid="exposure-standing"/);
  // The standing sits outside the <details>, which is the whole point: it is
  // what tells a reader whether opening the row is worth their time.
  assert.ok(row.indexOf('data-testid="exposure-standing"') < row.indexOf("<details"),
    "the standing is inside the disclosure, so you must open a row to know whether to open it");
});

test("the controls stay outside the disclosure", () => {
  // A name waiting on confirmation is work, and work that only appears after
  // you open something is work most people never find.
  const page = code(read("src/app/clinician/member/[id]/responses/page.tsx"));
  const row = code(read("src/components/clinical/ExposureRow.tsx"));
  assert.match(page, /controls=\{/, "the page does not pass the confirm and remap controls");
  assert.ok(row.indexOf("{controls}") < row.indexOf("<details"),
    "the controls are inside the disclosure");
});

test("missing follow-up has its own row, outside the pattern block", () => {
  const page = code(read("src/app/clinician/member/[id]/responses/page.tsx"));
  assert.match(page, /data-testid="follow-up-gap"/, "there is no follow-up row");
  assert.match(page, /followUpGap\(list, observations\)/);
  // And the duplicate is filtered from the limitations rather than matched on
  // its words, so the two cannot drift apart.
  assert.match(page, /missingFollowupLimitation\(f!\.missingFollowupCount, f!\.supportCount\)/,
    "the limitation that duplicates the follow-up row is not removed");
});

test("the follow-up row renders for an intervention below the pattern threshold", () => {
  // The case the old placement lost entirely: missingness lived inside the
  // pattern block, and the pattern block only renders above the display
  // threshold — so an intervention with one or two exposures showed no
  // missingness at all, and those are exactly the ones nobody has followed up.
  const page = code(read("src/app/clinician/member/[id]/responses/page.tsx"));
  const gapAt = page.indexOf('data-testid="follow-up-gap"');
  const insufficient = page.indexOf('f.patternState === "insufficient_data"');
  assert.ok(gapAt > 0);
  // The gap block reads `list` and `observations` directly and never consults
  // the fingerprint, so no threshold can suppress it.
  const block = page.slice(page.indexOf("const gap = followUpGap"), gapAt + 400);
  assert.doesNotMatch(block, /fingerprintByDefinition|patternState/,
    "the follow-up row depends on the fingerprint, so a threshold can hide it");
  assert.ok(insufficient > 0, "the fixture for this test no longer matches the page");
});
