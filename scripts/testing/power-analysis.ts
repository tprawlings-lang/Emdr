// What can the planning engine actually see?
//
//   npx tsx scripts/testing/power-analysis.ts
//
// Runs the real rules against synthetic cohorts with a KNOWN true effect, and
// reports how often each one finds it — plus how often it fires when there is
// nothing there. No database, no fabricated population: this is a study of the
// detector, and the ground truth has to be known for a sensitivity number to
// mean anything.

import {
  attenuation, falsePositiveRate, minimumCohortFor, powerCurve, type PowerPoint,
} from "../../src/lib/analysis/power";

// Taken from the live deployment rather than invented: 78% follow-up
// completion network-wide, about three due measures per person in a 90-day
// window, and an eligible population of 240.
// The cohort's SHARE of the population is held at one in six — roughly what a
// real cohort here looks like (Mandarin-preferred is 40 of 240) — so the curve
// isolates statistical power from the attenuation a contained cohort suffers.
const BASE = { measuresPerPerson: 3, baseRate: 0.78 };
const SHARE = 1 / 6;
const SIZES = [20, 30, 40, 60, 100, 200, 400];
const EFFECTS = [0, -5, -8, -10, -12, -15, -20, -25];

const pct = (x: number | null) => (x === null ? "  n/a" : `${(x * 100).toFixed(0).padStart(4)}%`);

function table(title: string, points: PowerPoint[]) {
  console.log(`\n${title}`);
  console.log(`  ${"cohort".padEnd(8)}${EFFECTS.map((e) => `${e}pp`.padStart(7)).join("")}`);
  for (const size of SIZES) {
    const row = EFFECTS.map((e) => {
      const p = points.find((x) => x.cohortSize === size && x.effectPp === e);
      return (p ? pct(p.detectionRate) : "     -").padStart(7);
    });
    console.log(`  ${String(size).padEnd(8)}${row.join("")}`);
  }
  // Where the rule could not run at all, the detection rate is not a low
  // number, it is no number — and the two must not be read as the same thing.
  const blocked = points.filter((p) => p.withholdRate > 0.5);
  if (blocked.length > 0) {
    const sizes = [...new Set(blocked.map((p) => p.cohortSize))].sort((a, b) => a - b);
    console.log(`  withheld in most trials at cohort size: ${sizes.join(", ")} ` +
      "— below the minimum analysis size, so there is no rate to report");
  }
}

async function main() {
  console.log("Detector power analysis — the real rules, synthetic cohorts, known ground truth.");
  console.log(`Reference rate ${(BASE.baseRate * 100).toFixed(0)}%, ` +
    `${BASE.measuresPerPerson} due measures per person, cohort held at 1 in ${Math.round(1 / SHARE)} of the population.`);

  table("FOLLOWUP_GAP — share of runnable trials that fired (threshold: 12pp below)",
    powerCurve("FOLLOWUP_GAP", SIZES, EFFECTS, BASE, 300, undefined, SHARE));

  table("ACCESS_GAP — same, over two windows (threshold: 10pp, both windows, same direction)",
    powerCurve("ACCESS_GAP", SIZES, EFFECTS, BASE, 300, undefined, SHARE));

  console.log("\nFalse-positive rate — the rule fires with NO true difference at all:");
  for (const rule of ["FOLLOWUP_GAP", "ACCESS_GAP"] as const) {
    for (const size of [40, 60, 200]) {
      const p = falsePositiveRate(rule, size, BASE, 1000, undefined, SHARE);
      console.log(`  ${rule.padEnd(14)} n=${String(size).padStart(3)}  ` +
        `fired ${String(p.fired).padStart(3)}/${p.evaluated} runnable  ` +
        `= ${pct(p.detectionRate)}   (withheld ${(p.withholdRate * 100).toFixed(0)}%)`);
    }
  }

  console.log("\nAttenuation — how much of a true gap survives being inside its own reference:");
  for (const share of [1 / 12, 1 / 6, 1 / 3, 1 / 2]) {
    const n = 60;
    const ref = Math.round(n * (1 / share - 1));
    console.log(`  a cohort that is 1 in ${String(Math.round(1 / share)).padStart(2)} of the population shows ` +
      `${(attenuation(n, ref) * 100).toFixed(0)}% of its true gap`);
  }

  console.log("\nSmallest cohort reaching 80% detection:");
  for (const effect of [-12, -15, -20, -25]) {
    const n = minimumCohortFor("FOLLOWUP_GAP", effect, 0.8, SIZES, BASE, 300, undefined, SHARE);
    console.log(`  FOLLOWUP_GAP, a true gap of ${effect}pp: ` +
      (n === null ? `not reached at any size up to ${SIZES[SIZES.length - 1]}` : `${n} people`));
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
