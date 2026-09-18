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
import { measuredSentence } from "../src/lib/buyer/payer-answers";
import { reviewerAnswers, standingGates } from "../src/lib/buyer/reviewer-answers";
import type { GateRow } from "../src/lib/review/release-readiness";

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


// ---------------------------------------------------------------------------
// The payer console
// ---------------------------------------------------------------------------

test("the payer overview asks its four questions above the charts", () => {
  const page = code(read("src/app/payer/overview/page.tsx"));
  assert.match(page, /<OpeningQuestions/);
  assert.ok(page.indexOf("<OpeningQuestions") < page.indexOf("<EnvelopeView"),
    "the charts come before the questions they answer");
  assert.match(page, /payerAnswers\(tenantId\)/);
});

test("the payer answers read projections rather than querying", () => {
  const answers = code(read("src/lib/buyer/payer-answers.ts"));
  assert.doesNotMatch(answers, /SELECT |longitudinal_events|await data\(\)/,
    "the answers query the database instead of reading the projection");
});

test("a payer answer names a fall between two stages, not at one", () => {
  // Naming only the stage produced "68% of the cohort started care, and the
  // largest fall is at started care" — a sentence reporting a loss at the stage
  // it has just counted, which reads as a contradiction.
  const answers = code(read("src/lib/buyer/payer-answers.ts"));
  assert.match(answers, /most are lost between \$\{fell\.from\.toLowerCase\(\)\} and/);
  assert.doesNotMatch(answers, /the largest fall is at/);
});

test("no buyer answer prints a database key at a buyer", () => {
  // The measures denominator read "5 measures named in contract
  // 918be3ea-d3cc-…" — a row id in front of a plan executive, which is the
  // buyer-side version of the policy version the member's Today was showing.
  const answers = code(read("src/lib/buyer/payer-answers.ts"));
  assert.doesNotMatch(answers, /\$\{r\.contract\.id\}/,
    "a contract row id is interpolated into something a buyer reads");
  assert.match(answers, /\$\{r\.contract\.name\}/);
});

test("the payer's four questions are ordered as they depend on each other", () => {
  // Eligibility fixes the denominator, participation is counted against it,
  // measurement says which contract terms could be computed at all, and
  // maturity says whether any of it should be quoted yet. A console answering
  // the fourth first tells somebody how complete a picture is before showing
  // them the picture.
  assert.deepEqual(questionsFor("payer").map((q) => q.id), [
    "payer.eligible", "payer.participated", "payer.measured", "payer.evidence-maturity",
  ]);
});


test("a withheld contract measure is named, not counted and dropped", () => {
  // "3 of 5 computed" tells a plan executive that two are missing and nothing
  // about which two, and a measure with no number and no name reads as one
  // nobody cared about.
  const said = measuredSentence([
    { label: "ED visits per 1,000", observed: 41 },
    { label: "Follow-up within 30 days", observed: null },
    { label: "Median time to care", observed: null },
  ]);
  assert.match(said, /1 of 3 contract measures/);
  assert.match(said, /Follow-up within 30 days/);
  assert.match(said, /Median time to care/);
});

test("a complete contract says none is withheld rather than saying nothing", () => {
  const said = measuredSentence([{ label: "ED visits per 1,000", observed: 41 }]);
  assert.match(said, /None is withheld/);
});


// ---------------------------------------------------------------------------
// The reviewer console
// ---------------------------------------------------------------------------

const gate = (over: Partial<GateRow> = {}): GateRow => ({
  gateId: "g1", name: "A gate", status: "pass", evidenceClass: "measured",
  inForce: { decision: "approved" } as GateRow["inForce"], superseded: null,
  ...over,
});

test("the reviewer's questions are blockers, decisions, then what passed", () => {
  // "Blockers and requested decisions before passed evidence." The landing had
  // this exactly backwards: thirteen screens to go and look at, with the queue
  // of things waiting on a decision underneath.
  assert.deepEqual(questionsFor("reviewer").map((q) => q.id), [
    "reviewer.blocks", "reviewer.decide", "reviewer.passed",
  ]);
});

