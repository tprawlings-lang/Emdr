import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueRow } from "../src/components/experience/QueueRow";
import { QueueEvidencePanel } from "../src/components/experience/QueueEvidencePanel";
import { focusBehaviour } from "../src/lib/experience/evidence-panel";
import type { QueueRowView } from "../src/lib/experience/clinician-home";

// UX 011: "The evidence drawer compresses queue rows and repeats actions.
// Define responsive drawer or detail-view behavior. Acceptance: identity,
// action, and keyboard focus remain clear."
//
// All three halves were measured on the running app before any of this was
// written, because none of them are visible in the source:
//
//   At 1024px, opening the panel took a queue row from 678px wide to 262px.
//   At 390px the panel opened at y=3204 on an 844px screen — 2,360px below the
//   fold — so tapping "why this is here" changed nothing the reader could see.
//   Focus landed on <body> at every width, at every stage of the fix.
//
// The last one is the interesting failure. The panel ASSERTS that it names the
// control it returns focus to, and the assertion passed throughout: it checked
// that a non-empty string had been supplied, while no element in the document
// carried that id. A contract checked against a string rather than against a
// control is a contract nobody is keeping.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const ROW: QueueRowView = {
  // A REAL ID SHAPE, colons and all. The first working version of the focus
  // fix looked the opener up with `querySelector("#" + hash)`, which throws on
  // this id because it is not a valid selector — and the catch swallowed it.
  id: "alert:90E2E12904C3BD4B817AC334EA778161::checkin_safety_positive",
  personId: "person-1",
  personName: "Ada Fenwick",
  disambiguator: null,
  reason: "A safety alert is open and unanswered.",
  ownerName: "Dr Vale",
  dueAt: null,
  overdue: false,
  action: "complete_review",
  blockedReason: null,
  safetyAuthority: true,
  band: "high",
  secondary: [{ label: "Evidence", value: "Check-in recorded 2 days ago" }],
  signalId: null,
  group: "needs_attention",
  version: "alerts@a1:open",
};

const rowHtml = () =>
  renderToStaticMarkup(
    <QueueRow row={ROW} now="2026-09-18 10:00:00" panelHref={`/clinician/today?row=${ROW.id}`} />
  );

const panelHtml = (closeHref: string) =>
  renderToStaticMarkup(
    <QueueEvidencePanel row={ROW} mode="nonmodal" closeHref={closeHref} />
  );

// ---------------------------------------------------------------------------
// The control the panel returns focus to has to exist
// ---------------------------------------------------------------------------

test("the opener the panel names is a control that is actually in the row", () => {
  // THE DEFECT. `assertPanel` is handed `row-${row.id}` and checks it is not
  // blank. Nothing checked that the document contained it, and nothing did.
  const html = rowHtml();
  assert.ok(html.includes(`id="row-${ROW.id}"`),
    "no element in the row carries the id the panel returns focus to, so " +
    '"return focus to the exact originating control" resolves to nothing');

  // And it is the control that OPENS the panel, not some nearby element: the
  // reader should land back on the thing they pressed.
  const opener = new RegExp(`<a[^>]*id="row-${ROW.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`).exec(html);
  assert.ok(opener, "the focus-return target is not a link");
  assert.ok(opener[0].includes("href="), "the focus-return target has no destination");
});

test("the close control carries the opener as its fragment", () => {
  // No-JavaScript path: the fragment is a real link to a real focusable
  // element, so a browser following it lands the reader in the right place
  // without any of this running.
  const html = panelHtml(`/clinician/today#row-${ROW.id}`);
  assert.ok(html.includes(`href="/clinician/today#row-${ROW.id}"`),
    "the close link does not name where focus should go");

  const view = read("src/components/experience/ClinicianHomeView.tsx");
  assert.match(view, /closeHref=\{`\$\{hrefFor\(\{ row: null \}\)\}#row-\$\{selected\.id\}`\}/,
    "the queue no longer builds the close link with a focus-return fragment");
});

test("the opener is looked up as an id, never as a selector", () => {
  // A queue row's id is its work-item id, which contains colons, so
  // `#row-alert:90E2…` is not a valid CSS selector. querySelector threw, the
  // catch turned it into silence, and focus stayed on <body> through two
  // rounds of "fixed".
  const src = read("src/components/experience/RestoreFocus.tsx");
  assert.match(src, /getElementById/, "the opener is looked up with a selector again");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /querySelector/,
    "querySelector is back, and a row id is not a valid selector");
});

test("the focus effect re-runs when the panel closes", () => {
  // The panel is link-driven, so closing it is a client-side navigation that
  // re-renders without remounting. An empty dependency list runs once for the
  // life of the page, which is why the first correct-looking fix changed
  // nothing at all.
  const src = read("src/components/experience/RestoreFocus.tsx");
  assert.match(src, /\}, \[token\]\);/,
    "the focus effect has no dependency on the panel state, so it fires once and never again");
  const view = read("src/components/experience/ClinicianHomeView.tsx");
  assert.match(view, /<RestoreFocus token=\{selected\?\.id \?\? "closed"\} \/>/,
    "the queue does not tell the focus effect when the panel opens or closes");
});

