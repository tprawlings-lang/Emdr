#!/usr/bin/env tsx
// Demo environment operations (Demo-First handoff §5, §7, §10).
//
//   npm run demo -- health      environment is in the state a demo expects
//   npm run demo -- baseline    print the versioned dataset fingerprint
//   npm run demo -- reset       remove all synthetic activity, rebuild baseline
//   npm run demo -- backfill    reconstruct genesis events from current state
//   npm run demo -- replay      rebuild projections from events and diff
//   npm run demo -- verify      reset → backfill → replay, and report
//
// Why these exist as commands rather than tests: handoff §10 asks that a
// security reviewer be able to see "event replay and projection rebuild
// reproduce the same synthetic state." Until now that was provable only by
// reading a test file and trusting it. A reviewer should be able to run it.
//
// Everything here refuses to operate outside EMDR_DEMO=1.

process.env.EMDR_DEMO = process.env.EMDR_DEMO ?? "1";

import { getDb } from "../src/lib/db";
import { resetDemoData, demoBaseline, demoHealth } from "../src/lib/demo-reset";
import { backfillGenesisEvents } from "../src/lib/spine-backfill";
import { verifyProjections, formatVerifyResult } from "../src/lib/projections";

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", OFF = "\x1b[0m";
const tick = (ok: boolean) => (ok ? `${GREEN}ok${OFF}  ` : `${RED}FAIL${OFF}`);

function requireDemo() {
  if (process.env.EMDR_DEMO !== "1") {
    console.error("Refused: EMDR_DEMO must be 1. These commands assume fabricated data.");
    process.exit(2);
  }
}

async function main() {
  const cmd = process.argv[2] ?? "health";
  requireDemo();

  switch (cmd) {
    case "health": {
      const r = demoHealth(getDb());
      for (const c of r.checks) console.log(`  ${tick(c.ok)} ${c.name.padEnd(16)} ${DIM}${c.detail}${OFF}`);
      console.log(r.ok ? `\n${GREEN}HEALTHY${OFF}` : `\n${RED}UNHEALTHY${OFF}`);
      process.exit(r.ok ? 0 : 1);
    }

    case "baseline": {
      const b = demoBaseline(getDb());
      console.log(`version : ${b.version}`);
      console.log(`hash    : ${b.hash}`);
      console.log("counts  :");
      for (const [t, n] of Object.entries(b.counts)) if (n > 0) console.log(`  ${String(n).padStart(5)}  ${t}`);
      return;
    }

    case "reset": {
      const r = resetDemoData(getDb());
      console.log(`Removed ${r.totalDeleted} row(s) across ${Object.keys(r.deleted).length} table(s).`);
      console.log(`Rebuilt ${r.version} — baseline ${r.baseline.hash}`);

      // Reset now includes the genesis backfill, because without it a reset
      // produces an environment whose event log is EMPTY — and the timeline,
      // the cited summary, and the trajectory are all assembled from events.
      // A reviewer opening a member record saw three empty sections and had no
      // way to know the cause was a missing operator step rather than a missing
      // feature. "Reset" has to mean a complete environment or it is a trap.
      //
      // Idempotent (asserted in tests/spine-backfill.test.ts), so running it
      // here cannot double-insert.
      const b = await backfillGenesisEvents();
      console.log(`Reconstructed ${b.inserted} event(s) from ${b.scanned} row(s).`);
      return;
    }

    case "backfill": {
      const r = await backfillGenesisEvents();
      console.log(`scanned ${r.scanned}, inserted ${r.inserted}, skipped-no-person ${r.skippedNoPerson}`);
      for (const [t, n] of Object.entries(r.byType)) console.log(`  ${String(n).padStart(4)}  ${t}`);
      return;
    }

    case "replay": {
      const v = await verifyProjections();
      console.log(formatVerifyResult(v));
      console.log(v.identical
        ? `\n${GREEN}IDENTICAL${OFF} — projections rebuilt from events match the live tables exactly.`
        : `\n${RED}DRIFT${OFF} — see the diff above.`);
      process.exit(v.identical ? 0 : 1);
    }

    // The reviewer-facing demonstration: return to a known state, reconstruct
    // history from it, then prove the rebuild reproduces that state exactly.
    case "verify": {
      console.log("1/4  reset");
      const reset = resetDemoData(getDb());
      console.log(`     ${reset.totalDeleted} row(s) removed; baseline ${reset.baseline.hash}`);

      console.log("2/4  baseline is reproducible");
      const second = resetDemoData(getDb());
      const stable = second.baseline.hash === reset.baseline.hash;
      console.log(`     ${tick(stable)} ${stable ? "two resets produced the same hash" : "HASHES DIFFER — the seed is not deterministic"}`);

      console.log("3/4  genesis backfill");
      const bf = await backfillGenesisEvents();
      console.log(`     ${bf.inserted} event(s) reconstructed across ${Object.keys(bf.byType).length} type(s)`);
      const again = await backfillGenesisEvents();
      const idempotent = again.inserted === 0;
      console.log(`     ${tick(idempotent)} ${idempotent ? "re-running inserts nothing (idempotent)" : `NOT IDEMPOTENT — second run inserted ${again.inserted}`}`);

      console.log("4/4  projection replay");
      const v = await verifyProjections();
      console.log(`     ${tick(v.identical)} ${v.rebuild.applied} event(s) applied; ${v.diffs.length} difference(s); ${v.rebuild.gaps.length} gap(s)`);
      if (!v.identical) console.log(formatVerifyResult(v));

      const ok = stable && idempotent && v.identical;
      console.log(ok
        ? `\n${GREEN}PASS${OFF} — deterministic seed, idempotent backfill, byte-identical replay.`
        : `\n${RED}FAIL${OFF}`);
      process.exit(ok ? 0 : 1);
    }

    default:
      console.error(`Unknown command "${cmd}". Try: health | baseline | reset | backfill | replay | verify`);
      process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
