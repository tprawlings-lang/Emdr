// The backup, actually taken and actually readable.
//
// THE REGISTER FOUND THIS ON ITS FIRST RUN: `runBackup` was built, shipped and
// named by no test at all. It is the code that stands between a lost disk and
// everything a pilot participant has ever told this product — the fitness
// screener asks about suicidal thoughts in the past thirty days and the daily
// check-in asks about harm urges — and the environment guard already warns that
// with enrollment open and backups off, those answers exist in one place only.
//
// WHAT A BACKUP TEST HAS TO PROVE IS THAT IT RESTORES. "The function returned a
// key" is the test that passes while the bytes are garbage, and nobody finds
// out until the day somebody needs them. So the test below takes a real
// snapshot of a real database, encrypts it to a real age key, decrypts it with
// the matching identity, opens the result as a database and reads a row back.
//
// AND THAT IT NEVER WRITES PLAINTEXT. A snapshot of this database in the clear
// is worse than no backup: no backup loses the data, and a plaintext one hands
// it to whoever finds the file. That property gets its own test, and a
// mutation that removes the encryption step has to fail it.

process.env.EMDR_DATA_DIR = `/tmp/steady-backup-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_SESSION_SECRET = "backup-test-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "backup-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Decrypter, generateIdentity, identityToRecipient } from "age-encryption";
import Database from "better-sqlite3";

import { getDb } from "../src/lib/db";
import {
  runBackup, backupConfigured, r2Configured, readBackupState,
} from "../src/lib/backup";

const db = getDb();
const MARKER = `backup-marker-${process.pid}`;
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'A Person', 'member', 'x')"
).run(MARKER, `${MARKER}@example.test`);

/** A real age keypair, so the test decrypts what the product encrypted. */
async function keypair(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateIdentity();
  return { identity, recipient: await identityToRecipient(identity) };
}

function tmpdir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `steady-backup-test-${tag}-`));
}

async function withRecipient<T>(recipient: string | undefined, fn: () => Promise<T>): Promise<T> {
  const before = process.env.BACKUP_AGE_RECIPIENT;
  if (recipient === undefined) delete process.env.BACKUP_AGE_RECIPIENT;
  else process.env.BACKUP_AGE_RECIPIENT = recipient;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.BACKUP_AGE_RECIPIENT;
    else process.env.BACKUP_AGE_RECIPIENT = before;
  }
}

test("a backup restores: the bytes decrypt to a database with the data in it", async () => {
  // THE ONLY TEST THAT MATTERS. Everything else here is about how it fails;
  // this is the one that says the thing works. A backup nobody has restored
  // from is a belief, not a backup.
  const { identity, recipient } = await keypair();
  const dir = tmpdir("roundtrip");

  const result = await withRecipient(recipient, () => runBackup({ localDir: dir }));
  assert.ok(result.bytes > 0, "the backup is empty");
  assert.equal(result.uploaded, false, "a local backup reported itself as uploaded off-site");

  const written = fs.readdirSync(dir);
  assert.equal(written.length, 1, `expected one file, got ${written.join(", ")}`);

  const ciphertext = fs.readFileSync(path.join(dir, written[0]));
  const d = new Decrypter();
  d.addIdentity(identity);
  const plaintext = await d.decrypt(new Uint8Array(ciphertext));

  const restoredPath = path.join(dir, "restored.db");
  fs.writeFileSync(restoredPath, plaintext);
  const restored = new Database(restoredPath, { readonly: true });
  try {
    const row = restored.prepare("SELECT id, name FROM users WHERE id = ?").get(MARKER) as
      | { id: string; name: string } | undefined;
    assert.ok(row, "the restored database does not contain the row that was in the live one");
    assert.equal(row.name, "A Person");
  } finally {
    restored.close();
  }
});

test("without a key, it refuses rather than writing the database in the clear", async () => {
  // A PLAINTEXT SNAPSHOT IS WORSE THAN NO BACKUP. No backup loses the data; a
  // plaintext one hands it to whoever finds the file — and this database holds
  // answers about suicidal thoughts and harm urges.
  const dir = tmpdir("norecipient");
  await withRecipient(undefined, async () => {
    await assert.rejects(
      () => runBackup({ localDir: dir }),
      /BACKUP_AGE_RECIPIENT/,
      "a backup was taken with no key to encrypt it to",
    );
  });
  assert.deepEqual(
    fs.readdirSync(dir), [],
    "a file was left behind after the refusal, so something was written unencrypted",
  );
});

test("what it writes is not readable without the key", async () => {
  // The inverse of the round trip, and worth asserting separately: a mutation
  // that skipped the encryption step would still round-trip if the test only
  // checked that the bytes came back.
  const { recipient } = await keypair();
  const dir = tmpdir("opaque");
  await withRecipient(recipient, () => runBackup({ localDir: dir }));
  const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]));

  // A SQLite file starts with this exact string. If it is there, the snapshot
  // went out in the clear.
  assert.notEqual(
    raw.subarray(0, 15).toString("utf8"), "SQLite format 3",
    "the backup is an unencrypted database file",
  );
  assert.ok(
    !raw.toString("latin1").includes(MARKER),
    "a user id is readable in the backup without decrypting it",
  );
  // And it is an age file, rather than merely not-a-database.
  assert.match(raw.subarray(0, 20).toString("utf8"), /^age-encryption\.org/);
});

test("a wrong key does not open it", async () => {
  const a = await keypair();
  const b = await keypair();
  const dir = tmpdir("wrongkey");
  await withRecipient(a.recipient, () => runBackup({ localDir: dir }));
  const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]));

  const d = new Decrypter();
  d.addIdentity(b.identity);
  await assert.rejects(
    () => Promise.resolve(d.decrypt(new Uint8Array(raw))),
    "somebody else's key opened the backup",
  );
});

test("a success is recorded where the status screen reads it", async () => {
  // A backup nobody can see the result of is a backup nobody notices has
  // stopped. The state file is what the environment health panel reads.
  const { recipient } = await keypair();
  const dir = tmpdir("state");
  const result = await withRecipient(recipient, () => runBackup({ localDir: dir }));
  const state = readBackupState();
  assert.equal(state.lastKey, result.key, "the recorded key is not the one just written");
  assert.equal(state.lastBytes, result.bytes);
  assert.ok(state.lastSuccessAt, "no success time was recorded, so age cannot be shown");
  assert.ok(
    Date.now() - Date.parse(state.lastSuccessAt!) < 120_000,
    "the recorded success time is not from this run",
  );
});

test("off-site is configured only when BOTH the store and the key are set", async () => {
  // Four R2 variables and a key. `backupConfigured` gating on the store alone
  // would report a deployment as backed up while every attempt refused for
  // want of a key — which is the failure that looks fine on a dashboard.
  const before = { ...process.env };
  try {
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
      process.env[k] = "placeholder-not-a-real-credential";
    }
    delete process.env.BACKUP_AGE_RECIPIENT;
    assert.equal(r2Configured(), true);
    assert.equal(
      backupConfigured(), false,
      "a deployment with nowhere to encrypt to reported itself as backed up",
    );
    process.env.BACKUP_AGE_RECIPIENT = (await keypair()).recipient;
    assert.equal(backupConfigured(), true);
  } finally {
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "BACKUP_AGE_RECIPIENT"]) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
});

test("a local backup never reaches for a bucket that is not there", async () => {
  // `localDir` is the path the restore drill and this suite use. If it fell
  // through to the S3 client it would fail in an environment with no
  // credentials, which is every environment that most needs a rehearsal.
  const { recipient } = await keypair();
  const dir = tmpdir("nobucket");
  const before = process.env.R2_BUCKET;
  delete process.env.R2_BUCKET;
  try {
    const r = await withRecipient(recipient, () => runBackup({ localDir: dir }));
    assert.equal(r.uploaded, false);
    assert.equal(r.pruned, 0, "a local backup pruned something in a bucket it never opened");
  } finally {
    if (before !== undefined) process.env.R2_BUCKET = before;
  }
});
