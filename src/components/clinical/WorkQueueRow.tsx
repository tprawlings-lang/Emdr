// One row of the clinician work queue (GUI and Decision-Surface Handoff §10.3).
//
// §10.3 lists eight required fields, and the list is the specification: priority
// band and label, person, reason for appearing, change since last review, most
// recent evidence time, current owner, due or response target, and one row
// action. A row missing any of them pushes the question back onto the clinician
// — "why is this here?", "is this mine?", "how old is this?" — which is the
// work the queue exists to remove.
//
// One action, not three. A row offering review, contact and open has not
// decided what it is asking for, and the clinician pays for that indecision on
// every row they scan.
//
// EXPANSION HANDOFF 03 §4 ADDS THREE THINGS AND ONE RULE.
//
// The rule first: "a row is not a mini chart. The clinician understands the
// reason without opening it; scores, history, full evidence, and extra actions
// belong in the drawer." So what follows is deliberately small — a safety
// label, at most three short facts, and how long since anyone made contact.
//
// THE SAFETY LABEL IS THE IMPORTANT ONE. §2: "safety remains visibly labeled as
// safety. Non-safety review_now cannot masquerade as safety." An attention
// signal and a safety obligation can sit in the same bucket, which is right —
// hiding a review-worthy concern a section lower because it is not safety helps
// nobody — and it is only right because the row says which it is. The label
// reads from `safetyAuthority`, never from the band, because the band is
// exactly what the two share.

import Link from "next/link";
import type { WorkItem } from "@/lib/clinical/work-queue";
import { PriorityBadge, FreshnessLabel, OwnerChip, DueLabel, relativeAge } from "./primitives";
import { AttentionSignalDrawer } from "./AttentionSignalDrawer";

const ACTION_LABEL: Record<WorkItem["action"], string> = {
  review: "Review",
  contact: "Contact",
  open: "Open",
  none: "",
};

export function WorkQueueRow({
  item, now, hidePerson = false, drawer = false,
}: {
  item: WorkItem;
  now: string;
  /** Set on a person's own record, where repeating their name in every row is
   *  noise rather than identity. */
  hidePerson?: boolean;
  /** Whether the quick review drawer is available (expansion handoff 03 §5).
   *
   *  A SECOND CONTROL, NEVER A SECOND PRIMARY ACTION. §5: "the drawer may
   *  expose secondary actions, but the queue row retains exactly one primary
   *  action." So the primary button below is unchanged and this sits beside it
   *  as a quieter affordance — opening a review is not deciding anything, and
   *  §12 requires that opening it change nothing at all. */
  drawer?: boolean;
}) {
  const href = `/clinician/member/${item.personId}`;

  return (
    <li className="border-b border-ground/10 last:border-b-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5 sm:flex-nowrap">
        <div className="flex w-full items-center gap-3 sm:w-auto sm:shrink-0">
          <PriorityBadge band={item.band} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {!hidePerson && (
              <Link href={href} className="font-semibold text-ground underline-offset-2 hover:underline">
                {item.personName}
              </Link>
            )}
            {/* §10.3's duplicate collapse. The count is what keeps the collapse
                honest — three alerts becoming one row without saying so hides
                volume the clinician may need to know about. */}
            {item.eventCount > 1 && (
              <span className="rounded-full bg-ground/10 px-2 py-0.5 text-xs font-medium text-olive">
                {item.eventCount} events
              </span>
            )}
          </div>

          {/* Not colour alone (§19): the word "Safety" is the signal, and the
              chip is only its dressing. */}
          {item.safetyAuthority && (
            <span className="mt-0.5 inline-block rounded-full bg-state-support/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-state-support">
              Safety
            </span>
          )}

          <p className={hidePerson ? "text-sm font-medium text-ground" : "mt-0.5 text-sm text-ground/90"}>
            {item.reason}
          </p>

          {/* §4: "maximum three short facts." The cap is in the projection, and
              the slice here is a second guard rather than a first — a row that
              grew a fourth fact would be a row on its way to becoming a chart. */}
          {item.supportFacts.length > 0 && (
            <ul className="measure mt-1 space-y-0.5">
              {item.supportFacts.slice(0, 3).map((f, n) => (
                <li key={n} className="text-xs text-olive">{f}</li>
              ))}
            </ul>
          )}
          {/* The underlying event text. Carries the scoring specifics a
              clinician needs when acting — allowed on a clinician surface — but
              it is not the headline, because a raw key does not tell anyone at
              a glance why they are here. */}
          {item.detail && (
            <p className="mt-0.5 font-mono text-xs text-olive">{item.detail}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Null change renders as its own state rather than as silence —
                §14: missing is not the same as nothing changed. */}
            <span className="text-xs text-olive">
              {item.change ?? "First time in this queue"}
            </span>
            <FreshnessLabel evidenceAt={item.evidenceAt} now={now} />
            <OwnerChip name={item.ownerName} />
            {/* §4's "last meaningful clinician contact". Null is its own
                state: somebody nobody has contacted yet and somebody contacted
                this morning must not read the same. */}
            <span className="text-xs text-olive">
              {item.lastContactDays === null
                ? "No contact recorded"
                : item.lastContactDays === 0
                  ? "Contacted today"
                  : `Last contact ${item.lastContactDays}d ago`}
            </span>
            {/* A resolved item's deadline is history. Rendering a countdown
                against a past due time produced "Due in just now", which is
                both wrong and meaningless. */}
            {item.resolvedAt ? (
              <span className="text-xs text-state-safe">
                ◆ Resolved {relativeAge(item.resolvedAt, now)} ago
              </span>
            ) : (
              <DueLabel dueAt={item.dueAt} overdue={item.overdue} now={now} />
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-center">
          {drawer && (
            <AttentionSignalDrawer
              personId={item.personId}
              personName={item.personName}
              signalId={item.signalId}
            />
          )}
          {item.actionable && item.action !== "none" ? (
            <Link
              href={href}
              className="inline-block rounded-full bg-ground px-4 py-2 text-sm font-medium text-ivory transition-colors hover:bg-ground/90"
            >
              {ACTION_LABEL[item.action]}
            </Link>
          ) : (
            // Not a disabled button. A disabled control invites clicking and
            // explains nothing; the sentence explains and cannot be clicked.
            <span className="block max-w-[16rem] text-xs text-state-unknown">
              {item.blockedReason ?? "No action available"}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
