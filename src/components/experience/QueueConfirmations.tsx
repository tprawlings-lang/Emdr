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
//
// AND A CONFLICT IS LIFTED FOR THE SAME REASON, which was missed when this was
// written and is the more dangerous half. When another clinician resolves the
// row first, the reader's action returns `stale` — and a server action
// re-renders the route, the resolved row is gone, and the panel unmounts taking
// the conflict message with it. The clinician sees the row disappear and reads
// that as success. That is the same "silently vanished" failure this file
// exists to fix, applied to the one message they most need: somebody else
// decided this, and your decision did not land.

/** What happened: something landed, or something did not. */
export type NoticeKind = "confirmed" | "problem";

export interface RecordedNotice {
  key: string;
  kind: NoticeKind;
  /** The server's summary, verbatim. */
  summary: string;
}

interface Recorder {
  record: (summary: string, kind?: NoticeKind) => void;
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

  const record = useCallback((summary: string, kind: NoticeKind = "confirmed") => {
    // Newest first, and capped. A clinician working a queue can record several
    // in a row, and an unbounded list would push the queue off the screen —
    // which would make this fix a different way of hiding the work.
    setNotices((prev) => [{ key: `${Date.now()}-${prev.length}`, kind, summary }, ...prev].slice(0, 4));
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
                data-testid={n.kind === "problem" ? "queue-problem-notice" : "queue-confirmed-notice"}
                className={
                  n.kind === "problem"
                    // Caution, never safe: a conflict is not a thing that went
                    // well, and it must not be reachable by the eye as one.
                    ? "rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-sm text-app-ink"
                    : "rounded-2xl border border-state-safe/30 bg-state-safe-bg px-4 py-3 text-sm text-app-ink"
                }
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
