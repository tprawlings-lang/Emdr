// Data retention sweep (compliance 6.4): deletes program data for member
// accounts inactive for 24+ months. Run on a schedule (e.g. Render cron or a
// monthly operator task): `npx tsx scripts/retention-sweep.ts`.
// Pass --dry-run to preview. The 30-day email warning requires an email
// provider and is tracked as an open dependency in COMPLIANCE.md.

import { getDb } from "../src/lib/db";

const DRY_RUN = process.argv.includes("--dry-run");
const MONTHS = 24;

const db = getDb();
const stale = db
  .prepare(
    `SELECT u.id, u.email FROM users u
     WHERE u.role = 'member' AND u.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM audit_log a
         WHERE a.actor_id = u.id AND a.created_at > datetime('now', '-${MONTHS} months')
       )
       AND u.created_at < datetime('now', '-${MONTHS} months')`
  )
  .all() as { id: string; email: string }[];

console.log(`${stale.length} account(s) inactive for ${MONTHS}+ months${DRY_RUN ? " (dry run)" : ""}`);

for (const user of stale) {
  console.log(`- ${user.id}`);
  if (DRY_RUN) continue;
  db.transaction(() => {
    const byUser = (table: string) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id);
    db.prepare(
      "DELETE FROM post_session_checks WHERE session_id IN (SELECT id FROM therapy_sessions WHERE user_id = ?)"
    ).run(user.id);
    for (const t of [
      "therapy_sessions", "ai_messages", "ai_conversations", "ai_memory_items",
      "ai_companion_preferences", "user_triggers", "early_warning_signs", "safety_plans",
      "user_profiles", "readiness_assessments", "checkins", "screenings", "module_unlocks", "alerts",
    ]) byUser(t);
    db.prepare(
      `UPDATE users SET email = ?, name = 'Deleted member', password_hash = '!', dob = NULL,
         status = 'deleted' WHERE id = ?`
    ).run(`deleted-${user.id}@deleted.invalid`, user.id);
    db.prepare(
      "UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE user_id = ?"
    ).run(user.id);
    db.prepare(
      `INSERT INTO audit_log (actor_id, actor_role, event_family, event_type, detail_json)
       VALUES (?, 'system', 'identity', 'account_retention_deleted', '{}')`
    ).run(user.id);
  })();
}
console.log("Done.");
