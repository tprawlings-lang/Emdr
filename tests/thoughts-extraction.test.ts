// Clinician Thoughts Phase 2 — extraction, candidates and Save Thoughts.
//
// Phase 2's definition of done is three lines, and each is a section here:
//
//   Uncertainty is preserved.
//   No candidate becomes approved without clinician save.
//   Replay reproduces approved memory state.
//
// The first is the one worth the most care. §4's example is that "I think this
// may connect to abandonment" is not "abandonment is an active patient theme",
// and the failure it describes is not a crash — it is a record that reads
// slightly more confidently than the clinician was. Nothing about that shows up
// as an error, which is why it is tested rather than trusted.

process.env.EMDR_DATA_DIR = `/tmp/steady-extract-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  validateExtraction, quoteHash, EXTRACTION_SCHEMA_VERSION,
  type ExtractionItem,
} from "../src/lib/clinical/extraction-contract";
import { fixtureExtraction } from "../src/lib/clinical/extraction-fixture";
import { FIXTURE_MARKER } from "../src/lib/clinical/transcription-fixture";
import { getTask } from "../src/lib/ai-gateway/registry";

const TRANSCRIPT =
  "She semed steadier today. Not calm exactly, but she stayed in the room with it, "
  + "which she has not managed before. She said \"I keep waiting for it to go wrong\" — "
  + "her words, not mine. I think this might connect to the thing with her sister, but I "
  + "am not sure yet and I do not want to lead her there. Sleep is still poor, maybe four "
  + "hours. Follow up on the sleap next session."
  + `\n\n${FIXTURE_MARKER}`;

function item(over: Partial<ExtractionItem> = {}): ExtractionItem {
  return {
    tempId: "t1",
    itemType: "observation",
    statementClass: "clinician_observation",
    displayText: "Stayed present with the material.",
    normalizedLabel: null,
    sourceStart: null,
    sourceEnd: null,
    sourceQuoteHash: null,
    ...over,
  };
}
function payload(items: ExtractionItem[], over: Record<string, unknown> = {}) {
  return { schemaVersion: EXTRACTION_SCHEMA_VERSION, transcriptId: "tr1", items, ...over };
}

// ---------------------------------------------------------------------------
// Uncertainty is preserved
// ---------------------------------------------------------------------------

test("speculation cannot be filed as observation or patient report", () => {
  for (const cls of ["clinician_observation", "patient_report"] as const) {
    for (const type of ["clinician_hypothesis", "clinician_uncertainty"] as const) {
      const v = validateExtraction(payload([item({ itemType: type, statementClass: cls })]), "tr1", TRANSCRIPT);
      assert.equal(v.items.length, 0, `${type} filed as ${cls} must be refused`);
      assert.match(v.rejected[0].problem, /speculation recorded as fact/);
    }
  }
});

test("a refused item is reported, not silently dropped", () => {
  const v = validateExtraction(
    payload([item({ tempId: "keep" }), item({ tempId: "bad", itemType: "clinician_hypothesis", statementClass: "patient_report" })]),
    "tr1", TRANSCRIPT
  );
  assert.equal(v.items.length, 1);
  assert.equal(v.rejected.length, 1, "a model that keeps proposing this is a fact about the task, and a silent filter hides it");
  assert.equal(v.rejected[0].tempId, "bad");
});

test("the fixture keeps hedges as hedges and quotes as patient report", () => {
  const ex = fixtureExtraction("tr1", TRANSCRIPT);
  assert.ok(ex, "the fabricated transcript must be recognised");
  const byText = (frag: string) => ex.items.find((i) => i.displayText.includes(frag));

  const hedge = byText("Possible connection");
  assert.equal(hedge?.statementClass, "clinician_hypothesis", "'I think this might connect' is a hypothesis");
  const quote = byText("I keep waiting for it to go wrong");
  assert.equal(quote?.statementClass, "patient_report", "quoted speech is the patient's, not the clinician's");
  const held = byText("Holding back from naming");
  assert.equal(held?.statementClass, "clinician_uncertainty");
});

test("an approximate number is marked approximate", () => {
  const ex = fixtureExtraction("tr1", TRANSCRIPT)!;
  const sleep = ex.items.find((i) => i.normalizedLabel === "sleep" && i.numericFacts?.length);
  assert.ok(sleep, "the sleep figure must carry its number");
  assert.equal(sleep.numericFacts![0].value, 4);
  // "maybe four hours". An approximate 4 stored as an exact 4 is a number the
  // clinician never gave.
  assert.equal(sleep.numericFacts![0].approximate, true);
});

test("a negation survives extraction", () => {
  const second =
    "Difficult session. He did not want to talk about the accident and I did not push. We "
    + "spent most of it on grounding — the cold water one, which he says works about half "
    + "the time. He mentioned his brother is staying with him now, which is new. Might be "
    + "part of why this week was harder, or might be helping. Too early to say."
    + `\n\n${FIXTURE_MARKER}`;
  const ex = fixtureExtraction("tr2", second)!;
  const accident = ex.items.find((i) => i.normalizedLabel === "the accident");
  assert.ok(accident, "the accident item must exist");
  assert.match(accident.displayText, /Did not want/i, "'did not want to talk about it' must not become 'talked about it'");
});

// ---------------------------------------------------------------------------
// Citations are checked, not trusted
// ---------------------------------------------------------------------------

test("an invented offset loses its citation and keeps its item", () => {
  const bogus = item({ sourceStart: 0, sourceEnd: 10, sourceQuoteHash: quoteHash("not what is there") });
  const v = validateExtraction(payload([bogus]), "tr1", TRANSCRIPT);
  assert.equal(v.items.length, 1, "the item survives — only the false citation is dropped");
  assert.equal(v.items[0].sourceStart, null);
  assert.equal(v.items[0].sourceQuoteHash, null);
  assert.equal(v.droppedCitations, 1);
});

test("an honest offset is kept", () => {
  const start = TRANSCRIPT.indexOf("she stayed in the room");
  const end = start + "she stayed in the room".length;
  const good = item({ sourceStart: start, sourceEnd: end, sourceQuoteHash: quoteHash(TRANSCRIPT.slice(start, end)) });
  const v = validateExtraction(payload([good]), "tr1", TRANSCRIPT);
  assert.equal(v.items[0].sourceStart, start);
  assert.equal(v.droppedCitations, 0);
});

test("an out-of-bounds offset cannot read past the transcript", () => {
  const v = validateExtraction(
    payload([item({ sourceStart: 0, sourceEnd: TRANSCRIPT.length + 500, sourceQuoteHash: quoteHash("x") })]),
    "tr1", TRANSCRIPT
  );
  assert.equal(v.items[0].sourceStart, null);
});

test("every fixture citation verifies against the transcript it came from", () => {
  const ex = fixtureExtraction("tr1", TRANSCRIPT)!;
  const v = validateExtraction(ex, "tr1", TRANSCRIPT);
  assert.equal(v.rejected.length, 0, "the fixture must satisfy its own contract");
  assert.equal(v.droppedCitations, 0, "fixture offsets are located at call time, so they must all verify");
  assert.ok(v.items.every((i) => i.sourceStart !== null), "every fixture item cites its source");
});

test("a corrected transcript drops the citations it no longer supports", () => {
  // The clinician fixed "semed" and "sleap". Items whose quoted phrase is gone
  // must arrive uncited rather than pointing at words nobody said.
  const corrected = TRANSCRIPT.replace("Follow up on the sleap next session", "Follow up on sleep next session");
  const ex = fixtureExtraction("tr1", corrected)!;
  const followUp = ex.items.find((i) => i.displayText.startsWith("Follow up"));
  assert.equal(followUp?.sourceStart, null, "the phrase moved, so the citation is withheld rather than invented");
});

// ---------------------------------------------------------------------------
// Contract refusals
// ---------------------------------------------------------------------------

test("a payload for a different transcript is refused outright", () => {
  const v = validateExtraction(payload([item()]), "SOMETHING-ELSE", TRANSCRIPT);
  assert.equal(v.items.length, 0);
  assert.match(v.rejected[0].problem, /transcriptId/);
});

test("thread relationships are refused — that is a different task", () => {
  const withLink = { ...item(), threadId: "th1" };
  const v = validateExtraction(payload([withLink as ExtractionItem]), "tr1", TRANSCRIPT);
  assert.equal(v.items.length, 0);
  assert.match(v.rejected[0].problem, /thread relationships/);
});

test("unknown types, duplicate ids and empty text are refused", () => {
  const v = validateExtraction(
    payload([
      item({ tempId: "a", itemType: "diagnosis" as never }),
      item({ tempId: "b", displayText: "   " }),
      item({ tempId: "c" }),
      item({ tempId: "c" }),
    ]),
    "tr1", TRANSCRIPT
  );
  assert.equal(v.items.length, 1, "only the one good item survives");
  assert.equal(v.rejected.length, 3);
});

test("an unsupported schema version is refused rather than guessed at", () => {
  const v = validateExtraction(payload([item()], { schemaVersion: "2" }), "tr1", TRANSCRIPT);
  assert.equal(v.items.length, 0);
  assert.match(v.rejected[0].problem, /schemaVersion/);
});

// ---------------------------------------------------------------------------
// The fixture refuses to invent
// ---------------------------------------------------------------------------

test("the fixture returns nothing for text it did not write", () => {
  assert.equal(
    fixtureExtraction("tr1", "A real clinician said something real about a real patient."),
    null,
    "inventing clinical items for real text is the exact harm this feature exists to prevent"
  );
});

test("the fixture requires its own marker, not merely familiar words", () => {
  const unmarked = TRANSCRIPT.replace(FIXTURE_MARKER, "");
  assert.equal(fixtureExtraction("tr1", unmarked), null);
});

test("the fixture proposes some items a reviewer should reject", () => {
  // A fixture that is always right quietly demonstrates that the clinician's
  // judgement is a formality. Two candidates are deliberately wrong.
  const third =
    "Third session in a row where she has arrived late and apologised for it. Not reading "
    + "that as avoidance yet. Distress went from about a seven to a three during the set, "
    + "which is the biggest shift she has had. She used the cue word without being prompted. "
    + "I want to check whether the work thing is still active before we go further."
    + `\n\n${FIXTURE_MARKER}`;
  const ex = fixtureExtraction("tr3", third)!;
  const promoted = ex.items.find((i) => i.displayText === "Lateness reflects avoidance.");
  assert.ok(promoted, "the transcript says 'not reading that as avoidance YET' — the promotion must be on offer to be rejected");
});

// ---------------------------------------------------------------------------
// The gateway task
// ---------------------------------------------------------------------------

test("the extraction task is registered and refuses rather than invents", () => {
  const task = getTask("clinician.thought.extract");
  assert.ok(task, "§9 requires this task to go through the gateway");
  // A deterministic fallback here would mean fabricating items when the model
  // is unreachable, which is the one failure this feature must never have.
  assert.equal(task.fallback, "refuse");
  assert.equal(task.phi, "protected-in-hashed-provenance");
});
