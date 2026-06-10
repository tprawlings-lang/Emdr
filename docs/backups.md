# Database backups & restore

Compliance 2.6: daily automated encrypted backups, 30-day retention, restore
tested before launch and quarterly after.

## How it works

Every night at `BACKUP_HOUR_UTC` (default 03:00 UTC) the app process itself:

1. **Snapshots** the live SQLite database with better-sqlite3's `db.backup()` —
   SQLite's Online Backup API, the same mechanism behind the `sqlite3 .backup`
   CLI command. Safe under live traffic (WAL mode), produces a consistent
   single-file copy.
2. **Encrypts** the snapshot with [age](https://age-encryption.org) (X25519)
   to the public key in `BACKUP_AGE_RECIPIENT`. The matching secret key never
   exists on the server — only you can decrypt backups.
3. **Uploads** it to Cloudflare R2 as `steady/emdr-<UTC timestamp>.db.age`.
4. **Prunes** objects older than `BACKUP_RETENTION_DAYS` (default 30).
5. On **failure**: emails `BACKUP_ALERT_EMAIL` via Resend, logs loudly, and
   records the failure in the audit ledger and in `/api/backup-status`.

The scheduler runs in-process (armed by `src/instrumentation.ts`) because the
Render persistent disk is mounted only in the web service — a separate cron
service could not reach the database file. If the service restarts, the
scheduler re-arms automatically.

**Monitoring:** `GET /api/backup-status` shows `configured`, last success
(timestamp, object key, size) and last failure (timestamp, error). Check it
after enabling, and any morning you want reassurance.

## One-time setup

1. **R2 bucket** — Cloudflare dashboard → R2 → Create bucket (e.g.
   `steady-backups`). Then *Manage R2 API Tokens* → Create token scoped to
   that bucket with **Object Read & Write**. Note the Account ID, Access Key
   ID, and Secret Access Key.
2. **age keypair** — on your own machine (never on the server):
   ```bash
   age-keygen -o steady-backup-key.txt
   # Public key prints as: age1...
   ```
   Store `steady-backup-key.txt` somewhere durable and offline (password
   manager + printed copy). **Losing it means losing every backup.**
3. **Render env vars** — service → Environment, add:
   | Var | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | Cloudflare account id |
   | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from the R2 API token |
   | `R2_BUCKET` | bucket name |
   | `BACKUP_AGE_RECIPIENT` | the `age1...` public key |
   | `RESEND_API_KEY` | from resend.com (free tier is fine) |
   | `BACKUP_ALERT_EMAIL` | where failure alerts go |
   Optional: `BACKUP_HOUR_UTC` (default 3), `BACKUP_RETENTION_DAYS` (default
   30), `BACKUP_ALERT_FROM` (default `onboarding@resend.dev`, which Resend
   only delivers to your own verified address — set a verified domain sender
   for production), `EMDR_BACKUP_ENABLED=0` to switch off.
4. Redeploy / restart the service, then check `/api/backup-status` shows
   `configured: true`, and run a first manual backup from the Render shell:
   `npm run backup`.

## Restore procedure (production)

Scenario: the disk is lost or the database is corrupted.

1. **Freeze the app**: set `EMDR_DISABLE_NEW_SESSIONS=1` in Render env (kill
   switch) so no new sessions start mid-restore.
2. **On your machine**, restore the latest backup:
   ```bash
   export R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=...
   npx tsx scripts/restore.ts --out .restore --identity-file steady-backup-key.txt
   # add --key steady/emdr-<timestamp>.db.age for a specific point in time
   ```
   The script decrypts, runs `PRAGMA integrity_check`, and reports the user
   count — it fails loudly on a bad file.
3. **Verify the restore locally first** (always): `make restore-test` (below),
   log in, spot-check recent data.
4. **Put the file on the server**: Render → service → Shell:
   ```bash
   # from your machine: copy the decrypted db up via render's SSH/scp
   render ssh steady-emdr-demo   # or use the dashboard shell + a transfer URL
   ```
   Replace `/data/emdr.db` (also delete `/data/emdr.db-wal` and
   `/data/emdr.db-shm` if present) **while the service is suspended or
   immediately before a restart**, then restart the service.
5. **Unfreeze**: remove `EMDR_DISABLE_NEW_SESSIONS`, check `/`,
   `/api/backup-status`, and sign in to verify.
6. Record the drill/restore in the records folder (date, backup key used,
   outcome) — quarterly drills are a standing task (COMPLIANCE.md 2.6).

## `make restore-test`

Downloads the latest backup, decrypts it, integrity-checks it, then builds
and boots the app against the restored database on
[http://localhost:3999](http://localhost:3999):

```bash
export R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=...
export BACKUP_AGE_IDENTITY="AGE-SECRET-KEY-1..."   # or use --identity-file via RESTORE_ARGS
make restore-test
```

Variants:

```bash
# Test a local encrypted file instead of R2:
make restore-test RESTORE_ARGS="--file ./emdr-2026-06-10T03-00-00Z.db.age"
# Specific point in time:
make restore-test RESTORE_ARGS="--key steady/emdr-2026-06-01T03-00-00Z.db.age"
```

Sign in with a known account and spot-check a trend chart or companion
conversation — booting is not the test; *recognizing your data* is.

## Key rotation

To rotate the age key: generate a new keypair, update
`BACKUP_AGE_RECIPIENT`, restart, run `npm run backup` once. Old objects stay
decryptable only with the old key — keep it until they age out of retention
(30 days), then destroy it.
