import Link from "next/link";
import type { RecentActivity } from "@/lib/clinical/recent-activity";
import { ACTIVITY_LABEL } from "@/lib/clinical/recent-activity";
import { relativeAge } from "./primitives";

// The Recent Activity feed (expansion handoff 03 §7; Phase 4).
//
// §7's shape: a time, a person, one line about what happened, and a second line
// with the specifics. Chronological, server-ordered, and every item links to
// the patient and to evidence where access permits.
//
// THE WITHHELD COUNT IS PART OF THE FEED, not a footnote. §7 keeps Companion
// content out under the active visibility policy, and §20's discipline applies:
// the absence has to be visible without the content being shown. A feed that
// silently dropped four conversations would look like a quiet week.
//
// AND THE COLLAPSED LINES SAY THEY ARE COLLAPSED. §7 asks for repetitive
// same-type events to collapse "when individual items add no clinical meaning";
// a collapsed line that did not show its count would be hiding volume rather
// than summarising it.

export function RecentActivityFeed({ activity }: { activity: RecentActivity }) {
  if (activity.items.length === 0) {
    return (
      <div className="mt-4 rounded-3xl border border-ground/10 bg-linen px-5 py-6">
        <p className="measure text-sm text-ground">
          Nothing has been recorded across your caseload in this window. That is a statement about
          the record, not about how anyone is doing.
        </p>
        {activity.withheld.count > 0 && (
          <p className="measure mt-2 text-xs text-olive">{activity.withheld.reason}</p>
        )}
      </div>
    );
  }

  // Grouped by day, because a feed a clinician scans is scanned by day. The
  // order inside a day is the server's; nothing here re-sorts.
  const days: Array<{ day: string; items: RecentActivity["items"] }> = [];
  for (const item of activity.items) {
    const day = item.occurredAt.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }

  return (
    <div className="mt-4">
      {activity.withheld.count > 0 && (
        <p className="measure mb-4 rounded-xl border border-ground/15 px-3 py-2 text-xs text-olive">
          <span aria-hidden>· </span>
          {activity.withheld.reason}
        </p>
      )}

      <div className="space-y-6">
        {days.map(({ day, items }) => (
          <section key={day} aria-labelledby={`day-${day}`}>
            <h3 id={`day-${day}`} className="text-xs font-semibold uppercase tracking-wide text-olive">
              {day} <span className="font-normal">({relativeAge(`${day} 12:00:00`, activity.computedAt)} ago)</span>
            </h3>
            <ul className="mt-2 overflow-hidden rounded-3xl border border-ground/10 bg-linen">
              {items.map((i) => (
                <li key={i.id} className="border-b border-ground/10 px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="rounded-full bg-app-accent/50 px-2 py-0.5 text-xs text-app-ink">
                      {ACTIVITY_LABEL[i.kind]}
                    </span>
                    <Link
                      href={`/clinician/member/${i.personId}`}
                      className="font-medium text-ground underline-offset-2 hover:underline"
                    >
                      {i.personName}
                    </Link>
                    <span className="text-sm text-ground/90">{i.headline}</span>
                    {i.eventCount > 1 && (
                      <span className="rounded-full bg-ground/10 px-2 py-0.5 text-xs text-olive">
                        {i.eventCount} collapsed
                      </span>
                    )}
                  </div>
                  {i.detail && <p className="measure mt-0.5 text-xs text-olive">{i.detail}</p>}
                  {i.href && (
                    <p className="mt-1 text-xs">
                      <Link href={i.href} className="text-olive underline">Open it</Link>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="measure mt-4 text-xs text-olive">
        Your caseload only — {activity.coveredPeople} {activity.coveredPeople === 1 ? "person" : "people"}.
        Chronological, newest first, ordered on the server. Companion conversations appear as
        metadata and never as transcript text. Policy {activity.policyVersion}.
      </p>
    </div>
  );
}
