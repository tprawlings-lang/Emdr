// Regenerate the expected projection hashes in the seed manifest.
//
//   npm run gen:projection-hashes
//
// Handoff 07 Wave 8, p9's "Validate projections" control. The admin console
// listed that control as needing "expected projection hashes in the seed
// manifest"; this writes them.
//
// IT RESETS FIRST, AND THAT IS THE POINT. An expected hash taken from whatever
// happened to be in the developer's database is a record of that database, not
// of the published dataset — and it would then "pass" forever against the one
// environment nobody demonstrates from. So this rebuilds the baseline through
// the same path a reset uses and hashes what comes out.
//
// IT RESETS TWICE, for the reason `npm run demo -- verify` does: a hash written
// from a seed that is not deterministic is a hash that fails on the next
// machine, and the failure would be read as drift rather than as
// nondeterminism. If the two runs disagree, this refuses to write.

import fs from "fs";
import path from "path";

// A scratch database, so running this cannot touch a working one. Set before
// the first import that opens a connection.
const OUT_DIR = `/tmp/steady-projhash-${process.pid}-${Date.now()}`;
process.env.EMDR_DATA_DIR = OUT_DIR;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET ??= "gen-projection-hashes-placeholder-secret";
process.env.EMDR_DATA_KEY ??= "gen-projection-hashes-placeholder-key";

async function main() {
  const { getDb } = await import("../src/lib/db");
  const { resetDemoData } = await import("../src/lib/demo-reset");
  const { projectionHashes } = await import("../src/lib/demo/projection-hashes");
  const { DATASET_VERSION } = await import("../src/lib/demo-population-manifest");

  const db = getDb();

  console.log("1/3  reset");
  resetDemoData(db);
  const first = projectionHashes(db);

  console.log("2/3  reset again, to prove the seed is deterministic");
  resetDemoData(db);
  const second = projectionHashes(db);

  const unstable = first
    .filter((a, i) => a.hash !== second[i].hash)
    .map((a) => a.table);
  if (unstable.length > 0) {
    console.error(
      `REFUSED: two resets produced different hashes for ${unstable.join(", ")}.\n` +
      "The seed is not deterministic, and an expected hash written from it would fail on " +
      "every other machine for a reason that has nothing to do with drift."
    );
    process.exit(1);
  }

  const table: Record<string, string | null> = {};
  for (const h of second) table[h.table] = h.hash;

  const OUT = path.join(process.cwd(), "src/lib/demo/projection-hashes.generated.ts");
  const header = `// GENERATED — do not edit by hand.
//
// Regenerate with: npm run gen:projection-hashes
//
// Expected projection hashes for the seeded dataset (handoff 07 Wave 8, p9's
// "Validate projections" control). Keyed by dataset version, so a hash is
// never compared across two datasets that were never meant to match.
//
// A null means the table is empty in the baseline, which is a fact about the
// seed rather than a missing entry — the two are told apart on the console.
//
// tests/projection-validation.test.ts fails if these drift from a fresh reset.

export const EXPECTED_PROJECTION_HASHES: Record<string, Record<string, string | null>> = `;

  const payload = { [DATASET_VERSION]: table };
  fs.writeFileSync(OUT, `${header}${JSON.stringify(payload, null, 2)};\n`);

  const withRows = second.filter((h) => h.hash !== null).length;
  console.log(
    `3/3  wrote ${path.relative(process.cwd(), OUT)}: ${second.length} projected tables ` +
    `for ${DATASET_VERSION}, ${withRows} with rows`
  );

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
