import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  THOUGHT_LIFECYCLE, THOUGHT_STATES, meaningOf, observableStates, stateOfMemoryStatus,
} from "../src/lib/clinical/thought-lifecycle";
import { ThoughtLifecycle } from "../src/components/clinical/ThoughtLifecycle";

// Thoughts (17 September handoff, P4).
//
//   "Separate capture, review, approved memory, and Ask. User knows what is
//   private, proposed, approved, or filed."
//
// The surfaces were already separate — a recorder, a transcript list, kept
// items, themes and Ask each in their own panel. What the page never said in
// one place is which of the four STATES a given piece of thinking is in, and
// who can read it. That answer was spread across five footnotes down a long
// page, each true about its own corner: "a thought is not a formal note",
// "this is the record, not the transcript", "nothing here is shown to the
// patient", "a draft built from it still needs you to review and sign it".

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Four states, and what each one answers
// ---------------------------------------------------------------------------

test("the four states the handoff names are the four that exist", () => {
  assert.deepEqual(THOUGHT_STATES, ["private", "proposed", "approved", "filed"]);
  assert.equal(THOUGHT_LIFECYCLE.length, 4);
});

test("every state says who can read it", () => {
  // The question a clinician is actually asking. A lifecycle that explains the
  // mechanism and not the audience answers the wrong one.
  for (const m of THOUGHT_LIFECYCLE) {
    assert.ok(m.readableBy.length > 20, `${m.state} does not say who can read it`);
    assert.ok(m.means.length > 20, `${m.state} does not say what it means`);
  }
});

test("private and approved both say the patient does not see them", () => {
  assert.match(meaningOf("private").readableBy, /Not the patient/);
  assert.match(meaningOf("approved").readableBy, /not the patient/i);
});

test("a proposal is not evidence until it is answered", () => {
  assert.match(meaningOf("proposed").means, /not evidence until you answer it/);
});

// ---------------------------------------------------------------------------
// The state this product cannot see
// ---------------------------------------------------------------------------

test("filed is listed, and marked as something Steady cannot report", () => {
  // THE LOAD-BEARING ONE. The note draft is assembled on the way to a screen,
  // stored nowhere, and copied out as text — so nothing reports back that it
  // landed, and an item filed last week looks exactly like one that never left
  // this page. Dropping the row would let a reader assume the three shown are
  // all there are; a badge would be a claim nobody checked.
  const filed = meaningOf("filed");
  assert.equal(filed.observable, false);
  assert.match(filed.where, /Nothing here can tell you whether an item was filed/);
  assert.deepEqual(observableStates(), ["private", "proposed", "approved"]);
});

test("the unobservable state is marked on the screen, not silently dropped", () => {
  const t = text(renderToStaticMarkup(<ThoughtLifecycle />));
  for (const m of THOUGHT_LIFECYCLE) {
    assert.ok(t.includes(m.label), `${m.state} is missing from the screen`);
  }
  assert.match(t, /Steady cannot tell you this/);
  assert.equal((t.match(/Steady cannot tell you this/g) ?? []).length, 1,
    "more than one state claims to be unobservable");
});

test("no state claims the patient can read it, because none of them can", () => {
  const t = text(renderToStaticMarkup(<ThoughtLifecycle />)).toLowerCase();
  assert.doesNotMatch(t, /shown to the patient|the patient sees/,
    "a state on this page says the patient sees it");
});

// ---------------------------------------------------------------------------
// The stored statuses, mapped
// ---------------------------------------------------------------------------

test("candidate is proposed and approved is approved", () => {
  assert.equal(stateOfMemoryStatus("candidate"), "proposed");
  assert.equal(stateOfMemoryStatus("approved"), "approved");
});

test("rejected and superseded are not states in the lifecycle", () => {
  // They are things that happened to an item, not places it sits. Folding them
  // in would turn four rows into six that nobody reads.
  assert.equal(stateOfMemoryStatus("rejected"), null);
  assert.equal(stateOfMemoryStatus("superseded"), null);
});

// ---------------------------------------------------------------------------
// On the page
// ---------------------------------------------------------------------------

test("the lifecycle sits above the items it describes", () => {
  const page = code(read("src/app/clinician/member/[id]/thoughts/page.tsx"));
  const at = (s: string) => page.indexOf(s);
  assert.ok(at("<ThoughtLifecycle") > 0, "the Thoughts page does not render the lifecycle");
  assert.ok(at("<ThoughtLifecycle") < at('title="Kept items"'),
    "the states are explained below the items that are in them");
});

test("the four surfaces stay separate panels", () => {
  // The other half of the handoff's line, and the half that was already true:
  // capture, review, approved memory and Ask are not one scroll of mixed
  // material.
  const page = read("src/app/clinician/member/[id]/thoughts/page.tsx");
  for (const title of ["Recorded thoughts", "Kept items", "Themes on this record"]) {
    assert.ok(page.includes(title), `${title} is no longer its own panel`);
  }
  // Ask is its own component with its own heading, rendered on this page.
  assert.match(page, /<AskSteady/, "Ask is no longer on the Thoughts page");
  assert.match(read("src/components/clinical/AskSteady.tsx"), /Ask about this person/);
});
