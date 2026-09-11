// The formal note bridge (Clinician Thoughts spec §21, Phase 6).
//
// Phase 6 asks for one thing and forbids three. It asks that clinician-selected
// approved items feed a note draft with their source ids preserved. It forbids
// a draft that signs itself, a private thought that becomes a formal note
// without a clinician acting, and a pilot that cannot be switched off without
// losing data.
//
// THE DRAFT IS DERIVED AND NEVER STORED, which is how the third of those is
// answered rather than promised. This bridge has no table, no draft row and no
// state of its own: a draft is assembled from memory items on the way to the
// screen and exists for exactly as long as the response. Turn
// CLINICIAN_NOTE_BRIDGE off and a surface disappears; nothing is deleted
// because nothing was written. A stored draft would have made "disabled
// without data loss" a promise about a migration.
//
// `clinical_notes` is not that, and does not weaken it. It holds notes a
// clinician wrote and signed THEMSELVES, which are meant to survive — losing
// them on a flag change would be the defect, not the guarantee. This file still
// stores nothing, so the promise it makes is still a fact about it.
//
// SELECTION IS THE WHOLE POINT, and it is the opposite of the referral packet
// two files away. A referral is compiled passively because the moment of
// referral is a bad moment to ask somebody to curate. A clinical note is the
// clinician's own statement in a record they sign, so nothing reaches it that
// they did not choose: an unselected item is absent, and a selected item that
// was never approved is a refusal rather than a silent omission.
//
// A DRAFT IS NOT A NOTE. This produces text a clinician reads, edits and puts
// into a note they write and sign themselves. It cannot sign, and it does not
// model a signature it has no authority to apply.
//
// THE COPY CHANGED WHEN THE RECORD ARRIVED. It used to say "Steady does not
// hold formal notes and cannot sign one", and the first half of that stopped
// being true the day clinical_notes existed — a clinician signs their own notes
// at /clinician/member/[id]/notes now. The half that matters is unchanged and
// is what the sentence says instead: STEADY will not sign, because a signature
// on text Steady assembled would be Steady attesting on somebody's behalf. A
// claim that quietly outlives its subject is the thing §31.8 is about.

import type { MemoryItem } from "./memory-store";

export class NoteBridgeRefused extends Error {}

export interface NoteLine {
  /** The memory item this line came from. Preserved so a reader of the draft
   *  can get back to the thought and the transcript span behind it. */
  sourceItemId: string;
  sourceThoughtId: string | null;
  sourceTranscriptId: string | null;
  itemType: string;
  statementClass: string;
  text: string;
}

export interface NoteDraft {
  personId: string;
  /** Who assembled it. Not who signed it — nothing here signs. */
  assembledBy: string;
  assembledAt: string;
  lines: NoteLine[];
  /** Always "draft". There is no code path that produces another value. */
  state: "draft";
  /** Always null, for the same reason. */
  signedAt: null;
  /** Ids that were selected and could not be included, with why. A silent
   *  omission from a clinical note is the failure this exists to prevent. */
  refusedIds: Array<{ id: string; because: string }>;
}

/**
 * What a clinician has to do before any of this becomes a note, said in one
 * place so the screen and the tests quote the same words.
 */
export const SIGNING_IS_ELSEWHERE =
  "This is a draft, and Steady will not sign it: a signature attests to a clinician's own " +
  "statement, and applying one to text Steady assembled would be Steady attesting on their " +
  "behalf. Read it, change what is wrong, and write it into a note you sign yourself.";

/**
 * Assemble a draft from the items a clinician selected.
 *
 * REFUSES RATHER THAN FILTERS. An unapproved item that was selected does not
 * quietly vanish from the output: it comes back in `refusedIds` with the
 * reason, because a clinician who ticked six boxes and received five lines
 * would have no way to tell which one went and why.
 */
export function assembleDraft(args: {
  personId: string;
  assembledBy: string;
  assembledAt: string;
  /** Every item the clinician could have chosen from, in whatever status. */
  available: MemoryItem[];
  /** The ids they ticked. */
  selectedIds: string[];
}): NoteDraft {
  if (!args.assembledBy.trim()) {
    throw new NoteBridgeRefused("a draft has to record who assembled it");
  }
  const byId = new Map(args.available.map((i) => [i.id, i]));
  const lines: NoteLine[] = [];
  const refusedIds: Array<{ id: string; because: string }> = [];
  const seen = new Set<string>();

  for (const id of args.selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = byId.get(id);
    if (!item) {
      // Not "forbidden" and not an error: an item outside this person's record
      // does not exist as far as this draft is concerned, and saying more would
      // confirm that something is there.
      refusedIds.push({ id, because: "Not an item on this person's record." });
      continue;
    }
    if (item.status !== "approved") {
      refusedIds.push({
        id,
        because: `Still ${item.status}. Only an approved item can reach a note, because approval is where a clinician said the extraction was right.`,
      });
      continue;
    }
    if (item.personId !== args.personId) {
      refusedIds.push({ id, because: "Not an item on this person's record." });
      continue;
    }
    lines.push({
      sourceItemId: item.id,
      sourceThoughtId: item.sourceThoughtId,
      sourceTranscriptId: item.sourceTranscriptId,
      itemType: item.itemType,
      statementClass: item.statementClass,
      text: item.displayText,
    });
  }

  return {
    personId: args.personId,
    assembledBy: args.assembledBy,
    assembledAt: args.assembledAt,
    lines,
    state: "draft",
    signedAt: null,
    refusedIds,
  };
}

/**
 * The draft as text, for a clinician to take into their record system.
 *
 * EVERY LINE CARRIES ITS SOURCE ID, which is Phase 6's "preserve source item
 * IDs" and is the half that survives leaving this product: once the text is
 * pasted into an EHR the link back to the thought is whatever is written in it.
 */
export function draftText(draft: NoteDraft): string {
  if (draft.lines.length === 0) return "";
  return draft.lines
    .map((l) => `- [${l.statementClass}] ${l.text}  (steady:${l.sourceItemId})`)
    .join("\n");
}

/** Every source id in a draft, for a test and for the screen's own accounting. */
export function sourceIds(draft: NoteDraft): string[] {
  return draft.lines.map((l) => l.sourceItemId);
}

/** Whether anything about this draft could be mistaken for a signed note. */
export function isSigned(draft: NoteDraft): boolean {
  return draft.state !== "draft" || draft.signedAt !== null;
}