// ---------------------------------------------------------------------------
// The list is not squeezed, and the panel is not below the fold
// ---------------------------------------------------------------------------

test("the panel never takes a column out of the queue rows", () => {
  // Measured: at 1024px with the panel BESIDE the list a row was 262px wide,
  // which is UX 011 — "the evidence drawer compresses queue rows". The panel
  // moved below the list on 23 September, so it takes no width from anything
  // and that measurement cannot recur; the guard stays because the fix for it
  // is a layout choice somebody could undo in one class.
  const view = read("src/components/experience/ClinicianHomeView.tsx");
  for (const claim of [/\blg:w-\[24rem\]/, /\bxl:w-\[24rem\]/, /\bxl:shrink-0/]) {
    assert.ok(!claim.test(view),
      `the panel claims a fixed column again (${claim}), which is what squeezed rows to 262px`);
  }
  assert.ok(!/xl:flex-row/.test(view),
    "the list and the panel are side by side again, which is the arrangement that squeezed the rows");
});

test("the panel is above the rows on a phone and below them on a laptop", () => {
  // DECIDED 23 SEPTEMBER: below the list, matching every other work screen.
  //
  // ABOVE ON A PHONE IS A MEASUREMENT, NOT A PREFERENCE, and the decision was
  // taken with it in hand. Stacking it under the queue there was tried:
  // measured on a 390x844 screen the panel opened at y=3204 — 2,360px below the
  // fold — so a clinician tapped "why this is here" and the screen appeared not
  // to change.
  const view = read("src/components/experience/ClinicianHomeView.tsx");
  assert.match(view, /order-first/,
    "the panel stacks under the queue on a phone again, where it opened 2,360px below the fold");
  assert.match(view, /xl:order-last/,
    "the panel does not move below the list on a wide screen, which is what was decided");

  // ORDER IS A FLEX PROPERTY. An earlier attempt set `order-first` on a
  // container that was only `xl:flex`, so below xl it was a block container and
  // the ordering was silently ignored — the class list read correctly and the
  // measurement was unchanged.
  assert.match(view, /className="flex flex-col"/,
    "the container is not flex at every width, so the ordering does nothing");
});

test("opening a row moves the reader to the panel", () => {
  // BELOW THE LIST COSTS 895px ON A 1440x900 LAPTOP, measured after the move —
  // the same defect as the phone one at a different width: a control that
  // appears to do nothing.
  const view = read("src/components/experience/ClinicianHomeView.tsx");
  const panel = read("src/components/experience/QueueEvidencePanel.tsx");
  assert.match(view, /FocusPanelOnOpen/,
    "opening a row leaves the reader where they were, with the panel off-screen below the list");
  assert.match(panel, /id="queue-evidence"/, "the panel has no id to move the reader to");
  assert.match(panel, /tabIndex=\{-1\}/,
    "the panel cannot take focus, so moving the reader there does nothing");
});

test("the opening link carries no fragment", () => {
  // A FRAGMENT WAS THE FIRST ATTEMPT AND IT BROKE RE-OPENING A ROW.
  // `RestoreFocus` clears the fragment once it has done its job, so the address
  // becomes `?row=X`; going to `?row=X#queue-evidence` again is a fragment-only
  // change, which browsers handle WITHOUT RELOADING. The panel kept whatever it
  // was last showing, so a clinician who recorded a contact and opened the same
  // row again got the old confirmation instead of the form. The browser suite
  // caught it and it reproduced twice.
  const view = read("src/components/experience/ClinicianHomeView.tsx");
  const opening = view.slice(view.indexOf("panelHref="), view.indexOf("panelHref=") + 300);
  assert.ok(!/#queue-evidence/.test(opening),
    "the opening link carries a fragment again, so re-opening a row will not reload it");
});

// ---------------------------------------------------------------------------
// The behaviour the mode promises
// ---------------------------------------------------------------------------

test("a non-modal panel still leaves the page operable and returns focus", () => {
  const b = focusBehaviour("nonmodal");
  assert.equal(b.trapFocus, false, "the evidence panel traps focus, so comparison becomes recollection");
  assert.equal(b.pageRemainsOperable, true);
  assert.equal(b.returnFocusToOpener, true);
  // And the promise is now kept by something: the id above, the fragment, and
  // the effect. Before UX 011 this flag was true and nothing implemented it.
});

test("identity and one action stay on the panel", () => {
  const html = panelHtml("/clinician/today");
  assert.ok(html.includes("Ada Fenwick"), "the panel does not say who it is about");
  assert.ok(html.includes("Close"), "the panel cannot be closed");
});
