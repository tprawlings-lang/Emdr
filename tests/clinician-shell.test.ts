// The clinician shell (handoff 09 §5, Package 2).
//
// Package 2's exit evidence: "Before/after screenshots, capability omissions,
// responsive behavior, failure states, exact test evidence. Ten-second
// orientation and priority parity pass. Authorization and queue authority
// unchanged."
//
// TWO OF THOSE ARE TESTABLE HERE AND THEY ARE THE TWO THAT MATTER MOST.
//
//   PRIORITY PARITY. The new home must show the same rows in the same order as
//   the projection produced them. §5: "Retain domain-owned ordering and safety
//   authority." A presentation layer that sorted would be a second opinion
//   about who matters most, and the failure would be invisible — the queue
//   would still look like a queue.
//
//   AUTHORIZATION AND QUEUE AUTHORITY UNCHANGED. Both branches of the Today
//   page read the same envelope, so the check is that the shell reshapes rather
//   than recomputes: no query, no re-band, no filter that can drop an
//   obligation.
//
// AND THE ROW SHAPE IS THE PACKAGE'S POINT. §5: "A row should not require the
// clinician to parse eight badges before understanding the concern." The row it
// replaces carried eleven things. The test below counts the fields on the type,
// because a count on a rendered component is a count somebody defeats with a
// nested span.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { experienceContextFor } from "../src/lib/experience/context";
import { navigationFor } from "../src/lib/experience/navigation";
import { emptyViewState } from "../src/lib/experience/view-state";
import {
  clinicianHome, CLINICIAN_ACTIONS, ACTION_LABEL, ACTION_NOTE,
  type QueueRowView,
} from "../src/lib/experience/clinician-home";
import {
  EXPERIENCE_FLAGS, ALL_EXPERIENCE_FLAGS, experienceFlagEnabled, clinicianShellEnabled,
} from "../src/lib/experience/flags";
import { ready, empty, projectionFailed } from "../src/lib/presentation/envelope";
import type { WorkQueue, WorkItem } from "../src/lib/clinical/work-queue";
import { COURSE_SECTIONS, layerFor } from "../src/components/clinical/PersonShell";
import { CONSOLE_SCREENS } from "../src/components/clinical/ClinicianPage";
import { routeEntry } from "../src/lib/app/route-register";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const ctx = experienceContextFor({
  id: "clin-1", email: "c@example.test", name: "Dr X", role: "clinician", tenantId: "t-1",
});
const NOW = "2026-09-09T09:00:00.000Z";

function meta() {
  return {
    schemaVersion: "clinician_queue.v1",
    projectionVersion: "1",
    generatedAt: NOW,
    tenantId: "t-1",
    sourceWatermark: NOW,
    policyVersion: "p-1",
  };
}

function item(over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "i-1", group: "needs_action", band: "immediate",
    personId: "p-1", personName: "Ada",
    reason: "Screening risk item needs a documented response.",
    detail: "phq-9: item 9 positive", resolvedAt: null,
    change: null, evidenceAt: NOW,
    ownerId: null, ownerName: null,
    dueAt: NOW, overdue: false, eventCount: 1,
    action: "review", actionable: true, blockedReason: null,
    safetyAuthority: true, signalId: null,
    supportFacts: [], lastContactDays: null,
    ...over,
  } as WorkItem;
}

function queue(items: WorkItem[], over: Partial<WorkQueue> = {}): WorkQueue {
  return {
    items,
    groupCounts: {
      needs_action: items.length, review_today: 0, waiting_member: 0,
      waiting_staff: 0, recently_resolved: 0,
    },
    uiCounts: { needs_attention: items.length, review_today: 0, waiting: 0 },
    stableCount: 0, stablePersonIds: [],
    coverage: { providersRan: ["a"], providersFailed: [], truncated: false },
    policyVersion: "p-1", computedAt: NOW, newestEvidenceAt: NOW,
    ...over,
  } as WorkQueue;
}

function home(items: WorkItem[], over: Partial<WorkQueue> = {}) {
  return clinicianHome({
    ctx, envelope: ready(meta(), queue(items, over)),
    view: emptyViewState("t-1"), showing: null, now: NOW, rowsPerBucket: 10,
  });
}

// ---------------------------------------------------------------------------
// §5's row: five fields, and the safety label
// ---------------------------------------------------------------------------

