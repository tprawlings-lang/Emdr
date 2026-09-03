// Audio object storage, behind a Steady service abstraction (§13).
//
// The spec's instruction is one sentence — "Keep object storage behind a Steady
// service abstraction. Do not encode one vendor's bucket API into clinical
// domain code" — and it is the same instruction ADR 0012 gives about model
// providers, for the same reason. A vendor SDK reached directly from a feature
// takes its retry semantics, its error shapes and its naming rules with it, and
// the feature quietly becomes unportable while every individual call looks fine.
//
// TWO RULES ARE ENFORCED HERE RATHER THAN DOCUMENTED.
//
//   THE OBJECT NAME CARRIES NO IDENTITY. §13: "tenant/person metadata outside
//   the object name where practical." A key like
//   `tenant-northside/sarah-m/2026-09-03.webm` leaks a patient's name and their
//   organization to anyone who can see a bucket listing, a log line, an error
//   message or a CDN access log — none of which are the places anyone thinks to
//   look for PHI. So a key is an opaque random id, and the mapping from key to
//   person lives in the database, behind the tenant scope.
//
//   AUDIO IS ENCRYPTED BEFORE IT IS STORED. §18 requires stored audio to use
//   "the same key management strategy used for other protected content", which
//   in this codebase is lib/crypto's envelope. The local adapter therefore
//   encrypts on put and decrypts on get, rather than trusting a future bucket's
//   at-rest setting to be configured correctly by somebody else.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not stream. Every method takes
// and returns a whole buffer, which is right for the 30-second-to-3-minute
// recordings §3.1 describes and would be wrong for hour-long audio. When that
// changes, this interface changes — which is the point of it being an
// interface.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { encryptField, decryptField } from "../crypto";

export interface StoredObject {
  /** Opaque. Carries no tenant, person, date or original filename. */
  key: string;
  bytes: number;
  contentType: string;
}

export interface ThoughtStorage {
  /** Stable id recorded alongside the object, so a later read knows which
   *  backend wrote it. */
  id: string;
  put(args: { data: Buffer; contentType: string }): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  /** Removes the object. Returns whether something was actually removed, so a
   *  caller can record a deletion that happened rather than one it requested —
   *  §13: "do not claim deletion before the object is removed." */
  remove(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

/** Content types a recording may arrive as. An allowlist rather than a
 *  denylist: the upload path accepts audio the browser's MediaRecorder
 *  produces, and anything else is a bug or an attack, not a format to support. */
export const ALLOWED_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
] as const;

/** §3.1 suggests 30 seconds to 3 minutes and says not to hard-stop at three
 *  "unless storage or transcription policy requires it". This is that policy
 *  limit: generous enough that the guidance stays guidance, bounded enough that
 *  an upload cannot be used to fill a disk. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export class AudioTooLargeError extends Error {}
export class UnsupportedAudioTypeError extends Error {}

export function assertStorableAudio(args: { bytes: number; contentType: string }): void {
  if (!(ALLOWED_AUDIO_TYPES as readonly string[]).includes(args.contentType)) {
    throw new UnsupportedAudioTypeError(`Unsupported audio type: ${args.contentType}`);
  }
  if (args.bytes > MAX_AUDIO_BYTES) {
    throw new AudioTooLargeError(
      `Recording is ${args.bytes} bytes; the limit is ${MAX_AUDIO_BYTES}.`
    );
  }
  if (args.bytes <= 0) {
    throw new AudioTooLargeError("Recording is empty.");
  }
}

/** An opaque key. 32 hex characters from a CSPRNG: not derived from the
 *  person, the tenant, the time or the filename, so it cannot be guessed from
 *  knowing any of them and reveals none of them if it leaks. */
export function newObjectKey(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// The local adapter
// ---------------------------------------------------------------------------

function storageDir(): string {
  return process.env.EMDR_AUDIO_DIR
    ?? path.join(process.env.EMDR_DATA_DIR ?? path.join(process.cwd(), ".data"), "audio");
}

/** Disk-backed storage for this single-instance deployment (ADR 0004).
 *
 *  Encrypts through the same envelope as every other protected field, so audio
 *  at rest is protected by the application rather than by a storage
 *  configuration this code cannot see. Base64 in, ciphertext out: the envelope
 *  is a string API, and a recording is bytes. */
export const localThoughtStorage: ThoughtStorage = {
  id: "local-disk",

  async put({ data, contentType }) {
    assertStorableAudio({ bytes: data.byteLength, contentType });
    const dir = storageDir();
    fs.mkdirSync(dir, { recursive: true });
    const key = newObjectKey();
    fs.writeFileSync(path.join(dir, key), encryptField(data.toString("base64")), "utf8");
    return { key, bytes: data.byteLength, contentType };
  },

  async get(key) {
    const file = path.join(storageDir(), safeKey(key));
    if (!fs.existsSync(file)) return null;
    return Buffer.from(decryptField(fs.readFileSync(file, "utf8")), "base64");
  },

  async remove(key) {
    const file = path.join(storageDir(), safeKey(key));
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  },

  async exists(key) {
    return fs.existsSync(path.join(storageDir(), safeKey(key)));
  },
};

/** A key is used as a filename, so it is validated as one.
 *
 *  `newObjectKey` only ever produces 32 hex characters, but this function is
 *  reached with whatever a database row holds, and a row is only as trustworthy
 *  as everything that has ever written to it. A key of `../../etc/passwd` must
 *  not resolve to a path outside the directory. */
function safeKey(key: string): string {
  if (!/^[0-9a-f]{32}$/.test(key)) {
    throw new Error("Malformed storage key.");
  }
  return key;
}

let active: ThoughtStorage = localThoughtStorage;

export function thoughtStorage(): ThoughtStorage {
  return active;
}

/** Swap the backend. For tests, and for the deployment that eventually puts
 *  this on real object storage — one adapter, written once, rather than a
 *  bucket SDK spreading through the domain. */
export function setThoughtStorage(s: ThoughtStorage): () => void {
  const previous = active;
  active = s;
  return () => { active = previous; };
}
