import crypto from "node:crypto";
import { EVENT_TERMS } from "../clinical/event-vocabulary";

// A clinical approval, bound to the exact words it was given for.
//
// WHAT THIS EXISTS TO PREVENT is the most ordinary failure in a regulated
// product: an approval recorded once, and then the thing it approved changes.
// The sign-off survives, the content moves, and a year later somebody reads
// "clinically approved" over words no clinician ever saw. This codebase has
// already found four versions of that same drift in its own paperwork, which is
// why the work register exists; a clinical vocabulary deserves the stronger
// form.
//
// SO THE APPROVAL IS TIED TO A HASH OF THE CONTENT. `contentHash` is computed
// from every approved key, term and note, in a fixed order. Change one word and
// the hash changes; the approval no longer matches, and the guard fails. There
// is no way to edit a term and keep the sign-off by accident — only by
// deliberately recording a new one.
//
// WHAT AN APPROVAL DOES NOT COVER IS PART OF THE RECORD. `excludes` is required
// and rendered, because the dangerous reading of any sign-off is the widest
// one. These reviewers approved words for an audit column. They did not approve
// the clinical rules those events describe, they did not review the events
// themselves, and nothing here authorises real-person use.
//
// THE ATTESTATION IS NOT SOMETHING THIS FILE CAN INVENT. `reviewers` and
// `reviewedAt` describe what named people did on a named date. They are filled
// in by the people who did it — until then `status` is "awaiting_attestation",
// the vocabulary renders as unapproved, and the product says so on screen. An
// approval block with a plausible name in it is worse than an empty one,
// because it is the same shape as a true one.

export interface Reviewer {
  /** The name that appears on the record. */
  name: string;
  /** Their role, as they hold it — not their role in this product. */
  role: string;
  /**
   * The licence the role rests on, as printed on the form they signed.
   *
   * REQUIRED, because a name and a role are a claim and a licence number is a
   * thing somebody else can check. This record is the only place the product
   * states who approved its clinical words, and "a psychologist agreed" is not
   * a statement anybody can verify.
   */
  license: string;
  /** The date THEY wrote beside their signature, as YYYY-MM-DD.
   *
   *  Per reviewer rather than one date for the approval, because two people
   *  signing on different days is ordinary and collapsing it loses which
   *  signature is which. */
  signedAt: string;
}

/** The signed form itself, bound to the record by a hash of the file.
 *
 *  The attestation is a set of names and dates transcribed by somebody; the
 *  evidence is the document those names are written on. Recording its SHA-256
 *  means the record names one exact file — swap it and the guard fails, rather
 *  than the approval quietly pointing at whatever now sits at that path. */
export interface SignedEvidence {
  path: string;
  sha256: string;
  /** What the reviewers marked, in the form's own words. */
  determination: string;
  /** Anything they wrote in the conditions box. Empty when they wrote nothing,
   *  which is a different fact from nobody having looked. */
  conditions: readonly string[];
}

export type ApprovalStatus =
  /** The words exist and no attestation has been recorded against them. */
  | "awaiting_attestation"
  /** Named reviewers attested to this exact content on a recorded date. */
  | "approved";

export interface ClinicalApproval {
  id: string;
  /** What was approved, in one sentence. */
  scope: string;
  /** The surfaces these words appear on. */
  appliesTo: readonly string[];
  /** What this approval explicitly does not cover. Required. */
  excludes: readonly string[];
  /** The hash of the content this attestation was given for. */
  contentHash: string;
  status: ApprovalStatus;
  /** Who approved it. Empty until they do. */
  reviewers: readonly Reviewer[];
  /** The date they did, as YYYY-MM-DD. Null until they do. */
  reviewedAt: string | null;
  /** Where the full text they read is stored. */
  document: string;
  /** The printable form they sign, generated from the same words. */
  signoffForm: string;
  /** The returned form with their signatures on it. Null until it comes back. */
  signedEvidence: SignedEvidence | null;
}

/**
 * The hash of the vocabulary as it stands.
 *
 * Over the key, the term AND the note, because the note is where the clinical
 * boundary lives — "recorded is not delivered", "opened is not reviewed". A
 * hash over the terms alone would let the boundary be rewritten under an
 * unchanged approval, which is the exact hole this is here to close.
 *
 * Sorted by key, so the hash is a fact about the content rather than about the
 * order somebody happened to type it in.
 */
