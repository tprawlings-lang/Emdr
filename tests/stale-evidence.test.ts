// FAILURE-INJECTION EVIDENCE for the failure register's
// `stale.clinician-acts-on-moved-evidence`, `stale.correction-changes-a-trajectory`
// and `stale.answer-cites-corrected-evidence`
// — see src/lib/governance/failure-register.ts.
//
// THE FAILURE INJECTED HERE IS THE RECORD MOVING UNDER A DECISION. Not two
// people colliding — one person, reading a screen, while the thing the screen
// describes changes behind it. A correction arrives for a March observation in
// September; a new reading lands while a drawer is open; an answer cites
// something that has since been corrected.
//
// The hardest of the three is the backdated one, because it is the one where
// the obvious implementation is wrong: a correction to March is not news from
// March. The handoff says it in one line — "late-arriving information must not
// appear as newly occurring information" — and getting it right means two
// different clocks, one for when it happened and one for when we learned.

process.env.EMDR_DATA_DIR = `/tmp/steady-stale-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "stale-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "stale-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import {
  signalRowVersion, alertRowVersion, explainVersionChange,
} from "../src/lib/clinical/row-version";
import { reviewCurrency, reviewsWithCurrency } from "../src/lib/clinical/review-currency";
import { newestEvidenceFor } from "../src/lib/clinical/person-evidence";
import { appendEvent, readEvents, asOfBound } from "../src/lib/events";
import { stale } from "../src/lib/experience/command";
import { advance } from "../src/lib/experience/task-state";

// ---------------------------------------------------------------------------
// Evidence moving under a single reader
// ---------------------------------------------------------------------------

test("new evidence under one reader moves the version, and a cosmetic change does not", () => {
  const open = { state: "open", evidenceAt: "2026-09-10T08:00:00Z" };

  // THE INJECTION: nobody else acted; a new reading simply arrived while the
  // drawer was open. The decision in front of the clinician was computed
  // against evidence that is no longer the newest.
  const moved = { ...open, evidenceAt: "2026-09-12T08:00:00Z" };
  assert.notEqual(signalRowVersion(open), signalRowVersion(moved));

  // AND A VERSION THAT MOVES FOR COSMETIC REASONS TRAINS PEOPLE TO PRESS
  // THROUGH IT. A version carries what would make the reader's decision wrong,
  // and nothing else — the extra field here is ignored by construction.
  const renamed = { ...open, displayName: "someone else" } as typeof open;
  assert.equal(signalRowVersion(renamed), signalRowVersion(open));
});

test("the conflict says WHAT changed, not that a version string differs", () => {
  // "Detect the version mismatch and show the relevant change." Detection was
  // built and the showing was a version string — and a reader told "the queue
  // now holds open@2026-09-12T08:00:00Z" has been given the evidence that
  // something moved and none of what they need. The honest response to that
  // warning is to press through it, which is the behaviour the check exists to
  // prevent.
  const before = signalRowVersion({ state: "open", evidenceAt: "2026-09-10T08:00:00Z" });

  const acted = signalRowVersion({ state: "resolved", evidenceAt: "2026-09-10T08:00:00Z" });
  assert.match(explainVersionChange(before, acted)!, /Somebody else acted/);
  assert.match(explainVersionChange(before, acted)!, /resolved/);

  const newEvidence = signalRowVersion({ state: "open", evidenceAt: "2026-09-12T08:00:00Z" });
  const said = explainVersionChange(before, newEvidence)!;
  assert.match(said, /New evidence arrived/);
  assert.match(said, /2026-09-12/, "the reader is not told when the newer evidence arrived");
  assert.doesNotMatch(said, /Somebody else acted/, "nobody acted; saying so would send the reader looking for a person");

  const both = signalRowVersion({ state: "acknowledged", evidenceAt: "2026-09-12T08:00:00Z" });
  assert.match(explainVersionChange(before, both)!, /Both moved/);

  // A row that did not move cannot be given a conflict sentence.
  assert.equal(explainVersionChange(before, before), null);
});

test("an alert conflict distinguishes one that closed from one that was raised", () => {
  // THE TWO MEAN OPPOSITE THINGS. An alert closed by somebody else means the
  // work may be done. An alert RAISED since the page was built is something
  // the reader has not seen, and closing the row would close it unread.
  const shown = alertRowVersion([{ id: "a1", status: "open" }]);
  const closed = alertRowVersion([{ id: "a1", status: "closed" }]);
  const raised = alertRowVersion([{ id: "a1", status: "open" }, { id: "a2", status: "open" }]);

  assert.match(explainVersionChange(shown, closed)!, /closed by somebody else/);
  assert.match(explainVersionChange(shown, raised)!, /raised after this page was built/);
  assert.match(explainVersionChange(shown, raised)!, /have not seen/);
});

test("a conflict is never dressed as a failure the reader can retry away", () => {
  const result = stale(
    explainVersionChange(
      signalRowVersion({ state: "open", evidenceAt: "2026-09-10T08:00:00Z" }),
      signalRowVersion({ state: "open", evidenceAt: "2026-09-12T08:00:00Z" }),
    )!,
    signalRowVersion({ state: "open", evidenceAt: "2026-09-12T08:00:00Z" }),
  );
  const shown = advance(result);
  assert.equal(shown.name, "conflict");
  assert.equal(shown.retryable, false, "a conflict is resolved by reading what changed, not by pressing again");
  assert.match(shown.detail!, /New evidence arrived/);
});

// ---------------------------------------------------------------------------
// A correction to something already interpreted
// ---------------------------------------------------------------------------

test("a correction recorded today about March does not read as news from March", async () => {
  // THE ONE THE OBVIOUS IMPLEMENTATION GETS WRONG. A clinician reviewed this
  // person in June against everything known then. In September somebody
  // corrects a March check-in. The occurrence is March — earlier than the
  // review — so a staleness check that compared occurrence times would leave
  // the June review reading "current" over a record that changed underneath it.
  //
  // The handoff's time model is the fix: when it happened and when we learned
  // are different columns, and staleness is a question about the second.
  getDb();
  const c = await data();
  const user = (await c.get("SELECT id FROM users WHERE role = 'member' LIMIT 1", [])) as { id: string };
  const ctx = { tenantId: ((await c.get("SELECT tenant_id FROM users WHERE id = ?", [user.id])) as { tenant_id: string }).tenant_id };

  await c.run(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
                           dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, '2026-03-04', 4, 2, 0, 1, 3, 3, 0, 'continue', '2026-12-31 09:00:00')`,
    [`late-correction-${user.id}`, user.id],
  );

  // THE TWO STAMPS ARE ON OPPOSITE SIDES OF EVERY OTHER ROW, deliberately.
  // Occurrence in March is older than anything the seed holds; the recorded
  // stamp is newer than all of it. So an exact match on the recorded stamp is
  // the only way this assertion can pass, and a staleness check that read the
  // occurrence column would return the seed's own maximum instead.
  //
  // Asserted as an EQUALITY for that reason. Written as `>= the recorded
  // stamp` first, and swapping the column passed: the seeded population's own
  // check-ins are recent enough to satisfy a lower bound, so the test was
  // measuring the seed rather than the injection.
  const newest = await newestEvidenceFor(ctx as never, user.id);
  assert.equal(
    newest,
    "2026-12-31 09:00:00",
    `the newest evidence reads ${newest}, so a correction recorded after a review is invisible to it`,
  );

  const june = reviewCurrency({ reviewedEvidenceAt: "2026-06-01 09:00:00", newestEvidenceAt: newest });
  assert.equal(june.state, "out_of_date");
  // AND IT EXPLAINS THE NEW INTERPRETATION rather than only flagging it. The
  // review still stands as what was decided; what changed is whether it still
  // describes the record.
  assert.match(june.because, /arrived after/);
  assert.match(june.because, /still what was decided/);
});

