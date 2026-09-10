process.env.EMDR_DATA_DIR = `/tmp/steady-clock-${process.pid}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "clock-probe-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = "clock-key";
import { getDb } from "../../src/lib/db";
import { MILESTONES, readClock, setClock } from "../../src/lib/demo-clock";
import { detectSignals, planningWindows } from "../../src/lib/planning/service";
import { PLANNING_TENANT_ID, populationTenantIds } from "../../src/lib/planning/scope";
import { loadObservations } from "../../src/lib/metrics/population-metrics";

async function report(label: string) {
  const c = await readClock();
  const w = await planningWindows();
  const rows = await loadObservations(populationTenantIds());
  const r = await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  console.log(`\n── ${label}`);
  console.log(`   clock ${c.live ? "LIVE" : c.now.toISOString().slice(0, 10)}   windows ${w[0].start}..${w[0].end} | ${w[1].start}..${w[1].end}`);
  console.log(`   population visible: ${rows.length}   signals: ${r.signals.length} [${r.signals.map(s => s.signal_type).join(", ") || "none"}]`);
}

async function main() {
  getDb();
  await report("live");
  for (const m of MILESTONES) {
    const out = await setClock({ milestoneId: m.id, reason: `probe: ${m.label}`, actorId: "probe" });
    if (!out.ok) { console.log(`  refused: ${out.reason}`); continue; }
    await report(`${m.label} (day ${m.day})`);
  }
  await setClock({ milestoneId: null, reason: "probe: back to live", actorId: "probe" });
  await report("back to live");
}
main().then(()=>process.exit(0), e=>{console.error(e);process.exit(1);});
