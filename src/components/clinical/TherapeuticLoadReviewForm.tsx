"use client";

import { useState } from "react";
import { reviewTherapeuticLoad } from "@/lib/clinical/load-actions";
import { LOAD_DECISIONS, LOAD_DECISION_LABEL } from "@/lib/clinical/therapeutic-load-policy";

// §8's six clinician actions.
//
// EVERY ONE OF THEM RECORDS AND NONE OF THEM PERFORMS. "Will review whether the
// next step fits" is a clinician saying they will look; it does not unlock a
// module, change a plan, or move a gate, and the form says so on the screen
// rather than in a footnote — because a clinician pressing a button labelled
// "review progression" has every reason to wonder whether they just did
// something to a person.
//
// A disagreement needs its reason, and the engine refuses one without. §13:
// "clinician disagreement is recorded and does not erase system evidence" — the
// reading stays on the page with the disagreement printed under it, which is
// what makes the disagreement worth recording at all.

export function TherapeuticLoadReviewForm({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<string>("acknowledged");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsNote = decision === "disagree";

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
        const result = await reviewTherapeuticLoad(formData);
        setBusy(false);
        if (!result.ok) setError(result.error ?? "That could not be recorded.");
        else setOpen(false);
      }}
      className="rounded-2xl border border-ground/10 bg-linen px-4 py-3"
    >
      <input type="hidden" name="personId" value={personId} />
      <fieldset>
        <legend className="text-xs font-medium text-app-ink">What do you make of this?</legend>
        <div className="mt-2 space-y-1">
          {LOAD_DECISIONS.map((d) => (
            <label key={d} className="flex items-center gap-2 text-sm text-app-ink">
              <input
                type="radio"
                name="decision"
                value={d}
                checked={decision === d}
                onChange={() => setDecision(d)}
              />
              {LOAD_DECISION_LABEL[d]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-3 block text-xs text-olive">
        {needsNote ? "What Steady is reading wrong (required)" : "Anything worth adding (optional)"}
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
        This records your judgement. It does not change a plan, unlock a module, move a gate, or
        alter what this person can access — none of those are things this screen can do.
      </p>
    </form>
  );
}
