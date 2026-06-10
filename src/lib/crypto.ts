import crypto from "crypto";

// Application-layer encryption for member-entered free text (compliance 2.4):
// chat messages, companion memory values, trigger notes, safety-plan text,
// and screener answers are AES-256-GCM encrypted with a key held in the
// platform secrets manager (EMDR_DATA_KEY) — a database dump alone never
// exposes member content.
//
// Values are tagged "enc1:" so legacy plaintext rows decrypt as themselves
// (passthrough) and re-encrypt on next write. Without a key configured
// (local dev), fields pass through unchanged.

const PREFIX = "enc1:";

let cachedKey: Buffer | null | undefined;

function key(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.EMDR_DATA_KEY;
  if (!raw) {
    cachedKey = null;
    return cachedKey;
  }
  // Accept any secret string; derive a stable 32-byte key.
  cachedKey = crypto.createHash("sha256").update(raw).digest();
  return cachedKey;
}

export function dataEncryptionEnabled(): boolean {
  return key() !== null;
}

export function encryptField(value: string): string;
export function encryptField(value: string | null): string | null;
export function encryptField(value: string | null): string | null {
  if (value === null || value === "") return value;
  const k = key();
  if (!k) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptField(value: string): string;
export function decryptField(value: string | null): string | null;
export function decryptField(value: string | null): string | null {
  if (value === null || !value.startsWith(PREFIX)) return value;
  const k = key();
  if (!k) return "[encrypted]";
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or corrupted row: fail closed, never throw into a page.
    return "[encrypted]";
  }
}
