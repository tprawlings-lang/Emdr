"use client";

import { useState } from "react";
import {
  correctTranscriptAction, saveThoughtAction, discardThoughtAction,
  organizeThoughtAction,
} from "@/lib/clinical/thought-actions";
import { ThoughtItemCards, type CandidateCard } from "./ThoughtItemCards";

// The review screen (§3.2, §17.4).
//
// THE TRANSCRIPT IS THE SCREEN, in Phase 1. §3.2's first rule is "Show the
// transcript first or make it one click away. The clinician must always be able
// to see what Steady heard." Organized cards come in Phase 2 and sit below it;
// the transcript does not move down to make room, because a clinician who
// cannot check what was heard cannot trust anything derived from it.
//
// EDITING IS A CORRECTION, NOT AN OVERWRITE. Saving an edit posts the hash of
// the version being edited. If the transcript has moved on — another tab, a
// retry that landed — the server refuses and §17.4's copy explains why. Without
// that check the last tab to press Save silently wins, and the clinician who
// loses their correction never finds out.
//
// PHASE 2 PUT THE CARDS BELOW, AND THE TRANSCRIPT DID NOT MOVE. §3.2's rule is
// that the clinician can always see what Steady heard; a screen that pushed the
// transcript under the organized items would be ordering them by which is
// easier to read rather than by which is the evidence.
//
// CORRECTING THE TRANSCRIPT INVALIDATES THE CARDS, and the screen says so
// rather than leaving them there. The candidates cite offsets into the text
// that was just edited (§16), so keeping them on screen beside a changed
// transcript would show quotes that no longer match the words above them. The
// correction re-runs the organizer instead.
//
// WHAT THIS SCREEN DOES NOT DO. It does not promise that saving files anything
// into the patient's formal record. §16: "A private clinician thought should
// not silently become a formal note merely because an AI draft used it." The
// copy says where the thought goes, in the clinician's words.

export interface ReviewTranscript {
  text: string;
  hash: string;
  version: number;
  provider: string | null;
}