test("a row carries §5's five fields and nothing that needs parsing", () => {
  // §5: "Identity, reason, ownership, due state, one next action." Counted on
  // the TYPE rather than on the rendered component, because a count on markup
  // is a count somebody defeats with a nested span.
  const src = code(read("src/lib/experience/clinician-home.ts"));
  const shape = src.slice(
    src.indexOf("export interface QueueRowView"),
    src.indexOf("export interface SecondaryFact")
  );
  const fields = [...shape.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);

  // The five §5 asks for, plus what a row cannot do without: an id, the person
  // id behind the name, the disambiguator that keeps two Adas apart, the
  // safety label, the band, the blocked reason, the secondary bundle, the
  // signal, and the group. Each is justified in the module's own comments.
  for (const required of ["personName", "reason", "ownerName", "dueAt", "action"]) {
    assert.ok(fields.includes(required), `the row has no ${required}`);
  }
  // The point of the package: the row must not grow back. Eleven was the
  // number that made the old one unreadable.
  assert.ok(
    fields.length <= 16,
    `the row type has ${fields.length} fields (${fields.join(", ")}). §5: a row must not require parsing eight badges.`
  );
});

test("the safety label stays on the row and comes from its own field", () => {
  // §2 of handoff 03: "safety remains visibly labeled as safety. Non-safety
  // review_now cannot masquerade as safety." A renderer that inferred it from
  // the band would eventually label a response-pattern row as safety, because
  // the band is exactly what the two share.
  const h = home([item({ safetyAuthority: true }), item({ id: "i-2", safetyAuthority: false, band: "immediate" })]);
  assert.equal(h.items[0].safetyAuthority, true);
  assert.equal(h.items[1].safetyAuthority, false);
  assert.equal(h.items[0].band, h.items[1].band, "the fixture must share a band for this to prove anything");

  const row = code(read("src/components/experience/QueueRow.tsx"));
  assert.match(row, /row\.safetyAuthority/, "the row does not read the safety field");
  assert.ok(
    !/band\s*===\s*"immediate"|band\s*===\s*"high"/.test(row),
    "the row infers something from the band"
  );
});

test("secondary facts move off the row rather than disappearing", () => {
  // §5: "Move secondary facts into a readable detail panel." Nothing was
  // deleted — the test is that each fact the old row carried is still reachable.
  const h = home([item({
    change: "Distress up 2 since your last review",
    detail: "phq-9: item 9 positive",
    eventCount: 3,
    supportFacts: ["Third hard evening this month"],
    lastContactDays: 4,
  })]);
  const labels = h.items[0].secondary.map((f) => f.label);
  for (const expected of [
    "Change since last review", "Newest evidence", "Last clinician contact",
    "Events collapsed into this row", "Underlying event",
  ]) {
    assert.ok(labels.includes(expected), `"${expected}" is not in the panel: ${labels.join(", ")}`);
  }
  // And the panel renders them.
  const panel = code(read("src/components/experience/QueueEvidencePanel.tsx"));
  assert.match(panel, /row\.secondary\.map/, "the panel does not render the secondary facts");
});

test("no secondary fact shows a raw machine timestamp", () => {
  // Caught on the screen: the panel rendered "2026-09-09T04:48:59.577Z", which
  // nobody reads and which puts sub-second precision on a clinical fact that
  // is accurate to the day.
  const h = home([item({ evidenceAt: "2026-09-02T11:15:00.000Z", resolvedAt: "2026-09-03T09:00:00.000Z" })]);
  for (const f of h.items[0].secondary) {
    assert.ok(
      !/\dT\d|\.\d{3}Z|Z$/.test(f.value),
      `"${f.label}" shows a machine timestamp: "${f.value}"`
    );
  }
  // And it is still a date somebody can act on, not a vague word.
  const byLabel = new Map(h.items[0].secondary.map((f) => [f.label, f.value]));
  assert.equal(byLabel.get("Newest evidence"), "2026-09-02 11:15");
});

test("missing facts are stated, not dropped", () => {
  // §14: missing is not the same as nothing changed. A fact that vanished when
  // absent would make "no contact recorded" and "contacted today" look alike.
  const h = home([item({ change: null, lastContactDays: null })]);
  const byLabel = new Map(h.items[0].secondary.map((f) => [f.label, f.value]));
  assert.equal(byLabel.get("Change since last review"), "First time in this queue");
  assert.equal(byLabel.get("Last clinician contact"), "None recorded");
});

