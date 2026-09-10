"use client";

import { useState } from "react";
import {
  acceptConnectionAction, rejectConnectionAction, revisitConnectionAction,
} from "@/lib/clinical/thread-actions";

// Connect / Not related (§3.2, Phase 3).
//
// These appear AFTER the main review, never inside it. §3.2 is explicit, and
// the reason is worth stating: deciding whether a thing is TRUE and deciding
// what it CONNECTS TO are different judgements, and a screen that asks for both
// at once gets a worse answer to each. The clinician has already said what is
// true. This asks a second, smaller question about what it belongs with.
//
// TWO BUTTONS, NO DEFAULT, AND NO "LATER" THAT MEANS YES. A suggestion left
// undecided stays a suggestion — it is not applied by inaction, and it is not
// discarded either. That is the difference between a proposal and a
// notification, and it is why the queue can be left half-done without anything
// being decided on the clinician's behalf.
//
// THE REASON IS SHOWN, AND IT IS NOT A SCORE. "Both are labelled sleep" is
// something a clinician can disagree with. "0.71" is not — it invites either
// deference or dismissal, and neither is review.

export interface ConnectionSuggestion {
  membershipId: string;
  threadLabel: string;
  threadType: string;
  itemText: string;
  itemStatementClass: string;
  /** Why it was offered, in words. */
  because: string;
  /** Present when this was refused before and the clinician reopened it. */
  status: "proposed" | "rejected";
}

export function ThreadSuggestions({
  suggestions,
  rejected = [],
  onChanged,
}: {
  suggestions: ConnectionSuggestion[];
  /** Previously refused connections, offered for a deliberate second look. */
  rejected?: ConnectionSuggestion[];
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, "connected" | "not_related" | "reopened">>({});

  async function act(
    membershipId: string,
    action: typeof acceptConnectionAction,
    outcome: "connected" | "not_related" | "reopened"
  ) {
    setBusy(membershipId);
    setError(null);
    try {
      const form = new FormData();
      form.set("membershipId", membershipId);
      const result = await action(form);
      if (!result.ok) {
        setError(result.error ?? "That could not be recorded.");
        return;
      }
      setDone({ ...done, [membershipId]: outcome });
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  const open = suggestions.filter((s) => !done[s.membershipId]);

  if (open.length === 0 && rejected.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
      <h3 className="text-sm font-semibold text-app-ink">Does this belong with anything?</h3>
      <p className="measure mt-1 text-sm text-olive">
        Steady noticed these might connect to themes already on this record. Connecting is
        yours to decide — nothing here is applied unless you say so, and leaving one undecided
        leaves it undecided.
      </p>

      {error && <p className="measure mt-3 text-sm text-state-support" role="alert">{error}</p>}

      <ul className="mt-4 space-y-3">
        {suggestions.map((s) => {
          const outcome = done[s.membershipId];
          return (
            <li
              key={s.membershipId}
              className={`rounded-xl border px-4 py-4 ${
                outcome ? "border-ground/10 bg-linen/40" : "border-ground/15"
              }`}
            >
              <p className="text-sm text-app-ink">{s.itemText}</p>
              <p className="mt-2 text-sm text-olive">
                <span aria-hidden>↳</span> {s.threadLabel}
              </p>
              <p className="mt-1 text-xs text-olive">{s.because}</p>

              {outcome ? (
                <p className="mt-3 text-sm text-state-safe">
                  {outcome === "connected" ? "Connected." : "Recorded as not related."}
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === s.membershipId}
                    onClick={() => act(s.membershipId, acceptConnectionAction, "connected")}
                    className="rounded-full bg-app-ink px-3.5 py-1.5 text-sm font-medium text-linen disabled:opacity-50"
                  >
                    Connect
                  </button>
                  <button
                    type="button"
                    disabled={busy === s.membershipId}
                    onClick={() => act(s.membershipId, rejectConnectionAction, "not_related")}
                    className="rounded-full border border-ground/20 px-3.5 py-1.5 text-sm text-app-ink disabled:opacity-50"
                  >
                    Not related
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {rejected.length > 0 && (
        <details className="mt-5">
          {/* Behind a disclosure on purpose. A refusal that reappears in the
              main list every visit is the system asking again, which is exactly
              what "rejected links remain rejected" forbids — but a clinician
              who changes their mind needs a way back, and this is it. */}
          <summary className="cursor-pointer text-sm text-olive">
            Previously not related ({rejected.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {rejected.map((s) => (
              <li key={s.membershipId} className="rounded-xl border border-ground/10 px-4 py-3">
                <p className="text-sm text-app-ink">{s.itemText}</p>
                <p className="mt-1 text-sm text-olive">
                  <span aria-hidden>↳</span> {s.threadLabel}
                </p>
                {done[s.membershipId] === "reopened" ? (
                  <p className="mt-2 text-sm text-state-safe">Reopened — it is a suggestion again.</p>
                ) : (
                  <button
                    type="button"
                    disabled={busy === s.membershipId}
                    onClick={() => act(s.membershipId, revisitConnectionAction, "reopened")}
                    className="mt-2 text-sm text-olive underline disabled:opacity-50"
                  >
                    Look at this again
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
