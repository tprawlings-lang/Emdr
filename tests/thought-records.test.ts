// Member thought records (Handoff 10 2B; row CV10_D04):
//
//   - the cautious tier, ceiling 6, asked on every save;
//   - the crisis pre-filter runs over every field before anything is saved;
//   - encrypted at rest; private to the member: no clinician surface or
//     companion path reads the table, and nothing about an entry reaches the
//     spine; the audit log says only that one was saved or deleted;
//   - the 0 to 10 strengths are stored and never shown back;
//   - delete overwrites the words;
//   - absent when the row is sent back.

process.env.EMDR_DATA_DIR = `/tmp/steady-thought-records-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "thought-records-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "thought-records-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { AccessTier } from "../src/lib/safety/types";
import {
  cleanThoughtRecord, deleteThoughtRecord, memberThoughtRecords, saveThoughtRecord, thoughtRecordAllowed,
  thoughtRecordStanding, ThoughtRecordRefused,
} from "../src/lib/thought-records";
import { decryptField } from "../src/lib/crypto";

const db = getDb();
const CRISIS = "I want to kill myself";
const PRIVATE = "my manager ignored my email";

function member(activation = 2): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@tr.test`);
  db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
      sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, ?, 2, 0, 1, 1, 7, 0, 'processing_ok')`)
    .run(newId(), id, todayISO(), activation);
  return id;
}

const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

test("the gate: cautious tier, ceiling 6; unknown activation reads as 10", () => {
  const g = (tier: AccessTier, activation: number | null) => thoughtRecordAllowed({ tier, activation, imagery: true });
  assert.equal(g(AccessTier.CAUTIOUS, 6), true);
  assert.equal(g(AccessTier.CAUTIOUS, 7), false);
  assert.equal(g(AccessTier.STABILIZATION, 2), false);
  assert.equal(g(AccessTier.STEADY, null), false);
  assert.equal(thoughtRecordAllowed(null), false);
});

test("through the store: open on a calm day, not today above 6, and a save is refused then", async () => {
  assert.equal((await thoughtRecordStanding(member(2))).state, "open");
  const high = member(7);
  assert.equal((await thoughtRecordStanding(high)).state, "not_today");
  await assert.rejects(saveThoughtRecord(high, { situation: PRIVATE }), (e: Error) => e instanceof ThoughtRecordRefused && e.code === "not_today");
  assert.equal(count("SELECT COUNT(*) AS n FROM member_thought_records WHERE user_id = ?", high), 0);
});

test("a record needs what happened; anything else sent is dropped, and strengths must be 0 to 10", () => {
  assert.throws(() => cleanThoughtRecord({ situation: "  " }), ThoughtRecordRefused);
  const clean = cleanThoughtRecord({
    situation: PRIVATE, feeling: "hurt", strengthBefore: 7, strengthAfter: 11, balanced: "",
    ...({ diagnosis: "x", share: true } as object),
  } as Parameters<typeof cleanThoughtRecord>[0]);
  assert.deepEqual(clean, { situation: PRIVATE, feeling: "hurt", strengthBefore: 7 });
});

test("crisis language in any field saves nothing and alerts the care team without the words", async () => {
  const m = member();
  const r = await saveThoughtRecord(m, { situation: PRIVATE, thought: "nothing matters", balanced: CRISIS });
  assert.deepEqual(r, { ok: false, crisis: true });
  assert.equal(count("SELECT COUNT(*) AS n FROM member_thought_records WHERE user_id = ?", m), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND alert_type = 'activity_risk_language'", m), 1);
  const alert = db.prepare("SELECT detail FROM alerts WHERE user_id = ? AND alert_type = 'activity_risk_language'").get(m) as { detail: string };
  assert.ok(!alert.detail.includes("kill"), "the words reached the alert");
});

test("saved encrypted; nothing reaches the spine; the audit log says only that one was saved", async () => {
  const m = member();
  const saved = await saveThoughtRecord(m, { situation: PRIVATE, feeling: "hurt", strengthBefore: 6, strengthAfter: 3 });
  assert.ok(saved.ok);
  const row = db.prepare("SELECT payload_enc FROM member_thought_records WHERE id = ?").get(saved.id) as { payload_enc: string };
  assert.match(row.payload_enc, /^enc1:/);
  assert.ok(!row.payload_enc.includes("manager"));
  assert.equal(count("SELECT COUNT(*) AS n FROM longitudinal_events WHERE person_id = ?", m), 0, "an entry reached the spine");
  const au = db.prepare("SELECT event_type, detail_json FROM audit_log WHERE actor_id = ? AND event_type LIKE 'thought_record%'").all(m) as Array<{ event_type: string; detail_json: string | null }>;
  assert.deepEqual(au.map((a) => a.event_type), ["thought_record_saved"]);
  assert.ok(!(au[0].detail_json ?? "").includes("manager") && !(au[0].detail_json ?? "").includes("6"));
});

test("the member's own view: their words in order, no strength", async () => {
  const m = member();
  await saveThoughtRecord(m, { situation: PRIVATE, feeling: "hurt", strengthBefore: 9, thought: "they don't respect me", balanced: "they were busy", strengthAfter: 4 });
  const [r] = await memberThoughtRecords(m);
  assert.deepEqual(r.answers.map((a) => a.answer), [PRIVATE, "hurt", "they don't respect me", "they were busy"]);
  assert.deepEqual(r.answers.map((a) => a.question), ["What happened?", "What did you feel?", "What went through your mind?", "Is there a more balanced way to put it?"]);
  assert.ok(!JSON.stringify(r).match(/\b[49]\b/), "a strength was shown back");
});

test("delete overwrites the words; another member cannot delete", async () => {
  const m = member();
  const saved = await saveThoughtRecord(m, { situation: PRIVATE });
  assert.ok(saved.ok);
  assert.equal(await deleteThoughtRecord(member(), saved.id), false);
  assert.equal(await deleteThoughtRecord(m, saved.id), true);
  const row = db.prepare("SELECT payload_enc, deleted_at FROM member_thought_records WHERE id = ?").get(saved.id) as { payload_enc: string; deleted_at: string };
  assert.equal(decryptField(row.payload_enc), "{}");
  assert.ok(row.deleted_at);
  assert.deepEqual(await memberThoughtRecords(m), []);
});

test("private to the member: no clinician or companion code reads the table or the module", () => {
  const roots = ["src/app/clinician", "src/lib/clinical", "src/components/clinical", "src/app/review", "src/app/admin"];
  const files = [
    ...roots.flatMap((r) => walk(r)),
    ...["companion-tools.ts", "companion-ai.ts", "companion.ts", "companion-proposals.ts", "session-companion.ts"].map((f) => `src/lib/${f}`),
  ].filter((f) => fs.existsSync(f));
  const hits = files.filter((f) => /member_thought_records|thought-records"|thoughtRecord/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(hits, []);
});

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []);
}

test("absent while its row is sent back", async () => {
  const { SAFETY_CONFIG_VERSION } = await import("../src/lib/safety/governance");
  const sign = (verdict: "agree" | "needs_change") =>
    db.prepare("INSERT INTO autonomous_signoffs (id, rule_id, config_version, verdict) VALUES (?, 'CV10_D04', ?, ?)").run(newId(), SAFETY_CONFIG_VERSION, verdict);
  const m = member();
  sign("needs_change");
  assert.equal((await thoughtRecordStanding(m)).state, "absent");
  await assert.rejects(saveThoughtRecord(m, { situation: PRIVATE }), ThoughtRecordRefused);
  sign("agree");
  assert.equal((await thoughtRecordStanding(m)).state, "open");
});