test("two people with the same name get a permitted identifier, and others do not", () => {
  // §5: "Where names match, use a permitted secondary identifier rather than
  // initials alone." Initials are the failure: "Aiko N." and "Aiko I." is a
  // distinction a tired reader gets wrong, and the cost is a note on the wrong
  // record.
  const h = home([
    item({ id: "a", personId: "p-aiko-1", personName: "Aiko" }),
    item({ id: "b", personId: "p-aiko-2", personName: "Aiko" }),
    item({ id: "c", personId: "p-ada", personName: "Ada" }),
  ]);
  const [a, b, ada] = h.items;
  assert.ok(a.disambiguator, "the repeated name has no identifier");
  assert.notEqual(a.disambiguator, b.disambiguator, "both Aikos got the same identifier");
  assert.equal(ada.disambiguator, null, "an unambiguous name was given an identifier for no reason");
  // Not initials.
  assert.ok(!/^[A-Z]\.$/.test(a.disambiguator!), `the identifier is an initial: ${a.disambiguator}`);
});

// ---------------------------------------------------------------------------
// §5's separated actions
// ---------------------------------------------------------------------------

test("the four actions are distinct, and opening is not one of the commands", () => {
  // §5: "Distinguish Open, Record contact, Assign, and Complete review.
  // Opening is not acknowledgement."
  assert.deepEqual([...CLINICIAN_ACTIONS], ["open", "record_contact", "assign", "complete_review"]);

  // The commands module has three, and `open` is deliberately not among them:
  // a codebase where opening is a command is one where somebody makes it write.
  const commands = code(read("src/lib/clinical/shell-actions.ts"));
  const exported = [...commands.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    exported.sort(), ["assignWork", "completeReview", "recordContact"],
    `the shell exports ${exported.join(", ")}`
  );
  assert.ok(!exported.some((n) => /^open/i.test(n)), "opening has a server command");
});

test("no action label claims something the product did not do", () => {
  // §5: "Recording that an attempted contact occurred is not proof of
  // delivery." A button labelled "Contact" implies the product contacted
  // somebody, and §4.5 bars "notified" without a receipt.
  assert.equal(ACTION_LABEL.record_contact, "Record contact");
  for (const a of CLINICIAN_ACTIONS) {
    // NEGATED CLAUSES ARE DROPPED FIRST. "It is not proof that anything was
    // delivered" is the sentence this rule wants, and a regex over the raw
    // string flagged it — a guard that fires on its own subject is a guard
    // somebody deletes rather than fixes. What must not appear is an
    // AFFIRMATIVE claim of delivery.
    const affirmative = `${ACTION_LABEL[a]} ${ACTION_NOTE[a]}`
      .split(/[.;]/)
      .filter((clause) => !/\bnot\b|\bnever\b|\bno\b/i.test(clause))
      .join(" ");
    assert.ok(
      !/\bnotified\b|\bdelivered\b|\bsent\b|\balerted\b/i.test(affirmative),
      `${a} claims a delivery: "${affirmative}"`
    );
  }
  // And each note says what it does NOT do.
  assert.match(ACTION_NOTE.open, /not acknowledgement/i);
  assert.match(ACTION_NOTE.record_contact, /not proof/i);
  assert.match(ACTION_NOTE.assign, /does not notify/i);
});

test("the row's primary action is the thing the queue is asking for", () => {
  // The old row's single action navigated in all three of its labels —
  // "Review", "Contact" and "Open" all went to the record. That is the
  // conflation §5 names.
  assert.equal(home([item({ action: "review" })]).items[0].action, "complete_review");
  assert.equal(home([item({ action: "contact" })]).items[0].action, "record_contact");
  assert.equal(home([item({ action: "open" })]).items[0].action, "open");
  assert.equal(home([item({ action: "none" })]).items[0].action, null);
  // And a row this clinician may not act on offers nothing, with the reason.
  const blocked = home([item({ actionable: false, blockedReason: "Not your caseload." })]);
  assert.equal(blocked.items[0].action, null);
  assert.equal(blocked.items[0].blockedReason, "Not your caseload.");
});

