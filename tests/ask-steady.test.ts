process.env.EMDR_DATA_DIR = `/tmp/steady-ask-${process.pid}-${Date.now()}`;

// Ask Steady (Clinician Thoughts spec v2.1 §10, §12; Phase 5).
//
// Phase 5's definition of done is two lines — "no cross-patient or cross-tenant
// retrieval" and "every answer returns evidence" — and §12 adds the one that is
// hardest to keep:
//
//   "If evidence is insufficient or conflicting, SAY SO. DO NOT SMOOTH
//    CONFLICTING HISTORY INTO ONE ANSWER."
//
// SMOOTHING IS THE FAILURE MODE WORTH TESTING FOR, because it is what a fluent
// answer does by default. Given two records that disagree, the readable output
// is the one that reconciles them, and it is wrong in the specific way that
// matters: a clinician reading "sleep has been improving" cannot tell that half
// the sources said the opposite. So the conflict is found in code, over the
// retrieved set, before anything is composed — and an answer that has one is a
// different SHAPE rather than the same shape with a warning on it.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  rank, retrieve, dedupe, capPerSource, assertScope, ScopeViolation,
  lexicalMatch, structuredMatch, recencySignal, semanticWeightApplied,
  WEIGHTS, SOURCE_RELIABILITY, PER_SOURCE_CAP, MAX_EVIDENCE,
  RETRIEVAL_POLICY_VERSION, NO_SEMANTIC_SCORER,
  type RetrievalDoc, type SemanticScorer,
} from "../src/lib/clinical/ask-retrieval";
import {
  compose, validate, findConflicts, directionOf, outOfScope, mayPromoteToMemory,
  ASK_WRITES_NOTHING, ANSWER_KINDS, MIN_EVIDENCE, ASK_VERSION, NOT_YET_SEARCHED,
} from "../src/lib/clinical/ask-answer";
import { THOUGHTS_FLAGS, thoughtsFlagRequires } from "../src/lib/clinical/thoughts-flags";
import { getTask } from "../src/lib/ai-gateway/registry";
import "../src/lib/ai-gateway/registry";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const NOW = new Date("2026-09-09T12:00:00.000Z");
const SCOPE = { tenantId: "t-1", personId: "p-1" };

