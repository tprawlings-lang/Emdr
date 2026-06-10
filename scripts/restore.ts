// Restore a backup into a local data directory.
//
//   npx tsx scripts/restore.ts --out .restore                # latest from R2
//   npx tsx scripts/restore.ts --out .restore --key steady/emdr-....db.age
//   npx tsx scripts/restore.ts --out .restore --file path/to/backup.db.age
//
// Decryption identity (AGE-SECRET-KEY-1...) comes from BACKUP_AGE_IDENTITY or
// --identity-file <path>. The output is a ready-to-serve EMDR_DATA_DIR
// containing emdr.db. See docs/backups.md for the full procedure.
import fs from "fs";
import path from "path";
import { Decrypter } from "age-encryption";
import Database from "better-sqlite3";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const out = arg("--out") ?? ".restore";
  const file = arg("--file");
  const keyArg = arg("--key");

  let identity = process.env.BACKUP_AGE_IDENTITY?.trim();
  const identityFile = arg("--identity-file");
  if (!identity && identityFile) {
    identity = fs
      .readFileSync(identityFile, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("AGE-SECRET-KEY-"));
  }
  if (!identity) {
    console.error("No identity: set BACKUP_AGE_IDENTITY or pass --identity-file <keyfile>");
    process.exit(1);
  }

  let ciphertext: Uint8Array;
  let source: string;
  if (file) {
    ciphertext = fs.readFileSync(file);
    source = file;
  } else {
    const { latestBackupKey, downloadBackup } = await import("../src/lib/backup");
    const key = keyArg ?? (await latestBackupKey())?.key;
    if (!key) {
      console.error("No backup objects found in R2 (or R2 env vars not set).");
      process.exit(1);
    }
    console.log(`Downloading ${key} from R2…`);
    ciphertext = await downloadBackup(key);
    source = key;
  }

  const dec = new Decrypter();
  dec.addIdentity(identity);
  const plaintext = await dec.decrypt(ciphertext);

  fs.mkdirSync(out, { recursive: true });
  const dbPath = path.join(out, "emdr.db");
  // Remove any stale WAL/SHM so SQLite opens the snapshot cleanly.
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
  fs.writeFileSync(dbPath, plaintext);

  // Integrity + a quick shape check so a bad restore fails loudly here,
  // not when the app boots.
  const db = new Database(dbPath, { readonly: true });
  const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  const users = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  db.close();
  if (integrity.integrity_check !== "ok") {
    console.error(`Integrity check FAILED: ${integrity.integrity_check}`);
    process.exit(1);
  }
  console.log(`Restored ${source} → ${dbPath}`);
  console.log(`Integrity: ok · users: ${users.n}`);
  console.log(`Serve it with: EMDR_DATA_DIR=${path.resolve(out)} PORT=3999 npm run start`);
}

main().catch((err) => {
  console.error("Restore failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
