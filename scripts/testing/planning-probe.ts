// What the planning engine finds in this environment, right now.
//
// Not a test. The guards in `tests/planning.test.ts` prove the rules behave
// correctly on fixtures; this answers the different question a presenter and a
// reviewer both ask — what does it actually say about the data on this disk?
//
// It exists because that question found three real defects that fixtures could
// not have: an 86.7-point drift on a population that had not moved (a
// cohort-entry metric being windowed as activity), a rule that could never
// fire (follow-up gap withheld for the missingness it measures), and a
// fabricated population with no disparity in it at all, which meant every rule
// evaluated to "no gap" and the screens had never rendered anything.
//
//   npx tsx scripts/testing/planning-probe.ts
//
// Runs against a throwaway database seeded from the demo baseline, so it never
// touches a deployed one.

process.env.EMDR_DATA_DIR = `/tmp/steady-planning-probe-${process.pid}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "planning-probe-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = "planning-probe-key";

import { getDb } from "../../src/lib/db";
import { detectSignals } from "../../src/lib/planning/service";
import { PLANNING_TENANT_ID, populationTenantIds } from "../../src/lib/planning/scope";

async function main() {
  getDb();
  const r = await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  console.log(`planning release blocked: ${r.releaseBlocked}`);
  console.log(`signals: ${r.signals.length}`);
  for (const s of r.signals) {
    console.log(`  * ${s.signal_type}  ${s.cohort_ref}`);
    console.log(`      ${s.statement}`);
  }
  // Grouped, because the same reason repeated across seven cohorts is one
  // fact about the deployment rather than seven findings.
  const byRule = new Map<string, { reason: string; n: number }>();
  for (const w of r.withheld) {
    const seen = byRule.get(w.ruleId);
    if (seen) seen.n += 1;
    else byRule.set(w.ruleId, { reason: w.reason, n: 1 });
  }
  console.log("withheld:");
  for (const [id, { reason, n }] of byRule) {
    console.log(`  - ${id} (${n} cohort${n === 1 ? "" : "s"}): ${reason}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
