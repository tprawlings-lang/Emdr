// Expected projection hashes (handoff 07 Wave 8, p9's "Validate projections").
//
// p9's control: "Rebuild every projection and compare hashes; fail the page if
// any role's view differs." The admin console listed it as needing "expected
// projection hashes in the seed manifest", and this is that.
//
// TWO DIFFERENT QUESTIONS, AND ONLY ONE OF THEM WAS ANSWERED. `verifyProjections`
// rebuilds from the event spine and diffs the result against the live tables,
// which answers *are the projections consistent with their own events*. That is
// the more important question and it is already asked, on request, from the
// release console.
//
// It is not the same as *is this the dataset we published*. A generator change
// moves both halves at once — live and rebuilt agree because both moved — and
// the replay reports no difference at all. An expected hash recorded against
// the seed version is the only thing that catches that, and it catches a
// hand-edited row and a half-finished rebuild with it.
//
// WHAT IT DOES NOT CATCH, corrected here because the first version of this
// comment claimed it did and driving the console proved otherwise: APPENDED
// EVENTS. A data bundle writes to the spine and touches no projected table, so
// every hash still matches after one is applied — which is right, since the
// projections genuinely are the published ones until something rebuilds them.
// The record of an altered population is the applied-bundles list, which the
// console shows above this panel and the QA report carries as its own section.
// Two different questions with two different answers, and a hash that was
// quietly assumed to answer both would have been the more dangerous kind of
// green.
//
// PER TABLE, NOT ONE NUMBER. `demoBaseline` already hashes the whole dataset
// into a single value, which is right for "was this reset reproduced" and
// useless for p9's sentence: "fail the page if any ROLE'S VIEW differs" needs
// to name which one. So each projected table carries its own hash, and a
// mismatch says `checkins` rather than "something".
//
// WHAT IT CANNOT TELL YOU, said here because a hash invites more confidence
// than it earns: it says two datasets differ, never which is right. A
// deliberate seed change and a corrupted rebuild produce the same red row. The
// remedy for the first is regenerating the expected hashes with the script that
// wrote them; the remedy for the second is a reset. The console says both,
// because a check whose failure has no stated remedy is a check people learn
// to click past.

import type Database from "better-sqlite3";
import crypto from "crypto";

import { PROJECTED_TABLES, type ProjectedTable } from "../projections";
import { tableFingerprint } from "../demo-reset";
import { DATASET_VERSION } from "../demo-population-manifest";
import { EXPECTED_PROJECTION_HASHES } from "./projection-hashes.generated";

export interface ProjectionHash {
  table: ProjectedTable;
  rows: number;
  /** sha256 over the time-invariant fingerprint, or null for an empty table.
   *  Null rather than the hash of nothing: "this table is empty" and "this
   *  table hashes to e3b0c442…" are the same fact, and only one of them reads
   *  as one. */
  hash: string | null;
}

/** Hash every projected table as it stands. */
export function projectionHashes(db: Database.Database): ProjectionHash[] {
  return PROJECTED_TABLES.map((table) => {
    const rows = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const fp = tableFingerprint(db, table);
    if (fp.length === 0) return { table, rows, hash: null };
    const h = crypto.createHash("sha256");
    h.update(`table=${table}\n`);
    for (const line of fp) h.update(line + "\n");
    return { table, rows, hash: h.digest("hex") };
  });
}

export type HashVerdict = "matches" | "differs" | "not_recorded";

export interface ProjectionHashCheck {
  table: ProjectedTable;
  verdict: HashVerdict;
  expected: string | null;
  actual: string | null;
  rows: number;
}

export interface ProjectionValidation {
  datasetVersion: string;
  /** True only when every table matches a recorded hash. A table with no
   *  recorded hash is NOT a pass: an expected set that silently ignores a new
   *  table is an expected set that stops covering the dataset one table at a
   *  time. */
  ok: boolean;
  checks: ProjectionHashCheck[];
  /** Tables whose hash differs from the seed manifest's. */
  drifted: ProjectedTable[];
  /** Tables the manifest has no hash for at all. */
  unrecorded: ProjectedTable[];
}

/**
 * Compare the live projections against the hashes recorded for this dataset
 * version.
 *
 * A VERSION THAT WAS NEVER RECORDED IS NOT A PASS EITHER. If the manifest holds
 * hashes for `demo-population-v1` and the dataset says `v2`, every row is
 * `not_recorded` and `ok` is false — which is the honest answer. Treating an
 * unknown version as fine would make the check disappear at exactly the moment
 * the dataset changed.
 */
export function validateProjections(
  db: Database.Database,
  /** The recorded hashes to compare against. Defaults to the manifest's set for
   *  the current dataset version, and is a parameter so the behaviour can be
   *  tested against a manifest that is deliberately missing or wrong.
   *
   *  A GUARD THAT READS THIS FUNCTION'S SOURCE IS NOT ENOUGH, which is how it
   *  was checked first: an implementation that fell back to the live hash when
   *  none was recorded — `expected[table] ?? hash` — makes every table match
   *  trivially, and every source-level assertion about the verdict logic still
   *  held. The check has to be run against a set that should fail. */
  expected: Record<string, string | null> = EXPECTED_PROJECTION_HASHES[DATASET_VERSION] ?? {},
): ProjectionValidation {
  const checks: ProjectionHashCheck[] = projectionHashes(db).map(({ table, rows, hash }) => {
    const want = expected[table];
    if (want === undefined) {
      return { table, verdict: "not_recorded" as const, expected: null, actual: hash, rows };
    }
    return {
      table,
      verdict: want === hash ? ("matches" as const) : ("differs" as const),
      expected: want,
      actual: hash,
      rows,
    };
  });

  return {
    datasetVersion: DATASET_VERSION,
    ok: checks.every((c) => c.verdict === "matches"),
    checks,
    drifted: checks.filter((c) => c.verdict === "differs").map((c) => c.table),
    unrecorded: checks.filter((c) => c.verdict === "not_recorded").map((c) => c.table),
  };
}

/** What to do about a failing validation, in the words the console prints.
 *
 *  Written here rather than in the page because the two remedies are opposite
 *  and choosing between them is the whole of the operator's decision — and a
 *  remedy that lives in JSX is one that drifts from the check it explains. */
export function validationRemedy(v: ProjectionValidation): string | null {
  if (v.ok) return null;
  if (v.unrecorded.length > 0 && v.drifted.length === 0) {
    return (
      `No hash is recorded for ${v.unrecorded.length} table(s) under ${v.datasetVersion}. ` +
      "That is a gap in the seed manifest rather than a problem with the data: run " +
      "`npm run gen:projection-hashes` against a freshly reset environment and commit the result."
    );
  }
  return (
    `${v.drifted.length} table(s) differ from the hashes recorded for ${v.datasetVersion}: ` +
    `${v.drifted.join(", ")}. This says the dataset is not the one that was published — it ` +
    "does not say which is right. If the seed was changed on purpose, regenerate the hashes " +
    "with `npm run gen:projection-hashes` and commit them. If it was not, reset the " +
    "environment: a demonstration on a dataset nobody published is the thing p29's gate exists " +
    "to stop."
  );
}