export function ThoughtReview({
  thoughtId,
  transcript,
  /** True when organization did not run or did not succeed (§17.4). Stated
   *  rather than hidden behind an empty list of items pretending to be a
   *  result — "there was nothing to organize" and "Steady could not organize
   *  it" are different facts and only one of them is anybody's problem. */
  transcriptOnly,
  /** Candidate items, when the organizer produced any. */
  candidates = [],
  onDone,
}: {
  thoughtId: string;
  transcript: ReviewTranscript;
  transcriptOnly: boolean;
  candidates?: CandidateCard[];
  onDone?: () => void;
}) {
  const [text, setText] = useState(transcript.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [cards, setCards] = useState<CandidateCard[]>(candidates);
  const [reorganizing, setReorganizing] = useState(false);
  const dirty = text.trim() !== transcript.text.trim();
  // With cards on screen the primary action is theirs — two Save buttons
  // meaning different things is how a clinician saves the transcript believing
  // they saved their decisions.
  const cardsOwnSave = cards.length > 0;

  /** Correct the transcript, then organize the corrected text.
   *
   *  Both, always, and in that order. Correcting without re-organizing leaves
   *  candidates quoting text that no longer exists; organizing without
   *  correcting runs against the version the clinician just rejected. */
  async function correctAndReorganize() {
    setBusy(true);
    setReorganizing(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("thoughtId", thoughtId);
      form.set("text", text);
      form.set("expectedHash", transcript.hash);
      const corrected = await correctTranscriptAction(form);
      if (!corrected.ok) {
        setError(corrected.error ?? "That could not be saved.");
        return;
      }
      const organize = new FormData();
      organize.set("thoughtId", thoughtId);
      const organized = await organizeThoughtAction(organize);
      if (!organized.ok) {
        // The correction landed even though organizing did not, so the cards
        // are cleared: leaving the old ones would show quotes from the text
        // that was just replaced.
        setCards([]);
        setError(organized.error ?? "Steady could not organize the corrected transcript.");
        return;
      }
      // The page reloads to pick up the new candidates and the new hash. Doing
      // it here rather than merging in place avoids this component holding a
      // transcript hash that the server has already moved past.
      onDone?.();
    } finally {
      setBusy(false);
      setReorganizing(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // A correction, when there is one, before the save — so the saved thought
      // is the corrected one rather than the machine's version with an edit
      // hanging off it.
      if (dirty) {
        const form = new FormData();
        form.set("thoughtId", thoughtId);
        form.set("text", text);
        form.set("expectedHash", transcript.hash);
        const corrected = await correctTranscriptAction(form);
        if (!corrected.ok) {
          setError(corrected.error ?? "That could not be saved.");
          return;
        }
      }
      const form = new FormData();
      form.set("thoughtId", thoughtId);
      const result = await saveThoughtAction(form);
      if (!result.ok) {
        setError(result.error ?? "That could not be saved.");
        return;
      }
      setSaved(true);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!window.confirm("Discard this thought? The recording and transcript will not be kept.")) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("thoughtId", thoughtId);
      await discardThoughtAction(form);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
        <p className="text-sm font-medium text-state-safe">
          <span aria-hidden>◆</span> Saved
        </p>
        <p className="measure mt-2 text-sm text-ground">
          This thought is in {`this patient's`} Thoughts. It is not a formal note and has not
          been added to the clinical record.
        </p>
      </div>
    );
  }

  return (
    <>
    <div className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
      <h3 className="text-sm font-semibold text-app-ink">What Steady heard</h3>

      {transcriptOnly && (
        <p className="measure mt-2 rounded-xl bg-state-caution/10 px-3 py-2 text-sm text-ground">
          <span aria-hidden>▲</span> Your transcript is safe. Steady could not organize it into
          items. You can correct it and save it now, exactly as it is.
        </p>
      )}

      <label className="sr-only" htmlFor={`transcript-${thoughtId}`}>Transcript</label>
      <textarea
        id={`transcript-${thoughtId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        disabled={busy}
        className="measure mt-3 w-full rounded-xl border border-ground/15 bg-linen px-3 py-2 text-sm text-app-ink"
      />

      <p className="mt-1 text-xs text-olive">
        Version {transcript.version}
        {transcript.provider ? ` · transcribed by ${transcript.provider}` : ""}
        {dirty ? " · edited, not yet saved" : ""}
      </p>

      {error && (
        <p className="measure mt-3 text-sm text-state-support" role="alert">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {cardsOwnSave ? (
          dirty && (
            <button
              type="button" onClick={correctAndReorganize} disabled={busy}
              className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen disabled:opacity-50"
            >
              {reorganizing ? "Re-organizing…" : "Save correction and re-organize"}
            </button>
          )
        ) : (
          <button
            type="button" onClick={save} disabled={busy}
            className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen disabled:opacity-50"
          >
            {dirty ? "Save corrected transcript" : "Save thought"}
          </button>
        )}
        <button
          type="button" onClick={discard} disabled={busy}
          className="rounded-full px-4 py-2 text-sm text-olive underline disabled:opacity-50"
        >
          Discard
        </button>
      </div>

      {cardsOwnSave && dirty && (
        <p className="measure mt-3 rounded-xl bg-state-caution/10 px-3 py-2 text-sm text-ground">
          <span aria-hidden>▲</span> You have edited the transcript. The items below were drawn
          from the version above it and quote text you have just changed — save the correction to
          organize them again.
        </p>
      )}

      <p className="measure mt-4 text-xs text-olive">
        Saving keeps this in Thoughts, where only people with access to this patient can read
        it. It does not write a formal note, and nothing here is shared with the patient.
      </p>
    </div>

    {cardsOwnSave && (
      <ThoughtItemCards
        thoughtId={thoughtId}
        transcriptVersion={transcript.version}
        candidates={cards}
        onDone={onDone}
      />
    )}
    </>
  );
}
