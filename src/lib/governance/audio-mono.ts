// Produced audio is mono, or stereo with identical channels (Handoff 10 1E
// and §8.3). CI runs it through scripts/check-audio-mono.ts; the @safety suite
// proves it catches what it is for (tests/audio-mono-check.test.ts). It lives
// here so the work register and the tests can see it; nothing in the app
// imports it.
//
//   npx tsx scripts/check-audio-mono.ts [dir]      (default: assets/audio)
//
// WHY: v1 has no bilateral stimulation, and audio that moves between the ears
// is bilateral stimulation by another route. A recording with channels that
// differ is rejected before it can reach a member.
//
// THE RULE, and what it adds to the handoff's. The handoff: fail any file whose
// L/R correlation is below 0.99. Correlation alone has two blind spots, so this
// also fails on them:
//   - it is blind to a steady level difference (right = half of left
//     correlates perfectly, and is a static pan), so the two channels' levels
//     must also match within 1 dB;
//   - over a whole file, a short panned passage averages away, so every
//     one-second window that carries sound must clear 0.99 too.
//
// FAILS CLOSED. Only WAV masters (PCM 8/16/24/32-bit, or 32/64-bit float) can
// be read here, so any other file under the directory fails with that said:
// an unreadable file is not a passing one. Encoded copies for delivery are made
// from a checked master, outside this directory. README.md and dotfiles are
// the only other files allowed.

import fs from "node:fs";
import path from "node:path";

export const AUDIO_ASSET_DIR = "assets/audio";
export const MIN_CORRELATION = 0.99;
export const MAX_LEVEL_DIFF_DB = 1;
/** A window quieter than this (about -50 dBFS) carries no sound to judge. */
const SILENCE_RMS = 0.00316;

export interface AudioVerdict {
  file: string;
  ok: boolean;
  reason?: string;
  channels?: number;
  correlation?: number;
  worstWindow?: number;
  levelDiffDb?: number;
}

interface Decoded { channels: number; sampleRate: number; samples: Float64Array[] }

/** Read a WAV file into per-channel samples in [-1, 1]. Throws on anything
 *  it cannot read, with the reason. */
export function decodeWav(buf: Buffer): Decoded {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let fmt: { format: number; channels: number; sampleRate: number; bits: number; blockAlign: number } | null = null;
  let data: Buffer | null = null;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString("ascii", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    const body = buf.subarray(o + 8, Math.min(buf.length, o + 8 + size));
    if (id === "fmt ") {
      let format = body.readUInt16LE(0);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format GUID's first two bytes.
      if (format === 0xfffe && body.length >= 26) format = body.readUInt16LE(24);
      fmt = { format, channels: body.readUInt16LE(2), sampleRate: body.readUInt32LE(4), blockAlign: body.readUInt16LE(12), bits: body.readUInt16LE(14) };
    } else if (id === "data") {
      data = body;
    }
    o += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error("no fmt chunk");
  if (!data) throw new Error("no data chunk");
  const { format, channels, bits, blockAlign } = fmt;
  const pcm = format === 1 && [8, 16, 24, 32].includes(bits);
  const float = format === 3 && (bits === 32 || bits === 64);
  if (!pcm && !float) throw new Error(`unsupported encoding (format ${format}, ${bits}-bit)`);
  if (channels < 1) throw new Error("no channels");
  const bytes = bits / 8;
  const frames = Math.floor(data.length / blockAlign);
  const samples = Array.from({ length: channels }, () => new Float64Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const at = f * blockAlign + c * bytes;
      let v: number;
      if (float) v = bits === 32 ? data.readFloatLE(at) : data.readDoubleLE(at);
      else if (bits === 8) v = (data.readUInt8(at) - 128) / 128;
      else if (bits === 16) v = data.readInt16LE(at) / 32768;
      else if (bits === 24) v = data.readIntLE(at, 3) / 8388608;
      else v = data.readInt32LE(at) / 2147483648;
      samples[c][f] = v;
    }
  }
  return { channels, sampleRate: fmt.sampleRate, samples };
}

function rms(x: Float64Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return to > from ? Math.sqrt(s / (to - from)) : 0;
}

/** Pearson correlation over [from, to). Two flat channels that are equal
 *  correlate fully; one flat channel beside a moving one does not at all. */
export function correlation(a: Float64Array, b: Float64Array, from = 0, to = a.length): number {
  const n = to - from;
  if (n <= 0) return 1;
  let ma = 0, mb = 0;
  for (let i = from; i < to; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = from; i < to; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  if (saa === 0 && sbb === 0) {
    for (let i = from; i < to; i++) if (a[i] !== b[i]) return 0;
    return 1;
  }
  if (saa === 0 || sbb === 0) return 0;
  return sab / Math.sqrt(saa * sbb);
}

export function checkAudioFile(file: string): AudioVerdict {
  if (path.extname(file).toLowerCase() !== ".wav") {
    return { file, ok: false, reason: "only WAV masters can be checked, so this file cannot be shown to be mono" };
  }
  let d: Decoded;
  try {
    d = decodeWav(fs.readFileSync(file));
  } catch (e) {
    return { file, ok: false, reason: `unreadable: ${(e as Error).message}` };
  }
  if (d.channels === 1) return { file, ok: true, channels: 1 };
  if (d.channels > 2) return { file, ok: false, channels: d.channels, reason: `${d.channels} channels; mono or two identical channels only` };
  const [l, r] = d.samples;
  const whole = correlation(l, r);
  const window = Math.max(1, d.sampleRate);
  let worst = 1;
  for (let from = 0; from < l.length; from += window) {
    const to = Math.min(l.length, from + window);
    if (Math.max(rms(l, from, to), rms(r, from, to)) < SILENCE_RMS) continue;
    worst = Math.min(worst, correlation(l, r, from, to));
  }
  const rl = rms(l), rr = rms(r);
  const levelDiffDb = rl === 0 && rr === 0 ? 0 : rl === 0 || rr === 0 ? Infinity : Math.abs(20 * Math.log10(rl / rr));
  const verdict: AudioVerdict = { file, ok: true, channels: 2, correlation: whole, worstWindow: worst, levelDiffDb };
  if (whole < MIN_CORRELATION) return { ...verdict, ok: false, reason: `left/right correlation ${whole.toFixed(3)} is below ${MIN_CORRELATION}` };
  if (worst < MIN_CORRELATION) return { ...verdict, ok: false, reason: `a one-second stretch correlates only ${worst.toFixed(3)} left to right` };
  if (levelDiffDb > MAX_LEVEL_DIFF_DB) return { ...verdict, ok: false, reason: `the channels differ in level by ${levelDiffDb.toFixed(1)} dB` };
  return verdict;
}

/** Every file under the directory. A missing or empty directory passes:
 *  there is nothing to reach a member. */
export function checkAudioDir(dir: string): AudioVerdict[] {
  if (!fs.existsSync(dir)) return [];
  const out: AudioVerdict[] = [];
  const visit = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) visit(p);
      else if (e.name !== "README.md") out.push(checkAudioFile(p));
    }
  };
  visit(dir);
  return out;
}