test("a gate cleared by attestation counts as clear", () => {
  // THE LOAD-BEARING ONE. Three of the eight gates are attestations by nature —
  // their evidence comes back `unavailable` because there is nothing for a
  // machine to check. Counting only "pass AND approved" reported "1 of 8
  // passed" while more stood on a signature, which describes the evidence
  // plumbing rather than the release.
  const gates = [
    gate({ gateId: "machine", status: "pass" }),
    gate({ gateId: "attested", status: "unavailable" }),
  ];
  const s = standingGates(gates);
  assert.equal(s.clear.length, 2);
  assert.equal(s.byMachine.length, 1);
  assert.equal(s.byAttestation.length, 1);
});

test("blocking and clear account for every gate between them", () => {
  const gates = [
    gate({ gateId: "a", status: "pass" }),
    gate({ gateId: "b", status: "unavailable" }),
    gate({ gateId: "c", status: "fail" }),
    gate({ gateId: "d", inForce: null }),
    gate({ gateId: "e", inForce: null, superseded: { decision: "approved" } as GateRow["superseded"] }),
  ];
  const [blocks] = reviewerAnswers({
    gates, accessRequestsOpen: 0, copyUnapproved: { n: 0, of: 6 }, copyVersion: "v1",
  });
  const clear = standingGates(gates).clear.length;
  const blocking = Number(blocks.figure!.split(" / ")[0]);
  assert.equal(blocking + clear, gates.length,
    "some gate is neither blocking nor clear, so the console's arithmetic does not close");
});

test("what passed names the version it passed under", () => {
  // "What passed" without "under which version" is the sentence that lets a
  // stale attestation travel.
  const [, , passed] = reviewerAnswers({
    gates: [gate()], accessRequestsOpen: 0, copyUnapproved: { n: 0, of: 6 }, copyVersion: "v1",
  });
  assert.match(passed.answer, /at commit [0-9a-f]{7,}/);
  assert.match(passed.window, /Commit [0-9a-f]{7,}/);
  assert.match(passed.answer, /attestation alone/);
});

test("a blocker answer names the kinds, not only the count", () => {
  // "Evidence is failing" and "nobody has decided" both stop a release and need
  // entirely different people.
  const [blocks] = reviewerAnswers({
    gates: [gate({ gateId: "a", status: "fail" }), gate({ gateId: "b", inForce: null })],
    accessRequestsOpen: 0, copyUnapproved: { n: 0, of: 6 }, copyVersion: "v1",
  });
  assert.match(blocks.answer, /evidence is failing/i);
  assert.match(blocks.answer, /nobody has decided/i);
});

test("a clear release says so rather than reporting zero blockers", () => {
  const [blocks] = reviewerAnswers({
    gates: [gate()], accessRequestsOpen: 0, copyUnapproved: { n: 0, of: 6 }, copyVersion: "v1",
  });
  assert.match(blocks.answer, /No gate is blocking/);
});

test("the reviewer landing asks before it lists screens", () => {
  const page = code(read("src/app/review/page.tsx"));
  assert.ok(page.indexOf("<OpeningQuestions") < page.indexOf('<Panel title="Available now">'),
    "the catalogue of screens still comes before the blockers");
  assert.match(page, /resolvedGates\(\)/,
    "the landing cannot answer what blocks release");
});

test("one loader serves the landing and the release screen", () => {
  // Two copies of the resolution would be two answers to one question, which on
  // a release console is the failure the console exists to prevent.
  for (const f of ["src/app/review/page.tsx", "src/app/review/release/page.tsx"]) {
    assert.match(code(read(f)), /resolvedGates\(/, `${f} does not use the shared loader`);
  }
  assert.doesNotMatch(code(read("src/app/review/release/page.tsx")), /decisionHistory\(/,
    "the release page still resolves decisions itself");
});
