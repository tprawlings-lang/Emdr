// Two transactions started at once on the SQLite backend both land, one after
// the other (src/lib/data.ts, `tx`).
//
// They used to interleave on the single connection: the second BEGIN ran
// inside the first and threw "cannot start a transaction within a
// transaction". Found through a session close whose audit raced the
// fire-and-forget shadow decision at session start.

process.env.EMDR_DATA_DIR = `/tmp/steady-tx-queue-${process.pid}-${Date.now()}`;
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "tx-queue-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";

const tick = () => new Promise((r) => setTimeout(r, 5));

test("concurrent top-level transactions queue rather than collide", async () => {
  const c = await data();
  if (c.backend !== "sqlite") return;
  await c.run("CREATE TABLE IF NOT EXISTS tx_probe (who TEXT, step INTEGER)");
  const order: string[] = [];
  const body = (who: string) => c.tx(async (t) => {
    order.push(`${who}:begin`);
    await t.run("INSERT INTO tx_probe (who, step) VALUES (?, 1)", [who]);
    await tick();
    await t.run("INSERT INTO tx_probe (who, step) VALUES (?, 2)", [who]);
    order.push(`${who}:end`);
  });
  await Promise.all([body("a"), body("b"), body("c")]);
  assert.deepEqual(order, ["a:begin", "a:end", "b:begin", "b:end", "c:begin", "c:end"]);
  const n = (await c.get("SELECT COUNT(*) AS n FROM tx_probe")) as { n: number };
  assert.equal(n.n, 6);
});

test("a failed transaction rolls back and does not block the next", async () => {
  const c = await data();
  if (c.backend !== "sqlite") return;
  await c.run("CREATE TABLE IF NOT EXISTS tx_probe2 (v INTEGER)");
  const failing = c.tx(async (t) => {
    await t.run("INSERT INTO tx_probe2 (v) VALUES (1)");
    await tick();
    throw new Error("boom");
  });
  const next = c.tx(async (t) => { await t.run("INSERT INTO tx_probe2 (v) VALUES (2)"); });
  await assert.rejects(failing, /boom/);
  await next;
  const rows = (await c.all("SELECT v FROM tx_probe2")) as { v: number }[];
  assert.deepEqual(rows.map((r) => r.v), [2]);
});

test("a nested transaction does not wait on its parent", async () => {
  const c = await data();
  if (c.backend !== "sqlite") return;
  const out = await c.tx(async () => c.tx(async () => "inner"));
  assert.equal(out, "inner");
});
