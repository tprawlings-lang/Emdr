import { strict as assert } from "node:assert";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CareHistoryLedger } from "../src/components/clinical/CareHistoryLedger";
import {
  CONTACT_MEANING, NO_CARE_HISTORY, CARE_ACTION_LABEL, type CareHistoryEntry,
} from "../src/lib/clinical/care-history";

// WHERE THE CONTACT CAVEAT GOES, checked by rendering rather than by reading
// the component's source.
//
// "An attempt, recorded by the clinician who made it — not proof that anybody
// was reached" is the sentence this ledger turns on: a reader who counts three
// attempts and concludes somebody was reached has been misled by a list that
// was accurate. It was rendered ABOVE THE WHOLE LIST, which was true while
// every entry was a contact attempt.
//
// IT HAS BEEN WRONG TWICE, AND THE SECOND TIME THE TEST WAS WHY. Three actions
// joined the ledger on 23 September and the sentence started sitting over
// "Trajectory read"; the fix made it conditional on there being a contact
// somewhere in the list, which answers the EMPTY case and not the MIXED one — a
// ledger holding one call and one plan-link adjustment still captioned both
// with a sentence about calls. The guard that was supposed to hold this was a
// regular expression over the component's source: it asserted the shape of the
// condition, so it passed. The defect was found by opening the screen.
//
// So this renders the component and reads the output. A caveat in the wrong
// place is worse than none — it teaches people that the caveats here are
// decoration.

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function entry(over: Partial<CareHistoryEntry> & { action: CareHistoryEntry["action"] }): CareHistoryEntry {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    label: CARE_ACTION_LABEL[over.action],
    note: null,
    at: "2026-09-24 10:00",
    corrects: null,
    correctionReason: null,
    owner: null,
    ...over,
  };
}

const render = (entries: CareHistoryEntry[]) =>
  renderToStaticMarkup(<CareHistoryLedger entries={entries} />);

test("a contact attempt still carries what it does not prove", () => {
  const html = render([entry({ action: "contact", note: "Left a voicemail." })]);
  assert.ok(text(html).includes(CONTACT_MEANING),
    "the ledger no longer says what a contact attempt does not prove");
});

test("the caveat is inside the contact entry, not over the list", () => {
  // THE MIXED LEDGER — the case both previous versions got wrong. One call and
  // one plan-link adjustment: the sentence must be attached to the call.
  const html = render([
    entry({ action: "adjust_plan_link", note: "Calm Place setup is no longer linked to a goal." }),
    entry({ action: "contact", note: "Left a voicemail." }),
  ]);

  const items = html.split('data-testid="care-history-entry"').slice(1);
  assert.equal(items.length, 2, "the fixture did not render two entries");

  const withCaveat = items.filter((i) => i.includes(CONTACT_MEANING.slice(0, 40)));
  assert.equal(withCaveat.length, 1, "the caveat is on a number of entries other than one");
  assert.ok(withCaveat[0].includes("Left a voicemail."),
    "the caveat landed on an entry that is not the contact attempt");

  // AND NOT ABOVE THE LIST. Everything before the first entry is the section's
  // own heading and any list-level text; the sentence must not be there.
  const beforeTheList = html.slice(0, html.indexOf('data-testid="care-history-entry"'));
  assert.ok(!beforeTheList.includes(CONTACT_MEANING.slice(0, 40)),
    "the contact caveat is above the whole list again, captioning rows it does not describe");
});

test("an entry that is not a contact attempt carries no caveat about one", () => {
  for (const action of ["adjust_plan_link", "review_trajectory", "open_session_prep", "record_thought"] as const) {
    const html = render([entry({ action })]);
    assert.ok(!text(html).includes(CONTACT_MEANING),
      `"${CARE_ACTION_LABEL[action]}" is captioned with a sentence about contact attempts`);
  }
});

test("an empty ledger says what empty means", () => {
  assert.ok(text(render([])).includes(NO_CARE_HISTORY),
    "an empty ledger renders blank, which reads as a fault rather than a state");
});
