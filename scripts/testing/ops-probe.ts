process.env.EMDR_DATA_DIR = `/tmp/steady-ops-${process.pid}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "ops-probe-secret-at-least-32-characters-x";
process.env.EMDR_DATA_KEY = "ops-key";
import { getDb } from "../../src/lib/db";
import { loadCapacity, loadReviewLoad } from "../../src/lib/metrics/population-metrics";
import { populationTenantIds } from "../../src/lib/planning/scope";
import { windows } from "../../src/lib/planning/service";

async function main() {
  getDb();
  const t = populationTenantIds();
  const w = windows()[1];
  console.log(`window ${w.start}..${w.end}\n`);
  console.log("capacity:");
  for (const c of await loadCapacity(t, w)) {
    const ratio = c.openFirstVisitSlots ? (c.demand / c.openFirstVisitSlots).toFixed(2) : "n/a";
    console.log(`  ${c.region.padEnd(11)} demand=${String(c.demand).padStart(3)} slots=${String(c.openFirstVisitSlots ?? "none").padStart(4)} ratio=${ratio.padStart(5)} as_of_age=${c.asOfAgeDays}d`);
  }
  console.log("\nreview load:");
  for (const r of await loadReviewLoad(t, w)) {
    const ratio = r.staffedCapacity ? (r.fixedReviewEvents / r.staffedCapacity).toFixed(2) : "n/a";
    console.log(`  ${r.region.padEnd(11)} events=${String(r.fixedReviewEvents).padStart(3)} capacity=${String(r.staffedCapacity ?? "none").padStart(4)} ratio=${ratio.padStart(5)} schedule=${r.coverageScheduleKnown}`);
  }
}
main().then(()=>process.exit(0), e=>{console.error(e);process.exit(1);});
