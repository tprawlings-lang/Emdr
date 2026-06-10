# Operational targets. Backups: docs/backups.md · Compliance: COMPLIANCE.md

.PHONY: backup restore-test safety-tests

# Encrypt + upload a snapshot now (same pipeline as the nightly job).
backup:
	npx tsx scripts/backup.ts

# Quarterly restore drill (compliance 2.6): download the latest backup from
# R2, decrypt it, verify integrity, and boot the app against it on :3999.
# Requires R2_* env vars and BACKUP_AGE_IDENTITY (or --identity-file via
# RESTORE_ARGS). Use RESTORE_ARGS="--file my.db.age" to test a local file.
restore-test:
	npx tsx scripts/restore.ts --out .restore $(RESTORE_ARGS)
	npm run build
	@echo "--- Booting against the restored database on http://localhost:3999 ---"
	EMDR_DATA_DIR=$(CURDIR)/.restore PORT=3999 npm run start

safety-tests:
	npm run test:safety