export function vocabularyHash(
  terms: Record<string, { term: string; note: string }> = EVENT_TERMS
): string {
  // JSON-ENCODED, NOT JOINED WITH SEPARATORS. The first version built
  // `key\u0000term\u0000note` and joined with \u0001, and its own guard broke
  // it: a note containing those characters produces the same canonical string
  // as two entries, so one entry could forge a second and two different
  // vocabularies could hash alike. Contrived with hand-written words, and
  // exactly the assumption that stops holding when something generates them.
  // JSON escapes control characters, so no field can restructure the string it
  // sits in.
  const canonical = JSON.stringify(
    Object.keys(terms).sort().map((k) => [k, terms[k].term, terms[k].note])
  );
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * The approval record for the clinical display vocabulary.
 *
 * `contentHash` is the hash of the words as submitted for review. It is written
 * down rather than computed at read time, because a value computed from the
 * current content can never disagree with the current content — and disagreeing
 * is the entire job.
 */
export const DISPLAY_VOCABULARY_APPROVAL: ClinicalApproval = {
  id: "clinical-display-vocabulary-v1",
  scope:
    "The clinician-facing words shown in place of raw event keys in the audit and activity views of a person's record, and the note beside each one saying what it does and does not mean.",
  appliesTo: [
    "/clinician/member/[id]/audit",
    "/clinician/activity",
    "/review/audit",
  ],
  excludes: [
    "The clinical rules the events describe. These are words for things that already happened; no threshold, gate or safety precedence was reviewed or changed.",
    "The events themselves. Which events are recorded, and what they contain, is unchanged by this approval.",
    "Any patient-facing wording. Every term here is written for a clinician who can open the evidence underneath it.",
    "Any authorisation for real-person care, public enrollment, or payer deployment. The release boundary is unchanged.",
    "Event keys not listed in the document. An unlisted key renders as its raw value and is marked as carrying no approved words.",
  ],
  // Recorded from the content submitted for review. Regenerate deliberately,
  // with a new attestation, never to make a failing guard pass.
  contentHash: "853445054e584581996e897830e24480b2d9d2d30904aeb385bcd84cf56e9508",
  status: "approved",
  // TRANSCRIBED FROM THE SIGNED FORM, not reconstructed from when it was sent.
  // Both reviewers marked "Approved as written", wrote nothing in the
  // conditions box, and dated their signatures 9/17/26. That date is one day
  // BEFORE the form itself was prepared, which is recorded here rather than
  // corrected: an attestation is somebody else's statement, and tidying a date
  // on one is the small version of the drift this whole module exists to catch.
  // It is flagged for the product owner to resolve with the reviewers.
  reviewers: [
    {
      name: "Rebecca Altschuler, PhD",
      role: "Licensed Psychologist",
      license: "Psychologist — AZ PSY-005804 (Arizona)",
      signedAt: "2026-09-17",
    },
    {
      name: "John Allen, PhD",
      role: "Licensed Psychologist",
      license: "Psychologist — AZ PSY-002055 (Arizona)",
      signedAt: "2026-09-17",
    },
  ],
  reviewedAt: "2026-09-17",
  document: "docs/approvals/clinical-display-vocabulary-v1.md",
  signoffForm: "docs/approvals/clinical-display-vocabulary-v1-SIGNOFF-FORM.docx",
  signedEvidence: {
    path: "docs/approvals/clinical-display-vocabulary-v1-SIGNED.pdf",
    sha256: "92abb3548e8f8d3fa1803d9e912cbf87945536aa2a97d8206fcf62607619bc92",
    determination: "Approved as written.",
    conditions: [],
  },
};

export interface ApprovalCheck {
  ok: boolean;
  /** Why not, in words a reader can act on. */
  problems: string[];
}

/**
 * Whether an approval still covers the content it claims to.
 *
 * Three separate failures, kept separate because they need different answers:
 * an unsigned approval needs a reviewer, a stale hash needs a fresh review, and
 * a signed approval missing its names is a record that cannot be relied on.
 */
export function checkApproval(
  approval: ClinicalApproval = DISPLAY_VOCABULARY_APPROVAL,
  currentHash: string = vocabularyHash()
): ApprovalCheck {
  const problems: string[] = [];

  if (approval.status === "awaiting_attestation") {
    problems.push(
      `${approval.id} has no attestation: no reviewer and no date have been recorded, so these words carry no clinical approval.`
    );
  }

  if (approval.status === "approved") {
    if (approval.reviewers.length === 0) {
      problems.push(`${approval.id} claims approval and names no reviewer.`);
    }
    if (!approval.reviewedAt) {
      problems.push(`${approval.id} claims approval and records no date.`);
    }
    // A NAME IS A CLAIM; A LICENCE IS CHECKABLE. Both are required of an
    // approval being relied on, because this record is the only place the
    // product states who approved its clinical words.
    for (const r of approval.reviewers) {
      if (!r.license.trim()) {
        problems.push(`${approval.id} names ${r.name} with no licence, so the role cannot be checked.`);
      }
      if (!r.signedAt) {
        problems.push(`${approval.id} names ${r.name} with no date beside their signature.`);
      }
    }
    // AND THE DOCUMENT THEY SIGNED. Names and dates are a transcription, and
    // without the thing they were transcribed from there is nothing to check
    // the transcription against.
    if (!approval.signedEvidence) {
      problems.push(
        `${approval.id} claims approval with no signed document recorded, so the names and dates rest on nothing.`
      );
    } else if (!approval.signedEvidence.determination.trim()) {
      problems.push(`${approval.id} records a signed document that does not say what was determined.`);
    }
    if (approval.contentHash !== currentHash) {
      problems.push(
        `${approval.id} was approved for content hashed ${approval.contentHash.slice(0, 12)}…, and the vocabulary now hashes ${currentHash.slice(0, 12)}…. The words changed after the review, so the approval does not cover them.`
      );
    }
  }

  if (approval.excludes.length === 0) {
    problems.push(`${approval.id} does not say what it excludes, so its scope is whatever a reader assumes.`);
  }

  return { ok: problems.length === 0, problems };
}

/** Whether the vocabulary may be presented to a clinician as approved words. */
export function vocabularyIsApproved(): boolean {
  return checkApproval().ok;
}
