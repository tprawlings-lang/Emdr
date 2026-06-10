// Manual backup runner: `npm run backup` uploads to R2 (same path as the
// nightly job); `npm run backup -- --local <dir>` writes the encrypted
// snapshot to a local directory instead (no R2 needed) — used for testing
// the pipeline and for ad-hoc offline copies.
import { runBackup, sendBackupAlert } from "../src/lib/backup";

const localIdx = process.argv.indexOf("--local");
const localDir = localIdx >= 0 ? (process.argv[localIdx + 1] ?? ".backups") : undefined;

runBackup({ localDir })
  .then((r) => {
    console.log(
      `Backup OK: ${r.key} (${r.bytes} bytes)${r.uploaded ? `, pruned ${r.pruned} old object(s)` : ` written to ${localDir}`}`
    );
    process.exit(0);
  })
  .catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Backup FAILED:", message);
    await sendBackupAlert("Steady: manual backup FAILED", `Manual backup failed: ${message}`);
    process.exit(1);
  });
