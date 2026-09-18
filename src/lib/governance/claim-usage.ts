// Where a claim has already gone (17 September handoff, P5).
//
//   "Record every export or publication version that used a claim."
//
// THE QUESTION THIS ANSWERS IS ASKED AFTER THE FACT, and it is the only one
// the registry could not answer. `resolveClaim` decides whether a claim may be
// shown TODAY, and it fails closed, which handles everything going forward.
// What it cannot do is answer the question somebody asks the day a claim is
// withdrawn or found to be wrong: where has it already been?
//
// Withdrawing a claim stops it rendering. It does not recall the CSV somebody
// emailed a commissioner in July, and it does not tell anybody that the
// sentence on the evidence page said something different in July than it says
// now. The words are gone from the source and nothing remembers them.
//
// So a use is recorded when it happens, with the words AS THEY WERE. The
// stored `publicText` is the point of the row: a version hash alone proves two
// versions differ and tells nobody what either one said.
//
// ONE ROW PER VERSION, NOT PER VIEW. The handoff asks for the export or
// publication VERSION, so the record is keyed on (claim, claim version,
// vehicle, reference). The first render after a deploy writes; every render
// after it finds the row and does nothing. That keeps a public page's write
// bounded by how often the words change rather than by how many people read
// them, and it keeps the ledger something a person can read.

import crypto from "crypto";
import { data } from "@/lib/data";
import { versionReport } from "@/lib/version";
import type { EvidenceClaim } from "./evidence-registry";

/** How a claim left: rendered on a surface, or written into a file. */
export type ClaimVehicle = "publication" | "export";

export interface ClaimUse {
  claimId: string;
  claimVersion: string;
  vehicle: ClaimVehicle;
  /** The route for a publication, the export id for an export. */
  reference: string;
  /** Which build did it. */
  productVersion: string;
  /** The words, as they were at the time. */
  publicText: string;
  firstUsedAt: string;
}

/**
 * A version of a claim RECORD, not of its text.
 *
 * Everything material is in it — the words, the scope, the population, the
 * limitations, who approved it and until when. A hash over `publicText` alone
 * would call two claims the same version when one had lost its expiry date or
 * gained a surface, and "which version of this claim was published" would then
 * be a question about the sentence rather than about the approval behind it.
 */
