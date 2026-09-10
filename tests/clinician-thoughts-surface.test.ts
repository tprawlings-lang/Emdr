// The clinician thoughts surface: the recorder, the review screen and the page
// that hosts them (§3, §17, §20's file map).
//
// These are source guards rather than render tests, and the split is
// deliberate. What matters about these components is not what they look like —
// it is where responsibility sits. §20 says the recorder is "media capture
// only, no clinical domain decisions", §6.2 says the clinician identity comes
// from authenticated context, §22 says a disabled surface must not be
// reachable, and §18 says protected content stays out of logs. Every one of
// those is a claim about which file contains which knowledge, and a rendering
// test cannot see any of them.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { THOUGHTS_FLAGS } from "../src/lib/clinical/thoughts-flags";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** These files explain their own rules at length in prose. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const RECORDER = "src/components/clinical/ThoughtRecorder.tsx";
const REVIEW = "src/components/clinical/ThoughtReview.tsx";
const WORKSPACE = "src/components/clinical/ThoughtsWorkspace.tsx";
const ACTIONS = "src/lib/clinical/thought-actions.ts";
const PAGE = "src/app/clinician/member/[id]/thoughts/page.tsx";

test("§20's files exist where the map says", () => {
  for (const f of [RECORDER, REVIEW, WORKSPACE, ACTIONS, PAGE]) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} is missing`);
  }
});

test("the recorder makes no clinical decision", () => {
  // §20: "Media capture only, no clinical domain decisions." It is a client
  // component, so anything it decides is decided in the browser, where a user
  // can change it.
  const src = code(read(RECORDER));
  for (const forbidden of [
    "statement_class", "statementClass", "clinical_memory", "nextStatus",
    "isReviewable", "approve", "item_type",
  ]) {
    assert.ok(!src.includes(forbidden),
      `the recorder reasons about ${forbidden}, which belongs on the server`);
  }
  // It also must not read the database directly.
  assert.ok(!/from "@\/lib\/(db|data|repository)"/.test(src),
    "the recorder reaches the database from the browser");
});

test("the patient's name is rendered before any control", () => {
  // §3.1: "Display patient name at the top so the clinician can immediately
  // catch a wrong-person error." A clinician who has just finished one session
  // and opened another patient's record is exactly the person who records
  // ninety seconds about the wrong person.
  const src = read(RECORDER);
  const name = src.indexOf("{personName}");
  const firstButton = src.indexOf("<button");
  assert.ok(name > 0, "the recorder never renders the patient's name");
  assert.ok(firstButton > 0);
  assert.ok(name < firstButton,
    "a control is rendered before the patient's name, so a wrong-person error is caught too late");
});

test("recording asks for no filing first", () => {
  // §3: "Do not ask the clinician to choose a note type, category, diagnosis,
  // tag, or folder before recording." The promise of the feature is a thought
  // captured with no filing work.
  const src = code(read(RECORDER));
  for (const filing of ["noteType", "note_type", "category", "diagnosis", "folder", "tag"]) {
    assert.ok(!new RegExp(`\\b${filing}\\b`).test(src),
      `the recorder asks for ${filing} before recording`);
  }
});

test("cancel confirms only when something was captured", () => {
  // §3.1: "On Cancel, require a second action only if audio has already been
  // captured." A confirmation for nothing teaches people to click through
  // confirmations.
  const src = code(read(RECORDER));
  assert.match(src, /chunksRef\.current\.length > 0/,
    "cancel does not check whether anything was captured");
  assert.match(src, /captured && !window\.confirm/,
    "cancel confirms unconditionally, or does not confirm at all");
});

test("the microphone is released when the screen goes away", () => {
  // A recording indicator that outlives the screen is a privacy problem and the
  // fastest way to lose a clinician's trust in the feature.
  const src = code(read(RECORDER));
  assert.match(src, /useEffect\(\(\) => \(\) => \{/, "there is no unmount cleanup");
  assert.match(src, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/,
    "the microphone tracks are never stopped");
});

test("every action checks the flag, not just the page", () => {
  // §22. A form post does not go through the component that decided whether to
  // render the form, so a page-only check leaves the commands open.
  const src = code(read(ACTIONS));
  const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.ok(exported.length >= 5, "the action surface shrank unexpectedly");
  for (const fn of exported) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const end = body.indexOf("\nexport async function", 1);
    const scoped = end > 0 ? body.slice(0, end) : body;
    assert.match(scoped, /thoughtsSurfaceAvailable\(/,
      `${fn} does not check the capture flag`);
  }
});

test("no action accepts a tenant from the caller", () => {
  // §6.2: "Do not accept tenant_id from a browser payload. Resolve it from
  // authenticated context."
  const src = code(read(ACTIONS));
  assert.ok(!/formData\.get\(["']tenantId["']\)/.test(src),
    "an action reads tenantId from the request");
  assert.ok(!/formData\.get\(["']clinicianId["']\)/.test(src),
    "an action reads the clinician's identity from the request");
  assert.match(src, /requireClinician\(\)/, "an action does not authenticate");
});

test("no transcript text reaches an audit detail", () => {
  // §18: "Do not log raw transcript text, patient query text, or model prompts
  // in general application logs." The audit record says a correction happened
  // and how long it was, never what it said.
  const src = code(read(ACTIONS));
  const details = [...src.matchAll(/detail: \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(details.length >= 4, "the actions stopped auditing");
  // Checked per VALUE, not by substring. `chars: text.length` is the correct
  // way to record how long a correction was, and a substring search for "text"
  // flags it — a guard that fires on the safe form is a guard somebody deletes
  // rather than satisfies. What must not appear is a value that IS the content:
  // a bare `text`, a `.text` read, or a buffer.
  for (const d of details) {
    for (const pair of d.split(",")) {
      const value = pair.includes(":") ? pair.slice(pair.indexOf(":") + 1).trim() : pair.trim();
      if (!value) continue;
      assert.ok(!/^(text|transcript|audio|buffer)$/.test(value),
        `an audit detail carries the content itself: ${pair.trim()}`);
      assert.ok(!/\.(text|transcript)$/.test(value),
        `an audit detail reads content off an object: ${pair.trim()}`);
      assert.ok(!/^Buffer|arrayBuffer/.test(value),
        `an audit detail carries raw bytes: ${pair.trim()}`);
    }
  }
});

test("a failed transcription keeps the recording", () => {
  // §13's failure row, and Phase 1's definition of done. The audio is stored
  // and the thought moves to processing BEFORE transcription is attempted, so a
  // provider failure leaves something to retry.
  const src = code(read(ACTIONS));
  const put = src.indexOf("thoughtStorage().put");
  const finalize = src.indexOf("finalizeCapture(");
  const transcribe = src.indexOf("transcriptionService().transcribe");
  assert.ok(put > 0 && finalize > 0 && transcribe > 0);
  assert.ok(put < transcribe, "transcription is attempted before the audio is stored");
  assert.ok(finalize < transcribe, "the thought is not moved to processing before transcription");
  // And the failure path does not delete or fail the thought.
  const failure = src.slice(src.indexOf("if (!result.ok)"), src.indexOf("addTranscript("));
  assert.ok(!failure.includes("discard"), "a transcription failure discards the thought");
  assert.ok(!failure.includes('"failed"'), "a transcription failure marks the thought failed");
});

test("the review screen shows the transcript and posts its hash", () => {
  // §3.2: the clinician must always be able to see what Steady heard. §14.1: a
  // stale submission must conflict rather than overwrite.
  const src = code(read(REVIEW));
  assert.match(src, /<textarea/, "the transcript is not editable on the review screen");
  assert.match(src, /form\.set\("expectedHash", transcript\.hash\)/,
    "a correction is posted without the version it was made against");
  // The correction lands before the save, so the saved thought is the corrected
  // one rather than the machine's with an edit hanging off it.
  assert.ok(src.indexOf("correctTranscriptAction") < src.indexOf("saveThoughtAction"),
    "the save is attempted before the correction");
});

test("the review screen does not promise a formal note", () => {
  // §16: "A private clinician thought should not silently become a formal note
  // merely because an AI draft used it." The screen says where the thought
  // goes, in the clinician's words.
  const src = read(REVIEW);
  assert.match(src, /not a formal note|does not write a formal note/i,
    "the review screen never says what saving does not do");
});

test("the page is registered in the person rail", async () => {
  const { layerFor } = await import("../src/components/clinical/PersonShell");
  // §17.1 puts Record Thoughts in the action region: it is something the
  // clinician does, not something they consult.
  assert.equal(layerFor("/thoughts"), "actions");
});

test("a disabled environment says so instead of rendering a recorder", () => {
  const src = code(read(PAGE));
  assert.match(src, /thoughtsSurfaceAvailable\(/, "the page does not check the flag");
  // The recorder is inside the enabled branch.
  const check = src.indexOf("const available =");
  const recorder = src.indexOf("<ThoughtsWorkspace");
  assert.ok(check > 0 && recorder > check,
    "the recorder is rendered before the flag is consulted");
  // §22: a flag change must not delete or rewrite stored history, and the
  // disabled copy has to say so or a clinician will assume it did.
  assert.match(read(PAGE), /never deletes or rewrites/i,
    "the disabled state does not tell the clinician their history survives");
});

test("the six flags are the ones the rollout plan names", () => {
  assert.deepEqual([...THOUGHTS_FLAGS].sort(), [
    "CLINICIAN_NOTE_BRIDGE",
    "CLINICIAN_PATIENT_ASK",
    "CLINICIAN_SESSION_PREP",
    "CLINICIAN_THOUGHTS_CAPTURE",
    "CLINICIAN_THOUGHTS_EXTRACTION",
    "CLINICIAN_THREADS",
  ]);
});
