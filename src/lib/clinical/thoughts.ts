// Clinician thought capture — the state machine and its rules (§8.1).
//
// A clinician speaks after a session; Steady transcribes it; the clinician
// corrects the transcript if it got something wrong and saves it. This module
// owns the states that walk between those points, and nothing else: no model
// call, no storage, no React.
//
// THE STATE MACHINE IS HERE, ALONE, BECAUSE THERE IS ONLY ONE OF IT. §8.1
// draws six states and four failure edges. Written as `if (status === ...)`
// checks spread across a route, an action and a component, those edges become
// three slightly different opinions about when a thought is reviewable — and
// the one that matters most, "a processing failure never deletes captured audio
// or a completed transcript", is the kind of rule that survives in exactly one
// of the three.
//
// THE RULE WORTH READING TWICE. Phase 1's definition of done says "interrupted
// processing does not lose a completed transcript." That is not a retry policy;
// it is a constraint on the transitions themselves. Transcription and extraction
// are two steps, and only the first produces something irreplaceable — the
// clinician's own words, which they cannot say again the same way. So a failure
// AFTER transcription lands on `review_transcript_only`, a real state with a
// real screen, and never on `failed`. The clinician gets their transcript and
// can save it; what they lose is the organizing, which Steady can redo.

import { appendEventSafe } from "../events";

export type ThoughtStatus =
  /** Recording, in the browser. Nothing has been uploaded. */
  | "capturing"
  /** Uploaded; transcription and extraction are running. */
  | "processing"
  /** Transcript and organized items are ready for the clinician. */
  | "review"
  /** Transcript is ready and extraction failed. Reviewable, not broken. */
  | "review_transcript_only"
  /** The clinician approved and saved. Terminal. */
  | "saved"
  /** Cancelled, or discarded from review. Terminal. */
  | "discarded"
  /** Nothing usable was produced. Terminal. */
  | "failed";

/** What happened, in the vocabulary the transitions are written in. */
export type ThoughtEvent =
  | "done"                 // the clinician stopped recording
  | "cancel"               // the clinician cancelled during capture
  | "transcript_ready"     // a transcript exists
  | "extraction_ready"     // candidate items exist
  | "extraction_failed"    // organizing failed; the transcript survives
  | "upload_failed"        // nothing reached us
  | "transcription_failed" // audio arrived, no transcript came back
  | "save"                 // the clinician approved
  | "discard";             // the clinician threw it away

const TRANSITIONS: Record<ThoughtStatus, Partial<Record<ThoughtEvent, ThoughtStatus>>> = {
  capturing: {
    done: "processing",
    cancel: "discarded",
  },
  processing: {
    // Both must land for a full review. The transcript alone is enough for a
    // reduced one, which is the whole point of the split below.
    extraction_ready: "review",
    // §17.4's copy for this state is "Your transcript is safe. Steady could not
    // organize it yet. You can save the transcript now or retry organization."
    // A state that says that has to exist for the copy to be true.
    extraction_failed: "review_transcript_only",
    // No transcript ever arrived: there is nothing for a clinician to look at.
    upload_failed: "failed",
    transcription_failed: "failed",
  },
  review: {
    save: "saved",
    discard: "discarded",
    // A retry of organization can improve a review that already exists, and
    // must never demote it: re-running extraction on a reviewable thought
    // cannot take the clinician back to "processing" and strand their words.
    extraction_ready: "review",
    extraction_failed: "review",
  },
  review_transcript_only: {
    save: "saved",
    discard: "discarded",
    // A successful retry upgrades it.
    extraction_ready: "review",
    // A failed retry leaves it exactly where it was.
    extraction_failed: "review_transcript_only",
  },
  saved: {},
  discarded: {},
  failed: {},
};

/** The state a thought moves to, or null when the event does not apply.
 *
 *  Null rather than a throw: a duplicate webhook, a double-clicked Save and a
 *  retry that arrives after the clinician already discarded the thought are all
 *  ordinary, and none of them should surface as an error. The caller writes
 *  nothing when the answer is null. */
export function nextStatus(from: ThoughtStatus, event: ThoughtEvent): ThoughtStatus | null {
  return TRANSITIONS[from][event] ?? null;
}

/** Terminal states. Nothing moves out of them, including a late retry. */
export function isTerminal(status: ThoughtStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

/** States in which the clinician has something to look at. */
export function isReviewable(status: ThoughtStatus): boolean {
  return status === "review" || status === "review_transcript_only";
}

/** Whether a transcript exists that must not be destroyed.
 *
 *  Used by the retention and cleanup paths rather than the UI: §8's rule is
 *  that "a processing failure never deletes captured audio or a completed
 *  transcript unless policy explicitly requires deletion", and a cleanup job
 *  that decides for itself which states are safe to purge is how that rule gets
 *  broken by someone who never read it. */
export function holdsIrreplaceableContent(status: ThoughtStatus): boolean {
  return status !== "failed" && status !== "capturing";
}

// ---------------------------------------------------------------------------
// Source events (§7)
// ---------------------------------------------------------------------------

/** Recording finalized. Carries no transcript because there is none yet, and
 *  no audio because audio never travels through the ledger. */
export async function recordThoughtCaptured(args: {
  thoughtId: string;
  tenantId: string;
  personId: string;
  clinicianPersonId: string;
  durationMs: number;
  sourceSessionId?: string | null;
  recordedAt: string;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinician_thought.recorded",
    actorId: args.clinicianPersonId,
    actorType: "clinician",
    occurredAt: args.recordedAt,
    payload: {
      thoughtId: args.thoughtId,
      durationMs: args.durationMs,
      sourceSessionId: args.sourceSessionId ?? null,
      recordedAt: args.recordedAt,
    },
  });
}

