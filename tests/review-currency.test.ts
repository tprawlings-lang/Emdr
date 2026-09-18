// Completion semantics (17 September handoff, P3).
//
//   "A completion record should contain the actor, reviewed evidence version,
//   action and reason, resulting workflow state, next responsible party, and
//   timestamp. If material evidence changes later, the interface should
//   identify the earlier review as out of date under an approved policy."
//
// THE FAILURE THIS PREVENTS is the one a queue is most prone to. A clinician
// reviews somebody on Monday against what was on the record then, and the row
// leaves the queue. On Wednesday a check-in arrives that would have changed
// their mind. Nothing raises it, because the item was reviewed — and "reviewed"
// is being read as a property of the PERSON when it was a statement about a
// moment.

process.env.EMDR_DATA_DIR = `/tmp/steady-revcur-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "review-currency-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "review-currency-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { recordCareAction, careActionsForPerson } from "../src/lib/clinical/attention-signals";
import { newestEvidenceFor } from "../src/lib/clinical/person-evidence";
import {
  reviewCurrency, reviewsWithCurrency, REVIEW_CURRENCY_POLICY, REVIEW_CURRENCY_LABEL,
} from "../src/lib/clinical/review-currency";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const db = getDb();
function person(role: string, name: string): string {
  const id = newId();
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, PLATFORM_TENANT_ID, name);
  db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, ?)"
  ).run(id, PLATFORM_TENANT_ID, `${id}@revcur.test`, role, name);
  return id;
}

const clinician = person("clinician", "Dr Iyer");
const member = person("member", "Tomas");
const ctx: TenantContext = { tenantId: PLATFORM_TENANT_ID, personId: clinician };

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test("a review made before newer evidence is out of date", () => {
  const c = reviewCurrency({
    reviewedEvidenceAt: "2026-09-14 09:00:00",
    newestEvidenceAt: "2026-09-16 21:30:00",
  });
  assert.equal(c.state, "out_of_date");
  assert.match(c.because, /2026-09-16 21:30:00 arrived after the 2026-09-14 09:00:00/);
  assert.equal(c.policyVersion, REVIEW_CURRENCY_POLICY.version);
});

test("a review with nothing recorded since is current", () => {
  const same = reviewCurrency({
    reviewedEvidenceAt: "2026-09-16 21:30:00",
    newestEvidenceAt: "2026-09-16 21:30:00",
  });
  assert.equal(same.state, "current", "evidence unchanged read as a change");
});

test("a review that recorded no evidence version is unknown, never current", () => {
  // THE THIRD STATE, AND THE REASON IT EXISTS. Every row written before this
  // mechanism carries no version. Calling those current is a claim nobody
  // checked; calling them out of date is a false alarm on the whole history.
  const c = reviewCurrency({ reviewedEvidenceAt: null, newestEvidenceAt: "2026-09-16 21:30:00" });
  assert.equal(c.state, "unknown");
  assert.match(c.because, /did not record which evidence/);
  assert.match(c.because, /not being called current/);
});

test("evidence that cannot be read is unknown, not unchanged", () => {
  // Reading nothing back is not evidence that nothing happened. Treating an
  // unreadable record as "unchanged" would mark a review current on the
  // strength of a failed query.
  const c = reviewCurrency({ reviewedEvidenceAt: "2026-09-14 09:00:00", newestEvidenceAt: null });
  assert.equal(c.state, "unknown");
  assert.match(c.because, /unread rather than as unchanged/);
});

test("the rule is named, versioned, and says what it does not count", () => {
  // "Under an approved policy." An unnamed rule cannot be approved, cited or
  // changed deliberately.
  assert.ok(REVIEW_CURRENCY_POLICY.version.length > 8);
  assert.ok(REVIEW_CURRENCY_POLICY.materialChange.length > 40);
  assert.ok(REVIEW_CURRENCY_POLICY.excludes.length >= 2,
    "the policy does not say what it declines to count, so its scope is whatever a reader assumes");
  assert.match(REVIEW_CURRENCY_POLICY.excludes.join(" "), /policy version on its own/i,
    "a policy bump is not excluded, so every review on the caseload goes stale on the same morning");
});

test("the three states are three different sentences on screen", () => {
  const said = new Set(Object.values(REVIEW_CURRENCY_LABEL));
  assert.equal(said.size, 3, "two states are reported with the same words");
  assert.doesNotMatch(REVIEW_CURRENCY_LABEL.out_of_date, /wrong|incorrect|error|missed/i,
    "the label reads as a criticism of a colleague's judgement rather than as a fact about the record");
});

// ---------------------------------------------------------------------------
// The record carries what the handoff lists
// ---------------------------------------------------------------------------

test("a completion records the evidence it was made against and who holds it next", async () => {
  db.prepare(
    `INSERT INTO checkins (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge,
        feels_safe, dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, ?, '2026-09-14', 4, 2, 0, 1, 1, 5, 0, 'practice', '2026-09-14 09:00:00')`
  ).run(newId(), member, PLATFORM_TENANT_ID);

  const seen = await newestEvidenceFor(ctx, member);
  assert.equal(seen, "2026-09-14 09:00:00");

  await recordCareAction(ctx, {
    personId: member, clinicianId: clinician, action: "review",
    note: "Called, settled, nothing further today.",
    sourceSurface: "command_center_row",
    reviewedEvidenceAt: seen,
    nextResponsibleParty: clinician,
  });

  const [record] = await careActionsForPerson(ctx, member, 5);
  assert.equal(record.reviewedEvidenceAt, "2026-09-14 09:00:00");
  assert.equal(record.nextResponsibleParty, clinician);
  assert.equal(record.reviewCurrencyPolicy, REVIEW_CURRENCY_POLICY.version,
    "the record does not say which rule will decide whether it is still current");
  assert.equal(record.clinicianPersonId, clinician);
  assert.ok(record.completedAt);
});

test("a completion that saw nothing records nothing, rather than stamping now", async () => {
  // Binding a review to the moment instead of to the evidence would make every
  // review permanently current, which is the mechanism failing silently.
  const other = person("member", "Nobody");
  await recordCareAction(ctx, {
    personId: other, clinicianId: clinician, action: "review",
    sourceSurface: "command_center_row",
    reviewedEvidenceAt: await newestEvidenceFor(ctx, other),
  });
  const [record] = await careActionsForPerson(ctx, other, 5);
  assert.equal(record.reviewedEvidenceAt, null);
  assert.equal(record.reviewCurrencyPolicy, null,
    "a currency policy was cited over no evidence version");
  assert.equal(reviewsWithCurrency([record], null)[0].currency.state, "unknown");
});

test("evidence arriving after the review turns it out of date on the next read", async () => {
  // END TO END, and on read rather than on a sweep: a review that went stale
  // overnight reads as stale on the next screen, not on the next run of a job.
  db.prepare(
    `INSERT INTO alerts (id, user_id, tenant_id, alert_type, severity, detail, status, created_at)
     VALUES (?, ?, ?, 'harm_urge', 'high', 'later evidence', 'open', '2026-09-16 21:30:00')`
  ).run(newId(), member, PLATFORM_TENANT_ID);

  const records = await careActionsForPerson(ctx, member, 5);
  const now = await newestEvidenceFor(ctx, member);
  assert.equal(now, "2026-09-16 21:30:00", "the newer evidence is not being read");

  const [review] = reviewsWithCurrency(records, now);
  assert.equal(review.currency.state, "out_of_date");
  assert.match(review.currency.because, /no longer describes the current record/);
});

test("only reviews are asked whether they are current", async () => {
  // The ledger also holds contacts. Asking whether a phone call has gone out of
  // date is not a question, and labelling one would be noise on a screen whose
  // whole value is that its labels mean something.
  await recordCareAction(ctx, {
    personId: member, clinicianId: clinician, action: "contact",
    sourceSurface: "command_center_row", reviewedEvidenceAt: "2026-09-14 09:00:00",
  });
  const records = await careActionsForPerson(ctx, member, 10);
  assert.ok(records.some((r) => r.action === "contact"), "the fixture recorded no contact");
  const out = reviewsWithCurrency(records, "2026-09-16 21:30:00");
  assert.ok(out.every((r) => records.find((x) => x.id === r.id)?.action === "review"),
    "a contact was given a currency verdict");
});

// ---------------------------------------------------------------------------
// The interface that identifies it
// ---------------------------------------------------------------------------

test("the ledger has a reader, which it did not before", () => {
  // `careActionsForPerson` had no caller anywhere in the product: reviews were
  // written and never read back, so a rule about identifying stale ones had
  // nowhere to identify them.
  const overview = code(read("src/app/clinician/member/[id]/page.tsx"));
  assert.match(overview, /careActionsForPerson\(/, "nothing reads the care-time ledger");
  assert.match(overview, /<ReviewLedger/, "the overview does not show recorded reviews");
});

test("both review paths record what the reviewer was looking at", () => {
  const src = code(read("src/lib/clinical/shell-actions.ts"));
  const calls = src.match(/recordCareAction\([\s\S]*?\}\);/g) ?? [];
  const reviews = calls.filter((c) => /action: "review"/.test(c));
  assert.ok(reviews.length >= 2, `expected both review paths, found ${reviews.length}`);
  for (const c of reviews) {
    assert.match(c, /reviewedEvidenceAt/,
      "a review is recorded without the evidence version it was made against");
    assert.match(c, /nextResponsibleParty/,
      "a completion names nobody as holding the person next");
  }
});

test("the evidence reading is taken before the review is written", () => {
  // Reading it afterwards would bind the review to evidence that arrived in the
  // same second as the decision, which makes a review that was already stale
  // look current.
  // Compared at the CALL SITES, not by first occurrence in the file: the first
  // version of this assertion compared the two import lines and failed on a
  // correct implementation, which is a test measuring the import order.
  const src = code(read("src/lib/clinical/shell-actions.ts"));
  const calls = [...src.matchAll(/await recordCareAction\([\s\S]*?\}\);/g)]
    .filter((m) => /action: "review"/.test(m[0]));
  assert.ok(calls.length >= 2, `expected both review paths, found ${calls.length}`);
  for (const m of calls) {
    const before = src.slice(Math.max(0, m.index! - 500), m.index!);
    assert.match(before, /await newestEvidenceFor\(/,
      "the evidence stamp is not read immediately before the review is recorded, so a review " +
      "can bind to evidence that arrived in the same second as the decision");
  }
});
