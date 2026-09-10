// The fabricated transcription service, and the gate that confines it.
//
// This is the most dangerous file in the clinician-thoughts feature, and the
// tests are shaped by that rather than by what it does. It invents clinical
// text. Outside a demonstration it would put words a clinician never said into
// a patient's record, attributed to that clinician, in a field the product
// treats as source evidence.
//
// So the first two tests are about REACHABILITY, not output: it must be
// selected in demo and unreachable outside it, and the guard must be able to
// fail in both directions. Everything after that is about the transcripts being
// useful for review — which means containing the things a reviewer needs to see
// handled, not the things that make a demo look tidy.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  transcriptionService, setTranscriptionService, unconfiguredTranscription,
  hashTranscript, LOW_CONFIDENCE,
} from "../src/lib/clinical/transcription";
import { fixtureTranscription, FIXTURE_MARKER } from "../src/lib/clinical/transcription-fixture";

const AUDIO = Buffer.from("some recorded bytes");

function withEnv(demo: string | undefined, fn: () => void) {
  const before = process.env.EMDR_DEMO;
  if (demo === undefined) delete process.env.EMDR_DEMO;
  else process.env.EMDR_DEMO = demo;
  try { fn(); } finally {
    if (before === undefined) delete process.env.EMDR_DEMO;
    else process.env.EMDR_DEMO = before;
  }
}

test("the fixture is selected in demo", () => {
  withEnv("1", () => {
    assert.equal(transcriptionService().id, "fixture",
      "demo has no transcriber, so Phase 1 cannot be walked by a reviewer");
  });
});

test("the fixture is unreachable outside demo", () => {
  // The gate. Without it, a deployment with EMDR_DEMO unset would fabricate
  // clinical text for real patients.
  withEnv(undefined, () => {
    assert.equal(transcriptionService().id, "unconfigured",
      "a text-inventing service is reachable outside a demonstration");
  });
  withEnv("0", () => {
    assert.equal(transcriptionService().id, "unconfigured");
  });
});

test("the environment is read at call time", () => {
  // A provider chosen when the module first loaded cannot be changed without a
  // redeploy. This codebase has shipped that bug before.
  withEnv("1", () => assert.equal(transcriptionService().id, "fixture"));
  withEnv(undefined, () => assert.equal(transcriptionService().id, "unconfigured"));
  withEnv("1", () => assert.equal(transcriptionService().id, "fixture"));
});

test("an override is restored, so a test cannot leak a provider", () => {
  withEnv(undefined, () => {
    const restore = setTranscriptionService(fixtureTranscription);
    assert.equal(transcriptionService().id, "fixture");
    restore();
    assert.equal(transcriptionService().id, "unconfigured",
      "the override outlived its restore, so a later test runs against the wrong provider");
  });
});

test("the gate is on the environment, not on a mutable default", async () => {
  // A source guard as well as a behavioural one: the behavioural test above
  // passes if someone swaps the default to the fixture and adds an
  // `if (!demo) return unconfigured` somewhere else. What must stay true is
  // that the demo check is the ONLY path to it.
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/clinical/transcription.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.match(src, /process\.env\.EMDR_DEMO === "1"/,
    "the fixture is no longer gated on the demo environment");
  const gate = src.indexOf('process.env.EMDR_DEMO === "1"');
  const use = src.indexOf("return fixtureTranscription");
  assert.ok(gate > 0 && use > gate && use - gate < 80,
    "the fixture is returned somewhere other than immediately behind the demo gate");
});

test("every fabricated transcript says it is fabricated", async () => {
  // On the TEXT, not beside it. A transcript is copied, quoted into a note
  // draft, exported and read in an audit trail; a label living in a component
  // does not travel with it.
  const r = await fixtureTranscription.transcribe({ audio: AUDIO, contentType: "audio/webm" });
  assert.ok(r.ok);
  assert.ok(r.ok && r.text.includes(FIXTURE_MARKER),
    "a fabricated transcript carries no marker in its own text");
  assert.match(FIXTURE_MARKER, /fabricated/i);
});

