// Boot the app's database layer and report whether every documented demo
// login works. Run as a SUBPROCESS by tests/demo-roles.test.ts.
//
// A subprocess rather than a dynamic import, because `getDb()` memoises the
// handle in module state: a test that re-imports it inside the same process
// gets the database it already opened, not the one it just built. A guard
// written that way passes whatever the code does — which is what happened
// first time, and neither deliberate break failed it.
import { getDb, verifyPassword } from "../../src/lib/db";
import { DEMO_ACCOUNTS, demoPassword } from "../../src/lib/demo-seed";

const db = getDb();
const problems: string[] = [];
for (const a of DEMO_ACCOUNTS) {
  const row = db.prepare("SELECT id, role, password_hash FROM users WHERE email = ?").get(a.email) as
    { id: string; role: string; password_hash: string } | undefined;
  if (!row) { problems.push(`${a.email}: no such account`); continue; }
  if (row.role !== a.role) problems.push(`${a.email}: role ${row.role}, expected ${a.role}`);
  if (!verifyPassword(demoPassword(a.role), row.password_hash)) {
    problems.push(`${a.email}: the documented password does not work`);
  }
}
const alex = db.prepare("SELECT id FROM users WHERE email = ?").get("patient.demo@steady.local") as
  { id: string } | undefined;
const legacyLeft = db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@example.com'").get() as
  { n: number };

process.stdout.write(JSON.stringify({
  problems,
  alexId: alex?.id ?? null,
  legacyRemaining: Number(legacyLeft.n),
}));
