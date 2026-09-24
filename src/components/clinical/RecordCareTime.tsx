import { recordCareTimeAction } from "@/lib/clinical/assignment-actions";
import { SubmitButton } from "@/components/experience/SubmitButton";

/**
 * A clinician says they did this, rather than the screen assuming it.
 *
 * BOTH ACTIONS ARE NAMED AFTER OPENING A SCREEN, which makes writing the row on
 * render the obvious build and the wrong one. Next.js prefetches a route when a
 * link is hovered, so that version would record "this clinician reviewed the
 * trajectory" for a link nobody clicked — a clinical fact invented by a mouse
 * moving. A render is also a GET: a reload, a back button or a crawler would
 * each add a row.
 *
 * ONE PRESS, AND THE LABEL SAYS WHAT IT WRITES. Nothing is sent anywhere and
 * nobody is told; this records care time on the person's record, which is the
 * only claim it makes.
 */
export function RecordCareTime({
  personId, action, label, help,
}: {
  personId: string;
  action: "open_session_prep" | "review_trajectory";
  label: string;
  help: string;
}) {
  return (
    <form action={recordCareTimeAction} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="action" value={action} />
      <label className="sr-only" htmlFor={`note-${action}`}>What you want recorded with it</label>
      <input
        id={`note-${action}`}
        name="note"
        maxLength={500}
        placeholder="Anything worth recording with it (optional)"
        className="min-w-0 flex-1 rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
      />
      <SubmitButton
        pendingLabel="Recording…"
        className="rounded-full border border-ground/20 px-3.5 py-1.5 text-xs text-app-ink hover:bg-app-accent/40"
      >
        {label}
      </SubmitButton>
      <p className="measure basis-full text-xs text-olive">{help}</p>
    </form>
  );
}
