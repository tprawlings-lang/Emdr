import crypto from "crypto";
import { data } from "@/lib/data";
import { audit } from "@/lib/audit";
import { SMALL_CELL } from "@/components/charts/aggregate";

// Governed export (§29.1's export rule, §30.4's POST /exports, §31.4's export
// row).
//
// Both aggregate consoles carried a panel saying export was not built, and
// that was the right call while the only alternative was a download button. An
// export is a WRITE: it takes data out of this system into a spreadsheet that
// gets copied, emailed, and outlives the screen it came from. The record of it
// has to outlive the file too.
//
// §31.4 names six requirements. Each is enforced here rather than documented:
//
//   FILTER PARITY   The file contains exactly the cohort the screen showed.
//                   `filterHash` is computed from the filter the CALLER passed
//                   and stored with the job, so a file can be checked against
//                   the view that produced it afterwards. An export that
//                   silently widened its filter is a disclosure nobody
//                   authorised, and without the hash nobody could tell.
//
//   COHORT VERSION  Travels with the file, so the same report can be
//                   reproduced after the definition changes.
//
//   SUPPRESSION     Applied to the ROWS, not to the rendering. Suppression
//                   that only exists on screen is not suppression — the file
//                   is the artefact that leaves.
//
//   PURPOSE         Required, and recorded before the file exists. A purpose
//                   supplied afterwards is a justification, not a reason.
//
//   AUDIT EVENT     Written before the file is returned. If the audit write
//                   fails, the export fails: an unlogged disclosure is worse
//                   than a refused one.
//
//   SIGNED FILE     A signature over the content, so a copy circulating later
//                   can be checked against what was actually released.

export class ExportRefused extends Error {}

export interface ExportRow {
  [column: string]: string | number | null;
}

export interface ExportRequest {
  tenantId: string;
  requestedBy: string;
  requestedByRole: string;
  /** Which screen asked. Recorded so an unexpected export surface is visible. */
  surface: string;
  cohortVersion: string;
  /** The filter the screen was showing. Hashed for parity. */
  filter: Record<string, unknown>;
  /** Columns that hold counts, and must be suppressed below the small-cell
   *  threshold. Named by the caller because only the caller knows which
   *  numbers are counts of people and which are rates or denominators. */
  countColumns: string[];
  rows: ExportRow[];
  purpose: string;
}

export interface ExportResult {
  id: string;
  filename: string;
  csv: string;
  rowCount: number;
  suppressedCells: number;
  filterHash: string;
  contentHash: string;
  signature: string;
  cohortVersion: string;
  createdAt: string;
}

/** Deterministic hash of a filter: key order must not change the result, or
 *  two identical filters produce two different hashes and parity is
 *  meaningless. */
export function hashFilter(filter: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(filter).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = filter[k];
      return acc;
    }, {}),
  );
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** The signing key. Derived from the session secret rather than stored
 *  separately: a signature nobody can verify is decoration, and a key that
 *  lives in a second place is a key that gets rotated in one of them. */
