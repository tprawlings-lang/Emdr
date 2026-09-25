// The companion may suggest; it may not enrol, complete or write program
// state, and it never reads what a member writes in one (Handoff 10 §3.5,
// §2.5; row CV10_A16). Also guards the future clinician-assigned lane: no
// companion path can reach member-written entries (§6).

process.env.EMDR_DATA_DIR = `/tmp/steady-companion-programs-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "companion-programs-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "companion-programs-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { companionTools, executeCompanionTool } from "../src/lib/companion-tools";

const SRC = path.join(process.cwd(), "src/lib");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const PROGRAM_TABLES = /\b(program_enrollments|program_unit_completions|activity_entries|program_entry_screens|member_thought_records)\b/;
const PROGRAM_WRITERS = /\b(enrollInProgram|leaveProgram|completeUnit|saveActivityEntry|deleteActivityEntry|memberEntries|plannedItems|pickedAreas|reflectOptions|saveThoughtRecord|memberThoughtRecords|deleteThoughtRecord)\b/;

/** Every file the companion's model path is built from. */
const COMPANION_FILES = ["companion-tools.ts", "companion-ai.ts", "companion.ts", "companion-proposals.ts", "session-companion.ts"];

test("no companion file names a program table or a program writer or reader", () => {
  const hits: string[] = [];
  for (const f of COMPANION_FILES) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) continue;
    const src = code(fs.readFileSync(p, "utf8"));
    if (PROGRAM_TABLES.test(src)) hits.push(`${f}: ${src.match(PROGRAM_TABLES)![0]}`);
    if (PROGRAM_WRITERS.test(src)) hits.push(`${f}: ${src.match(PROGRAM_WRITERS)![0]}`);
    if (/from "\.\/program(s|-activities|-actions)"/.test(src)) hits.push(`${f}: imports the programs modules`);
    if (/from "\.\/thought-records"/.test(src)) hits.push(`${f}: imports the member's thought records`);
  }
  assert.deepEqual(hits, []);
});

test("every companion tool that can write is one of the three already reviewed", () => {
  const writing = [...companionTools(true)].filter((t) => t.tier !== "read").map((t) => t.name).sort();
  assert.deepEqual(writing, ["escalate_risk", "record_trigger", "remember"]);
  const suggest = companionTools(true).find((t) => t.name === "suggest_practice");
  assert.equal(suggest?.tier, "read");
});

function member(withCheckin: boolean): string {
  const db = getDb();
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@cp.test`);
  if (withCheckin) {
    db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
        sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, 2, 2, 0, 1, 1, 7, 0, 'processing_ok')`)
      .run(newId(), id, todayISO());
  }
  return id;
}

test("suggest_practice respects the gate: a skill the member cannot open is not suggested", async () => {
  const run = (m: string, id: string) => executeCompanionTool(m, "conv", "suggest_practice", { practice_id: id }, { riskFlag: false });
  // No check-in: activation unknown, so a ceiling-4 skill is closed and a ceiling-10 one open.
  const unknown = member(false);
  assert.match(await run(unknown, "skill-values-check"), /Not available/);
  assert.match(await run(unknown, "skill-orient-room"), /Open to them: "Find the room"/);
  assert.match(await run(unknown, "no-such-practice"), /Not available/);
  const calm = member(true);
  assert.match(await run(calm, "skill-values-check"), /Open to them/);
});

test("suggest_practice writes nothing", async () => {
  const db = getDb();
  const m = member(true);
  const before = (db.prepare("SELECT COUNT(*) AS n FROM practice_completions").get() as { n: number }).n;
  await executeCompanionTool(m, "conv", "suggest_practice", { practice_id: "skill-orient-room" }, { riskFlag: false });
  const after = (db.prepare("SELECT COUNT(*) AS n FROM practice_completions").get() as { n: number }).n;
  assert.equal(after, before);
});