test("a command result is never rendered as success unless it is one", () => {
  // §4.4's "a failed save never appears as saved", at the surface. The control
  // routes every outcome through `advance`, which is the only path to a
  // confirmed task state.
  const actions = code(read("src/components/experience/RowActions.tsx"));
  assert.match(actions, /advance\(/, "the control does not route outcomes through advance()");
  assert.match(actions, /mayClaimSaved\(/, "the control decides for itself whether to claim success");
  // It must not set a success state from anything but the server's answer.
  assert.ok(
    !/setTask\(\s*\{[^}]*confirmed/.test(actions),
    "the control constructs a confirmed task state itself"
  );
});

test("a conflict preserves the draft and offers no blind retry", () => {
  // §5: "preserve any unsent draft according to policy. Do not silently
  // overwrite." The note is cleared only on a confirmed write.
  const actions = code(read("src/components/experience/RowActions.tsx"));
  assert.match(
    actions, /if \(r\.outcome === "confirmed"\) setNote\(""\)/,
    "the draft is cleared on something other than a confirmed write"
  );
  assert.match(actions, /task\.retryable/, "the control offers retry without asking whether it is safe");
});

// ---------------------------------------------------------------------------
// Priority parity and queue authority
// ---------------------------------------------------------------------------

test("the shell shows the projection's rows in the projection's order", () => {
  // Package 2's exit evidence: "priority parity". A presentation layer that
  // sorted would be a second opinion about who matters most, and the queue
  // would still look like a queue.
  const items = [
    item({ id: "1", personName: "Zoe", band: "immediate" }),
    item({ id: "2", personName: "Ada", band: "high" }),
    item({ id: "3", personName: "Mo", band: "standard" }),
  ];
  const h = home(items);
  assert.deepEqual(h.items.map((r) => r.id), ["1", "2", "3"]);

  // And the module contains no sort at all.
  const src = code(read("src/lib/experience/clinician-home.ts"));
  assert.ok(!/\.sort\(/.test(src), "the home projection sorts");
  for (const token of ["BAND_ORDER", "PRIORITY", "localeCompare"]) {
    assert.ok(!src.includes(token), `the home projection orders by ${token}`);
  }
});

test("paging never caps the count, so a filter cannot hide an obligation", () => {
  // §5: "Do not let a filter quietly hide mandatory obligations." The rows are
  // paged; the total is the whole bucket.
  const many = Array.from({ length: 25 }, (_, i) => item({ id: `i-${i}` }));
  const h = clinicianHome({
    ctx, envelope: ready(meta(), queue(many)),
    view: emptyViewState("t-1"), showing: null, now: NOW, rowsPerBucket: 10,
  });
  assert.equal(h.items.length, 10, "paging did not apply");
  assert.equal(h.totalItems, 25, "the total was capped to the page");
  assert.equal(h.counts.needs_attention, 25, "the header count was capped");
});

test("the shell reads no database and re-bands nothing", () => {
  // "Authorization and queue authority unchanged" — the shell reshapes an
  // envelope it was handed. Both branches of the Today page read the same one.
  const src = code(read("src/lib/experience/clinician-home.ts"));
  for (const token of ["getDb", "repo(", "SELECT", "activePolicy", "buildCaseload"]) {
    assert.ok(!src.includes(token), `the home projection reaches for ${token}`);
  }
  const page = code(read("src/app/clinician/today/page.tsx"));
  const projections = [...page.matchAll(/clinicianQueueProjection\(/g)];
  assert.equal(
    projections.length, 1,
    "the page computes the queue more than once; the two branches must share one projection"
  );
});

// ---------------------------------------------------------------------------
// Failure states
// ---------------------------------------------------------------------------

test("a failed projection is not an empty day", () => {
  // §30.8's whole reason for existing, carried into the new home. Empty is
  // good news; failed is a clinician working blind while believing they are up
  // to date.
  const failed = clinicianHome({
    ctx, envelope: projectionFailed(meta(), "corr-1"),
    view: emptyViewState("t-1"), showing: null, now: NOW, rowsPerBucket: 10,
  });
  assert.equal(failed.envelopeState, "projection_failed");
  assert.equal(failed.items.length, 0);
  assert.ok(failed.primaryAbsentNote, "a failed projection produced no explanation");
  assert.ok(
    !/nothing needs action|clear|all done/i.test(failed.primaryAbsentNote!),
    `a failure read as good news: ${failed.primaryAbsentNote}`
  );
  assert.equal(failed.correlationId, "corr-1");

  const emptyDay = clinicianHome({
    ctx, envelope: empty(meta(), "Nothing needs action under the current policy."),
    view: emptyViewState("t-1"), showing: null, now: NOW, rowsPerBucket: 10,
  });
  assert.equal(emptyDay.envelopeState, "empty");
  assert.match(emptyDay.primaryAbsentNote!, /not about how anybody is doing/);
});

test("partial coverage is reported before the rows, and never as complete", () => {
  // §5: "Coverage failure is visible, not silent... Partial coverage must never
  // render as full coverage."
  const h = home([item()], {
    coverage: {
      providersRan: ["a"],
      providersFailed: [{ providerId: "recovery-trajectory-provider", reason: "TimeoutError" }],
      truncated: false,
    },
  });
  assert.equal(h.coverage.complete, false);
  assert.equal(h.coverage.failed[0].source, "recovery-trajectory-provider");

  // Before the rows, in the markup. A notice below eight rows is one a
  // clinician reads after deciding the list is complete.
  const view = read("src/components/experience/ClinicianHomeView.tsx");
  const coverageAt = view.indexOf('data-testid="coverage-notice"');
  const rowsAt = view.indexOf("home.items.map");
  assert.ok(coverageAt > 0 && rowsAt > 0, "the view no longer has both");
  assert.ok(coverageAt < rowsAt, "the coverage notice renders after the rows");
});

// ---------------------------------------------------------------------------
// §1.4's panel
// ---------------------------------------------------------------------------

test("the evidence panel is non-modal and does not trap focus", () => {
  // §1.4's ruling, and the reason: a trapped panel makes the reader close it to
  // see the list, so a comparison becomes a recollection.
  const panel = code(read("src/components/experience/QueueEvidencePanel.tsx"));
  assert.match(panel, /focusBehaviour\(mode\)/, "the panel does not derive its focus behaviour from its mode");
  assert.ok(
    !/trapFocus:\s*(true|\{)/.test(panel),
    "the panel sets trapFocus itself instead of deriving it"
  );
  assert.match(panel, /mode = "nonmodal"/, "the panel does not default to non-modal");
  assert.match(panel, /assertPanel\(/, "the panel is not checked against its contract");
});

test("the panel keeps identity and the action target on screen", () => {
  // §5: "Keep identity and the action target visible while reading evidence or
  // entering a decision."
  const panel = read("src/components/experience/QueueEvidencePanel.tsx");
  assert.match(panel, /row\.personName/, "the panel does not show whose evidence this is");
  assert.match(panel, /subjectLabel: row\.personName/, "the contract is not given the subject");
});

// ---------------------------------------------------------------------------
// §1.1 and §5's navigation
// ---------------------------------------------------------------------------

test("no clinician navigation promotes a capability this build lacks", () => {
  // §1.1, now true of BOTH shells. Four entries left CONSOLE_SCREENS and one
  // left the rail in this package.
  for (const s of CONSOLE_SCREENS) {
    const entry = routeEntry(s.href);
    assert.ok(entry, `${s.href} is not in the route register`);
    assert.notEqual(
      entry!.state, "unavailable",
      `the clinician layer nav promotes ${s.href}, which is a dead end`
    );
  }
  for (const d of navigationFor(ctx).core) {
    assert.notEqual(routeEntry(d.href)?.state, "unavailable");
  }
});

test("the person record is §5's five sections, not a wrapping row", () => {
  // §5: "Person sections should group around Overview, Course, Sessions, Notes,
  // and Safety... Avoid a long second horizontal menu that wraps into several
  // rows." Building handoffs 04 and 05 took the Progress row to five tabs,
  // which is the row this fixes.
  const shell = code(read("src/components/clinical/PersonShell.tsx"));
  const list = shell.slice(shell.indexOf("const SCREENS"), shell.indexOf("export const COURSE_SECTIONS"));
  const progress = [...list.matchAll(/slug: "([^"]*)", label: "[^"]*", layer: "progress"/g)].map((m) => m[1]);
  assert.ok(
    progress.length <= 2,
    `the Progress layer has ${progress.length} tabs (${progress.join(", ")}); §5 rules out a wrapping second menu`
  );
  assert.ok(progress.includes("/course"), "Course is not in the Progress layer");
});

test("every screen Course absorbed is still reachable and still resolves its layer", () => {
  // NOTHING WAS REMOVED. Each of the four still has its address, and
  // `layerFor` still puts a deep link in the right layer — a route the shell
  // does not know renders with the wrong rail item selected.
  const coursePage = read("src/app/clinician/member/[id]/course/page.tsx");
  for (const slug of COURSE_SECTIONS) {
    assert.ok(
      fs.existsSync(path.join(root, `src/app/clinician/member/[id]${slug}/page.tsx`)),
      `${slug} no longer exists`
    );
    assert.ok(coursePage.includes(`"${slug}"`), `Course does not link to ${slug}`);
    assert.equal(layerFor(slug), "progress", `${slug} resolves to the wrong layer`);
  }
  // And each link says what the reader will find, which is what the extra room
  // was for.
  const notes = [...coursePage.matchAll(/note:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(notes.length, COURSE_SECTIONS.length, "a Course section has no description");
  for (const n of notes) assert.ok(n.length > 30, `a thin description: "${n}"`);
});

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

test("the shell is behind a role flag, and the old page is what runs with it off", () => {
  // §10.1: "Keep new work behind role-level flags and prove the current
  // experience is unchanged with each flag off."
  assert.equal(ALL_EXPERIENCE_FLAGS.length, 4, "the four role shells are not all declared");
  assert.ok(EXPERIENCE_FLAGS.EXPERIENCE_CLINICIAN_SHELL);

  const page = code(read("src/app/clinician/today/page.tsx"));
  assert.match(page, /if \(clinicianShellEnabled\(\)\)/, "the page does not branch on the flag");
  // The branch returns, so everything after it is the untouched old page.
  const branchAt = page.indexOf("if (clinicianShellEnabled())");
  const oldShellAt = page.indexOf("<ClinicianPage");
  assert.ok(branchAt < oldShellAt, "the old shell renders before the flag is read");
});

test("an explicit environment variable can turn the shell off in a demo", () => {
  // How a person checks §10.1's promise rather than trusting a test.
  const before = process.env.EMDR_EXPERIENCE_CLINICIAN_SHELL;
  const demo = process.env.EMDR_DEMO;
  try {
    process.env.EMDR_DEMO = "1";
    delete process.env.EMDR_EXPERIENCE_CLINICIAN_SHELL;
    assert.equal(clinicianShellEnabled(), true, "the shell is not on by default in a demo");
    process.env.EMDR_EXPERIENCE_CLINICIAN_SHELL = "0";
    assert.equal(clinicianShellEnabled(), false, "the shell cannot be turned off");
    // And the unbuilt shells are off even in a demo.
    assert.equal(experienceFlagEnabled("EXPERIENCE_MEMBER_SHELL"), false);
  } finally {
    if (before === undefined) delete process.env.EMDR_EXPERIENCE_CLINICIAN_SHELL;
    else process.env.EMDR_EXPERIENCE_CLINICIAN_SHELL = before;
    if (demo === undefined) delete process.env.EMDR_DEMO;
    else process.env.EMDR_DEMO = demo;
  }
});

// ---------------------------------------------------------------------------
// Ten-second orientation
// ---------------------------------------------------------------------------

test("the home names the question it answers and one strongest action", () => {
  // §5's operating question and §8.2's "one strongest action". Package 2's
  // "ten-second orientation" pass is about whether a clinician can say what
  // this screen is for and what to do next.
  const h = home([item({ personName: "Ada", action: "review" })]);
  assert.match(h.asking.question, /queue/i);
  assert.ok(h.asking.orienting.length > 0);
  assert.ok(h.primary, "there is no strongest action");
  assert.match(h.primary!.label, /Ada/, "the strongest action does not say who it is about");
  assert.match(h.primary!.label, /Complete review/, "the strongest action is not the queue's own ask");
  // It is the FIRST row's, because the queue is already in the domain's order.
  assert.equal(h.primary!.href, "/clinician/member/p-1");
});

test("a home whose first row is not actionable says so rather than inventing one", () => {
  const h = home([item({ actionable: false, blockedReason: "Not your caseload." })]);
  assert.equal(h.primary, null);
  assert.match(h.primaryAbsentNote!, /Not your caseload|no single strongest action/);
});
