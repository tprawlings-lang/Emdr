process.env.EMDR_DATA_DIR = `/tmp/steady-decisions-${process.pid}-${Date.now()}`;

// Handoff 09 §11's four open decisions, as they were answered (2026-09-09).
//
// §11 is the table the handoff refuses to answer for itself. Four were still
// outstanding after Package 7, and each was put to the product owner rather
// than guessed at. These guards hold the ANSWERS, which is a different job from
// holding a feature: the risk with a decision is not that the code breaks, it
// is that the code quietly stops implementing what was decided while the
// decision text sits there still claiming otherwise.
//
// So each guard below pairs the recorded answer with the behaviour it produced,
// and fails if either half moves without the other.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  SECTION_11_DECISIONS, stillOpen, properlyRecorded,
} from "../src/lib/experience/open-decisions";
import {
  HORIZON_REVIEW, THERAPEUTIC_LOAD_REVIEW, AWAITING_CLINICAL_REVIEW,
  mayShowToMember, mayEnterTaskQueue, reviewRecorded,
} from "../src/lib/clinical/clinical-review-gate";
import {
  REOPENS_KINDS, REOPENS_COPY, DAY_STATE_MESSAGE, reopensLine, memberDayView,
} from "../src/lib/experience/member-day";
import {
  COMPANION_LIMITS, COMPANION_ENTRY_MESSAGE, COMPANION_ENTRY_COPY,
  meetsEntryCondition, COMPANION_IS_NOT_A_SESSION_STEP,
} from "../src/lib/experience/companion-entry";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// The record itself
// ---------------------------------------------------------------------------

test("every §11 decision carries a date and a place it lives", () => {
  // A decision with no date is a preference somebody stated; a decision with no
  // location is a claim that nothing implements. Both are how a list like this
  // rots into documentation.
  assert.equal(SECTION_11_DECISIONS.length, 4);
  for (const d of SECTION_11_DECISIONS) {
    assert.ok(properlyRecorded(d), `${d.id} is recorded as decided without a date, an answer or a place`);
  }
  assert.deepEqual(stillOpen().map((d) => d.id), []);
});

// ---------------------------------------------------------------------------
// Horizon indicator — held behind the review
// ---------------------------------------------------------------------------

test("the horizon does not render to a member before its clinical review", () => {
  // §11: "Take it to moderated clinical review. Remove it if it reads as a
  // covert score." Both halves are asserted — the mechanism AND its current
  // state — because a guard that only checked the mechanism would pass on the
  // day somebody flips the constant without a review.
  assert.equal(HORIZON_REVIEW.reviewed, false);
  assert.equal(mayShowToMember(HORIZON_REVIEW), false);

  const canvas = code("components/member/DayCanvas.tsx");
  assert.match(
    canvas,
    /if \(!mayShowToMember\(HORIZON_REVIEW\)\) return null;/,
    "the horizon renders without consulting its review"
  );
});

test("a review with no author does not release the horizon", () => {
  assert.equal(mayShowToMember({ ...HORIZON_REVIEW, reviewed: true }), false);
  assert.equal(
    mayShowToMember({ ...HORIZON_REVIEW, reviewed: true, authority: "Dr X", evidence: "docs/…" }),
    true
  );
});

test("the member gate and the queue gate stay two questions", () => {
  // They ask the same thing today and will not stay that way: one asks whether
  // a reading may be handed to a clinician as work, the other whether an
  // indicator may be shown to the person it is about. Collapsing them to one
  // predicate is how clearing one silently clears the other.
  const gate = code("lib/clinical/clinical-review-gate.ts");
  assert.match(gate, /export function mayShowToMember/);
  assert.match(gate, /export function mayEnterTaskQueue/);
  assert.match(gate, /export function reviewRecorded/);
  // And both are still held today.
  assert.equal(mayEnterTaskQueue(THERAPEUTIC_LOAD_REVIEW), false);
  assert.equal(reviewRecorded(HORIZON_REVIEW), false);
});

test("both held features are named on a surface, not only in code", () => {
  assert.equal(AWAITING_CLINICAL_REVIEW.length, 2);
  const ids = AWAITING_CLINICAL_REVIEW.map((f) => f.feature);
  assert.ok(ids.includes("Horizon indicator"), "the horizon hold is not reported anywhere");
  for (const f of AWAITING_CLINICAL_REVIEW) {
    assert.ok(f.review.withholds.trim().length > 0, `${f.feature} does not say what it withholds`);
  }
});

