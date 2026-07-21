import { test } from "node:test";
import assert from "node:assert/strict";

// The module derives + caches the key lazily on first use (not at import), so
// setting the env var here — before any test calls encrypt/decrypt — is enough.
process.env.EMDR_DATA_KEY = "unit-test-data-key-please-ignore";

import { encryptField, decryptField, dataEncryptionEnabled } from "../src/lib/crypto.ts";

test("encryption is enabled when a key is present", () => {
  assert.equal(dataEncryptionEnabled(), true);
});

test("round-trips member free text", () => {
  const plain = "I felt anxious near the water today — SUDS 6.";
  const ct = encryptField(plain);
  assert.notEqual(ct, plain);
  assert.match(ct, /^enc1:/);
  assert.equal(decryptField(ct), plain);
});

test("ciphertext is non-deterministic (fresh IV per call)", () => {
  const a = encryptField("same input");
  const b = encryptField("same input");
  assert.notEqual(a, b); // random IV
  assert.equal(decryptField(a), "same input");
  assert.equal(decryptField(b), "same input");
});

test("null and empty pass through unchanged", () => {
  assert.equal(encryptField(null), null);
  assert.equal(encryptField(""), "");
  assert.equal(decryptField(null), null);
  assert.equal(decryptField(""), "");
});

test("legacy plaintext (no enc1: prefix) decrypts as itself", () => {
  // Rows written before encryption was enabled decrypt as passthrough.
  assert.equal(decryptField("legacy plaintext row"), "legacy plaintext row");
});
