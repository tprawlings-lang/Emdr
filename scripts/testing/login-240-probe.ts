process.env.EMDR_DATA_DIR = `/tmp/steady-l240-${process.pid}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "l240-probe-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = "l240-key";
import { getDb, verifyPassword } from "../../src/lib/db";
import { data } from "../../src/lib/data";
import { MANIFEST_EMAIL_LIKE } from "../../src/lib/demo-population-manifest";

async function main() {
  getDb();
  const c = await data();
  const rows = await c.all(
    `SELECT email, role, password_hash, status, tenant_id FROM users WHERE email LIKE ?`,
    [MANIFEST_EMAIL_LIKE]) as { email: string; role: string; password_hash: string; status: string; tenant_id: string }[];
  console.log(`accounts matching ${MANIFEST_EMAIL_LIKE}: ${rows.length}`);
  const roles = new Set(rows.map(r => r.role));
  const tenants = new Set(rows.map(r => r.tenant_id));
  console.log(`roles: ${[...roles].join(", ")}   distinct tenants: ${tenants.size}`);
  let ok = 0, bad = 0;
  for (const r of rows) if (verifyPassword("patient1234", r.password_hash)) ok++; else bad++;
  console.log(`password "patient1234" verifies for ${ok}, fails for ${bad}`);
  const active = rows.filter(r => r.status === "active").length;
  console.log(`status active: ${active}`);
  console.log(`sample: ${rows.slice(0, 3).map(r => r.email).join(", ")}`);
}
main().then(()=>process.exit(0), e=>{console.error(e);process.exit(1);});
