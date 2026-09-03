// Identity scan — the reviewer's check that fabricated data is fabricated
// (§26 p44: "/review/demo-data — Reset and verify fabricated data — seed, scan,
// reset — Run identity scan").
//
// The atlas makes the SCAN the primary action on this screen, not the reset,
// and that is the right way round. A reviewer looking at a demonstration is
// being asked to accept a large claim on trust — that none of these 17,000
// people exist — and the reset button does nothing to support it. The scan
// does, by looking for the marks a real person leaves in a dataset.
//
// WHAT IT IS AND IS NOT. This is a contamination scan, not a re-identification
// defence. It reads the columns a real identifier could arrive in and reports
// anything shaped like one: an address on a live mail domain, a phone number,
// a government identifier, a street address. It cannot prove a name is
// invented, and it says so rather than implying it did.
//
// IT IS SCOPED TO THE FABRICATED POPULATION, and the first version was not.
// Scanning every row flagged the demonstration's own human accounts, whose
// addresses are supposed to be deliverable — a real person's real email is
// their email, not contamination. `runQualityChecks` already had this right:
// it reports the count of real people rather than judging it, because a human
// signing up in an environment is legitimate. What is NOT legitimate is a
// fabricated record carrying something that could reach or identify somebody,
// so that is what this looks for. A person whose provenance was never stated
// is reported separately, as the defect it is: the write guard requires one,
// so a null is a row that predates the guard.
//
// TWO THINGS IT REFUSES TO DO QUIETLY.
//
//   IT DOES NOT DECRYPT. Free-text clinical fields are encrypted at rest, and
//   a scanner that held the data key to read them would be a decryption tool
//   living on a review screen. So those columns are counted as UNREADABLE and
//   reported as a stated limit — "N fields could not be read" — rather than
//   being silently skipped, which would let a clean result mean either "there
//   is nothing there" or "we did not look".
//
//   IT DOES NOT PASS A TABLE IT COULD NOT FIND. A missing column is reported,
//   not treated as zero findings. A scan whose coverage shrinks silently is
//   how a check keeps passing while it stops checking.

import type Database from "better-sqlite3";
import { isEncrypted } from "./crypto";

/** `nothing_to_scan` is its own state and not a pass. A clean result over zero
 *  rows says "we looked and found nothing" using the same word as "there was
 *  nothing to look at", and those are different facts — the second one means
 *  this environment has no fabricated population, which a reviewer told
 *  "clean" would never learn. */
export type ScanSeverity = "contaminated" | "suspect" | "clean" | "nothing_to_scan";

export type FindingSeverity = "contaminated" | "suspect";

export interface ScanFinding {
  /** Where it was found. */
  table: string;
  column: string;
  rowId: string;
  /** Which pattern matched, in the reviewer's words. */
  kind: string;
  /** The value, redacted to its shape. The scan never prints a candidate real
   *  identifier back onto a screen — that would republish the thing it exists
   *  to find. */
  shape: string;
  severity: FindingSeverity;
}

export interface ScanRule {
  kind: string;
  /** Why this shape would mean contamination. */
  because: string;
  test: (value: string) => boolean;
  severity: FindingSeverity;
  /** Redacted rendering, so the finding is locatable without being readable. */
  shape: (value: string) => string;
}

/** Domains a fabricated dataset may address. Everything else is deliverable
 *  mail to somebody, which is what makes it a finding. `.local` and `.test`
 *  are reserved by RFC 2606/6762; `example.*` is reserved for documentation. */
const RESERVED_DOMAIN = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|test|local|invalid|localhost)$/i;

const DIGITS = /\d/g;

function digitShape(v: string): string {
  return v.replace(DIGITS, "#");
}

export const SCAN_RULES: ScanRule[] = [
  {
    kind: "Deliverable email domain",
    because: "Mail addressed here would reach a real inbox. A fabricated population's addresses must be undeliverable by construction.",
    severity: "contaminated",
    test: (v) => /@/.test(v) && !RESERVED_DOMAIN.test(v.trim()),
    shape: (v) => `…@${v.split("@").pop() ?? ""}`,
  },
  {
    kind: "Government identifier shape",
    because: "Nothing in this product needs a national identifier, so a value shaped like one was pasted rather than generated.",
    severity: "contaminated",
    // US SSN, UK NI number, NHS number.
    test: (v) => /\b\d{3}-\d{2}-\d{4}\b/.test(v) || /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/.test(v) || /\b\d{3}\s?\d{3}\s?\d{4}\b/.test(v),
    shape: digitShape,
  },
  {
    kind: "Telephone number",
    because: "A number a person could dial is a route to somebody. Crisis lines belong in the crisis resource list, not in a person's record.",
    severity: "suspect",
    // No \b before the opening bracket: a word boundary cannot exist between a
    // space and "(", so "Call back on (415) 555-0134" went unmatched. The guard
    // that planted that string is the only reason this was ever noticed.
    test: (v) => /(?:\+\d[\d ().-]{8,}\d)|(?:\(\d{3}\)\s?\d{3}[ -]\d{4})|(?:\b\d{3}-\d{3}-\d{4}\b)/.test(v),
    shape: digitShape,
  },
  {
    kind: "Postal address",
    because: "A street address places a person somewhere real.",
    severity: "suspect",
    test: (v) => /\b\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/.test(v),
    shape: (v) => digitShape(v).slice(0, 40),
  },
];

/** Where a real identifier could arrive. Named explicitly rather than scanning
 *  every column of every table: a scan that reports its own coverage has to
 *  know what it covers, and "everything" is not a coverage statement.
 *
 *  `personColumn` is how each row is tied back to a person, so the scan can be
 *  restricted to the fabricated ones. A table with no such column cannot be
 *  scoped and is not scanned — it would be scanned indiscriminately or not at
 *  all, and the second is honest. */