// ---------------------------------------------------------------------------
// Paused-state retention — when it lifts, and what happens then
// ---------------------------------------------------------------------------

test("a paused day says when it lifts; no other day claims a hold", () => {
  // The sentence is the answer to "when does this lift". Rendering it on a day
  // that is not paused describes a hold that is not happening — which is the
  // same class of error as the hold saying nothing at all.
  const paused = reopensLine("paused", { kind: "person" });
  assert.ok(paused);
  assert.equal(paused.kind, "person");
  assert.ok(paused.sentence.length > 0);

  for (const state of ["open", "narrow", "stabilizing", "crisis", "interrupted", "service_unavailable"] as const) {
    assert.equal(reopensLine(state, { kind: "person" }), null, `${state} claims something reopens`);
  }
});

test("an unsupplied reopening is said to be unknown, never guessed", () => {
  // §8.4: "Steady could not load this view" and "there is nothing here" are
  // different states. A missing answer that renders as the reassuring one is
  // the product inventing a promise.
  const missing = reopensLine("paused", null);
  assert.ok(missing);
  assert.equal(missing.kind, "unknown");
  assert.equal(missing.at, null);
});

test("only the timed branch carries a time", () => {
  const timed = reopensLine("paused", { kind: "at", at: "2026-10-01T09:00:00.000Z" });
  assert.ok(timed);
  assert.equal(timed.at, "2026-10-01T09:00:00.000Z");
  assert.equal(reopensLine("paused", { kind: "person" })?.at, null);
  assert.equal(reopensLine("paused", { kind: "unknown" })?.at, null);
});

test("no reopening sentence names why the day is paused", () => {
  // The day model reads the gate's reasons to pick a shape and discards them so
  // that no surface can render one (§2: narrowing must never read as "you
  // failed the check"). This sentence is new text on that screen and is the
  // obvious place for a reason to reappear.
  const forbidden = /score|band|track|severity|readiness|percent|risk|criteri|threshold|because you|your result/i;
  for (const kind of REOPENS_KINDS) {
    const sentence = DAY_STATE_MESSAGE[REOPENS_COPY[kind]];
    assert.ok(sentence && sentence.trim().length > 0, `${kind} has no sentence`);
    assert.ok(!forbidden.test(sentence), `the ${kind} sentence leaks a reason: ${sentence}`);
  }
});

test("the reopening line survives the member projection assertion", async () => {
  // The field is new on a projection that refuses anything not on its
  // allow-list, so this fails loudly if the allow-list and the view disagree.
  const view = memberDayView({
    day: null,
    reopens: { kind: "person" },
    now: "2026-09-09T10:00:00.000Z",
  });
  assert.ok("reopens" in view);
});

test("the reopening line reaches the screen", () => {
  const surface = code("components/experience/MemberTodayView.tsx");
  assert.match(surface, /day\.reopens/, "the view carries the answer and the screen drops it");
  assert.match(surface, /data-testid="reopens"/);
});

// ---------------------------------------------------------------------------
// AI companion placement — kept, under §11's stated condition
// ---------------------------------------------------------------------------

test("the companion says it is AI, in those words", () => {
  // §11's interim condition is specific: "entry states it is AI". The line this
  // replaced said "supportive software", which is true of a spreadsheet and
  // tells nobody that the replies are generated.
  const isAi = COMPANION_ENTRY_MESSAGE[COMPANION_ENTRY_COPY.isAi];
  assert.match(isAi, /\bAI\b/);
  assert.match(isAi, /not written by a person|nobody reads/i);
});

test("the companion names its communication limits, and each is a thing that will not happen", () => {
  // "Names its communication limits" is not "carries a disclaimer". A
  // disclaimer protects the product; this tells somebody what typing here will
  // and will not do.
  assert.ok(COMPANION_LIMITS.length >= 4);
  for (const l of COMPANION_LIMITS) {
    assert.ok(l.text.trim().length > 0, `${l.id} is empty`);
    assert.ok(
      /\bnot\b|\bnobody\b|\bcannot\b|\bdoes not\b/i.test(l.text),
      `${l.id} does not name a limit: ${l.text}`
    );
  }
  const ids = COMPANION_LIMITS.map((l) => l.id);
  assert.ok(ids.includes("not_monitored"), "the companion does not say nobody is watching");
  assert.ok(ids.includes("not_emergency"), "the companion does not say it cannot help in an emergency");
});

