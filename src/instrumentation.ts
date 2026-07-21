// Next.js instrumentation hook: runs once when the server process starts.
// Arms the in-process nightly backup scheduler (src/lib/backup.ts) — this is
// the right home because the SQLite file lives on this service's disk, which
// a separate cron service could not mount.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast on a misconfigured production deploy (forgeable sessions /
    // plaintext PII) before serving a single request.
    const { assertProductionConfig } = await import("./lib/env-guard");
    assertProductionConfig();

    const { scheduleNightlyBackups } = await import("./lib/backup");
    scheduleNightlyBackups();
  }
}
