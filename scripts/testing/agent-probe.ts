process.env.EMDR_DATA_DIR = `/tmp/steady-agents-${process.pid}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "agent-probe-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = "agent-key";
import { getDb } from "../../src/lib/db";
import { runAgents } from "../../src/lib/agents/runner";

const t0 = Date.now();
const db = getDb();
const seeded = Date.now() - t0;
console.log(`seed (generator + agents): ${(seeded / 1000).toFixed(1)}s`);
// Idempotence: a second run must insert nothing.
const t1 = Date.now();
const again = runAgents(db);
console.log(`second agent run: ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(again, null, 2));
