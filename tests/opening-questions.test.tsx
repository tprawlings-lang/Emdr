import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OPENING_QUESTIONS, questionsFor, assertTraceable, unanswered,
  OpeningQuestionError, type TracedAnswer,
} from "../src/lib/buyer/opening-questions";
import { OpeningQuestions } from "../src/components/app/OpeningQuestions";

// Decision-led buyer views (17 September handoff, P5).
//
//   "These pages should begin with decisions and work, not a collection of
//   charts." Acceptance: "users can answer each opening question and trace
//   figures to denominator, window, missingness, and definition."
//
// The consoles were not wrong — they were unasked. The organization overview
// already carried a denominator on every figure and a funnel with its largest
// drop marked. What it did not do was say what the reader came to find out:
// three questions bring somebody to that screen, and answering them meant
// reading three charts on three tabs and doing the joining yourself.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const answer = (over: Partial<TracedAnswer> = {}): TracedAnswer => ({
  questionId: "org.access-delayed", question: "Where is access delayed?",
  answer: "Most people are lost between contact attempted and contacted.",
  figure: "19% (932 / 4,820)",
  denominator: "4,820 referrals received.",
  window: "The whole record.",
  missingness: "People referred outside this organization are not counted.",
  definition: "Distinct people, not events.",
  evidenceHref: "/organization/access", evidenceLabel: "Open the access pathway",
  ...over,
});

// ---------------------------------------------------------------------------
// The questions the handoff names
// ---------------------------------------------------------------------------

test("each audience opens with the questions the handoff gives it", () => {
  assert.deepEqual(questionsFor("organization").map((q) => q.question), [
    "Where is access delayed?",
    "Where is work accumulating?",
    "Are delivery and safety policies being followed?",
  ]);
  assert.deepEqual(questionsFor("payer").map((q) => q.question), [
    "Who was eligible?",
    "Who participated?",
    "What was measured?",
    "How mature and complete is the evidence?",
  ]);
});

test("the questions are the reader's words, not metric names", () => {
  // "Median days referral to first contact" is what we happen to have counted.
  // A console that leads with it makes the reader do the translation.
  for (const q of OPENING_QUESTIONS) {
    assert.match(q.question, /\?$/, `${q.id} is not a question`);
    assert.doesNotMatch(q.question, /rate|median|per 1,000|coverage %/i,
      `${q.id} is a metric name wearing a question mark`);
  }
});

// ---------------------------------------------------------------------------
// The acceptance criterion, enforced
// ---------------------------------------------------------------------------

test("an answer that cannot be traced to all four does not render", () => {
  // THE LOAD-BEARING ONE. A confident sentence over a number nobody can take
  // apart is the spreadsheet these pages replaced.
  for (const k of ["denominator", "window", "missingness", "definition"] as const) {
    assert.throws(
      () => assertTraceable(answer({ [k]: "  " })),
      (e: Error) => e instanceof OpeningQuestionError && e.message.includes(k),
      `an answer with no ${k} was accepted`,
    );
  }
});

test("a question with no answer is refused too", () => {
  assert.throws(() => assertTraceable(answer({ answer: "" })), OpeningQuestionError);
});

test("a traceable answer passes through unchanged", () => {
  const a = answer();
  assert.equal(assertTraceable(a), a);
});

// ---------------------------------------------------------------------------
// Not being able to answer is an answer
// ---------------------------------------------------------------------------

test("an unanswerable question keeps its place and says why", () => {
  // A console that drops a question it cannot answer today looks, to somebody
  // comparing two screenshots, like a console that was never asked it.
  const u = unanswered(questionsFor("organization")[1], {
    because: "No slot record exists, so supply cannot be counted.",
    evidenceHref: "/organization/capacity", evidenceLabel: "Open demand and capacity",
  });
  assert.equal(u.questionId, "org.work-accumulating");
  assert.equal(u.figure, null);
  assert.match(u.answer, /Not answered here/);
  assert.match(u.missingness, /No slot record exists/);
  // And it is still traceable, so it renders through the same path.
  assert.doesNotThrow(() => assertTraceable(u));
});

// ---------------------------------------------------------------------------
// On the screen
// ---------------------------------------------------------------------------

test("the four traces are on the screen, behind one disclosure", () => {
  const html = renderToStaticMarkup(
    <OpeningQuestions heading="What this console is for" answers={[answer()]} />
  );
  for (const trace of ["denominator", "window", "missingness", "definition"]) {
    assert.match(html, new RegExp(`data-trace="${trace}"`), `${trace} is not rendered`);
  }
  // One disclosure, not four competing with the answer.
  assert.equal((html.match(/<details/g) ?? []).length, 1);
  const t = text(html);
  assert.match(t, /Where is access delayed\?/);
  assert.match(t, /19% \(932 \/ 4,820\)/);
});

test("a figure is written with its denominator, never bare", () => {
  const html = renderToStaticMarkup(
    <OpeningQuestions heading="x" answers={[answer({ figure: "19% (932 / 4,820)" })]} />
  );
  assert.match(html, /data-testid="opening-figure"/);
  assert.match(text(html), /932 \/ 4,820/);
});

test("an unanswered question renders without a figure", () => {
  const u = unanswered(questionsFor("organization")[1], {
    because: "x", evidenceHref: "/y", evidenceLabel: "z",
  });
  const html = renderToStaticMarkup(<OpeningQuestions heading="x" answers={[u]} />);
  assert.doesNotMatch(html, /data-testid="opening-figure"/,
    "a question nobody could answer still shows a number");
});

// ---------------------------------------------------------------------------
// The organization console
// ---------------------------------------------------------------------------

test("the organization overview asks its questions above the charts", () => {
  const page = code(read("src/app/organization/overview/page.tsx"));
  assert.match(page, /<OpeningQuestions/);
  assert.ok(page.indexOf("<OpeningQuestions") < page.indexOf("<EnvelopeView"),
    "the charts come before the questions they answer");
});

test("an answer that cannot be given takes its reason from the projection", () => {
  // The first version said "no site has enough waiting people to report a
  // demand figure without identifying them" — a plausible sentence about
  // small-cell suppression, and wrong. The projection returns `partial` with
  // demand for four sites and no supply: the scheduling system has no slot
  // record. A console that invents why it cannot answer is worse than one that
  // does not answer, because the invented reason is what a reader acts on.
  const answers = code(read("src/lib/buyer/organization-answers.ts"));
  assert.match(answers, /envelope\?\.missing\?\.map/,
    "the reason a question cannot be answered is not read from the envelope");
  assert.doesNotMatch(answers, /enough waiting people to report a demand figure/,
    "the invented small-cell reason is back");
});

test("no answer computes a number of its own", () => {
  // Every figure is read off a projection the charts below are drawn from, so
  // the summary and the chart cannot disagree — which is the failure mode of a
  // summary written beside the thing it summarises.
  const answers = code(read("src/lib/buyer/organization-answers.ts"));
  assert.doesNotMatch(answers, /SELECT |longitudinal_events|await data\(\)/,
    "the answers query the database instead of reading the projection");
});
