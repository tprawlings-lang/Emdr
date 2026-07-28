// SOS panic panel core (roadmap F7). Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-sos-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { getSosPanel, recordSosOpened } from "../src/lib/sos";

const USER = "sos-user";

test("setup member with a safety plan", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    USER, "sos@test.local", "SOS Tester", "member", "x",
  ]);
  await c.run(
    `INSERT INTO safety_plans (user_id, grounding_tools_json, support_contact_name, support_contact_method, reminder_phrase)
     VALUES (?, ?, ?, ?, ?)`,
    [USER, JSON.stringify(["cold water", "walk outside"]), "Sam", "555-123-4567", null]
  );
});

test("panel assembles the member's own plan; crisis line always present", async () => {
  const panel = await getSosPanel(USER);
  assert.equal(panel.supportContactName, "Sam");
  assert.equal(panel.supportContactMethod, "555-123-4567");
  assert.deepEqual(panel.groundingTools, ["cold water", "walk outside"]);
  assert.ok(panel.crisisLabel.length > 0, "has a crisis label");
  assert.ok(panel.crisisHref.length > 0, "has a crisis href");
});

test("panel is safe for a member with no plan at all", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    "sos-bare", "bare@test.local", "Bare", "member", "x",
  ]);
  const panel = await getSosPanel("sos-bare");
  assert.equal(panel.supportContactName, null);
  assert.deepEqual(panel.groundingTools, []);
  assert.ok(panel.crisisHref.length > 0);
});

test("recordSosOpened writes a coded safety event (types/ids only, no content)", async () => {
  const before = await countSosEvents();
  const r = await recordSosOpened(USER);
  assert.equal(r.ok, true);
  const after = await countSosEvents();
  assert.equal(after, before + 1);
});

async function countSosEvents(): Promise<number> {
  const c = await data();
  const row = (await c.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'sos_opened'"
  )) as { n: number };
  return Number(row.n);
}
