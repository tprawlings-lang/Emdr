# Disaster recovery — RTO / RPO and runbook

## Targets
- **RPO (max data loss): 24 hours.** Nightly encrypted snapshot to Cloudflare R2
  (`src/lib/backup.ts`, `docs/backups.md`), 30-day retention. A same-day failure
  loses at most the hours since the last nightly snapshot.
- **RTO (max downtime): ~1 hour.** Rebuild path below is scripted end to end.

> To tighten RPO below 24h, add intra-day snapshots (e.g. hourly) — the same
> `runBackup()` path, scheduled more often. Flag for founder if the data-loss
> tolerance is lower than a day.

## Failure scenarios & response
| Scenario | Response |
|---|---|
| App instance crash / bad deploy | Roll back to previous deploy (Render dashboard); disk/data survive. Set `EMDR_DISABLE_NEW_SESSIONS=1` first if a safety defect is suspected. |
| Data disk corruption / loss | Restore latest R2 snapshot (below). Up to 24h of data lost (RPO). |
| Leaked `EMDR_DATA_KEY` | Rotate key, re-encrypt (key-rotation migration is future work — ADR 0002), invalidate old backups. |
| Leaked `EMDR_SESSION_SECRET` | Rotate secret — all existing session cookies become invalid immediately (forces re-login). |
| Provider region outage | Redeploy the Docker image to an alternate host; restore latest R2 snapshot. |

## Restore procedure
1. Provision a fresh instance with the same env (`EMDR_DATA_KEY`,
   `EMDR_SESSION_SECRET`, `BACKUP_AGE_IDENTITY`, R2 creds).
2. `make restore-test` downloads the latest snapshot, decrypts it, runs
   `PRAGMA integrity_check`, prints the user count, and serves it locally on
   :3999 for verification. (`scripts/restore.ts`.)
3. Point the app's `EMDR_DATA_DIR` at the restored `emdr.db` and start.
4. Verify: sign in as a known member, confirm `verifyAuditChain()` (audit
   console), confirm latest check-in/session rows present.

## Verification cadence
Run `make restore-test` monthly and after any backup-code change. A failed
nightly backup emails `BACKUP_ALERT_EMAIL` (Resend).
