"use client";

import { useState } from "react";
import { reviewTrajectory } from "@/lib/clinical/trajectory-actions";
import { REVIEW_STATES, REVIEW_LABEL } from "@/lib/clinical/trajectory-vocabulary";

// Recording what a clinician makes of one domain's state (handoff 04 §5, §12).
//
// FOUR OPTIONS AND NONE OF THEM CHANGES THE STATE. "Disagrees with it" does not
// hide the lane, mark it resolved, or suppress it next time — handoff 05 §13
// states the shared rule as "clinician disagreement is recorded and does not
// erase system evidence", and the honest implementation is that the state stays
// on the page with the disagreement printed under it.
//
// A DISAGREEMENT NEEDS ITS REASON. The engine refuses one without a note, and
// so does this form, because a contested state with nothing to contest it with
// leaves the next reader worse off than no review at all: they can see somebody
// disagreed and not what they knew.

export function TrajectoryReviewForm({
  personId, snapshotId,
}: {
  personId: string;
  snapshotId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<string>("reviewed");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsNote = state === "disagreed" || state === "needs_context";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); }}
        className="text-xs text-app-ink underline underline-offset-2"
      >
        Record what you make of this
      </button>
    );
  }

  return (
    <form
      action={async (formData: FormData) => {
        setBusy(true);
        const result = await reviewTrajectory(formData);
        setBusy(false);
        if (!result.ok) setError(result.error ?? "That could not be recorded.");
        else setOpen(false);
      }}
      className="rounded-2xl border border-ground/10 bg-linen px-4 py-3"
    >
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="snapshotId" value={snapshotId} />
      <fieldset>
        <legend className="text-xs font-medium text-app-ink">What do you make of this?</legend>
        <div className="mt-2 space-y-1">
          {REVIEW_STATES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-app-ink">
              <input
                type="radio"
                name="reviewState"
                value={s}
                checked={state === s}
                onChange={() => setState(s)}
              />
              {REVIEW_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-3 block text-xs text-olive">
        {needsNote ? "What Steady is missing (required)" : "Anything worth adding (optional)"}
        <textarea
          name="note"
          rows={2}
          required={needsNote}
          className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm text-app-ink"
        />
      </label>
      {error && <p className="measure mt-2 text-xs text-rose-800">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-ground px-3 py-1.5 text-xs text-linen disabled:opacity-60"
        >
          {busy ? "Recording…" : "Record it"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="text-xs text-olive underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
      <p className="measure mt-2 text-xs text-olive">
        This is recorded beside the state, not over it. Steady keeps computing what it computes,
        and the next reader sees both.
      </p>
    </form>
  );
}
