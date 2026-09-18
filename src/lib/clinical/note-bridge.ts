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
  /** Why there are no lines, or null when there are. */
  emptyBecause: EmptyDraftCause | null;
}

/**
 * Why a draft has no lines (UX 006).
 *
 *   "The draft-note empty state implies available choices when none were
 *   approved. Model no source items separately from none selected. Acceptance:
 *   each empty state states the actual cause."
 *
 * The screen used to answer with one sentence for every case: "This is empty
 * because you have not chosen anything — not because there was nothing to
 * choose." Written to be careful, and false in two of the three states it
 * covered. With nothing approved there was indeed nothing to choose, and the
 * sentence told a clinician to look for a control that was not there. With
 * every selection refused, it said they had chosen nothing while a panel below
 * listed what they had chosen and why each was rejected.
 *
 * SO THE CAUSE IS A VALUE THE ASSEMBLER COMPUTES, not a sentence a page
 * guesses at. The assembler is the only thing that knows all three facts — what
 * existed, what was ticked, what survived — and a screen that re-derives any of
 * them will get it wrong the first time a fourth case appears.
 */
export type EmptyDraftCause =
  /** Nothing has been approved for this person, so there was nothing to tick. */
  | "no_approved_items"
  /** There were items to choose from and none were ticked. */
  | "none_selected"
  /** Items were ticked and every one of them was refused. */
  | "all_refused";

/** What to tell a clinician, per cause. Here rather than on the page so the
 *  words and the value that selects them cannot drift apart. */
export const EMPTY_DRAFT_REASON: Record<EmptyDraftCause, string> = {
  no_approved_items:
    "There is nothing to choose from yet. No item on this person's record has been approved, " +
    "and approval is where a clinician says the extraction was right.",
  none_selected:
    "Nothing is selected. There are approved items above — tick the ones this note should " +
    "carry and build the draft.",
  all_refused:
    "Everything selected was refused, and each refusal is listed below with its reason. " +
    "Nothing was quietly dropped.",
};

// ---------------------------------------------------------------------------
// Where the items come from — and whether any can arrive (17 September handoff,
// P4: "Draft note — model source availability and user selection separately.")
// ---------------------------------------------------------------------------
//
// THE TWO WERE ONE SENTENCE. With nothing approved, the screen said "Nothing has
// been approved for this person yet. Approve items on Thoughts and they become
// selectable here." That is advice, and in three environments it is advice that
// cannot be followed: with capture switched off there is nothing to record,
// with extraction switched off a recording produces a transcript and no
// candidate items, and with no model configured neither runs at all. In each of
// those the clinician goes to Thoughts, finds no way to approve anything, and
// concludes the product is broken — when what is true is that this deployment
// does not have the source switched on.
//
// SO AVAILABILITY IS ITS OWN VALUE, computed from the same flags the surfaces
// check, and the selection state stays what it was. A screen can then say both:
// where items come from, and what has been ticked.

export type DraftSourceState =
  /** Recording, extraction and a model are all in place. */
  | "available"
  /** The recording surface is off here, so nothing can be captured. */
  | "capture_off"
  /** Recording works; turning a transcript into candidate items does not. */
  | "extraction_off"
  /** Both surfaces are on and no model is configured, so nothing is extracted. */
  | "no_model";

export interface DraftSource {
  state: DraftSourceState;
  /** Whether a NEW approved item could arrive at all as things stand. */
  canProduceItems: boolean;
  /** Where items come from, or why none can. */
  said: string;
  /** What the clinician can do about it. Null when it is not theirs to fix. */
  next: string | null;
}

export function draftSource(args: {
  captureOn: boolean; extractionOn: boolean; modelConfigured: boolean;
}): DraftSource {
  if (!args.captureOn) {
    return {
      state: "capture_off", canProduceItems: false,
      said: "Recording is switched off in this environment, so no new items can be captured for this person.",
      // NOT "approve items on Thoughts". There is nothing there to approve and
      // sending somebody to look is how a configuration state gets read as a
      // fault.
      next: null,
    };
  }
  if (!args.extractionOn) {
    return {
      state: "extraction_off", canProduceItems: false,
      said: "Recording works here, but turning a transcript into items is switched off — so a note you record produces a transcript and nothing selectable.",
      next: null,
    };
  }
  if (!args.modelConfigured) {
    return {
      state: "no_model", canProduceItems: false,
      said: "No model is configured in this environment, so nothing is extracted from a recording and nothing reaches this list.",
      next: null,
    };
  }
  return {
    state: "available", canProduceItems: true,
    said: "Items arrive here once they have been extracted from a note and approved.",
    next: "Record or write a note on Thoughts, then approve the items it produces.",
  };
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

  // The three facts, in the one place that holds all three. `available` is
  // every item the clinician could have chosen from IN ANY STATUS, so "nothing
  // to choose from" is about approved items rather than about rows existing.
  const approvable = args.available.filter(
    (i) => i.status === "approved" && i.personId === args.personId
  );
  const emptyBecause: EmptyDraftCause | null =
    lines.length > 0 ? null
    : refusedIds.length > 0 ? "all_refused"
    : approvable.length === 0 ? "no_approved_items"
    : "none_selected";

  return {
    personId: args.personId,
    assembledBy: args.assembledBy,
    assembledAt: args.assembledAt,
    lines,
    state: "draft",
    signedAt: null,
    refusedIds,
    emptyBecause,
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