test("the disclosure is at entry, above the conversation, at every entry", () => {
  // THE PLACEMENT IS THE REQUIREMENT. The previous version of this text existed,
  // was accurate, and sat below the message thread — read, if at all, by
  // somebody who had already typed. §11 says entry.
  for (const rel of ["app/app/companion/page.tsx", "app/app/onboarding/profile/page.tsx"]) {
    const src = code(rel);
    const notice = src.indexOf("<CompanionEntryNotice />");
    const chat = src.indexOf("<CompanionChat");
    assert.ok(notice > 0, `${rel} does not show the entry disclosure`);
    assert.ok(chat > 0, `${rel} no longer mounts the companion; this guard is checking the wrong file`);
    assert.ok(notice < chat, `${rel} shows the disclosure after the conversation`);
  }
});

test("the entry condition is a predicate, so moving the notice fails rather than passes", () => {
  assert.equal(
    meetsEntryCondition({ beforeFirstExchange: true, statesItIsAi: true, namesLimits: COMPANION_LIMITS.length }),
    true
  );
  assert.equal(
    meetsEntryCondition({ beforeFirstExchange: false, statesItIsAi: true, namesLimits: COMPANION_LIMITS.length }),
    false,
    "a disclosure below the thread still satisfies the condition"
  );
  assert.equal(
    meetsEntryCondition({ beforeFirstExchange: true, statesItIsAi: false, namesLimits: COMPANION_LIMITS.length }),
    false
  );
  assert.equal(
    meetsEntryCondition({ beforeFirstExchange: true, statesItIsAi: true, namesLimits: 1 }),
    false
  );
});

test("the companion is not a step inside a session", () => {
  // The one thing §11 actually asserts about its position: it does not appear
  // in the Vol 2 session state machine. Choosing where it DOES belong is the
  // founder decision §11 reserves; this is the negative that follows.
  assert.equal(COMPANION_IS_NOT_A_SESSION_STEP, true);
  const shell = code("components/experience/ActivityShell.tsx");
  assert.ok(
    !/companion/i.test(shell),
    "the activity shell reaches the companion, which places it inside a session"
  );
});

// ---------------------------------------------------------------------------
// Referral export — decided, and still not built
// ---------------------------------------------------------------------------

test("the referral export is built as passive compilation, and points at where", () => {
  // This guard used to assert the entry said "Not built", which was true and
  // was the whole point: handoff 09 forbade building it until the question was
  // answered, and an entry claiming a decision while an unbuilt feature quietly
  // appeared would have been worse than either alone.
  //
  // It is built now, so the guard asserts the thing that replaced that: the
  // decision names where it lives, and the files it names exist. A `where` that
  // still said "not built" would now be the stale half of the same failure.
  const d = SECTION_11_DECISIONS.find((x) => x.id === "referral_export_assembly");
  assert.ok(d);
  assert.equal(d.state, "decided");
  assert.match(d.answer, /[Pp]assive compilation/);
  assert.ok(!/Not built/.test(d.where), "the entry still claims it is unbuilt");
  for (const file of d.where.match(/src\/[\w/.-]+\.tsx?/g) ?? []) {
    assert.ok(fs.existsSync(path.join(process.cwd(), file)), `${d.id} names ${file}, which does not exist`);
  }
  // And the condition the decision attached to compiling without asking: the
  // member reads it.
  assert.match(d.answer, /member reads/i, "the decision no longer states its own condition");
  assert.match(d.where, /\/app\/settings\/referral/, "the member's own view of it is not named");
});

test("the decisions reach a surface", () => {
  // MATCHED ON THE RENDER, NOT THE IMPORT. The first version of this asserted
  // the name appeared in the file, which an import line satisfies on its own —
  // so a page that imported the decisions and rendered none of them passed.
  const status = code("app/review/status/page.tsx");
  assert.match(status, /SECTION_11_DECISIONS\.map\(/, "the decisions are imported but not rendered");
  assert.match(status, /stillOpen\(\)/);
});
