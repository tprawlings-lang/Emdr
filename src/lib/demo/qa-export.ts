// The QA report, released through the governed export path (handoff 07 Wave 8).
//
// p9's control: "Export QA report — a manifest of counts, hashes and failed
// checks, labelled fabricated on every page." The admin console listed it as
// needing not an export but a RELEASE PATH: handoff 09 Package 5 made an export
// a job with a lifecycle, a signature and a rechecked download, so the work here
// is putting the quality checks through that door rather than building a second
// one.
//
// WHY IT GOES THROUGH THE GOVERNED PATH AT ALL, given that every row in it is
// fabricated and none of it is a disclosure about anybody. Because the thing a
// QA report is FOR is being believed later. It gets attached to a ticket,
// pasted into a review, and quoted in a conversation about whether an
// environment was fit on a particular afternoon — which is exactly the class of
// claim the export machinery exists to make checkable. A QA report with no
// signature, no content hash and no recorded purpose is a screenshot with extra
// steps, and the first time two people disagree about what it said, nothing can
// settle it.
//
// IT HAS ITS OWN READER, AND THAT IS THE ONE DEPARTURE. The aggregate exports
// are read back through `/api/exports/[id]`, which resolves the caller's scope
// through the organization and payer bindings and deliberately excludes the
// platform tenant. A QA report is an operations artifact for the demo
// administrator, not an aggregate disclosure for a plan — so it is created
// against the platform tenant and read through a route that asks for
// `requireDemoAdmin` instead. Same machinery, same signature check at read
// time, different door, and the difference is stated rather than worked around
// by giving a demo administrator an intelligence binding they should not have.
//
// EVERY ROW IS A CHECK OR A HASH, never a person. There is no count of people
// in it — the profile-count check reports "240 exactly" as TEXT against a
// fabricated manifest — so `countColumns` is empty, and it is empty as a
// declaration rather than an omission: `createExport` requires every caller to
// say which columns hold counts of people before a file can exist.

import type Database from "better-sqlite3";

import { PLATFORM_TENANT_ID } from "../db";
import { createExport, ExportRefused, type ExportResult, type ExportRow } from "../intelligence/export";
import { runQualityChecks } from "../demo-quality";
import { demoBaseline } from "../demo-reset";
import { DATASET_VERSION } from "../demo-population-manifest";
import { validateProjections } from "./projection-hashes";
import { appliedScenarios } from "./data-scenario";
import { readLastReset } from "./preflight";

/** The surface name recorded on the job, so an unexpected QA export is visible
 *  in the same place an unexpected population export would be. */
export const QA_EXPORT_SURFACE = "admin/demo/qa-report";

export interface QaSection {
  section: string;
  item: string;
  expected: string;
  actual: string;
  result: "pass" | "fail" | "info";
}

/**
 * Every row of the report.
 *
 * FOUR SECTIONS, in the order somebody reading a failure needs them. The reset
 * outcome comes first for the reason the preflight gate puts it first: checks
 * computed against a database whose rebuild failed are checks about the wrong
 * database, and a reader who works down from the top should hit that before
 * they start interpreting counts.
 *
 * A FAILING CHECK IS A ROW, NOT AN ABSENCE. p9 asks for "failed checks" and it
 * would be easy to read that as a report OF the failures; the report is of
 * every check, with the failures marked. A file that lists only what went wrong
 * cannot be used to show that anything went right, which is the more common
 * reason somebody attaches one to a ticket.
 */
