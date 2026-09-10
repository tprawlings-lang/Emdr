// Audio storage and the transcription interface (§13).
//
// Two rules here are worth guarding rather than trusting, because both fail
// invisibly:
//
//   AN OBJECT KEY LEAKS NOTHING. A key built from a tenant, a patient name or a
//   date shows up in bucket listings, log lines, error messages and CDN access
//   logs — none of which anyone treats as a place PHI lives. The failure is
//   silent because the feature works perfectly with a leaky key.
//
//   AN ABSENT TRANSCRIPTION PROVIDER FAILS RATHER THAN RETURNING NOTHING. Empty
//   text IS a transcript: it moves the thought to review and shows the clinician
//   a blank page asking them to check it. A retryable failure keeps the audio
//   and leaves the thought in processing, which is what is actually true.

process.env.EMDR_DATA_DIR = `/tmp/steady-audio-${process.pid}-${Date.now()}`;
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "audio-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  localThoughtStorage, newObjectKey, assertStorableAudio, ALLOWED_AUDIO_TYPES,
  MAX_AUDIO_BYTES, AudioTooLargeError, UnsupportedAudioTypeError,
  thoughtStorage, setThoughtStorage,
} from "../src/lib/clinical/thought-storage";
import {
  unconfiguredTranscription, transcriptionService, setTranscriptionService,
  hashTranscript, lowConfidenceSpans, LOW_CONFIDENCE,
} from "../src/lib/clinical/transcription";
import { isEncrypted } from "../src/lib/crypto";

const AUDIO = Buffer.from("fake webm bytes, but a real buffer");

test("an object key carries no identity", () => {
  const keys = Array.from({ length: 200 }, () => newObjectKey());
  for (const k of keys) {
    assert.match(k, /^[0-9a-f]{32}$/, `key is not opaque: ${k}`);
  }
  // Unguessable from anything a caller knows, and unique across calls.
  assert.equal(new Set(keys).size, keys.length, "keys collide");
  // Not derived from time: two keys made in the same millisecond differ, and
  // neither contains a recognisable timestamp.
  const now = String(Date.now()).slice(0, 8);
  assert.ok(!keys.some((k) => k.includes(now)), "a key embeds the current time");
});

test("audio is encrypted on disk", async () => {
  const stored = await localThoughtStorage.put({ data: AUDIO, contentType: "audio/webm" });
  const file = path.join(process.env.EMDR_DATA_DIR!, "audio", stored.key);
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(isEncrypted(raw), "the recording is on disk unencrypted");
  assert.ok(!raw.includes("real buffer"), "the recording's bytes are readable on disk");
  // And it round-trips byte for byte, so the encryption is not mangling audio.
  const back = await localThoughtStorage.get(stored.key);
  assert.ok(back);
  assert.equal(Buffer.compare(back!, AUDIO), 0, "the recording did not survive a round trip");
});

test("deletion is reported, not claimed", async () => {
  // §13: "do not claim deletion before the object is removed."
  const stored = await localThoughtStorage.put({ data: AUDIO, contentType: "audio/webm" });
  assert.equal(await localThoughtStorage.exists(stored.key), true);
  assert.equal(await localThoughtStorage.remove(stored.key), true);
  assert.equal(await localThoughtStorage.exists(stored.key), false);
  // A second delete removed nothing, and says so rather than reporting success.
  assert.equal(await localThoughtStorage.remove(stored.key), false);
  assert.equal(await localThoughtStorage.get(stored.key), null);
});

test("a malformed key cannot escape the storage directory", async () => {
  // A key reaches this function from a database row, and a row is only as
  // trustworthy as everything that has ever written to it.
  for (const bad of ["../../etc/passwd", "..", "a/b", "", "A".repeat(32), "z".repeat(32)]) {
    await assert.rejects(() => localThoughtStorage.get(bad), /Malformed storage key/,
      `${JSON.stringify(bad)} was accepted as a key`);
    await assert.rejects(() => localThoughtStorage.remove(bad), /Malformed storage key/);
  }
});

