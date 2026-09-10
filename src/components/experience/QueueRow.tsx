import Link from "next/link";
import type { QueueRowView } from "@/lib/experience/clinician-home";
import { ACTION_LABEL } from "@/lib/experience/clinician-vocabulary";
import { PriorityBadge, DueLabel } from "@/components/clinical/primitives";

// One Command Center row (handoff 09 §5, Package 2).
//
// §5's complaint about the row this replaces is worth quoting because it is the
// whole brief: "A row should not require the clinician to parse eight badges
// before understanding the concern. Move secondary facts into a readable detail
// panel."
//
// The row it replaces carried eleven things: a band badge, a safety chip, an
// event count, the reason, three support facts, a mono event key, a change
// line, a freshness label, an owner chip, a last-contact line and a due label.
// Every one was added for a good reason and the result was unreadable, which is
// how rows get like that.
//
// SO THIS ROW HAS §5'S FIVE: "Identity, reason, ownership, due state, one next
// action." Plus the safety label, which stays because it is a safety property
// rather than a fact — §2 of handoff 03: "safety remains visibly labeled as
// safety. Non-safety review_now cannot masquerade as safety", and a clinician
// scanning has to be able to tell them apart without opening anything.
//
// THE SECONDARY FACTS ARE NOT GONE. They are in `row.secondary`, which the
// evidence panel renders. Nothing was deleted; it moved to where there is room
// to read it.
//
// AND THE ACTION IS THE THING THE QUEUE IS ASKING FOR. The old row's single
// action navigated in all three of its labels — "Review", "Contact" and "Open"
// all went to the record — which is the conflation §5 names. "Record contact"
// now records, "Complete review" now reviews, and only "Open" navigates.

export function QueueRow({
  row,
  now,
  /** Whether this row is the one the panel is showing. §5: the panel is
   *  non-modal, so the row keeps a selected state while it is read. */
  selected = false,
  /** Where pressing the row's own body goes — the panel, as a link, so it
   *  works without JavaScript and can be opened in a new tab. */
  panelHref,
  children,
}: {
  row: QueueRowView;
  now: string;
  selected?: boolean;
  panelHref: string;
  /** The separated actions. Passed in rather than built here so this component
   *  stays a presentation of a row and the commands stay in one place. */
  children?: React.ReactNode;
}) {
  return (
    <li
      data-testid="queue-row"
      aria-current={selected ? "true" : undefined}
      className={`border-b border-ground/10 last:border-b-0 ${
        selected ? "bg-app-accent/25" : ""
      }`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:flex-nowrap">
        <div className="shrink-0 pt-0.5">
          <PriorityBadge band={row.band} />
        </div>

        <div className="min-w-0 flex-1">
          {/* IDENTITY. §5: "Where names match, use a permitted secondary
              identifier rather than initials alone." Two people called Aiko
              rendered as "Aiko N." and "Aiko I." is a distinction a tired
              reader gets wrong, and the cost is a note on the wrong record. */}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={`/clinician/member/${row.personId}`}
              className="font-semibold text-ground underline-offset-2 hover:underline"
            >
              {row.personName}
            </Link>
            {row.disambiguator && (
              <span className="font-mono text-xs text-olive">{row.disambiguator}</span>
            )}
            {/* Not colour alone (§8.1): the word "Safety" is the signal. */}
            {row.safetyAuthority && (
              <span className="rounded-full bg-state-support/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-state-support">
                Safety
              </span>
            )}
          </div>

          {/* REASON. One line, in words. */}
          <p className="measure mt-1 text-sm text-ground">{row.reason}</p>

          {/* OWNERSHIP and DUE STATE, on one quiet line. Null ownership is its
              own state: §6's "a decorative owner chip must not imply that
              somebody accepted responsibility" applies here too — unassigned
              says unassigned. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-olive">
            <span>{row.ownerName ? `Owner: ${row.ownerName}` : "Unassigned"}</span>
            <DueLabel dueAt={row.dueAt} overdue={row.overdue} now={now} />
            {/* The way into everything §5 moved off the row. A link rather
                than a button: it works with JavaScript off and can be opened
                in a new tab, which a clinician comparing two people will do. */}
            <Link href={panelHref} className="underline underline-offset-2 hover:text-app-ink">
              {selected ? "Showing details" : "Why this is here"}
            </Link>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 self-center">
          {row.action ? (
            children
          ) : (
            // Not a disabled button. A disabled control invites clicking and
            // explains nothing; the sentence explains and cannot be clicked.
            <span className="block max-w-[16rem] text-xs text-state-unknown">
              {row.blockedReason ?? "No action available"}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/** The row's action label, for a caller building the control. Exported so the
 *  label lives with the vocabulary rather than being retyped per surface. */
export function actionLabel(row: QueueRowView): string {
  return row.action ? ACTION_LABEL[row.action] : "";
}