export function qaRows(db: Database.Database): QaSection[] {
  const rows: QaSection[] = [];

  // ── Environment ──────────────────────────────────────────────────────────
  const lastReset = readLastReset(db);
  rows.push({
    section: "environment",
    item: "Last rebuild",
    expected: "succeeded, or never attempted",
    actual: lastReset === null
      ? "no rebuild recorded"
      : `${lastReset.status} ${lastReset.at}${lastReset.detail ? ` — ${lastReset.detail}` : ""}`,
    result: lastReset === null || lastReset.status === "succeeded" ? "pass" : "fail",
  });

  const baseline = demoBaseline(db);
  rows.push({
    section: "environment",
    item: "Dataset version",
    expected: DATASET_VERSION,
    actual: baseline.version,
    result: "info",
  });
  rows.push({
    section: "environment",
    item: "Baseline hash",
    expected: "stable across resets",
    actual: baseline.hash,
    result: "info",
  });

  // ── Data quality ─────────────────────────────────────────────────────────
  for (const c of runQualityChecks(db)) {
    rows.push({
      section: "data quality",
      item: c.check,
      expected: c.expected,
      actual: c.actual,
      result: c.pass ? "pass" : "fail",
    });
  }

  // ── Projection hashes ────────────────────────────────────────────────────
  const v = validateProjections(db);
  for (const c of v.checks) {
    rows.push({
      section: "projection hashes",
      item: c.table,
      expected: c.expected ?? "no hash recorded in the seed manifest",
      actual: c.actual ?? "empty in this environment",
      // An unrecorded hash is a FAIL here for the same reason it blocks the
      // preflight gate: a report that counts "I do not know" as fine is a
      // report somebody will quote as evidence that the dataset was right.
      result: c.verdict === "matches" ? "pass" : "fail",
    });
  }

  // ── Applied data scenarios ───────────────────────────────────────────────
  //
  // NOT A FAILURE, AND NOT NOTHING. A bundle is a legitimate thing to have
  // applied; what would be wrong is a QA report that describes a population
  // as the published one while it carries three days of fabricated safety
  // gates. So each is an `info` row, and a reader comparing two reports can
  // see why the counts differ.
  const applied = appliedScenarios();
  if (applied.length === 0) {
    rows.push({
      section: "data scenarios",
      item: "Applied bundles",
      expected: "the published baseline",
      actual: "none",
      result: "info",
    });
  } else {
    for (const a of applied) {
      rows.push({
        section: "data scenarios",
        item: a.scenarioVersion,
        expected: "the published baseline",
        actual: `${a.people} people, ${a.events} events, applied ${a.appliedAt} — "${a.reason}"`,
        result: "info",
      });
    }
  }

  return rows;
}

export interface QaSummary {
  total: number;
  failed: number;
  ok: boolean;
}

export function qaSummary(rows: QaSection[]): QaSummary {
  const graded = rows.filter((r) => r.result !== "info");
  const failed = graded.filter((r) => r.result === "fail").length;
  return { total: graded.length, failed, ok: failed === 0 };
}

export type QaExportOutcome =
  | { ok: true; result: ExportResult; summary: QaSummary }
  | { ok: false; reason: string };

/**
 * Release the QA report as a signed, audited export job.
 *
 * A FAILING ENVIRONMENT STILL EXPORTS, and that is deliberate — it is the
 * opposite of every other gate on this console. The other controls refuse on a
 * failing manifest because demonstrating from a broken environment is the harm;
 * this one exists to DESCRIBE a broken environment to somebody who is not in
 * the room. Refusing to export the report when the checks fail would withhold
 * the artifact at exactly the moment it is the thing being asked for.
 */
export async function exportQaReport(args: {
  db: Database.Database;
  requestedBy: string;
  requestedByRole: string;
  purpose: string;
}): Promise<QaExportOutcome> {
  const rows = qaRows(args.db);
  const summary = qaSummary(rows);

  try {
    const result = await createExport({
      tenantId: PLATFORM_TENANT_ID,
      requestedBy: args.requestedBy,
      requestedByRole: args.requestedByRole,
      surface: QA_EXPORT_SURFACE,
      // The dataset version IS the cohort here: the report is about a dataset,
      // and naming it is what lets two reports be compared at all.
      cohortVersion: DATASET_VERSION,
      filter: {
        scope: "demonstration environment",
        sections: ["environment", "data quality", "projection hashes", "data scenarios"],
        gradedChecks: summary.total,
      },
      // No column is a count of people. Declared rather than omitted: the type
      // requires a caller to have thought about it, and a caller that has not
      // cannot pass this by accident.
      countColumns: [],
      rows: rows as unknown as ExportRow[],
      purpose: args.purpose,
    });
    return { ok: true, result, summary };
  } catch (e) {
    if (e instanceof ExportRefused) return { ok: false, reason: e.message };
    throw e;
  }
}
