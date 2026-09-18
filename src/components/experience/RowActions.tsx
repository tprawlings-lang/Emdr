"use client";

import Link from "next/link";
import { useState } from "react";
import { recordContact, assignWork, completeReview } from "@/lib/clinical/shell-actions";
import { commandKey, type CommandResult } from "@/lib/experience/command";
import { idle, submitting, advance, mayClaimSaved, type TaskState } from "@/lib/experience/task-state";
import { ACTION_LABEL, ACTION_NOTE, type ClinicianAction } from "@/lib/experience/clinician-vocabulary";
import { useRecorded } from "./QueueConfirmations";

// The separated row actions (handoff 09 §5, §9; Package 2).
//
// §5: "Distinguish Open, Record contact, Assign, and Complete review. Opening
// is not acknowledgement... Show exactly what the action changed after the
// server confirms it."
//
// FOUR CONTROLS, AND ONE OF THEM IS A LINK. `Open` navigates and has no server
// action behind it at all — §12 of handoff 03 requires that opening changes
// nothing, and the surest way to keep that is for there to be nothing to call.
//
// THE STATE ON SCREEN IS THE SERVER'S, NEVER THIS COMPONENT'S. Every outcome
// goes through `advance`, which is the only way to reach a `confirmed` task
// state and refuses anything but a confirmed command result. §4.4: "Replace
// blanket claims such as Your answers are saved with confirmed state." So a
// refusal renders as "Could not save", a conflict as "Somebody else changed
// this", and an indeterminate answer offers NO retry — because the safe-feeling
// action there is the one that duplicates.
//
// AND A CONFLICT PRESERVES THE DRAFT. §5: "preserve any unsent draft according
// to policy. Do not silently overwrite." The note stays in the textarea when
// the server says stale, so a clinician who was typing does not lose it to
// somebody else's timing.

