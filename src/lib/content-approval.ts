// The signed Handoff 10 content review — what was approved, by whom, and over
// which exact words.
//
// Same shape of record as the display-vocabulary approval
// (governance/clinical-approval.ts), for the same reason: an approval that
// survives a change to the thing it approved is worse than none. So it names
// the content pack the reviewers read by its SHA-256, and the signed form by
// its SHA-256, and tests/content-approval.test.ts fails if either file stops
// matching — or if any member-facing string that rides on these rows is not,
// word for word, in the pack they signed.
//
// WHAT WAS SIGNED (docs/approvals/handoff-10-content-SIGNED-2026-09-24.pdf):
// both reviewers ticked the approve-all box for Lanes A to D (CV10_A01 to
// CV10_D05, 32 rows) and signed; no row was marked "approve with changes" or
// "needs change", and no notes were written. Lane E is marked "Not for
// signature at this time". The founder signed the attestation, which includes
// Lane F (CV10_F01 to F05).
//
// WHAT IT DOES NOT MEAN is part of the record, below. The approvals are of
// words and gating; nothing here authorises real-person use, and two founder
// rows (F01 licensing, F04 audio rights) attest to agreements whose documents
// are not in this repository.

export interface ContentReviewer {
  name: string;
  role: string;
  license: string;
  signedAt: string;
}

export interface ContentApproval {
  reference: string;
  reviewers: readonly ContentReviewer[];
  /** Rows the clinical reviewers approved. */
  approvedRows: readonly string[];
  /** Rows the founder signed (Lane F: licensing and compliance). */
  founderRows: readonly string[];
  founder: { name: string; signedAt: string };
  /** Rows deliberately left unsigned, with the form's reason. */
  notSigned: { rows: readonly string[]; why: string };
  /** The content the reviewers read, bound by hash. */
  contentPack: { path: string; sha256: string };
  /** The handoff the rows' "Spec" references point at. */
  spec: { path: string; sha256: string };
  /** The returned, signed form. */
  signedEvidence: { path: string; sha256: string; determination: string; conditions: readonly string[] };
  /** How a row whose "Decision asked" offered choices was read. */
  interpretations: readonly string[];
  excludes: readonly string[];
}

const rows = (lane: string, n: number) =>
  Array.from({ length: n }, (_, i) => `CV10_${lane}${String(i + 1).padStart(2, "0")}`);

export const CONTENT_V10_APPROVAL: ContentApproval = {
  reference: "STEADY-CLINREV-2026-09-24-10",
  reviewers: [
    { name: "Rebecca Altschuler, PhD", role: "Psychologist", license: "AZ PSY-005804", signedAt: "2026-09-24" },
    { name: "John Allen, PhD", role: "Psychologist", license: "AZ PSY-002055", signedAt: "2026-09-24" },
  ],
  approvedRows: [...rows("A", 17), ...rows("B", 5), ...rows("C", 5), ...rows("D", 5)],
  founderRows: rows("F", 5),
  founder: { name: "Travis, Founder", signedAt: "2026-09-24" },
  notSigned: {
    rows: rows("E", 5),
    why: "Lane E, the clinician-assigned lane, is marked “Not for signature at this time”: it waits for a provider partner and licensed protocol content.",
  },
  contentPack: {
    path: "docs/handoffs/10-content-pack.md",
    sha256: "8ca548603b388d47f00f01260390736e66a4191f331f2e4281512f33db3cd359",
  },
  spec: {
    path: "docs/handoffs/10-non-bls-modules.md",
    sha256: "22342e29eb2e5039640ee98f2ca17a8afefe9e0ae41d700d01d34cbf51b58423",
  },
  signedEvidence: {
    path: "docs/approvals/handoff-10-content-SIGNED-2026-09-24.pdf",
    sha256: "51369845f6afcb9f7b368428058f2f35c427602107dd75321f5b78c8f84287a8",
    determination:
      "Both reviewers: “I have reviewed and approve all rows in Lanes A, B, C and D (CV10_A01 to CV10_D05), except any row where I marked Approve with changes or Needs change.” No row was so marked.",
    conditions: [],
  },
  interpretations: [
    "CV10_B02 asked the reviewers to choose the proposal, the knowledge-base default, or their own values, and was approved without a choice marked. It is read as approving the proposal, the only values written in the row: units 1 and 2 at stabilization, ceiling 6; units 3 and 4 at cautious, ceiling 6; Gentle items only at stabilization.",
    "CV10_A04 asked whether the companion should keep offering the cold-water skill at all, and was approved without an answer to that part. The skill stays out of the member library and the companion's behaviour is unchanged, which is the row's own default.",
    "CV10_C05 approves PROMIS Sleep Disturbance 8a as the candidate measure. No sleep measure is added until its licensed item text is supplied: the content pack does not contain it and it is not written from memory.",
  ],
  excludes: [
    "Real-person use. Nothing here passes a release gate.",
    "Lane E. No clinician-assigned container is approved.",
    "The movement-practice and calm-place lesson rewordings made alongside P0 (KB_SELF_HOLD_REPLACES_BUTTERFLY): the form's row A01 covers the self-hold only.",
    "The existence of the licence (F01) and the audio rights (F04). The founder's signature attests to them; the agreements themselves are not in this repository.",
  ],
};

// Lane F counts as signed: it is the founder's lane by the form's own design
// (licensing and compliance, not clinical), and the founder signed it.
const APPROVED = new Set([...CONTENT_V10_APPROVAL.approvedRows, ...CONTENT_V10_APPROVAL.founderRows]);

/** Rows the signed record approves, clinical and founder. A later
 *  needs-change verdict in the sign-off table still withdraws one
 *  (content-signoff.ts). */
export function approvedContentRows(): ReadonlySet<string> {
  return APPROVED;
}
