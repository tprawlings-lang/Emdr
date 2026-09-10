// The thought capture state machine (§8.1) and its one non-negotiable rule.
//
// Phase 1's definition of done: "Interrupted processing does not lose a
// completed transcript." §8's rules put it twice more — "a processing failure
// never deletes captured audio or a completed transcript unless policy
// explicitly requires deletion", and §17.4's copy for the state promises the
// clinician "your transcript is safe".
//
// That promise is only keepable if a transcript arriving and organization
// failing are DIFFERENT outcomes. If they collapse into one `failed`, the
// clinician loses the only artifact in this whole feature that cannot be
// regenerated: their own words, which they cannot say again the same way.
// Everything else here — the transitions, the terminal states, the duplicate
// events — is ordinary. This is the test that matters.

import { strict as assert } from "node:assert";
import test from "node:test";
import {
  nextStatus, isTerminal, isReviewable, holdsIrreplaceableContent,
  type ThoughtStatus, type ThoughtEvent,
} from "../src/lib/clinical/thoughts";
import { isEventType } from "../src/lib/events";

const ALL: ThoughtStatus[] = [
  "capturing", "processing", "review", "review_transcript_only",
  "saved", "discarded", "failed",
];

test("a transcript that arrived is never lost to a later failure", () => {
  // The rule, stated three ways in the spec and once here.
  assert.equal(nextStatus("processing", "extraction_failed"), "review_transcript_only");
  assert.notEqual(nextStatus("processing", "extraction_failed"), "failed");
  // And the clinician can act on it: a reduced review is still a review.
  assert.ok(isReviewable("review_transcript_only"));
  assert.equal(nextStatus("review_transcript_only", "save"), "saved");
});

test("only a failure BEFORE a transcript reaches 'failed'", () => {
  // Nothing usable was produced, so there is nothing for a clinician to look
  // at. These are the only two edges into the state.
  assert.equal(nextStatus("processing", "upload_failed"), "failed");
  assert.equal(nextStatus("processing", "transcription_failed"), "failed");

  const intoFailed: Array<[ThoughtStatus, ThoughtEvent]> = [];
  const events: ThoughtEvent[] = [
    "done", "cancel", "transcript_ready", "extraction_ready", "extraction_failed",
    "upload_failed", "transcription_failed", "save", "discard",
  ];
  for (const s of ALL) {
    for (const e of events) {
      if (nextStatus(s, e) === "failed") intoFailed.push([s, e]);
    }
  }
  assert.deepEqual(
    intoFailed.map(([s, e]) => `${s}+${e}`).sort(),
    ["processing+transcription_failed", "processing+upload_failed"],
    "something reaches 'failed' from a state that already holds a transcript"
  );
});

test("a retry can upgrade a review and can never demote one", () => {
  // Re-running organization on a thought the clinician is already looking at
  // must not send them back to a spinner, and a second failure must not undo
  // the first success.
  assert.equal(nextStatus("review_transcript_only", "extraction_ready"), "review");
  assert.equal(nextStatus("review_transcript_only", "extraction_failed"), "review_transcript_only");
  assert.equal(nextStatus("review", "extraction_failed"), "review");
  assert.equal(nextStatus("review", "extraction_ready"), "review");
  for (const s of ["review", "review_transcript_only"] as ThoughtStatus[]) {
    assert.notEqual(nextStatus(s, "extraction_failed"), "processing");
    assert.notEqual(nextStatus(s, "extraction_ready"), "processing");
  }
});

test("terminal states are terminal, including for a late retry", () => {
  for (const s of ["saved", "discarded", "failed"] as ThoughtStatus[]) {
    assert.ok(isTerminal(s), `${s} is not terminal`);
    for (const e of ["extraction_ready", "extraction_failed", "save", "discard"] as ThoughtEvent[]) {
      assert.equal(nextStatus(s, e), null, `${s} moved on ${e}`);
    }
  }
  for (const s of ["capturing", "processing", "review", "review_transcript_only"] as ThoughtStatus[]) {
    assert.equal(isTerminal(s), false, `${s} is terminal and should not be`);
  }
});

test("an event that does not apply is null, not an error", () => {
  // A duplicate webhook, a double-clicked Save, and a retry landing after the
  // clinician discarded the thought are all ordinary. The caller writes nothing
  // when the answer is null; a throw would turn each of them into an incident.
  assert.equal(nextStatus("capturing", "save"), null);
  assert.equal(nextStatus("saved", "save"), null);
  assert.equal(nextStatus("discarded", "extraction_ready"), null);
  assert.equal(nextStatus("review", "done"), null);
});

test("cleanup cannot decide for itself what is safe to purge", () => {
  // A retention job that reasons about states on its own is how the transcript
  // rule gets broken by somebody who never read it.
  assert.equal(holdsIrreplaceableContent("capturing"), false, "nothing has been captured yet");
  assert.equal(holdsIrreplaceableContent("failed"), false, "nothing usable was produced");
  for (const s of ["processing", "review", "review_transcript_only", "saved", "discarded"] as ThoughtStatus[]) {
    assert.ok(holdsIrreplaceableContent(s),
      `${s} would be treated as safe to purge`);
  }
  // `discarded` included deliberately: §16 distinguishes rejecting a candidate
  // from deleting a clinical record, and what happens to a discarded thought's
  // content is a retention decision rather than an immediate delete.
});

test("every state is reachable and the machine has no orphans", () => {
  const reachable = new Set<ThoughtStatus>(["capturing"]);
  const events: ThoughtEvent[] = [
    "done", "cancel", "transcript_ready", "extraction_ready", "extraction_failed",
    "upload_failed", "transcription_failed", "save", "discard",
  ];
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of [...reachable]) {
      for (const e of events) {
        const to = nextStatus(s, e);
        if (to && !reachable.has(to)) { reachable.add(to); grew = true; }
      }
    }
  }
  const unreachable = ALL.filter((s) => !reachable.has(s));
  assert.deepEqual(unreachable, [],
    `these states cannot be reached from capturing: ${unreachable.join(", ")}`);
});

test("the source events are registered", () => {
  // appendEvent throws on an unregistered type, so an unregistered one here
  // would surface as a runtime failure on the clinician's first recording.
  for (const t of [
    "clinician_thought.recorded",
    "clinician_thought.transcribed",
    "clinician_thought.discarded",
  ]) {
    assert.ok(isEventType(t), `${t} is not registered in EVENT_TYPES`);
  }
});

test("no source event carries transcript text", async () => {
  // §18: raw protected content stays out of ordinary logs. §6.2 permits
  // pointing at a protected record by id and storing a hash. The distinction is
  // the whole reason a hash is in the payload — a second copy of a clinician's
  // words in an append-only ledger is a copy retention policy can never reach.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/clinical/thoughts.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const leak of ["transcriptText", "transcript_text", "audioStorageKey", "audio_storage_key"]) {
    assert.ok(!src.includes(leak),
      `an event payload carries ${leak}, which puts protected content in the ledger`);
  }
  assert.match(src, /transcriptHash/, "the transcript is not identified by hash at all");
});
