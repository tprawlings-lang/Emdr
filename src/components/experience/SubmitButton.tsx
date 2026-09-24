"use client";

import { useFormStatus } from "react-dom";

// The button that says the command is running, and refuses the second press.
//
// WHAT IT IS FOR, MEASURED RATHER THAN ASSUMED. Pressing "Record that you
// prepared" on a person's record is a server action: a write, a revalidate and
// a redirect, 221ms against a local database with a warm build and more than
// that over a network. For all of it the button read exactly as it had before,
// stayed enabled, and gave no sign the press had landed. The one moment the
// interface is guaranteed to be busy was the one moment it said nothing.
//
// AND SILENCE COSTS MORE THAN PATIENCE HERE. Pressed twice inside that window —
// an impatient clinician, or a slow link — the ledger took TWO care-time
// records for one piece of work. Measured: one press before, three rows after
// two presses. A record of care that did not happen is the one thing this
// ledger cannot survive, which is why `linkAssignmentToGoal` refuses a link
// that has not moved. The same rule needed a control.
//
// `aria-disabled`, NOT `disabled`, AND THAT IS THE ACCESSIBILITY CHOICE.
// A disabled button is removed from the tab order, so a keyboard user who
// presses Enter loses focus to the document body mid-task and has to find their
// place again — on a screen that is about to re-render underneath them. This
// stays focusable, announces itself as unavailable, and refuses the press in
// the handler instead.
//
// IT DOES NOT MAKE THE COMMAND IDEMPOTENT, and nothing here should be read as
// if it did. This closes the path a person can actually take. Two tabs, a
// replayed request or a retried POST still reach the server twice; the durable
// answer is a key the server reconciles, which `assignSupport` already carries
// and which is registered as the remaining work for the rest.

export function SubmitButton({
  children,
  pendingLabel,
  className,
  formAction,
  name,
  value,
}: {
  children: React.ReactNode;
  /** What it says while the server is working. Present tense, and close in
   *  length to the idle label so the row does not reflow under the pointer. */
  pendingLabel: string;
  className?: string;
  formAction?: string | ((formData: FormData) => void | Promise<void>);
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      aria-disabled={pending || undefined}
      // ANNOUNCED, because the only thing that changes is a word inside the
      // control the person is already on. Without this a screen-reader user
      // presses the button and hears nothing at all until the page reloads.
      aria-live="polite"
      data-pending={pending ? "true" : undefined}
      onClick={(e) => {
        if (pending) e.preventDefault();
      }}
      className={`${className ?? ""} aria-disabled:opacity-60`.trim()}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