export function RowActions({
  personId,
  signalId,
  action,
  personName,
  /** The version the row was rendered against, so a decision can be reconciled
   *  before it is accepted (§5). */
  expectedVersion,
  /** Who this could be assigned to. Empty disables assignment rather than
   *  offering a picker with nothing in it. */
  assignees,
  environmentGeneration,
}: {
  personId: string;
  signalId: string | null;
  action: ClinicianAction;
  personName: string;
  expectedVersion: string | null;
  assignees: Array<{ id: string; name: string }>;
  /** The rebuild this page came from. Sent with every command: a queue tab is
   *  exactly the surface that sits open for hours, which is when a reset
   *  happens underneath one. */
  environmentGeneration: string;
}) {
  const [open, setOpen] = useState<ClinicianAction | null>(null);
  const [task, setTask] = useState<TaskState>(idle());
  const [note, setNote] = useState("");
  const [result, setResult] = useState<CommandResult<{ summary: string }> | null>(null);
  const recorded = useRecorded();

  // ONE PRESS OF THIS BUTTON, and the mount id is what makes that a press
  // rather than a row.
  //
  // FOUND BY DRIVING IT, and it survived the fix that was supposed to end it.
  // The nonce was `${personId}:${signalId}` — stable for the life of the row
  // and therefore stable across page loads — so every press on that row, for
  // ever, carried one key. With the command log consulting the key, a
  // clinician who attempted contact on Monday and again on Wednesday with the
  // same words had the second press REPLAY Monday's result: a confirmation
  // that read exactly like a fresh one, over a record that gained nothing.
  // That is the same lost clinical entry the note-text comparison used to
  // produce, moved one layer down.
  //
  // §9 says a key containing a timestamp makes every retry a new action, and
  // that is still true: this is generated ONCE PER MOUNT, in a lazy
  // initialiser, not per request. A retry of the same press — the answer never
  // came back, the person presses again without reloading — carries the same
  // id and is reconciled. A press after a reload is a new decision and is
  // recorded as one, which is what the record has to be able to say.
  const [mountId] = useState(() => Math.random().toString(36).slice(2, 10));
  const nonce = `${personId}:${signalId ?? "no-signal"}:${mountId}`;

  async function run(which: ClinicianAction, call: () => Promise<CommandResult<{ summary: string }>>) {
    setTask(submitting());
    const r = await call();
    setResult(r);
    setTask(advance(r));
    // Lifted out of the row, because a confirmed review can REMOVE this row
    // from the queue and unmount the confirmation with it. See
    // ./QueueConfirmations.tsx.
    if (r.outcome === "confirmed" && r.result?.summary) recorded?.record(r.result.summary);
    // A CONFLICT IS LIFTED; A REFUSAL IS NOT, and the difference is whether the
    // row will still be there to read.
    //
    // `stale` means somebody else already decided this, which is exactly the
    // case where the row is gone: a server action re-renders the route, the
    // resolved row drops out of the queue, and the panel unmounts with the
    // message inside it. The reader watches the row vanish and reads that as
    // their own action succeeding — the failure QueueConfirmations was written
    // for, in its more dangerous form.
    //
    // A `rejected` refusal — "an immediate-band alert closes with a documented
    // action" — leaves the row exactly where it was, and belongs beside the
    // control it is refusing. Lifting that one as well put the same sentence on
    // screen twice.
    if (r.outcome === "stale") {
      const said = advance(r);
      recorded?.record(
        [said.label, said.detail, said.currentVersion ? `The queue now holds: ${said.currentVersion}.` : null]
          .filter(Boolean).join(" "),
        "problem"
      );
    }
    // The draft survives a conflict and a failure; it is cleared only on a
    // confirmed write, where keeping it would invite a second one.
    if (r.outcome === "confirmed") setNote("");
    void which;
  }

  if (task.name === "confirmed" && result) {
    return (
      <div data-testid="row-action-confirmed" className="max-w-[18rem] text-right">
        <p className="text-xs font-medium text-state-safe">{task.label}</p>
        {/* §5: exactly what changed, after the server confirmed it. */}
        <p className="measure mt-0.5 text-xs text-olive">{result.result?.summary}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Open. A link, not a command. */}
        <Link
          href={`/clinician/member/${personId}`}
          className="rounded-full border border-ground/20 px-3 py-1.5 text-xs text-app-ink hover:bg-app-accent/40"
        >
          {ACTION_LABEL.open}
        </Link>

        {/* The row's own primary action, from the domain's decision. */}
        <button
          type="button"
          id={`row-primary-${personId}`}
          onClick={() => { setOpen(action); setResult(null); setTask(idle()); }}
          disabled={task.name === "submitting"}
          className="rounded-full bg-ground px-3.5 py-1.5 text-xs font-medium text-ivory disabled:opacity-60"
        >
          {ACTION_LABEL[action]}
        </button>

        {/* Assign, offered only when there is somebody to assign to. */}
        {assignees.length > 0 && action !== "assign" && (
          <button
            type="button"
            onClick={() => { setOpen("assign"); setResult(null); setTask(idle()); }}
            className="rounded-full border border-ground/20 px-3 py-1.5 text-xs text-app-ink hover:bg-app-accent/40"
          >
            {ACTION_LABEL.assign}
          </button>
        )}
      </div>

      {task.name === "submitting" && (
        <p className="text-xs text-olive">{task.label}</p>
      )}

      {/* A refusal, a conflict or an unconfirmed answer. Never rendered as
          success, and never offering a retry the outcome does not permit. */}
      {/* Not for a conflict: that one is lifted above the list, because the row
          it belongs to is usually gone by the time it arrives. Rendering it
          here as well would say the same thing twice on one screen. */}
      {task.name !== "idle" && task.name !== "submitting" && !mayClaimSaved(task)
        && result?.outcome !== "stale" && (
        <div data-testid="row-action-problem" className="max-w-[20rem] rounded-xl border border-state-caution/40 bg-state-caution-bg/40 px-3 py-2 text-right">
          <p className="text-xs font-medium text-app-ink">{task.label}</p>
          {task.detail && <p className="measure mt-0.5 text-xs text-olive">{task.detail}</p>}
          {task.currentVersion && (
            <p className="measure mt-0.5 text-xs text-olive">
              The queue now holds: {task.currentVersion}. Reload to read it.
            </p>
          )}
          {task.reconcileBy && (
            <p className="measure mt-0.5 text-xs text-olive">
              Do not repeat this. Steady is reconciling it under key {task.reconcileBy.slice(0, 8)}.
            </p>
          )}
          {/* THE AFFORDANCE FOLLOWS THE REFUSAL. "Change it and try again" is
              right for a missing reason and wrong for a page that predates a
              rebuild: there is nothing in the form to change, and that button
              sends somebody round a loop that cannot end. */}
          {task.retryable && task.reloadRequired && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-1 text-xs underline underline-offset-2"
            >
              Reload this page
            </button>
          )}
          {task.retryable && !task.reloadRequired && (
            <button
              type="button"
              onClick={() => setOpen(open ?? action)}
              className="mt-1 text-xs underline underline-offset-2"
            >
              Change it and try again
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="w-full max-w-[22rem] rounded-xl border border-ground/10 bg-app-surface px-3 py-3 text-left">
          <p className="text-xs font-medium text-app-ink">{ACTION_LABEL[open]}</p>
          <p className="measure mt-0.5 text-xs text-olive">{ACTION_NOTE[open]}</p>

          {open === "assign" ? (
            <div className="mt-2 space-y-2">
              {assignees.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() =>
                    run("assign", () =>
                      assignWork({
                        intent: "assign", target: signalId ?? personId,
                        payload: { personId, ownerId: a.id, ownerName: a.name },
                        idempotencyKey: commandKey({
                          intent: "assign", target: signalId ?? personId,
                          actorPersonId: personId, nonce: `${nonce}:${a.id}`,
                        }),
                        expectedVersion,
                        environmentGeneration,
                      })
                    )
                  }
                  className="block w-full rounded-lg border border-ground/15 px-2.5 py-1.5 text-left text-xs text-app-ink hover:bg-app-accent/40"
                >
                  {a.name}
                </button>
              ))}
            </div>
          ) : (
            <>
              <label className="mt-2 block text-xs text-olive">
                {open === "record_contact"
                  ? "What happened"
                  : "What you decided (optional)"}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-ground/20 bg-app-surface px-2.5 py-1.5 text-sm text-app-ink"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={task.name === "submitting"}
                  onClick={() =>
                    run(open, () =>
                      open === "record_contact"
                        ? recordContact({
                            intent: "record_contact", target: signalId ?? personId,
                            payload: { personId, note },
                            idempotencyKey: commandKey({
                              intent: "record_contact", target: signalId ?? personId,
                              actorPersonId: personId, nonce: `${nonce}:${note}`,
                            }),
                            expectedVersion,
                            environmentGeneration,
                          })
                        : completeReview({
                            intent: "complete_review", target: signalId ?? personId,
                            payload: { personId, note },
                            idempotencyKey: commandKey({
                              intent: "complete_review", target: signalId ?? personId,
                              actorPersonId: personId, nonce,
                            }),
                            expectedVersion,
                            environmentGeneration,
                          })
                    )
                  }
                  className="rounded-full bg-ground px-3 py-1.5 text-xs font-medium text-ivory disabled:opacity-60"
                >
                  Record it
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="text-xs text-olive underline underline-offset-2"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          <p className="measure mt-2 text-xs text-olive">
            {/* The sentence that has to survive: nothing on this control does
                anything to {personName} until the server says it did. */}
            Nothing is recorded against {personName} until the server confirms it, and this screen
            will say what changed.
          </p>
        </div>
      )}
    </div>
  );
}