test("the old interpretation is preserved, not overwritten", async () => {
  // "Preserve the old version and explain the new interpretation." A review
  // that was current and is now out of date is not deleted or rewritten: the
  // row stays, and the currency verdict is computed beside it.
  const rows = [{
    id: "r1",
    completedAt: "2026-06-01 09:00:00",
    clinicianPersonId: "c1",
    action: "review",
    note: "Reviewed against the March readings.",
    nextResponsibleParty: "c1",
    reviewedEvidenceAt: "2026-06-01 09:00:00",
  }];
  const after = reviewsWithCurrency(rows, "2026-09-18 09:00:00");
  assert.equal(after.length, 1);
  assert.equal(after[0].note, "Reviewed against the March readings.", "the earlier review's words were rewritten");
  assert.equal(after[0].currency.state, "out_of_date");
  assert.equal(after[0].currency.reviewedEvidenceAt, "2026-06-01 09:00:00");
});

test("a review that recorded no evidence version is not called current", () => {
  // THE FAIL-CLOSED HALF. An older review with nothing to compare against
  // cannot be shown as current, because "current" would be a claim nobody
  // checked.
  const r = reviewCurrency({ reviewedEvidenceAt: null, newestEvidenceAt: "2026-09-18 09:00:00" });
  assert.equal(r.state, "unknown");
  assert.match(r.because, /not being called current/);

  // And evidence that cannot be read at all is unknown rather than unchanged.
  const gone = reviewCurrency({ reviewedEvidenceAt: "2026-06-01 09:00:00", newestEvidenceAt: null });
  assert.equal(gone.state, "unknown");
  assert.match(gone.because, /unread rather than as unchanged/);
});

