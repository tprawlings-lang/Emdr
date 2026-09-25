// The audio mono check (Handoff 10 §8.3; row CV10_F03): proves the script
// catches what it is for, on files written here, before any real recording
// exists. A check that has never seen a failing file is not yet a check.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkAudioDir, checkAudioFile, correlation, decodeWav } from "../src/lib/governance/audio-mono";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steady-audio-"));
const RATE = 8000;

/** A WAV file from per-channel sample functions. */
function wav(name: string, seconds: number, channels: Array<(t: number) => number>, bits: 16 | 24 | 32 = 16, float = false): string {
  const frames = Math.round(seconds * RATE);
  const bytes = bits / 8;
  const blockAlign = bytes * channels.length;
  const data = Buffer.alloc(frames * blockAlign);
  for (let f = 0; f < frames; f++) {
    channels.forEach((fn, c) => {
      const v = Math.max(-1, Math.min(1, fn(f / RATE)));
      const at = f * blockAlign + c * bytes;
      if (float) data.writeFloatLE(v, at);
      else if (bits === 16) data.writeInt16LE(Math.round(v * 32767), at);
      else if (bits === 24) data.writeIntLE(Math.round(v * 8388607), at, 3);
      else data.writeInt32LE(Math.round(v * 2147483647), at);
    });
  }
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(float ? 3 : 1, 0);
  fmt.writeUInt16LE(channels.length, 2);
  fmt.writeUInt32LE(RATE, 4);
  fmt.writeUInt32LE(RATE * blockAlign, 8);
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(bits, 14);
  const chunk = (id: string, body: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, "ascii");
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body]);
  };
  const body = Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", fmt), chunk("data", data)]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.concat([riff, body]));
  return p;
}

// A voice-like signal: a few non-harmonic partials, so correlation means something.
const voice = (t: number) => 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 347 * t) + 0.1 * Math.sin(2 * Math.PI * 911 * t);

test("the decoder reads back what was written, in every accepted encoding", () => {
  for (const [bits, float] of [[16, false], [24, false], [32, false], [32, true]] as const) {
    const d = decodeWav(fs.readFileSync(wav(`rt-${bits}-${float}.wav`, 0.1, [voice, voice], bits, float)));
    assert.equal(d.channels, 2);
    assert.equal(d.sampleRate, RATE);
    assert.ok(Math.abs(d.samples[0][10] - voice(10 / RATE)) < 1e-3, `${bits}-bit ${float ? "float" : "pcm"} decoded wrong`);
  }
});

test("mono and identical stereo pass", () => {
  assert.equal(checkAudioFile(wav("mono.wav", 2, [voice])).ok, true);
  const same = checkAudioFile(wav("same.wav", 2, [voice, voice], 24));
  assert.equal(same.ok, true, same.reason);
  assert.ok(same.correlation! > 0.999);
  assert.equal(checkAudioFile(wav("same-float.wav", 2, [voice, voice], 32, true)).ok, true);
});

test("sound that alternates between the ears fails (the bilateral shape)", () => {
  // One full left-right cycle per second: the handoff's 0.5 to 2 Hz band.
  const pan = (t: number) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 1 * t);
  const v = checkAudioFile(wav("alternating.wav", 4, [(t) => voice(t) * pan(t), (t) => voice(t) * (1 - pan(t))]));
  assert.equal(v.ok, false);
  // The handoff's own rule — whole-file correlation — is what catches it first.
  assert.match(v.reason!, /^left\/right correlation/);
});

test("a steady pan fails even though it correlates perfectly", () => {
  const v = checkAudioFile(wav("static-pan.wav", 2, [voice, (t) => 0.5 * voice(t)]));
  assert.ok(v.correlation! > 0.999, "the fixture should correlate — that is the blind spot");
  assert.equal(v.ok, false);
  assert.match(v.reason!, /level/);
});

test("a short panned passage in a long file fails, though the whole file averages above 0.99", () => {
  const pan = (t: number) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 1 * t);
  const inBurst = (t: number) => t >= 20 && t < 21;
  const l = (t: number) => (inBurst(t) ? voice(t) * pan(t) : voice(t));
  const r = (t: number) => (inBurst(t) ? voice(t) * (1 - pan(t)) : voice(t));
  const p = wav("burst.wav", 40, [l, r]);
  const v = checkAudioFile(p);
  assert.ok(v.correlation! >= 0.99, `the fixture's whole-file correlation should pass (${v.correlation}) — that is the blind spot`);
  assert.equal(v.ok, false);
  assert.match(v.reason!, /one-second stretch/);
});

test("sound in one ear only fails", () => {
  const v = checkAudioFile(wav("one-ear.wav", 2, [voice, () => 0]));
  assert.equal(v.ok, false);
});

test("silence is not judged, and identical silence passes", () => {
  const v = checkAudioFile(wav("quiet-start.wav", 3, [(t) => (t < 1 ? 0 : voice(t)), (t) => (t < 1 ? 0 : voice(t))]));
  assert.equal(v.ok, true, v.reason);
  assert.equal(correlation(new Float64Array(4), new Float64Array(4)), 1);
});

test("it fails closed: other formats, broken files and more than two channels", () => {
  const mp3 = path.join(dir, "voice.mp3");
  fs.writeFileSync(mp3, Buffer.from("ID3 not really"));
  const broken = path.join(dir, "broken.wav");
  fs.writeFileSync(broken, Buffer.from("RIFF\0\0\0\0WAVE"));
  const quad = wav("quad.wav", 0.5, [voice, voice, voice, voice]);
  for (const [f, why] of [[mp3, /only WAV/], [broken, /unreadable/], [quad, /4 channels/]] as const) {
    const v = checkAudioFile(f);
    assert.equal(v.ok, false, `${path.basename(f)} passed`);
    assert.match(v.reason!, why);
  }
});

test("the directory walk checks every file but README and dotfiles; a missing directory passes", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "steady-audio-dir-"));
  fs.mkdirSync(path.join(d, "voice"));
  fs.writeFileSync(path.join(d, "README.md"), "notes");
  fs.writeFileSync(path.join(d, ".gitkeep"), "");
  fs.copyFileSync(path.join(dir, "mono.wav"), path.join(d, "voice", "a.wav"));
  fs.copyFileSync(path.join(dir, "static-pan.wav"), path.join(d, "voice", "b.wav"));
  const r = checkAudioDir(d);
  assert.deepEqual(r.map((x) => [path.basename(x.file), x.ok]), [["a.wav", true], ["b.wav", false]]);
  assert.deepEqual(checkAudioDir(path.join(d, "nope")), []);
});

test("the real asset directory passes today", () => {
  const bad = checkAudioDir("assets/audio").filter((r) => !r.ok);
  assert.deepEqual(bad, []);
});