export const SCAN_TARGETS: Array<{
  table: string; idColumn: string; personColumn: string; columns: string[];
}> = [
  { table: "users", idColumn: "id", personColumn: "id", columns: ["email", "name"] },
  { table: "persons", idColumn: "id", personColumn: "id", columns: ["display_name"] },
  { table: "user_profiles", idColumn: "user_id", personColumn: "user_id",
    columns: ["goals_json", "trauma_areas_json", "restricted_topics_json"] },
  // A support contact's phone number is exactly the shape this looks for, and
  // on a fabricated person it is exactly the finding that matters.
  { table: "safety_plans", idColumn: "user_id", personColumn: "user_id",
    columns: ["support_contact_name", "support_contact_method", "reminder_phrase", "stop_signs", "careful_topics"] },
  { table: "ai_messages", idColumn: "id", personColumn: "user_id", columns: ["message_text"] },
  { table: "ai_memory_items", idColumn: "id", personColumn: "user_id", columns: ["memory_value"] },
  { table: "user_triggers", idColumn: "id", personColumn: "user_id", columns: ["trigger_name", "notes"] },
  { table: "early_warning_signs", idColumn: "id", personColumn: "user_id", columns: ["sign_name"] },
  { table: "alerts", idColumn: "id", personColumn: "user_id", columns: ["detail", "review_note"] },
];

export interface ScanCoverage {
  table: string;
  column: string;
  /** Values actually read and tested. */
  scanned: number;
  /** Values that are ciphertext. Counted, never decrypted. */
  encrypted: number;
  /** The column or table is not in this schema. */
  absent: boolean;
}

export interface IdentityScanResult {
  ranAt: string;
  severity: ScanSeverity;
  findings: ScanFinding[];
  coverage: ScanCoverage[];
  /** Total values read and tested across every target. */
  scanned: number;
  /** Total values present but unreadable because they are encrypted at rest. */
  unreadable: number;
  /** People this scan covered — those marked fabricated. */
  fabricatedPeople: number;
  /** People whose provenance was never stated. A defect: the write guard
   *  requires one, so these rows predate it. */
  peopleWithoutProvenance: number;
  /** People marked real. REPORTED, NOT JUDGED — a human signing up in this
   *  environment is legitimate, and their own details are theirs. Their records
   *  are outside this scan by construction. */
  realPeople: number;
  /** Targets whose table or column this schema does not have. */
  absentTargets: string[];
}

export function runIdentityScan(db: Database.Database): IdentityScanResult {
  const findings: ScanFinding[] = [];
  const coverage: ScanCoverage[] = [];
  const absentTargets: string[] = [];
  let scanned = 0;
  let unreadable = 0;

  for (const target of SCAN_TARGETS) {
    for (const column of target.columns) {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = db.prepare(
          `SELECT t.${target.idColumn} AS row_id, t.${column} AS v
             FROM ${target.table} t
             JOIN persons p ON p.id = t.${target.personColumn}
            WHERE p.provenance = 'fabricated'
              AND t.${column} IS NOT NULL AND t.${column} <> ''`
        ).all() as Array<Record<string, unknown>>;
      } catch {
        // Reported, not counted as clean. A scan whose coverage shrinks in
        // silence is how a check keeps passing after it stops checking.
        coverage.push({ table: target.table, column, scanned: 0, encrypted: 0, absent: true });
        absentTargets.push(`${target.table}.${column}`);
        continue;
      }

      let read = 0;
      let enc = 0;
      for (const r of rows) {
        const v = String(r.v);
        if (isEncrypted(v)) { enc += 1; continue; }
        read += 1;
        for (const rule of SCAN_RULES) {
          if (rule.test(v)) {
            findings.push({
              table: target.table, column, rowId: String(r.row_id),
              kind: rule.kind, shape: rule.shape(v), severity: rule.severity,
            });
          }
        }
      }
      scanned += read;
      unreadable += enc;
      coverage.push({ table: target.table, column, scanned: read, encrypted: enc, absent: false });
    }
  }

  const count = (sql: string): number => {
    try {
      return Number((db.prepare(sql).get() as { n: number }).n);
    } catch {
      absentTargets.push("persons.provenance");
      return 0;
    }
  };
  const fabricatedPeople = count("SELECT COUNT(*) AS n FROM persons WHERE provenance = 'fabricated'");
  const peopleWithoutProvenance = count("SELECT COUNT(*) AS n FROM persons WHERE provenance IS NULL");
  const realPeople = count("SELECT COUNT(*) AS n FROM persons WHERE provenance = 'real'");

  // A person with no stated provenance is contamination of a different kind:
  // the scan cannot say which population they belong to, so it cannot say it
  // covered them. Real people are NOT part of this verdict.
  const severity: ScanSeverity =
    peopleWithoutProvenance > 0 || findings.some((f) => f.severity === "contaminated")
      ? "contaminated"
      : findings.length > 0
        ? "suspect"
        : fabricatedPeople === 0 || scanned === 0
          ? "nothing_to_scan"
          : "clean";

  return {
    ranAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    severity, findings, coverage, scanned, unreadable,
    fabricatedPeople, peopleWithoutProvenance, realPeople, absentTargets,
  };
}

/** What a clean result does and does not establish. Rendered on the screen,
 *  because a scan reported without its limits is read as a guarantee. */
export const SCAN_BOUNDARY =
  "A clean scan means no value in the fabricated population's columns listed above is shaped like a real-world identifier. It does not mean the names are invented, it cannot read the fields that are encrypted at rest, it does not cover people whose records are real, and it is not a re-identification test.";