// ---------------------------------------------------------------------------
// An answer that cites something since corrected
// ---------------------------------------------------------------------------

test("a generated answer is rebuilt from the current record, never served from a store", () => {
  // "Mark it stale or regenerate under an explicit policy." THE POLICY HERE IS
  // REGENERATE, and it is enforced by there being nowhere to put an answer: no
  // summary or retrieved answer is written to a table, so no reader can be
  // served one that cites evidence corrected since it was produced.
  //
  // A SOURCE CHECK, because the property is an absence. A behavioural test can
  // show that today's answer matches today's record; it cannot show that no
  // code path stores one, and storing one is the change that would break this.
  for (const file of [
    "src/lib/clinical/summary.ts",
    "src/lib/clinical/ask-answer.ts",
    "src/lib/clinical/ask-store.ts",
    "src/lib/clinical/ask-retrieval.ts",
  ]) {
    const src = fs.readFileSync(file, "utf8");
    assert.ok(
      !/INSERT\s+INTO|\.insert\(/i.test(src),
      `${file} persists generated output, so an answer can outlive the evidence it cited`,
    );
  }
});

test("approved memory that cites a corrected source stops feeding answers", async () => {
  // THE ONE GENERATED ARTEFACT THAT IS STORED. An approved memory item is
  // durable and cites a transcript span, so it is the thing that CAN outlive a
  // correction — and the answer is that a corrected source supersedes the item
  // rather than editing it, and retrieval reads approved items only.
  const src = fs.readFileSync("src/lib/clinical/memory-store.ts", "utf8");
  assert.match(
    src,
    /status = 'approved'/,
    "approved memory no longer filters by status, so a superseded item can be retrieved into an answer",
  );
  assert.match(src, /supersedesId|supersedes_id/, "a memory item cannot record what it replaced");
  // Superseded is a STATUS, not a deletion: the earlier item stays readable,
  // which is the same rule the review ledger follows.
  assert.match(src, /"candidate" \| "approved" \| "rejected" \| "superseded"/);
});

// ---------------------------------------------------------------------------
// The as-of cutoff itself
// ---------------------------------------------------------------------------

test("an as-of reconstruction excludes what was recorded after the cutoff, on the same day", async () => {
  // THE DEFECT THIS TEST EXISTS FOR WAS INVISIBLE FOR AS LONG AS THE DATE DID
  // NOT CHANGE. `recorded_at` takes SQLite's `datetime('now')` — "2026-09-19
  // 08:00:00", a space — and every caller passes an ISO instant —
  // "2026-09-18T09:00:00.000Z", a T. The filter compares TEXT, and " " sorts
  // before "T", so every row recorded on the cutoff's own date passed whatever
  // its time: a reconstruction "as of 09:00" included an event recorded at
  // 23:00 that evening. That is exactly the future-data leakage the parameter
  // exists to prevent, and it surfaced only as a test that went red the
  // morning the date rolled over — same-day rows had been passing by accident.
  getDb();
  const c = await data();
  const person = (await c.get("SELECT id FROM persons LIMIT 1", [])) as { id: string };

  const cutoff = "2026-09-18T09:00:00.000Z";
  const before = await appendEvent({
    personId: person.id, type: "daily_checkin.completed",
    occurredAt: "2026-09-18T08:00:00.000Z", recordedAt: "2026-09-18T08:00:00.000Z",
  });
  // Recorded LATER THE SAME DAY. This is the one the old comparison let
  // through, and the only one that distinguishes a fixed comparison from a
  // lucky one.
  const sameDayLater = await appendEvent({
    personId: person.id, type: "daily_checkin.completed",
    occurredAt: "2026-09-18T23:00:00.000Z", recordedAt: "2026-09-18T23:00:00.000Z",
  });

  const seen = (await readEvents({ personId: person.id, asOf: cutoff })).map((e) => e.id);
  assert.ok(seen.includes(before), "an event recorded before the cutoff was dropped");
  assert.ok(
    !seen.includes(sameDayLater),
    "an event recorded at 23:00 passed a cutoff of 09:00 on the same day — future data in a point-in-time read",
  );

  // And the cutoff is narrowed by one rule, exported so a caller building its
  // own comparison cannot invent a second one that nearly matches.
  assert.equal(asOfBound("2026-09-18T09:00:00.000Z"), "2026-09-18 09:00:00");
  assert.equal(asOfBound("2026-09-18 09:00:00"), "2026-09-18 09:00:00");
});
