process.env.EMDR_DATA_DIR = `/tmp/steady-notebridge-${process.pid}-${Date.now()}`;

// The formal note bridge (Clinician Thoughts spec §21, Phase 6).
//
// Phase 6 asks for one thing and forbids three. It asks that clinician-selected
// approved items feed a note draft with their source ids preserved. It forbids
// a draft that signs itself, a private thought becoming a formal note without a
// clinician acting, and a pilot that cannot be switched off without losing data.
//
// §18's test row for this feature is the short version: "only selected approved
// items included, source IDs preserved, draft never auto-signed."
//
// THE THIRD PROHIBITION IS THE ONE A TEST CAN LOSE SIGHT OF, so it is checked
// structurally rather than behaviourally: there is no note table, no draft row
// and no write anywhere in the bridge. A draft is assembled on the way to the
// screen and exists for the length of the response. "Disabled without data
// loss" is then a fact rather than a promise about a migration — there is
// nothing to lose.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  assembleDraft, draftText, sourceIds, isSigned, SIGNING_IS_ELSEWHERE, NoteBridgeRefused,
} from "../src/lib/clinical/note-bridge";
import type { MemoryItem } from "../src/lib/clinical/memory-store";
import { thoughtsSurfaceAvailable } from "../src/lib/clinical/thoughts-flags";
import { layerFor } from "../src/components/clinical/PersonShell";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const code = (rel: string) =>
  fs.readFileSync(path.join(SRC, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const item = (over: Partial<MemoryItem> = {}): MemoryItem => ({
  id: "item-1",
  personId: "person-1",
  sourceThoughtId: "thought-1",
  sourceTranscriptId: "transcript-1",
  itemType: "observation",
  statementClass: "clinician_observation",
  normalizedLabel: null,
  displayText: "Sleeping better since the schedule change.",
  status: "approved",
  approvedBy: "clin-1",
  approvedAt: "2026-09-01T09:00:00Z",
  supersedesId: null,
  span: { start: 10, end: 40 },
  numericFacts: [],
  createdAt: "2026-09-01T08:00:00Z",
  ...over,
});

const build = (available: MemoryItem[], selectedIds: string[]) =>
  assembleDraft({
    personId: "person-1",
    assembledBy: "clin-1",
    assembledAt: "2026-09-10T09:00:00Z",
    available,
    selectedIds,
  });

// ---------------------------------------------------------------------------
// Only selected approved items
// ---------------------------------------------------------------------------

test("an item nobody selected is not in the draft", () => {
  // The half that makes this a bridge rather than an export. A note is the
  // clinician's own statement in a record they sign; nothing reaches it that
  // they did not choose.
  const draft = build([item({ id: "a" }), item({ id: "b" })], ["a"]);
  assert.deepEqual(sourceIds(draft), ["a"]);
});

test("a selected item that was never approved is refused, not dropped", () => {
  // REFUSED RATHER THAN FILTERED. A clinician who ticked six boxes and received
  // five lines would have no way to tell which one went, or why.
  const draft = build([item({ id: "a" }), item({ id: "b", status: "candidate" })], ["a", "b"]);
  assert.deepEqual(sourceIds(draft), ["a"]);
  assert.equal(draft.refusedIds.length, 1);
  assert.equal(draft.refusedIds[0].id, "b");
  assert.match(draft.refusedIds[0].because, /candidate/);
  assert.match(draft.refusedIds[0].because, /approv/i, "the refusal does not say what approval is for");
});

test("every non-approved status is refused, not only the obvious one", () => {
  for (const status of ["candidate", "rejected", "superseded"] as const) {
    const draft = build([item({ id: "x", status })], ["x"]);
    assert.deepEqual(sourceIds(draft), [], `a ${status} item reached a note`);
    assert.equal(draft.refusedIds.length, 1);
  }
});

test("an item from another person cannot be selected into this draft", () => {
  // Both refusals say the same thing on purpose: an item outside this person's
  // record does not exist as far as this draft is concerned, and a different
  // message for "wrong person" would confirm that something is there.
  const draft = build([item({ id: "a", personId: "person-2" })], ["a"]);
  assert.deepEqual(sourceIds(draft), []);
  assert.equal(draft.refusedIds[0].because, "Not an item on this person's record.");
  const unknown = build([], ["ghost"]);
  assert.equal(unknown.refusedIds[0].because, "Not an item on this person's record.");
});

test("selecting the same item twice produces one line", () => {
  const draft = build([item({ id: "a" })], ["a", "a", "a"]);
  assert.deepEqual(sourceIds(draft), ["a"]);
});

test("an empty selection produces an empty draft, not everything", () => {
  // The failure that would turn "clinician-selected" into "everything by
  // default": a helpful fallback that includes it all when nothing is ticked.
  const draft = build([item({ id: "a" }), item({ id: "b" })], []);
  assert.deepEqual(sourceIds(draft), []);
  assert.equal(draftText(draft), "");
});

// ---------------------------------------------------------------------------
// Source ids preserved
// ---------------------------------------------------------------------------

test("every line carries the item, thought and transcript it came from", () => {
  const draft = build([item({ id: "a" })], ["a"]);
  const line = draft.lines[0];
  assert.equal(line.sourceItemId, "a");
  assert.equal(line.sourceThoughtId, "thought-1");
  assert.equal(line.sourceTranscriptId, "transcript-1");
});

test("the source id survives into the text that leaves Steady", () => {
  // THE HALF THAT MATTERS AFTER THIS LEAVES. Once the text is pasted into a
  // record system, the link back to the thought is whatever is written in it.
  const draft = build([item({ id: "abc123" })], ["abc123"]);
  assert.match(draftText(draft), /steady:abc123/);
  assert.match(draftText(draft), /clinician_observation/);
  assert.match(draftText(draft), /Sleeping better/);
});

// ---------------------------------------------------------------------------
// Never auto-signed
// ---------------------------------------------------------------------------

test("nothing the bridge produces is signed, and nothing can sign it", () => {
  const draft = build([item({ id: "a" })], ["a"]);
  assert.equal(draft.state, "draft");
  assert.equal(draft.signedAt, null);
  assert.equal(isSigned(draft), false);

  // No exported function signs, and no code path sets another state. Checked on
  // the source because the absence is the feature: a `sign()` that threw would
  // still be a signature this product had modelled.
  const src = code("lib/clinical/note-bridge.ts");
  assert.ok(!/\bfunction sign\b|\bsignNote\b|signedAt: [^n]/.test(src), "the bridge can sign");
  assert.ok(
    !/state: "signed"|state = "signed"/.test(src),
    "a code path produces a signed state"
  );
  // And it says why rather than leaving the absence to be read as unfinished.
  assert.match(SIGNING_IS_ELSEWHERE, /cannot sign/);
  assert.match(SIGNING_IS_ELSEWHERE, /record system of truth/);
});

test("a draft records who assembled it, and refuses to exist without that", () => {
  // Not who signed it — nothing signs. But an artefact that will be read as a
  // clinician's words has to say which clinician built it.
  assert.throws(() => assembleDraft({
    personId: "person-1", assembledBy: "  ", assembledAt: "2026-09-10T09:00:00Z",
    available: [item()], selectedIds: ["item-1"],
  }), NoteBridgeRefused);
  assert.equal(build([item()], ["item-1"]).assembledBy, "clin-1");
});

// ---------------------------------------------------------------------------
// Nothing is stored, so nothing is lost
// ---------------------------------------------------------------------------

test("the bridge writes nothing at all", () => {
  // PHASE 6'S THIRD RULE, answered structurally. "Pilot can be disabled per
  // tenant without data loss" is a promise about a migration if a draft is a
  // row; it is a fact if a draft is a function of the request.
  const src = code("lib/clinical/note-bridge.ts");
  assert.ok(!/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i.test(src), "the bridge writes");
  assert.ok(!/from "\.\.\/data"|from "@\/lib\/data"/.test(src), "the bridge reaches the database");
  // And no table was added for it.
  const schema = code("lib/db.ts");
  assert.ok(
    !/CREATE TABLE IF NOT EXISTS (clinical_)?note/i.test(schema),
    "a note table exists, so switching the pilot off would now lose something"
  );
});

test("the screen assembles the draft from the request and stores nothing", () => {
  const page = code("app/clinician/member/[id]/note/page.tsx");
  assert.match(page, /assembleDraft\(/, "the screen does not use the bridge");
  assert.match(page, /searchParams/, "the selection does not come from the request");
  assert.ok(!/INSERT INTO|UPDATE\s+\w+\s+SET/i.test(page), "the screen writes the draft somewhere");
});

// ---------------------------------------------------------------------------
// The flag and the surface
// ---------------------------------------------------------------------------

test("the bridge rests on extraction, and is off unless the whole chain is on", () => {
  // §22: a later phase's surface must not open while an earlier one is closed.
  const flags = code("lib/clinical/thoughts-flags.ts");
  assert.match(flags, /CLINICIAN_NOTE_BRIDGE: "CLINICIAN_THOUGHTS_EXTRACTION"/);
  const prev = process.env.CLINICIAN_THOUGHTS_EXTRACTION;
  process.env.EMDR_DEMO = "1";
  assert.equal(thoughtsSurfaceAvailable("CLINICIAN_NOTE_BRIDGE"), true, "the bridge is off in demo");
  process.env.CLINICIAN_THOUGHTS_EXTRACTION = "0";
  assert.equal(
    thoughtsSurfaceAvailable("CLINICIAN_NOTE_BRIDGE"), false,
    "the bridge opens over extraction that is switched off"
  );
  if (prev === undefined) delete process.env.CLINICIAN_THOUGHTS_EXTRACTION;
  else process.env.CLINICIAN_THOUGHTS_EXTRACTION = prev;
});

test("the screen refuses to render behind its own flag, and says nothing was lost", () => {
  const page = code("app/clinician/member/[id]/note/page.tsx");
  assert.match(page, /thoughtsSurfaceAvailable\("CLINICIAN_NOTE_BRIDGE"\)/);
  assert.match(page, /approvedMemory\(ctx, id\)/, "the screen reads memory outside the flag check");
  // The disabled branch says why nothing is lost, rather than implying a
  // migration happened.
  assert.match(page, /stored nowhere/);
});

test("the surface is reachable and registered", () => {
  assert.match(code("lib/app/route-register.ts"), /path: "\/clinician\/member\/\[id\]\/note"/);
  assert.match(
    code("app/clinician/member/[id]/thoughts/page.tsx"),
    /\/note`/,
    "nothing links to the bridge from the screen where items are approved"
  );
  // And the shell RESOLVES its layer, or the page renders with the wrong rail
  // item selected. Asserted on the function rather than on the identifier: a
  // guard matching the name passes on a renamed export that resolves nothing.
  assert.equal(layerFor("/note"), "actions", "the shell does not know where the bridge belongs");
});

test("the draft is audited by id, never by content", () => {
  // Assembling a draft is a read of a person's record for a purpose that leaves
  // this product. What is recorded is which items, not what they said.
  const page = code("app/clinician/member/[id]/note/page.tsx");
  assert.match(page, /type: "note_draft_assembled"/);
  assert.match(page, /sourceItemIds/);
  assert.ok(!/displayText|draftText\(draft\)\s*\}?\s*,?\s*\n?\s*\}\)/.test(
    page.slice(page.indexOf("note_draft_assembled") - 400, page.indexOf("note_draft_assembled") + 400)
  ), "the audit detail carries item text");
});