test("only recordable audio is storable", () => {
  for (const t of ALLOWED_AUDIO_TYPES) {
    assert.doesNotThrow(() => assertStorableAudio({ bytes: 1000, contentType: t }));
  }
  // An allowlist, so anything else is refused rather than enumerated.
  for (const t of ["text/html", "application/pdf", "image/png", "application/octet-stream"]) {
    assert.throws(() => assertStorableAudio({ bytes: 1000, contentType: t }),
      UnsupportedAudioTypeError, `${t} was accepted as audio`);
  }
  assert.throws(() => assertStorableAudio({ bytes: MAX_AUDIO_BYTES + 1, contentType: "audio/webm" }),
    AudioTooLargeError);
  assert.throws(() => assertStorableAudio({ bytes: 0, contentType: "audio/webm" }),
    AudioTooLargeError, "an empty recording was accepted");
});

test("the backend is swappable without the domain knowing", async () => {
  // §13: "Keep object storage behind a Steady service abstraction. Do not
  // encode one vendor's bucket API into clinical domain code."
  const seen: string[] = [];
  const restore = setThoughtStorage({
    id: "memory",
    async put({ data, contentType }) {
      seen.push("put");
      return { key: newObjectKey(), bytes: data.byteLength, contentType };
    },
    async get() { seen.push("get"); return null; },
    async remove() { return true; },
    async exists() { return false; },
  });
  try {
    await thoughtStorage().put({ data: AUDIO, contentType: "audio/webm" });
    await thoughtStorage().get("0".repeat(32));
    assert.deepEqual(seen, ["put", "get"]);
    assert.equal(thoughtStorage().id, "memory");
  } finally { restore(); }
  assert.equal(thoughtStorage().id, "local-disk", "the backend was not restored");
});

// ── Transcription ───────────────────────────────────────────────────────────

test("no provider is a retryable failure, never an empty transcript", async () => {
  const r = await unconfiguredTranscription.transcribe({ audio: AUDIO, contentType: "audio/webm" });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.retryable,
    "an unconfigured provider reports a permanent failure, so the audio would never be retried");
  // The distinction that matters: it did not return text. Empty text is a
  // transcript, and a transcript sends the clinician to a blank review page.
  assert.ok(!("text" in r), "the unconfigured provider returned a transcript");
});

test("a transcript's hash identifies that exact text", () => {
  assert.equal(hashTranscript("hello"), hashTranscript("hello"));
  assert.notEqual(hashTranscript("hello"), hashTranscript("hello "),
    "a trailing space produces the same hash, so a correction could look like no change");
  assert.match(hashTranscript("x"), /^[0-9a-f]{64}$/);
});

test("low-confidence spans are the ones below the threshold", () => {
  const spans = [
    { start: 0, end: 4, confidence: 0.99 },
    { start: 5, end: 9, confidence: LOW_CONFIDENCE },
    { start: 10, end: 14, confidence: LOW_CONFIDENCE - 0.01 },
  ];
  const low = lowConfidenceSpans(spans);
  assert.equal(low.length, 1, "the threshold is inclusive when it should be exclusive");
  assert.equal(low[0].start, 10);
});

test("a fixture provider can drive the whole path without a network", async () => {
  // ADR 0012 §7 wants evaluation runnable "in CI against recorded fixtures
  // without live provider calls", and the same applies here.
  const restore = setTranscriptionService({
    id: "fixture",
    async transcribe() {
      const text = "She seemed steadier today.";
      return {
        ok: true, text, hash: hashTranscript(text), provider: "fixture",
        model: "fixture-1", language: "en", lowConfidence: [], durationMs: 58_000,
      };
    },
  });
  try {
    const r = await transcriptionService().transcribe({ audio: AUDIO, contentType: "audio/webm" });
    assert.ok(r.ok);
    assert.ok(r.ok && r.hash === hashTranscript(r.text),
      "the reported hash does not match the reported text");
  } finally { restore(); }
  assert.equal(transcriptionService().id, "unconfigured");
});