/** A transcript version exists.
 *
 *  THE HASH, NOT THE TEXT. §18 keeps raw transcript text out of ordinary logs,
 *  and §6.2 allows an event to point at a protected record by id and store a
 *  hash. That is enough to prove which version a later item was extracted from
 *  and to detect a transcript changing underneath a stale browser tab — which
 *  is exactly what §14.1's conflict rule needs — without putting a second copy
 *  of the clinician's words into the append-only ledger, where retention policy
 *  could never reach them. */
export async function recordThoughtTranscribed(args: {
  thoughtId: string;
  transcriptId: string;
  tenantId: string;
  personId: string;
  /** The clinician for a correction; null when the transcription service
   *  produced it. Nullable rather than a placeholder string: an event that
   *  names a person who did not act is worse than one that names nobody. */
  actorId: string | null;
  version: number;
  transcriptHash: string;
  provider: string | null;
  providerModel: string | null;
  /** Who produced this version: the service, or the clinician correcting it. */
  createdBy: "transcription_service" | "clinician";
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinician_thought.transcribed",
    actorId: args.actorId,
    actorType: args.createdBy === "clinician" ? "clinician" : "system",
    payload: {
      thoughtId: args.thoughtId,
      transcriptId: args.transcriptId,
      version: args.version,
      transcriptHash: args.transcriptHash,
      provider: args.provider,
      model: args.providerModel,
      createdBy: args.createdBy,
    },
  });
}

/** Candidate items produced from a transcript (§7).
 *
 *  The item IDS travel, not their text. §18 keeps clinical narrative out of the
 *  ledger, and the items are rows that can be read with the right scope — an
 *  event carrying their display text would be a second copy of a clinician's
 *  private judgement in a store whose whole point is that nothing is ever
 *  removed from it.
 *
 *  `aiInferenceId` is what makes a candidate attributable: it names the exact
 *  inference, and therefore the task version and model, that proposed this set.
 *  Null when the extraction came from the demo fixture, which is not an
 *  inference and must not be recorded as one. */
export async function recordExtractionCompleted(args: {
  thoughtId: string;
  transcriptId: string;
  tenantId: string;
  personId: string;
  itemIds: string[];
  taskVersion: string;
  aiInferenceId: string | null;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinician_thought.extraction_completed",
    actorId: null,
    actorType: "system",
    payload: {
      thoughtId: args.thoughtId,
      transcriptId: args.transcriptId,
      itemIds: args.itemIds,
      taskVersion: args.taskVersion,
      aiInferenceId: args.aiInferenceId,
    },
  });
}

/** A clinician accepted a candidate (§7).
 *
 *  `statementClass` is on the event because the class is the claim. Replaying
 *  an approval without it would rebuild an approved item whose epistemic status
 *  had to be looked up somewhere else — and Phase 2's definition of done is
 *  that replay reproduces the approved memory state, not most of it. */
export async function recordItemApproved(args: {
  memoryItemId: string;
  thoughtId: string;
  tenantId: string;
  personId: string;
  itemType: string;
  statementClass: string;
  approvedBy: string;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinical_memory.item_approved",
    actorId: args.approvedBy,
    actorType: "clinician",
    payload: {
      memoryItemId: args.memoryItemId,
      thoughtId: args.thoughtId,
      itemType: args.itemType,
      statementClass: args.statementClass,
      approvedBy: args.approvedBy,
    },
  });
}

/** A clinician removed a candidate (§7).
 *
 *  Recorded rather than silent. A rejected candidate is evidence about the
 *  extractor, and §11's learning posture needs to know what the clinician threw
 *  away as much as what they kept. */
export async function recordItemRejected(args: {
  memoryItemId: string;
  thoughtId: string;
  tenantId: string;
  personId: string;
  rejectedBy: string;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinical_memory.item_rejected",
    actorId: args.rejectedBy,
    actorType: "clinician",
    payload: {
      memoryItemId: args.memoryItemId,
      thoughtId: args.thoughtId,
      rejectedBy: args.rejectedBy,
    },
  });
}

/** An approved item was corrected (§7, §16). */
export async function recordItemCorrected(args: {
  priorItemId: string;
  replacementItemId: string;
  tenantId: string;
  personId: string;
  reason: string | null;
  correctedBy: string;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinical_memory.item_corrected",
    actorId: args.correctedBy,
    actorType: "clinician",
    payload: {
      priorItemId: args.priorItemId,
      replacementItemId: args.replacementItemId,
      reason: args.reason,
      correctedBy: args.correctedBy,
    },
  });
}

/** Thrown away, before or after review.
 *
 *  §16: "Rejecting a candidate before approval is not the same as deleting a
 *  clinical record. Keep enough audit metadata to show the candidate was
 *  reviewed without retaining unnecessary discarded PHI longer than policy
 *  permits." So the event records that it happened and at which state, and the
 *  protected content follows retention policy separately. */
export async function recordThoughtDiscarded(args: {
  thoughtId: string;
  tenantId: string;
  personId: string;
  clinicianPersonId: string;
  fromStatus: ThoughtStatus;
  hadTranscript: boolean;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinician_thought.discarded",
    actorId: args.clinicianPersonId,
    actorType: "clinician",
    payload: {
      thoughtId: args.thoughtId,
      fromStatus: args.fromStatus,
      hadTranscript: args.hadTranscript,
    },
  });
}
