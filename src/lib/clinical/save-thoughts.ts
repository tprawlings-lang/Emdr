// The Save Thoughts command (§8.1, §14.1, Phase 2).
//
// One command, applied atomically: the clinician has read every candidate and
// says which are true, which are wrong, and which needed rewording. §17's
// primary action is "Save Thoughts" — "do not make the clinician confirm every
// card one by one in the ordinary path" — so the decisions arrive as a set and
// land as a set.
//
// THREE PROPERTIES, EACH ENFORCED RATHER THAN INTENDED.
//
//   ATOMIC. Every approval, rejection and edit happens inside one transaction.
//   A partial save is the worst outcome available here: the clinician believes
//   they curated the record, and what is actually stored is the first half of
//   their judgement with no indication that the rest is missing.
//
//   IDEMPOTENT. §8.1: "a repeated Save Thoughts command with the same
//   idempotency key must not duplicate approved items." The key is INSERTED
//   FIRST, inside the transaction, against a unique constraint — so a
//   concurrent retry loses on the constraint and rolls back, rather than
//   racing between a check and a write.
//
//   CONFLICT ON A STALE TRANSCRIPT. §14.1: "the server validates every approved
//   item against the current transcript/extraction generation. A stale browser
//   submission must return a conflict rather than writing against an older
//   transcript." A clinician who corrected the transcript in another tab has
//   approved items that cite text which no longer exists — so this refuses,
//   and the screen re-reads. Writing them anyway would attach a citation to
//   words nobody said.

import { data } from "../data";
import { ulid } from "../ids";
import { repo, type TenantContext } from "../repository";
import {
  approveItem, rejectItem, listItemsForThought, type MemoryItem,
} from "./memory-store";
import { encryptField } from "./../crypto";
import { currentTranscript, getThought, transitionThought } from "./thought-store";
import { recordItemApproved, recordItemRejected } from "./thoughts";

export type ItemDecision = "approve" | "reject";

export interface SaveDecision {
  candidateId: string;
  decision: ItemDecision;
  /** The clinician's wording, when they edited the card. Undefined means the
   *  candidate's own text stands. */
  displayText?: string;
  normalizedLabel?: string | null;
}

export interface SaveThoughtsRequest {
  thoughtId: string;
  /** The transcript version the clinician was looking at. */
  transcriptVersion: number;
  idempotencyKey: string;
  decisions: SaveDecision[];
}

export class StaleSubmissionError extends Error {}
export class UndecidedCandidatesError extends Error {}

export interface SaveResult {
  approved: MemoryItem[];
  rejected: MemoryItem[];
  /** True when this exact key had already been applied and nothing was written
   *  a second time. The caller renders the same success either way — a retry
   *  that reports failure teaches people to retry again. */
  replayed: boolean;
}

/**
 * Apply a clinician's decisions to a thought's candidates.
 *
 * EVERY CANDIDATE MUST BE DECIDED. §9's human gate for the extraction task is
 * "all items reviewed before approval", and a save that silently left some
 * candidates untouched would leave the record half-curated while telling the
 * clinician it was done. An undecided candidate is refused rather than
 * defaulted — defaulting to reject would throw away a true item the clinician
 * merely scrolled past, and defaulting to approve is unthinkable.
 */
