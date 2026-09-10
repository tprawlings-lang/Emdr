"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Confirmations that survive the row they came from (handoff 06 §5).
//
// WHY THIS EXISTS, and it was found by pressing the button rather than by
// reading the code. §5: "Show exactly what the action changed after the server
// confirms it." `RowActions` does show it — inside the row. And a review that
// closes a person's open alerts REMOVES THAT ROW FROM THE QUEUE, because the
// queue reads the alert's status and a reviewed alert stops asking. So the row
// unmounted, and the confirmation went with it: the clinician pressed
// "Record it" on a safety row and it silently vanished from the list.
//
// A disappearing row is not a confirmation. It is indistinguishable from a
// re-sort, and §4.4's rule — "replace blanket claims such as Your answers are
// saved with confirmed state" — is not satisfied by a row that is simply gone.
//
// So the confirmation is lifted one level, to a live region above the list that
// outlives any row. It is fed by the actions themselves and holds the server's
// own summary, unchanged: this component invents no text and claims nothing the
// server did not say.

export interface RecordedNotice {
  key: string;
  /** The server's summary, verbatim. */
  summary: string;
}

interface Recorder {
  record: (summary: string) => void;
}

const RecordedContext = createContext<Recorder | null>(null);

/** Available to any client control inside the queue. Returns null outside the
 *  provider, so a control can be rendered elsewhere without a crash — it just
 *  keeps its own in-row confirmation and nothing is lifted. */
export function useRecorded(): Recorder | null {
  return useContext(RecordedContext);
}

export function QueueConfirmations({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<RecordedNotice[]>([]);

  const record = useCallback((summary: string) => {
    // Newest first, and capped. A clinician working a queue can record several
    // in a row, and an unbounded list would push the queue off the screen —
    // which would make this fix a different way of hiding the work.
    setNotices((prev) => [{ key: `${Date.now()}-${prev.length}`, summary }, ...prev].slice(0, 4));
  }, []);

  return (
    <RecordedContext.Provider value={{ record }}>
      {/* Polite, not assertive: this reports something the clinician just did
          deliberately, so interrupting them is the wrong urgency. */}
      <div aria-live="polite" data-testid="queue-confirmations">
        {notices.length > 0 && (
          <ul className="mt-4 space-y-2">
            {notices.map((n) => (
              <li
                key={n.key}
                className="rounded-2xl border border-state-safe/30 bg-state-safe-bg px-4 py-3 text-sm text-app-ink"
              >
                {/* No label of its own. Every one of these summaries already
                    opens by saying what was recorded, and "Recorded. Recorded
                    your review…" is what a prefix produced. */}
                {n.summary}
              </li>
            ))}
          </ul>
        )}
      </div>
      {children}
    </RecordedContext.Provider>
  );
}