export function claimVersion(claim: EvidenceClaim): string {
  const material = JSON.stringify([
    claim.claimId, claim.publicText, claim.productScope, claim.productVersion,
    claim.population, claim.evidenceType, [...claim.sourceIds].sort(),
    claim.resultSummary, claim.limitations, [...claim.allowedSurfaces].sort(),
    claim.approvalStatus, claim.approvedBy ?? null, claim.reviewedAt ?? null,
    claim.expiresAt ?? null,
    claim.countedFrom ? [claim.countedFrom.count, claim.countedFrom.source, claim.countedFrom.how] : null,
  ]);
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/**
 * Which build published it.
 *
 * SAYS SO WHEN IT CANNOT TELL. A ledger whose whole job is pinning a claim to
 * a version is worse than useless if the version is a placeholder that reads
 * like a real one — the row would look like evidence and be a guess. When no
 * commit is reported the record says the build was unidentified, which is the
 * same gap `versionReport` already names on the status page.
 */
export function buildIdentity(): string {
  const v = versionReport();
  return v.commitShort ?? "unidentified-build";
}

/**
 * Record a use, once.
 *
 * Idempotent on (claim, version, vehicle, reference), so the caller does not
 * have to know whether this use has been seen. Returns whether this call was
 * the one that wrote it, which is what a test needs to prove the dedupe works
 * rather than asserting on a row count that a second insert would also satisfy.
 */
export async function recordClaimUse(
  use: Omit<ClaimUse, "firstUsedAt"> & { firstUsedAt?: string }
): Promise<"recorded" | "already recorded"> {
  const c = await data();
  const at = use.firstUsedAt ?? new Date().toISOString().slice(0, 19).replace("T", " ");
  const res = await c.run(
    `INSERT INTO claim_uses
       (id, claim_id, claim_version, vehicle, reference, product_version, public_text, first_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (claim_id, claim_version, vehicle, reference) DO NOTHING`,
    [
      crypto.randomUUID(), use.claimId, use.claimVersion, use.vehicle, use.reference,
      use.productVersion, use.publicText, at,
    ],
  );
  return res.changes > 0 ? "recorded" : "already recorded";
}

/**
 * Record that a surface published these claims.
 *
 * BEST EFFORT, DELIBERATELY, and this is the one place in the governance code
 * where a recording failure does not stop the thing it records. The surfaces
 * that carry claims are public pages, and a public page carries the crisis
 * link. Failing the render because a bookkeeping insert failed would trade a
 * gap in a ledger for a person meeting an error page, which is not a trade
 * this product makes. The export path below takes the opposite decision, for
 * the opposite reason.
 */
export async function recordPublication(
  claims: readonly EvidenceClaim[],
  args: { surface: string; productVersion?: string; at?: string },
): Promise<void> {
  const productVersion = args.productVersion ?? buildIdentity();
  for (const claim of claims) {
    try {
      await recordClaimUse({
        claimId: claim.claimId,
        claimVersion: claimVersion(claim),
        vehicle: "publication",
        reference: args.surface,
        productVersion,
        publicText: claim.publicText,
        firstUsedAt: args.at,
      });
    } catch {
      // Swallowed for the reason above. Not logged to the audit chain either:
      // a failed write cannot append to a log that lives in the same database.
    }
  }
}

/**
 * Which registry claims appear, word for word, in a piece of text.
 *
 * THE EXPORT HOOK IS A SCAN RATHER THAN A PARAMETER. An optional `claimIds`
 * argument on `createExport` would be correct exactly until somebody pasted a
 * claim sentence into an export header and did not think to pass it — which is
 * the case the ledger exists for, and the one a caller is least likely to
 * notice. Matching on the words cannot be forgotten.
 *
 * Exact substring, not fuzzy. The registry's rule is already that nothing
 * paraphrases a claim, so a paraphrase in an export is a separate defect and
 * one this function should not quietly launder into a recorded use.
 */
export function claimsUsedIn(
  text: string, claims: readonly EvidenceClaim[]
): EvidenceClaim[] {
  return claims.filter((c) => text.includes(c.publicText));
}

export interface ClaimUsageRow extends ClaimUse {
  id: string;
}

/** Every recorded use of one claim, oldest first. */
export async function usesOfClaim(claimId: string): Promise<ClaimUsageRow[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, claim_id, claim_version, vehicle, reference, product_version, public_text, first_used_at
       FROM claim_uses WHERE claim_id = ? ORDER BY first_used_at ASC, id ASC`,
    [claimId],
  )) as Record<string, unknown>[];
  return rows.map(toRow);
}

/** The whole ledger, newest first. The reviewer's screen reads this. */
export async function claimUsageLedger(limit = 200): Promise<ClaimUsageRow[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, claim_id, claim_version, vehicle, reference, product_version, public_text, first_used_at
       FROM claim_uses ORDER BY first_used_at DESC, id DESC LIMIT ?`,
    [limit],
  )) as Record<string, unknown>[];
  return rows.map(toRow);
}

function toRow(r: Record<string, unknown>): ClaimUsageRow {
  return {
    id: String(r.id),
    claimId: String(r.claim_id),
    claimVersion: String(r.claim_version),
    vehicle: String(r.vehicle) as ClaimVehicle,
    reference: String(r.reference),
    productVersion: String(r.product_version),
    publicText: String(r.public_text),
    firstUsedAt: String(r.first_used_at),
  };
}

export interface ClaimUsageSummary {
  claimId: string;
  /** Newest version first. */
  versions: Array<{ claimVersion: string; publicText: string; uses: ClaimUsageRow[] }>;
}

/**
 * The ledger, grouped the way the question is asked.
 *
 * BY CLAIM AND THEN BY VERSION, because "where has this gone" is asked about a
 * claim and answered about a version: the interesting row is almost always the
 * one whose words are not the current words. A flat list sorted by time buries
 * exactly that row.
 */
export function groupUsage(rows: readonly ClaimUsageRow[]): ClaimUsageSummary[] {
  const byClaim = new Map<string, Map<string, ClaimUsageRow[]>>();
  for (const r of rows) {
    const versions = byClaim.get(r.claimId) ?? new Map<string, ClaimUsageRow[]>();
    byClaim.set(r.claimId, versions);
    versions.set(r.claimVersion, [...(versions.get(r.claimVersion) ?? []), r]);
  }
  return [...byClaim.entries()]
    .map(([claimId, versions]) => ({
      claimId,
      versions: [...versions.entries()]
        .map(([claimVersion, uses]) => ({
          claimVersion,
          publicText: uses[0].publicText,
          uses: [...uses].sort((a, b) => a.firstUsedAt.localeCompare(b.firstUsedAt)),
        }))
        .sort((a, b) => b.uses[0].firstUsedAt.localeCompare(a.uses[0].firstUsedAt)),
    }))
    .sort((a, b) => a.claimId.localeCompare(b.claimId));
}