test("the same recording always transcribes the same way", async () => {
  // Deterministic, so a demo can be walked twice and read the same.
  const a = await fixtureTranscription.transcribe({ audio: AUDIO, contentType: "audio/webm" });
  const b = await fixtureTranscription.transcribe({ audio: AUDIO, contentType: "audio/webm" });
  assert.ok(a.ok && b.ok);
  assert.equal(a.ok && b.ok && a.text, b.ok && b.text);
  // And different recordings differ, or the fixture is a constant.
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const r = await fixtureTranscription.transcribe({
      audio: Buffer.from(`recording ${i}`), contentType: "audio/webm",
    });
    if (r.ok) seen.add(r.text);
  }
  assert.ok(seen.size > 1, "every recording produces the same transcript");
});

test("the reported hash matches the reported text", async () => {
  const r = await fixtureTranscription.transcribe({ audio: AUDIO, contentType: "audio/webm" });
  assert.ok(r.ok);
  assert.equal(r.ok && r.hash, hashTranscript(r.ok ? r.text : ""));
});

test("the transcripts contain what a reviewer needs to see handled", async () => {
  // A fixture whose sentences are all clean declaratives lets a reviewer
  // approve the feature having never seen the case it exists for. §4's rule —
  // a hypothesis is not a fact, uncertainty is not a finding — is only
  // reviewable if the sample text contains some.
  const texts: string[] = [];
  for (let i = 0; i < 60; i++) {
    const r = await fixtureTranscription.transcribe({
      audio: Buffer.from(`r${i}`), contentType: "audio/webm",
    });
    if (r.ok) texts.push(r.text);
  }
  const all = texts.join("\n");
  const required: Array<[string, RegExp]> = [
    ["a hedge", /\b(I think|might|maybe|not sure|too early to say)\b/i],
    ["a negation", /\b(did not|does not|has not|no point)\b/i],
    ["a quoted patient statement", /"[^"]+"/],
    ["an approximate number", /\b(about|maybe) (a )?(four|seven|three|half|\d)/i],
    ["a named relationship", /\b(sister|brother)\b/i],
  ];
  for (const [what, pattern] of required) {
    assert.match(all, pattern, `no fabricated transcript contains ${what}`);
  }
});

test("at least one transcript has something to correct", async () => {
  // §3.2's promise is that a clinician can fix what Steady heard. A transcript
  // with nothing wrong in it never asks them to, so the review step would be
  // demonstrated without ever being exercised.
  const found: string[] = [];
  for (let i = 0; i < 60; i++) {
    const r = await fixtureTranscription.transcribe({
      audio: Buffer.from(`x${i}`), contentType: "audio/webm",
    });
    if (r.ok && r.lowConfidence.length > 0) found.push(r.text);
  }
  assert.ok(found.length > 0, "no fabricated transcript reports a low-confidence span");
  // The spans point at real offsets in their own text.
  const r = await fixtureTranscription.transcribe({
    audio: Buffer.from(found[0].slice(0, 4)), contentType: "audio/webm",
  });
  if (r.ok) {
    for (const s of r.lowConfidence) {
      assert.ok(s.start >= 0 && s.end <= r.text.length && s.start < s.end,
        `a low-confidence span (${s.start}, ${s.end}) is outside its transcript`);
      assert.ok(s.confidence < LOW_CONFIDENCE);
    }
  }
});

test("an empty recording is a permanent failure, not a fabricated transcript", async () => {
  const r = await fixtureTranscription.transcribe({ audio: Buffer.alloc(0), contentType: "audio/webm" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.retryable, false,
    "an empty recording is marked retryable, so it would be retried forever");
});

test("the unconfigured service is still what a real deployment gets", async () => {
  // The fixture must not have become the fallback for everybody.
  const r = await unconfiguredTranscription.transcribe({ audio: AUDIO, contentType: "audio/webm" });
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.retryable, "a deployment without a provider would stop retrying");
});
