import Link from "next/link";
import {
  READINGS_ARE_NOT_AN_OUTCOME, type RecentSession,
} from "@/lib/clinical/recent-session";

// The last session, on the overview (17 September handoff, P4).
//
// THE EMPTY STATE IS NOT AN OMISSION. A person who has never had a session and
// a person whose last one was in March look identical on a page that renders
// this card only when there is something in it — and "nobody has run a session
// with this person" is one of the more useful things the first thirty seconds
// of a record can tell you.

export function RecentSessionCard({
  personId, session,
}: { personId: string; session: RecentSession | null }) {
  return (
    <section
      data-testid="recent-session"
      className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-app-ink">Last session</h2>
        <Link href={`/clinician/member/${personId}/sessions`} className="text-xs text-olive underline">
          All sessions
        </Link>
      </div>

      {!session ? (
        <p className="measure mt-3 text-sm text-olive">
          No session has been run with this person. That is a fact about the record, not about
          whether one is due.
        </p>
      ) : (
        <>
          <p className="measure mt-3 text-sm text-app-ink">{session.said}</p>
          <p className="measure mt-1 text-sm text-olive">{session.readings}</p>
          <p className="measure mt-0.5 text-xs text-olive">{READINGS_ARE_NOT_AN_OUTCOME}</p>
          {session.outstanding && (
            // The one thing on this card that is work rather than history, so
            // it is marked as work rather than as another grey line.
            <p
              data-testid="recent-session-outstanding"
              className="measure mt-2 rounded-xl border border-ground/20 px-3 py-2 text-sm text-app-ink"
            >
              {session.outstanding}
            </p>
          )}
          <p className="mt-2 text-xs">
            <Link
              href={`/clinician/member/${personId}/session/${session.id}`}
              className="text-olive underline"
            >
              Open this session
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
