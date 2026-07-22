import fs from "fs";
import os from "os";
import path from "path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Encrypter } from "age-encryption";
import { getDb } from "./db";
import { audit } from "./audit";
import { withRetry, isTransientHttpError } from "./retry";

// Nightly encrypted off-site backups (compliance 2.6).
//
// - Snapshot: better-sqlite3's db.backup() — SQLite's Online Backup API, the
//   same mechanism as the `sqlite3 .backup` CLI command, safe while the app
//   is serving traffic (WAL mode).
// - Encryption: age (X25519) to the public recipient in BACKUP_AGE_RECIPIENT.
//   The matching AGE-SECRET-KEY never exists on the server; restores happen
//   wherever the operator keeps the identity (see docs/backups.md).
// - Storage: Cloudflare R2 via the S3 API. Retention: BACKUP_RETENTION_DAYS
//   (default 30); older objects are pruned after each successful upload.
// - Failure alerting: email via Resend when RESEND_API_KEY and
//   BACKUP_ALERT_EMAIL are set; always logged and audited.
//
// Scheduling runs in-process (src/instrumentation.ts) because the Render
// disk is only mounted in the web service — a separate cron service could
// not see the database file.

const PREFIX = "steady/";

export interface BackupResult {
  key: string;
  bytes: number;
  uploaded: boolean;
  pruned: number;
}

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET
  );
}

export function backupConfigured(): boolean {
  return r2Configured() && Boolean(process.env.BACKUP_AGE_RECIPIENT);
}

function s3(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    // Explicit resilience posture: the SDK retries transient S3 errors with
    // its standard exponential-backoff strategy (default 3 attempts → 4 here).
    maxAttempts: 4,
  });
}

function stateFile(): string {
  const dir = process.env.EMDR_DATA_DIR ?? path.join(process.cwd(), ".data");
  return path.join(dir, "backup-state.json");
}

export interface BackupState {
  lastSuccessAt?: string;
  lastKey?: string;
  lastBytes?: number;
  lastFailureAt?: string;
  lastError?: string;
}

export function readBackupState(): BackupState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as BackupState;
  } catch {
    return {};
  }
}

function writeBackupState(patch: Partial<BackupState>) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...readBackupState(), ...patch }, null, 2));
  } catch (err) {
    console.error("backup: could not persist state file:", err);
  }
}

async function encryptSnapshot(snapshotPath: string): Promise<Uint8Array> {
  const recipient = process.env.BACKUP_AGE_RECIPIENT;
  if (!recipient) throw new Error("BACKUP_AGE_RECIPIENT is not set");
  const enc = new Encrypter();
  enc.addRecipient(recipient.trim());
  return enc.encrypt(fs.readFileSync(snapshotPath));
}

async function prune(client: S3Client, bucket: string, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 86400000;
  const stale: { Key: string }[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token })
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) {
        stale.push({ Key: obj.Key });
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  for (let i = 0; i < stale.length; i += 1000) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: stale.slice(i, i + 1000), Quiet: true },
      })
    );
  }
  return stale.length;
}

/**
 * Take a snapshot, encrypt, upload, prune. With `localDir` set, the encrypted
 * file is written there instead of uploading (used by `npm run backup -- --local`
 * and the test suite; exercises the full pipeline except R2).
 */
export async function runBackup(opts: { localDir?: string } = {}): Promise<BackupResult> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
  const key = `${PREFIX}emdr-${stamp}.db.age`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steady-backup-"));
  const snapshotPath = path.join(tmp, "snapshot.db");
  try {
    await getDb().backup(snapshotPath);
    const ciphertext = await encryptSnapshot(snapshotPath);

    let pruned = 0;
    let uploaded = false;
    if (opts.localDir) {
      fs.mkdirSync(opts.localDir, { recursive: true });
      fs.writeFileSync(path.join(opts.localDir, path.basename(key)), ciphertext);
    } else {
      if (!r2Configured()) throw new Error("R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET)");
      const client = s3();
      const bucket = process.env.R2_BUCKET!;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: ciphertext,
          ContentType: "application/octet-stream",
        })
      );
      uploaded = true;
      const retention = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
      pruned = await prune(client, bucket, retention);
    }

    const result: BackupResult = { key, bytes: ciphertext.byteLength, uploaded, pruned };
    writeBackupState({ lastSuccessAt: new Date().toISOString(), lastKey: key, lastBytes: result.bytes });
    await audit({
      actorRole: "system",
      family: "security",
      type: "backup_completed",
      target: key,
      detail: { bytes: result.bytes, uploaded, pruned },
    });
    return result;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Newest backup object in the bucket (used by the restore script). */
