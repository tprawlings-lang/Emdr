process.env.EMDR_DATA_DIR = `/tmp/steady-entrants-${process.pid}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "entrants-probe-secret-at-least-32-chars-x";
process.env.EMDR_DATA_KEY = "entrants-key";
import { getDb } from "../../src/lib/db";
import { ALL_ELIGIBLE, cohort, regionCohorts, type CohortDefinition } from "../../src/lib/metrics/cohorts";
import { computeActivation, resolve } from "../../src/lib/metrics/compute";
import { loadObservations, metricContext } from "../../src/lib/metrics/population-metrics";
import { populationTenantIds } from "../../src/lib/planning/scope";
import { windows } from "../../src/lib/planning/service";

async function main() {
  getDb();
  const t = populationTenantIds();
  const cohorts: CohortDefinition[] = [
    ALL_ELIGIBLE, ...regionCohorts(),
    cohort("spanish_preferred.v1"), cohort("mandarin_preferred.v1"),
    cohort("rural_states.v1"), cohort("age_65_plus.v1"),
  ];
  for (const w of windows()) {
    const rows = await loadObservations(t, w);
    const ctx = metricContext("e", w);
    console.log(`\n== window ${w.start}..${w.end}`);
    for (const c of cohorts) {
      const entered = resolve(rows, c).filter((r) => r.enrolledInWindow).length;
      const a = computeActivation(rows, c, ctx);
      console.log(`  ${c.id.padEnd(26)} entrants=${String(entered).padStart(3)}  activation denom=${String(a.denominator).padStart(3)}  value=${a.value === null ? "n/a" : (a.value * 100).toFixed(0) + "%"}`);
    }
  }
}
main().then(()=>process.exit(0), e=>{console.error(e);process.exit(1);});
