// Identifier generation for the longitudinal spine (ADR 0010).
//
// Durable entities on the new spine use ULIDs rather than UUIDv4: a ULID's
// leading 48 bits are the millisecond timestamp, so lexical sort == creation
// order. That matters because `LongitudinalEvent` is an ordered log — with
// random UUIDs, replaying "events in order" requires a separate sort key and a
// tiebreak, and any clock skew between writers silently reorders history.
//
// Monotonic within a millisecond: when two IDs are generated in the same
// millisecond the random component is incremented rather than redrawn, so
// ordering holds for rapid successive appends (a command that emits several
// events, for instance).
//
// `newId()` in db.ts (UUIDv4) is unchanged and still used by every existing
// table. This is additive.

import crypto from "node:crypto";

// Crockford base32: no I, L, O, or U (avoids transcription ambiguity).
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

/** The reserved nil ULID. Used for the platform tenant so the value is stable
 *  across every environment and obviously reserved on sight. */
export const NIL_ULID = "00000000000000000000000000";

let lastTime = 0;
let lastRandom: number[] = [];

function encodeTime(now: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ENCODING[now % 32] + out;
    now = Math.floor(now / 32);
  }
  return out;
}

function randomChars(): number[] {
  const bytes = crypto.randomBytes(RANDOM_LEN);
  return Array.from(bytes, (b) => b % 32);
}

/** Increment the random component in place, carrying left. Returns false if the
 *  whole component overflowed (astronomically unlikely — 32^16 values). */
function incrementRandom(chars: number[]): boolean {
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] < 31) {
      chars[i]++;
      return true;
    }
    chars[i] = 0;
  }
  return false;
}

/** A lexically-sortable, monotonic 26-character identifier. */
export function ulid(now: number = Date.now()): string {
  if (now === lastTime && lastRandom.length > 0) {
    if (!incrementRandom(lastRandom)) {
      // Overflowed within the millisecond: fall forward a millisecond rather
      // than emit an out-of-order id.
      lastTime = now + 1;
      lastRandom = randomChars();
      return encodeTime(lastTime) + lastRandom.map((c) => ENCODING[c]).join("");
    }
  } else {
    lastTime = now;
    lastRandom = randomChars();
  }
  return encodeTime(lastTime) + lastRandom.map((c) => ENCODING[c]).join("");
}

/** A ULID derived deterministically from a timestamp and a seed string.
 *
 *  Used by the genesis backfill (ADR 0010 step 3): the time component comes from
 *  the source row's own timestamp, so reconstructed events sort into their true
 *  chronological position, and the random component is a hash of the source
 *  row's identity, so re-running the backfill produces the *same* id and the
 *  insert conflicts instead of duplicating. Idempotency without a tracking
 *  table. */
export function ulidFrom(timestampMs: number, seed: string): string {
  const digest = crypto.createHash("sha256").update(seed).digest();
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) out += ENCODING[digest[i] % 32];
  return encodeTime(Math.max(0, Math.floor(timestampMs))) + out;
}

/** Milliseconds encoded in a ULID's time component; null if malformed. */
export function ulidTime(id: string): number | null {
  if (!isUlid(id)) return null;
  let t = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const v = ENCODING.indexOf(id[i]);
    if (v < 0) return null;
    t = t * 32 + v;
  }
  return t;
}

export function isUlid(id: unknown): id is string {
  if (typeof id !== "string" || id.length !== TIME_LEN + RANDOM_LEN) return false;
  for (const ch of id) if (ENCODING.indexOf(ch) < 0) return false;
  return true;
}