export async function saveThoughts(ctx: TenantContext, req: SaveThoughtsRequest): Promise<SaveResult> {
  const clinician = ctx.personId;
  if (!clinician) throw new Error("Saving thoughts requires an authenticated clinician in the context.");

  const thought = await getThought(ctx, req.thoughtId);
  if (!thought) throw new StaleSubmissionError("No such thought.");

  const transcript = await currentTranscript(ctx, thought);
  if (!transcript) throw new StaleSubmissionError("This thought has no transcript.");
  if (transcript.version !== req.transcriptVersion) {
    throw new StaleSubmissionError(
      `This thought was corrected while you were reviewing it (transcript is now version ${transcript.version}). Re-read it before saving.`
    );
  }

  // THE REPLAY CHECK COMES FIRST, and it has to.
  //
  // A retry arrives after the original succeeded, so the candidates it names
  // are no longer candidates — they are approved and rejected items. Every
  // validation below would therefore reject a legitimate retry as a stale
  // submission, which is the opposite of idempotent: the caller is told their
  // decisions conflict when in fact they already landed.
  //
  // The unique constraint inside the transaction is still the authority for the
  // CONCURRENT case, where two retries race and neither can see the other yet.
  // This is the sequential case, and it needs an answer before the state that a
  // successful save necessarily destroys is used to judge the retry.
  const prior = await repo(ctx).findOne<{ id: string }>(
    "clinician_thought_saves",
    "thought_id = ? AND idempotency_key = ?",
    [req.thoughtId, req.idempotencyKey]
  );
  if (prior) {
    const items = await listItemsForThought(ctx, req.thoughtId);
    return {
      approved: items.filter((i) => i.status === "approved"),
      rejected: items.filter((i) => i.status === "rejected"),
      replayed: true,
    };
  }

  const candidates = (await listItemsForThought(ctx, req.thoughtId)).filter((i) => i.status === "candidate");
  const decided = new Map(req.decisions.map((d) => [d.candidateId, d]));

  // A decision naming something that is not a candidate of this thought is a
  // stale submission, not a no-op: it means the screen and the record disagree
  // about what was on offer.
  for (const d of req.decisions) {
    if (!candidates.some((c) => c.id === d.candidateId)) {
      throw new StaleSubmissionError("A decision referred to a candidate that is no longer on this thought.");
    }
  }
  const undecided = candidates.filter((c) => !decided.has(c.id));
  if (undecided.length > 0) {
    throw new UndecidedCandidatesError(`${undecided.length} candidate(s) have no decision.`);
  }

  const c = await data();
  const approved: MemoryItem[] = [];
  const rejected: MemoryItem[] = [];

  try {
    await c.tx(async () => {
      // FIRST, so a duplicate loses on the unique constraint before anything is
      // written rather than after.
      await repo(ctx).insert("clinician_thought_saves", {
        id: ulid(),
        thought_id: req.thoughtId,
        idempotency_key: req.idempotencyKey,
        transcript_version: req.transcriptVersion,
        approved_count: req.decisions.filter((d) => d.decision === "approve").length,
        rejected_count: req.decisions.filter((d) => d.decision === "reject").length,
        saved_by: clinician,
      });

      const at = new Date().toISOString();
      for (const cand of candidates) {
        const d = decided.get(cand.id)!;
        if (d.decision === "approve") {
          // An edit is applied BEFORE approval, so the approved row carries the
          // clinician's wording and the event describes what was actually
          // stored. Applying it after would leave a window where the record
          // says something the clinician rewrote.
          if (d.displayText !== undefined || d.normalizedLabel !== undefined) {
            const patch: Record<string, unknown> = {};
            if (d.displayText !== undefined) patch.display_text = encryptField(d.displayText);
            if (d.normalizedLabel !== undefined) {
              patch.normalized_label = d.normalizedLabel ? encryptField(d.normalizedLabel) : null;
            }
            await repo(ctx).update("clinical_memory_items", patch, "id = ?", [cand.id]);
          }
          approved.push(await approveItem(ctx, cand.id, at));
        } else {
          rejected.push(await rejectItem(ctx, cand.id));
        }
      }
    });
  } catch (err) {
    // The unique constraint firing means this exact submission already landed.
    // That is a success from the caller's point of view: the decisions are in
    // the record, applied once.
    if (isDuplicateKey(err)) {
      const items = await listItemsForThought(ctx, req.thoughtId);
      return {
        approved: items.filter((i) => i.status === "approved"),
        rejected: items.filter((i) => i.status === "rejected"),
        replayed: true,
      };
    }
    throw err;
  }

  // Events AFTER the transaction commits. An event for a write that rolled back
  // is a claim about the record that the record does not support, and the
  // ledger is append-only — there is no taking it back.
  for (const item of approved) {
    await recordItemApproved({
      memoryItemId: item.id,
      thoughtId: req.thoughtId,
      tenantId: ctx.tenantId,
      personId: thought.personId,
      itemType: item.itemType,
      statementClass: item.statementClass,
      approvedBy: clinician,
    });
  }
  for (const item of rejected) {
    await recordItemRejected({
      memoryItemId: item.id,
      thoughtId: req.thoughtId,
      tenantId: ctx.tenantId,
      personId: thought.personId,
      rejectedBy: clinician,
    });
  }

  if (thought.status === "review" || thought.status === "review_transcript_only") {
    await transitionThought(ctx, req.thoughtId, "save");
  }

  return { approved, rejected, replayed: false };
}

function isDuplicateKey(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|duplicate key value/i.test(m);
}
