// Tamper-evidence test for the audit log hash chain. Hermetic: forces a fresh,
// non-demo database in an isolated temp dir so it never touches dev/prod data
// and starts from an empty audit_log.
process.env.EMDR_DATA_DIR = `/tmp/steady-audit-test-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO; // the demo seed writes audit rows; keep the log empty

import { strict as assert } from "node:assert";
import test from "node:test";
import { getDb } from "../src/lib/db";
import { audit, verifyAuditChain } from "../src/lib/audit";

function auditIds(): number[] {
  return (getDb().prepare("SELECT id FROM audit_log ORDER BY id ASC").all() as { id: number }[]).map(
    (r) => r.id
  );
}

test("audit chain: a clean chain verifies", () => {
  const before = auditIds().length;
  for (let i = 0; i < 5; i++) {
    audit({ actorId: `u${i}`, actorRole: "member", family: "clinical", type: "test_event", detail: { i } });
  }
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.reason);
  assert.ok(v.checked >= before + 5);
});

test("audit chain: editing a row's content breaks the chain at that row", () => {
  const db = getDb();
  const ids = auditIds();
  const targetId = ids[ids.length - 2]; // an interior chained row
  db.prepare("UPDATE audit_log SET detail_json = ? WHERE id = ?").run(
    JSON.stringify({ tampered: true }),
    targetId
  );
  const v = verifyAuditChain();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAtId, targetId);
});

test("audit chain: deleting a row breaks the chain", () => {
  const db = getDb();
  const ids = auditIds();
  const before = ids.length;
  db.prepare("DELETE FROM audit_log WHERE id = ?").run(ids[1]);
  assert.equal(auditIds().length, before - 1);
  const v = verifyAuditChain();
  assert.equal(v.ok, false, "a deleted row must break the chain");
});
