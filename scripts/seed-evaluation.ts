// Seed (or rebuild) an evaluation tenant's synthetic caseload (Handoff 11 W1).
//
//   npm run seed:evolvedmd
//   npx tsx scripts/seed-evaluation.ts <tenant-id>
//
// Removes the tenant's own rows and seeds it again from its plan, anchored to
// today, then rebuilds the event ledger. Refuses any tenant that is not a
// configured evaluation tenant, or that holds a real person.

import { rebuildEvaluationTenant } from "../src/lib/tenants/evaluation-admin";

async function main() {
  const tenantId = process.argv[2] ?? "evolvedmd-eval";
  const r = await rebuildEvaluationTenant(tenantId);
  const removed = Object.values(r.deleted).reduce((a, b) => a + b, 0);
  console.log(`${r.tenantId}: removed ${removed} row(s); seeded ${r.counts.staff} staff, ${r.counts.patients} patients, ${r.counts.testers} member testers`);
  console.log(`  ${r.counts.measures} measures, ${r.counts.checkins} check-ins, ${r.counts.visits} visits, ${r.counts.alerts} alerts; ${r.eventsInserted} event(s) reconstructed`);
  console.log(`  trajectories: ${Object.entries(r.counts.byTrajectory).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
