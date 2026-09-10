import Link from "next/link";
import type { QueueRowView } from "@/lib/experience/clinician-home";
import { ACTION_LABEL, ACTION_NOTE, CLINICIAN_ACTIONS } from "@/lib/experience/clinician-vocabulary";
import { focusBehaviour, assertPanel, MODE_NOTE, type PanelMode } from "@/lib/experience/evidence-panel";

// The queue's evidence panel (handoff 09 §1.4, §5; Package 2).
//
// §5: "Open a nonmodal detail panel on wide screens. On small screens, open a
// full page with a dependable return path. Keep identity and the action target
// visible while reading evidence or entering a decision."
//
// NON-MODAL, AND THAT IS THE WHOLE RULING. §1.4 settled a disagreement between
// the two source documents: handoff 08 required every drawer to trap focus, and
// the Astra review pointed out that a desktop evidence panel exists precisely so
// a clinician can read the evidence WHILE looking at the row it belongs to. A
// trapped panel makes that impossible — the reader must close it to see the
// list, so the comparison becomes a recollection.
//
// SO THIS PANEL IS RENDERED IN THE PAGE, BESIDE THE QUEUE, as an aside. It has
// a labeled region and a close control, the list stays operable, and nothing is
// trapped. The focus behaviour is not a prop: it comes from
// `focusBehaviour(mode)`, so a later author cannot make it trap by passing a
// boolean.
//
// IT IS A LINK-DRIVEN PANEL, not a client component with state. The row links
// to `?row=<id>`, the server renders the panel for that row, and the browser
// back button closes it. That is why identity stays visible: the queue is still
// on screen because the page never left.

export function QueueEvidencePanel({
  row,
  mode = "nonmodal",
  /** Where the close control goes — the queue without the row parameter. */
  closeHref,
  children,
}: {
  row: QueueRowView;
  mode?: PanelMode;
  closeHref: string;
  /** The separated actions, so a decision can be entered without leaving the
   *  evidence. §5: "Keep identity and the action target visible while reading
   *  evidence or entering a decision." */
  children?: React.ReactNode;
}) {
  const behaviour = focusBehaviour(mode);
  // Refused at render rather than trusted: a panel with no accessible name or
  // no subject on screen throws here instead of stranding a keyboard user.
  assertPanel({
    mode,
    label: `Why ${row.personName} is in the queue`,
    subjectLabel: row.personName,
    openerId: `row-${row.id}`,
  });

  return (
    <section
      // §1.4: "a labeled region" in every mode.
      aria-label={`Why ${row.personName} is in the queue`}
      data-testid="queue-evidence-panel"
      data-panel-mode={mode}
      data-traps-focus={behaviour.trapFocus ? "true" : "false"}
      className="rounded-3xl border border-ground/10 bg-linen p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* IDENTITY STAYS VISIBLE. §5's requirement, and the reason the panel
              repeats a name that is also on the row: the row may be scrolled
              out from under it on a narrow-ish screen. */}
          <p className="text-sm font-semibold text-ground">
            {row.personName}
            {row.disambiguator && (
              <span className="ml-2 font-mono text-xs font-normal text-olive">
                {row.disambiguator}
              </span>
            )}
          </p>
          <p className="measure mt-1 text-sm text-ground/90">{row.reason}</p>
        </div>
        {behaviour.closeControl && (
          <Link
            href={closeHref}
            aria-label="Close the details"
            className="shrink-0 rounded-full px-2 py-1 text-sm text-olive hover:bg-app-accent/40 hover:text-app-ink"
          >
            Close
          </Link>
        )}
      </div>

      {/* Everything §5 moved off the row, as a definition list rather than as
          prose somebody has to parse. */}
      <dl className="mt-4 space-y-2">
        {row.secondary.map((f, i) => (
          <div key={`${f.label}-${i}`} className="text-xs">
            {f.label && <dt className="font-medium text-app-ink">{f.label}</dt>}
            <dd className={`measure text-olive ${f.label ? "" : "pl-0"}`}>{f.value}</dd>
          </div>
        ))}
      </dl>

      {children && (
        <div className="mt-5 border-t border-ground/10 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-olive">
            What you can record
          </p>
          <div className="mt-2">{children}</div>
          {/* §5's separation, said out loud. A clinician who has just opened a
              record should not have to wonder whether opening it counted as
              anything. */}
          <ul className="measure mt-3 space-y-1 text-xs text-olive">
            {CLINICIAN_ACTIONS.map((a) => (
              <li key={a}>
                <span className="font-medium text-app-ink">{ACTION_LABEL[a]}</span> — {ACTION_NOTE[a]}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="measure mt-4 text-xs text-olive">
        {MODE_NOTE[mode]}
      </p>
    </section>
  );
}