function doc(over: Partial<RetrievalDoc> & { id: string }): RetrievalDoc {
  return {
    personId: "p-1",
    tenantId: "t-1",
    type: "note",
    text: "",
    occurredAt: "2026-09-01T00:00:00.000Z",
    concepts: [],
    excluded: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Phase 5's first line of done: no cross-patient or cross-tenant retrieval
// ---------------------------------------------------------------------------

test("a candidate from another person stops the retrieval rather than being filtered", () => {
  // THROWING IS THE POINT. A filter would remove the record and leave the bug
  // that produced it in place for the next caller, who might not have a filter.
  // §12 puts scope before retrieval, so a scope failure is a defect upstream
  // and has to be loud.
  const docs = [doc({ id: "a" }), doc({ id: "b", personId: "p-2" })];
  assert.throws(() => assertScope(docs, SCOPE), ScopeViolation);
  assert.throws(() => rank({ query: "sleep", docs, scope: SCOPE, now: NOW }), ScopeViolation);
});

test("a candidate from another tenant stops the retrieval too", () => {
  const docs = [doc({ id: "a" }), doc({ id: "b", tenantId: "t-2" })];
  assert.throws(() => assertScope(docs, SCOPE), ScopeViolation);
});

test("the ranker cannot widen its own evidence set", () => {
  // There is no loader in the retrieval module: no database call, no person id
  // it could look anything up with. The authorized set arrives as an argument,
  // which is what makes "scope first" a property of the shape rather than of
  // the care taken at each call site.
  const src = code("lib/clinical/ask-retrieval.ts");
  for (const token of ["getDb", "better-sqlite3", "repo(", "SELECT", "await "]) {
    assert.ok(!src.includes(token), `the retrieval layer reaches for ${token}`);
  }
});

test("the action establishes scope before it reads anything", () => {
  // Read as source order rather than as behaviour because the alternative is a
  // test that needs a second tenant, two people and a seeded database to assert
  // something that is true of four lines.
  const src = code("lib/clinical/ask-actions.ts");
  // THE CALL, NOT THE DEFINITION. `indexOf("personInScope(")` finds the
  // `async function personInScope(` above it, which is always before every
  // read and made the order assertion vacuous.
  const scopeCheck = src.indexOf("await personInScope(");
  const firstRead = src.indexOf("await retrievalDocs(");
  assert.ok(scopeCheck > 0, "the scope check is not called");
  assert.ok(firstRead > 0, "the read moved; this guard is checking nothing");
  assert.ok(scopeCheck < firstRead, "records are read before the person is established as in scope");

  // AND ORDER IS NOT ENOUGH, which the first version of this guard proved:
  // with the condition replaced by `if (false)` the call still sat in the right
  // place and the order assertion still passed, while every question about
  // every person was answered. So the check has to be a REFUSAL — a negated
  // condition whose body returns before the read happens.
  assert.match(
    src.slice(Math.max(0, scopeCheck - 8), scopeCheck),
    /if \(!\($/,
    "the scope check's result is not what decides"
  );
  assert.match(
    src.slice(scopeCheck, firstRead),
    /\breturn\b/,
    "the scope check does not return before the read"
  );
});

test("an out-of-scope question does not say whether the person exists", () => {
  const a = outOfScope("anything", {
    askVersion: ASK_VERSION, retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION,
    semanticScoring: false, candidates: 0, evidenceCutoff: "2026-09-09",
  });
  assert.equal(a.kind, "out_of_scope");
  assert.equal(a.sources.length, 0);
  assert.ok(!/exists|not found|no such/i.test(a.summary), "the refusal discloses existence");
});

// ---------------------------------------------------------------------------
// Phase 5's second line of done: every answer returns evidence
// ---------------------------------------------------------------------------

test("a claim with no citation is withheld rather than shown", () => {
  const { kept, omitted } = validate(
    [{ text: "uncited", citations: [], sourceType: "note" }, { text: "cited", citations: ["a"], sourceType: "note" }],
    new Set(["a"])
  );
  assert.deepEqual(kept.map((c) => c.text), ["cited"]);
  assert.deepEqual(omitted, [{ text: "uncited", reason: "no citation" }]);
});

test("a claim citing outside the authorized set is withheld", () => {
  // The validator takes the permitted ids rather than deriving them, so a
  // caller cannot widen the evidence set by passing a different loader.
  const { kept, omitted } = validate([{ text: "x", citations: ["a", "z"], sourceType: "note" }], new Set(["a"]));
  assert.equal(kept.length, 0);
  assert.match(omitted[0].reason, /outside the authorized set/);
});

test("every claim in a composed answer cites a source that is in the source list", () => {
  const evidence = rank({
    query: "sleep",
    docs: [
      doc({ id: "n1", text: "Sleep has been better since we changed the evening routine." }),
      doc({ id: "n2", text: "Sleep still broken most nights." }),
    ],
    scope: SCOPE,
    now: NOW,
  });
  const a = compose({
    question: "how is sleep?", evidence, candidates: 2, semanticScoring: false,
    retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION, evidenceCutoff: "2026-09-09",
  });
  const ids = new Set(a.sources.map((s) => s.id));
  assert.ok(a.claims.length > 0);
  for (const c of a.claims) {
    assert.ok(c.citations.length > 0, "a claim reached the answer with no citation");
    for (const id of c.citations) assert.ok(ids.has(id), `${id} is cited and not in the source list`);
  }
});

test("one source is not enough to answer, and the answer says which kind of nothing it is", () => {
  // §8.4's distinction, in a different feature: "there is nothing here" and
  // "not enough to say" are different states, and only one of them is about the
  // person.
  const evidence = rank({ query: "sleep", docs: [doc({ id: "n1", text: "sleep" })], scope: SCOPE, now: NOW });
  const a = compose({
    question: "how is sleep?", evidence, candidates: 1, semanticScoring: false,
    retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION, evidenceCutoff: "2026-09-09",
  });
  assert.equal(a.kind, "insufficient");
  assert.equal(MIN_EVIDENCE, 2);
  assert.match(a.summary, /not a statement about the person|not enough/i);
  assert.equal(a.claims.length, 0);
});

test("an insufficient answer can name what was not searched", () => {
  // An answer reporting "not enough in the record" while never having looked at
  // half the record is making a claim about the person that is really a claim
  // about the search.
  assert.ok(NOT_YET_SEARCHED.length > 0);
  for (const s of NOT_YET_SEARCHED) {
    assert.ok(s.source.trim().length > 0 && s.why.trim().length > 0);
  }
  assert.match(code("components/clinical/AskSteady.tsx"), /NOT_YET_SEARCHED/);
});

// ---------------------------------------------------------------------------
// §12 — do not smooth conflicting history into one answer
// ---------------------------------------------------------------------------

test("two records that disagree on the same topic produce a conflicting answer", () => {
  const evidence = rank({
    query: "sleep",
    docs: [
      doc({ id: "n1", text: "Sleep has been better this fortnight.", concepts: ["sleep"] }),
      doc({ id: "n2", text: "Sleep is worse again, waking at three.", concepts: ["sleep"] }),
    ],
    scope: SCOPE,
    now: NOW,
  });
  const a = compose({
    question: "how has sleep been?", evidence, candidates: 2, semanticScoring: false,
    retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION, evidenceCutoff: "2026-09-09",
  });
  assert.equal(a.kind, "conflicting");
  assert.equal(a.conflicts.length, 1);
  assert.equal(a.conflicts[0].topic, "sleep");
  // BOTH SIDES ARE CARRIED. An answer that detected the conflict and then
  // showed one side would be the smoothing, one step later.
  assert.deepEqual(a.conflicts[0].sides.map((s) => s.citation).sort(), ["n1", "n2"]);
  assert.ok(!/overall|on balance|generally|improving/i.test(a.summary), "the summary reconciles the conflict");
});

test("disagreement about different topics is not a conflict", () => {
  // Two records pointing opposite ways about two different things is ordinary
  // clinical history. Calling it a conflict would make the signal useless.
  const conflicts = findConflicts(
    rank({
      query: "how are things",
      docs: [
        doc({ id: "n1", text: "Sleep is better.", concepts: ["sleep"] }),
        doc({ id: "n2", text: "Work is worse.", concepts: ["work"] }),
      ],
      scope: SCOPE, now: NOW,
    })
  );
  assert.deepEqual(conflicts, []);
});

test("direction is only claimed when the text points one way", () => {
  assert.equal(directionOf("sleep has been better"), "up");
  assert.equal(directionOf("sleep is worse"), "down");
  // Both directions in one record is not a direction — it is a record that
  // already contains the nuance, and asserting one would be the smoothing.
  assert.equal(directionOf("sleep is better but mornings are worse"), null);
  assert.equal(directionOf("we talked about her sister"), null);
});

test("the four answer shapes are distinguishable in the data, not only in prose", () => {
  // A reader — and the component — must be able to tell them apart without
  // parsing the summary.
  assert.deepEqual([...ANSWER_KINDS], ["answered", "insufficient", "conflicting", "out_of_scope"]);
  assert.match(code("components/clinical/AskSteady.tsx"), /data-answer-kind=\{answer\.kind\}/);
});

// ---------------------------------------------------------------------------
// §12 — read-only
// ---------------------------------------------------------------------------

test("an answer cannot become clinical memory", () => {
  // §12: "it does not write clinical memory from the answer itself."
  assert.equal(ASK_WRITES_NOTHING, true);
  const a = outOfScope("q", {
    askVersion: ASK_VERSION, retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION,
    semanticScoring: false, candidates: 0, evidenceCutoff: "x",
  });
  assert.equal(mayPromoteToMemory(a), false);
});

test("the action has no writer for clinical memory", () => {
  // Structural rather than intentional: there is no function in the action
  // module that could create a memory item, so there is no path from an answer
  // to one.
  const src = code("lib/clinical/ask-actions.ts");
  for (const writer of ["createCandidates", "approveItem", "saveThought", "supersedeItem", "addTranscript"]) {
    assert.ok(!src.includes(writer), `the ask action reaches ${writer}`);
  }
});

test("the recorded event carries evidence ids and never the question", () => {
  // A clinician's question about a patient is free clinical text, and a
  // question log is a second clinical record nobody reviews and retention
  // policy cannot reach.
  const src = code("lib/clinical/ask-actions.ts");
  // Sliced from the event type to the END of the appendEventSafe call, not to
  // the next `await audit(` — there is an earlier audit call in the scope
  // violation branch, so indexOf found a position BEFORE the event and the
  // slice was empty. An empty slice passes nothing and fails the first
  // assertion, which is how this was caught rather than a silent pass.
  const from = src.indexOf("clinician_patient_query.answered");
  assert.ok(from > 0, "the event is no longer emitted");
  const payload = src.slice(from, src.indexOf("});", from) + 3);
  assert.match(payload, /evidenceIds/);
  assert.ok(!/\bquestion\b|\btrimmed\b/.test(payload), "the event payload carries the question text");
});

// ---------------------------------------------------------------------------
// §10 — hybrid retrieval, and what ranking is not allowed to mean
// ---------------------------------------------------------------------------

test("the weights are §10's, and they are versioned", () => {
  assert.equal(WEIGHTS.semantic, 0.35);
  assert.equal(WEIGHTS.lexical, 0.25);
  assert.equal(WEIGHTS.structured, 0.2);
  assert.equal(WEIGHTS.recency, 0.1);
  assert.equal(WEIGHTS.reliability, 0.1);
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "the weights do not sum to one");
  // §10: "put them behind versioned retrieval policy so evaluation can change
  // them without changing the meaning of stored records."
  assert.match(RETRIEVAL_POLICY_VERSION, /^ask-retrieval\.\d+\.\d+\.\d+$/);
});

test("without a semantic scorer its weight is zero and is not redistributed", () => {
  // Redistributing the missing 0.35 across the other four would silently change
  // what they mean relative to each other. A score computed without a scorer is
  // simply on a smaller scale, and every score in the same answer is on it.
  assert.equal(NO_SEMANTIC_SCORER, null);
  assert.equal(semanticWeightApplied(null), 0);
  assert.equal(semanticWeightApplied({ score: () => 1 }), WEIGHTS.semantic);

  const docs = [doc({ id: "a", text: "sleep sleep sleep", concepts: ["sleep"] })];
  const without = rank({ query: "sleep", docs, scope: SCOPE, now: NOW })[0];
  const scorer: SemanticScorer = { score: () => 1 };
  const with_ = rank({ query: "sleep", docs, scope: SCOPE, now: NOW, scorer })[0];
  assert.ok(with_.score > without.score, "the semantic signal changed nothing");
  assert.ok(Math.abs(with_.score - without.score - WEIGHTS.semantic) < 1e-9);
});

test("an excluded record cannot come back on rank", () => {
  // §10: "exclude rejected candidates, dismissed inferences, expired temporary
  // intelligence, and unauthorized governance zones." Excluded BEFORE scoring,
  // so a high-scoring rejected candidate is not merely outranked.
  const docs = [
    doc({ id: "keep", text: "sleep" }),
    doc({ id: "rejected", text: "sleep sleep sleep sleep", excluded: "rejected" }),
    doc({ id: "dismissed", text: "sleep sleep sleep", excluded: "dismissed" }),
  ];
  const ids = rank({ query: "sleep", docs, scope: SCOPE, now: NOW }).map((s) => s.doc.id);
  assert.deepEqual(ids, ["keep"]);
});

test("near-identical sources are one piece of evidence, not two", () => {
  // Citing both makes an answer look better supported than it is.
  const docs = [
    doc({ id: "a", text: "Grounding has been helping in the evenings." }),
    doc({ id: "b", text: "Grounding has been helping in the evenings." }),
    doc({ id: "c", text: "Sister mentioned again this week." }),
  ];
  const out = dedupe(rank({ query: "grounding", docs, scope: SCOPE, now: NOW }));
  assert.equal(out.filter((s) => s.doc.text.includes("Grounding")).length, 1);
});

test("one source type cannot crowd out every other", () => {
  const docs = Array.from({ length: 8 }, (_, i) =>
    doc({ id: `n${i}`, type: "note", text: `sleep note ${i}` })
  ).concat([doc({ id: "m1", type: "memory", text: "sleep memory" })]);
  const out = capPerSource(rank({ query: "sleep", docs, scope: SCOPE, now: NOW }));
  assert.equal(out.filter((s) => s.doc.type === "note").length, PER_SOURCE_CAP);
  assert.ok(out.some((s) => s.doc.type === "memory"), "the capped type crowded out the other");
});

test("a record that matched nothing about the question is not cited", () => {
  // MEASURED, NOT REASONED ABOUT: asking "how has sleep been?" about the seeded
  // member cited a thread called "her sister". The ranking was working — two of
  // its five signals, recency and reliability, say nothing about whether a
  // record bears on the question, and 0.10 + 0.10 was enough to get in. What
  // was wrong was treating a rank as a relevance threshold.
  const out = retrieve({
    query: "sleep",
    docs: [
      doc({ id: "match", text: "Sleep is broken most nights." }),
      doc({ id: "recent-but-unrelated", text: "Her sister visited.", occurredAt: "2026-09-09T00:00:00.000Z" }),
    ],
    scope: SCOPE,
    now: NOW,
  });
  assert.deepEqual(out.map((s) => s.doc.id), ["match"]);
});

test("a thread's claim says it is a thread, not a one-word sentence", () => {
  // A thread's text is its canonical label. Rendered as a bare claim it reads
  // as something somebody wrote, rather than as a grouping they made.
  const evidence = rank({
    query: "sleep",
    docs: [
      doc({ id: "t1", type: "thread", text: "sleep", concepts: ["sleep"] }),
      doc({ id: "n1", type: "note", text: "Sleep is broken most nights." }),
    ],
    scope: SCOPE, now: NOW,
  });
  const a = compose({
    question: "how has sleep been?", evidence, candidates: 2, semanticScoring: false,
    retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION, evidenceCutoff: "2026-09-09",
  });
  const thread = a.claims.find((c) => c.citations.includes("t1"));
  assert.ok(thread, "the thread was dropped");
  assert.equal(thread.sourceType, "thread");
  assert.match(code("components/clinical/AskSteady.tsx"), /SOURCE_LABEL\[c\.sourceType\]/);
});

test("an answer rests on a readable number of sources", () => {
  const docs = Array.from({ length: 30 }, (_, i) =>
    doc({ id: `d${i}`, type: i % 2 ? "memory" : "note", text: `sleep ${i}` })
  );
  const out = retrieve({ query: "sleep", docs, scope: SCOPE, now: NOW });
  assert.ok(out.length <= MAX_EVIDENCE);
});

test("the signals do what their names say", () => {
  assert.equal(lexicalMatch("sleep worse", "sleep is worse"), 1);
  assert.equal(lexicalMatch("sleep worse", "nothing relevant"), 0);
  // Stopwords do not count as matches, or every record matches every question.
  assert.equal(lexicalMatch("how has the sleep been", "sleep"), 1);
  assert.equal(structuredMatch("sleep", ["sleep"]), 1);
  assert.equal(structuredMatch("sleep", ["work"]), 0);
  // Recency is a gentle decay, not a cliff: somebody asking when something
  // started is asking about the past on purpose.
  const recent = recencySignal("2026-09-08T00:00:00.000Z", NOW);
  const old = recencySignal("2026-03-01T00:00:00.000Z", NOW);
  assert.ok(recent > old && old > 0, "an older record scored zero on recency");
});

test("a clinician's own note outranks an activity record of the same relevance", () => {
  // Reliability is a RETRIEVAL weight and not a truth claim: a note is more
  // likely to be what somebody asking a question wants to read, not more true.
  assert.ok(SOURCE_RELIABILITY.note > SOURCE_RELIABILITY.checkin);
  const out = rank({
    query: "grounding",
    docs: [doc({ id: "c", type: "checkin", text: "grounding" }), doc({ id: "n", type: "note", text: "grounding" })],
    scope: SCOPE, now: NOW,
  });
  assert.equal(out[0].doc.id, "n");
});

// ---------------------------------------------------------------------------
// The surface, and the phase order
// ---------------------------------------------------------------------------

test("the query box takes an ordinary question, with no special syntax", () => {
  // §12: queries "should work without special syntax". The examples on the
  // screen are the claim, so they are sentences rather than a query language.
  const src = read("components/clinical/AskSteady.tsx");
  assert.match(src, /When did sleep start getting worse\?/);
  assert.match(src, /What have I written about her sister\?/);
  assert.match(src, /How has grounding been working\?/);
});

test("every claim on the screen offers its source", () => {
  // §12: "the UI should offer View source."
  const src = code("components/clinical/AskSteady.tsx");
  assert.match(src, /View source/);
  const claimBlock = src.slice(src.indexOf("ask-claim"), src.indexOf("Not searched"));
  assert.match(claimBlock, /SourceLink/, "a claim renders without a way to open its source");
});

test("nothing the query box imports can reach a database", () => {
  // FOUND BY A BUILD FAILURE, not by review: the component imported one
  // constant from ask-store.ts, which imports the memory and thought readers,
  // which import better-sqlite3 — so `next build` failed on fs and dns rather
  // than shipping a browser bundle with a database driver in it. The constant
  // moved to ask-answer.ts, which imports nothing but a type.
  //
  // Checked as a rule rather than left to the build, because the build only
  // catches it when the transitive import actually resolves to a node module,
  // and the next one might not.
  const component = code("components/clinical/AskSteady.tsx");
  const clientSafe = ["@/lib/clinical/ask-answer", "@/lib/clinical/ask-actions", "next/link", "react"];
  for (const m of component.matchAll(/from "([^"]+)"/g)) {
    assert.ok(
      clientSafe.includes(m[1]),
      `the query box imports ${m[1]}, which is not known to be client-safe`
    );
  }
  const answer = code("lib/clinical/ask-answer.ts");
  for (const token of ["getDb", "better-sqlite3", "repo(", "memory-store", "thought-store"]) {
    assert.ok(!answer.includes(token), `ask-answer reaches ${token} and a client component imports it`);
  }
});

test("the surface is behind Phase 5's flag, which rests on the phase before it", () => {
  assert.ok(THOUGHTS_FLAGS.includes("CLINICIAN_PATIENT_ASK"));
  assert.ok(
    thoughtsFlagRequires("CLINICIAN_PATIENT_ASK") !== null,
    "Phase 5's flag rests on nothing, so it can open with earlier phases dark"
  );
  assert.match(code("app/clinician/member/[id]/thoughts/page.tsx"), /CLINICIAN_PATIENT_ASK/);
});

test("the generation task is registered with a boundary it cannot cross", () => {
  // Registered and unused: the answer that ships is deterministic. The entry
  // exists so the boundary is fixed before anything is behind it — §12's rule
  // against smoothing is exactly what a fluent model would break.
  const task = getTask("clinician.patient_query.answer");
  assert.ok(task, "Ask Steady's task is not registered");
  assert.equal(task.fallback, "deterministic");
  assert.match(task.purpose, /[Cc]annot introduce a claim/);
  assert.match(task.purpose, /reconcile/, "the task's purpose does not forbid smoothing");
});