function signingKey(): string {
  const secret = process.env.EMDR_SESSION_SECRET;
  if (!secret) {
    throw new ExportRefused(
      "Export refused: no signing key is configured, so the file could not be signed. " +
      "An unsigned export cannot be checked against what was released.",
    );
  }
  return secret;
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build, record and sign an export.
 *
 * Refuses rather than degrades. Every refusal below is a case where producing
 * *something* would be worse than producing nothing, because the file would
 * leave the building looking exactly like a governed one.
 */
export async function createExport(req: ExportRequest): Promise<ExportResult> {
  const purpose = req.purpose.trim();
  // A purpose is what makes this reviewable later. "data" or "report" tells a
  // reviewer nothing, so the check is on substance rather than presence.
  if (purpose.length < 12) {
    throw new ExportRefused(
      "Export refused: state what this file is for, in a sentence. The purpose is recorded " +
      "with the export and is what makes it reviewable afterwards.",
    );
  }
  if (req.rows.length === 0) {
    throw new ExportRefused("Export refused: the current filter selects no rows.");
  }

  const key = signingKey();
  const columns = Object.keys(req.rows[0]);

  // Suppression, applied to the rows that will actually leave. A count below
  // the threshold becomes the same marker the screen shows, not a rounded
  // number and not a blank — a blank is indistinguishable from missing data.
  let suppressed = 0;
  const safeRows = req.rows.map((row) => {
    const out: ExportRow = {};
    for (const col of columns) {
      const v = row[col];
      if (req.countColumns.includes(col) && typeof v === "number" && v > 0 && v < SMALL_CELL) {
        out[col] = `under ${SMALL_CELL}`;
        suppressed++;
      } else {
        out[col] = v ?? null;
      }
    }
    return out;
  });

  const filterHash = hashFilter(req.filter);
  const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  const id = crypto.randomUUID();

  // The header block travels IN the file. A CSV that has been separated from
  // the page it came from is the normal case, not the exception, so the
  // provenance has to survive the separation.
  const header = [
    `# Steady export ${id}`,
    `# Surface: ${req.surface}`,
    `# Cohort version: ${req.cohortVersion}`,
    `# Filter hash: ${filterHash}`,
    `# Purpose: ${purpose.replace(/\n/g, " ")}`,
    `# Generated: ${createdAt}`,
    `# Suppression: counts below ${SMALL_CELL} are withheld and shown as "under ${SMALL_CELL}"`,
    `# FABRICATED DEMONSTRATION DATA — NOT CLINICAL OR FINANCIAL RECORD`,
  ].join("\n");

  const body = [
    columns.join(","),
    ...safeRows.map((r) => columns.map((c) => csvCell(r[c])).join(",")),
  ].join("\n");

  const csv = `${header}\n${body}\n`;
  const contentHash = crypto.createHash("sha256").update(csv).digest("hex");
  const signature = crypto.createHmac("sha256", key).update(contentHash).digest("hex");

  // The audit event comes BEFORE the file is returned. An unlogged disclosure
  // is worse than a refused one, so a failure here fails the export.
  await audit({
    actorId: req.requestedBy,
    actorRole: req.requestedByRole,
    family: "security",
    type: "export_created",
    target: req.surface,
    detail: {
      exportId: id,
      cohortVersion: req.cohortVersion,
      filterHash,
      purpose,
      rowCount: safeRows.length,
      suppressedCells: suppressed,
      contentHash,
    },
  });

  const c = await data();
  await c.run(
    `INSERT INTO export_jobs
       (id, tenant_id, requested_by, purpose, surface, cohort_version, filter_json,
        filter_hash, row_count, suppressed_cells, content_hash, signature, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, req.tenantId, req.requestedBy, purpose, req.surface, req.cohortVersion,
      JSON.stringify(req.filter), filterHash, safeRows.length, suppressed,
      contentHash, signature, createdAt,
    ],
  );

  return {
    id,
    filename: `steady-${req.surface.replace(/[^a-z0-9]+/gi, "-")}-${createdAt.slice(0, 10)}.csv`,
    csv,
    rowCount: safeRows.length,
    suppressedCells: suppressed,
    filterHash,
    contentHash,
    signature,
    cohortVersion: req.cohortVersion,
    createdAt,
  };
}

export interface ExportRecord {
  id: string;
  purpose: string;
  surface: string;
  cohortVersion: string;
  filterHash: string;
  rowCount: number;
  suppressedCells: number;
  contentHash: string;
  createdAt: string;
  requestedByName: string | null;
}

/** The export history for a tenant. This IS the audit surface for exports:
 *  what left, under which filter, for what stated reason, and who asked. */
export async function listExports(tenantId: string, limit = 20): Promise<ExportRecord[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT e.id, e.purpose, e.surface, e.cohort_version, e.filter_hash, e.row_count,
            e.suppressed_cells, e.content_hash, e.created_at, u.name AS requested_by_name
       FROM export_jobs e
       LEFT JOIN users u ON u.id = e.requested_by
      WHERE e.tenant_id = ?
      ORDER BY e.created_at DESC
      LIMIT ?`,
    [tenantId, limit],
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    purpose: String(r.purpose),
    surface: String(r.surface),
    cohortVersion: String(r.cohort_version),
    filterHash: String(r.filter_hash),
    rowCount: Number(r.row_count),
    suppressedCells: Number(r.suppressed_cells),
    contentHash: String(r.content_hash),
    createdAt: String(r.created_at),
    requestedByName: r.requested_by_name ? String(r.requested_by_name) : null,
  }));
}

/** Verify a signature against a content hash. Used by the download route so a
 *  file is never served from a record whose signature does not match. */
export function verifySignature(contentHash: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", signingKey()).update(contentHash).digest("hex");
  // Timing-safe: the comparison is on attacker-influenced input.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