export async function latestBackupKey(): Promise<{ key: string; lastModified: Date } | null> {
  const client = s3();
  let newest: { key: string; lastModified: Date } | null = null;
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET!, Prefix: PREFIX, ContinuationToken: token })
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key && obj.LastModified && (!newest || obj.LastModified > newest.lastModified)) {
        newest = { key: obj.Key, lastModified: obj.LastModified };
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return newest;
}

export async function downloadBackup(key: string): Promise<Uint8Array> {
  const res = await s3().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
  return res.Body!.transformToByteArray();
}

export async function sendBackupAlert(subject: string, body: string) {
  const to = process.env.BACKUP_ALERT_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) {
    console.error(`backup alert (email not configured — set RESEND_API_KEY + BACKUP_ALERT_EMAIL): ${subject}\n${body}`);
    return;
  }
  try {
    await withRetry(
      async () => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.BACKUP_ALERT_FROM ?? "Steady Backups <onboarding@resend.dev>",
            to: [to],
            subject,
            text: body,
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          const err = new Error(`resend ${res.status}: ${detail}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
      },
      {
        attempts: 4,
        // A backup-failure alert is exactly when the network may be flaky —
        // retry transient failures rather than dropping the alert on one blip.
        shouldRetry: isTransientHttpError,
        onRetry: (err, attempt, delayMs) =>
          console.warn(`backup alert retry ${attempt} in ${delayMs}ms:`, (err as Error).message),
      }
    );
  } catch (err) {
    console.error("backup alert email failed after retries:", err);
  }
}

// ---------- In-process nightly scheduler ----------

declare global {
  // Survives dev hot reloads so the scheduler is only armed once per process.
  var __steadyBackupScheduler: boolean | undefined;
}

function msUntilNextRun(): number {
  const hour = Math.min(23, Math.max(0, Number(process.env.BACKUP_HOUR_UTC ?? 3)));
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleNightlyBackups() {
  if (globalThis.__steadyBackupScheduler) return;
  globalThis.__steadyBackupScheduler = true;

  if (process.env.EMDR_BACKUP_ENABLED === "0") {
    console.log("backups: disabled via EMDR_BACKUP_ENABLED=0");
    return;
  }
  if (!backupConfigured()) {
    console.log(
      "backups: not configured (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, BACKUP_AGE_RECIPIENT) — nightly backups OFF"
    );
    return;
  }

  const arm = () => {
    const delay = msUntilNextRun();
    console.log(`backups: next run in ${Math.round(delay / 60000)} min`);
    const timer = setTimeout(async () => {
      try {
        const r = await runBackup();
        console.log(`backups: uploaded ${r.key} (${r.bytes} bytes, pruned ${r.pruned})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeBackupState({ lastFailureAt: new Date().toISOString(), lastError: message });
        await audit({ actorRole: "system", family: "security", type: "backup_failed", detail: { message } });
        console.error("backups: NIGHTLY BACKUP FAILED:", message);
        const state = readBackupState();
        await sendBackupAlert(
          "Steady: nightly backup FAILED",
          `The nightly database backup failed at ${new Date().toISOString()}.\n\nError: ${message}\n\nLast successful backup: ${state.lastSuccessAt ?? "never"} (${state.lastKey ?? "n/a"}).\n\nRunbook: docs/backups.md — run \`npm run backup\` manually after fixing the cause.`
        );
      } finally {
        arm();
      }
    }, delay);
    timer.unref?.();
  };
  arm();
}
