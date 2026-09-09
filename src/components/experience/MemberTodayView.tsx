import Link from "next/link";
import { pathsBesidesDock, type MemberDayView } from "@/lib/experience/member-day";
import { SUPPORT_ENTRIES } from "@/lib/experience/support-dock";

// Today (handoff 09 §4.1, §4.2, §4.5; Package 3).
//
// §4.1's hierarchy, top to bottom, and the order IS the specification:
//
//   "One orienting sentence. One recommended activity as the primary card, with
//    what it is, an approximate duration, and a clear pause promise. Secondary
//    tools below the primary card, not beside it. Recent activity shown
//    quietly. No streaks, no missed-day penalties, no progress percentages, no
//    withheld-card counts."
//
// BESIDE IS THE FAILURE MODE, NOT BELOW. Two cards side by side are two
// choices, and §3.4's finding on the old Today was that a catalog "makes the
// member decide what matters now. On a hard day, that choice load is exactly
// what the system should reduce." So the tools render as a list underneath,
// visually quieter than the primary, and there is no arrangement of this
// component that puts a second option level with the first.
//
// AND THE REQUIRED PATHS COME FROM THE STATE, NOT FROM THIS FILE. §4.2 gives
// each of the seven states a list; `requiredPaths` returns it. A component that
// composed its own list is a component that drops grounding from the crisis
// screen during a restyle.
//
// WHAT IS NOT HERE. No count of check-ins, no percentage, no "3 day streak", no
// "2 activities hidden today". §4.1 rules out the first three by name and §2.2
// Finding 3 rules out the streak; the fourth — telling somebody how much was
// withheld — is the one that reads as a scoreboard of their own safety.

export function MemberTodayView({ day }: { day: MemberDayView }) {
  // §4.2's paths for this state, minus the ones the fixed dock is already
  // showing. Drawing "Ground now" here AND in the dock a hundred pixels below
  // makes a member decide whether the two are the same button, on a screen
  // designed to remove decisions. The dock keeps them reachable; this row is
  // for what the dock does not carry.
  const paths = pathsBesidesDock(day.state, SUPPORT_ENTRIES.map((e) => e.href));
  const failing = day.state === "service_unavailable";

  return (
    <div className="space-y-6">
      {/* One orienting sentence. Not three. */}
      <p className="measure text-lg leading-relaxed text-ground">{day.orientingSentence}</p>

      {/* §11's paused-state answer, and only on a paused day. It sits directly
          under the orienting sentence rather than at the foot of the screen,
          because "when does this lift" is the question a person on hold is
          already asking — putting the answer below the tools makes them scroll
          past the absence to find it.

          Quieter than the sentence above it, and not a card. A bordered panel
          would read as an alert about a problem, and the whole point is that
          this is not one. */}
      {day.reopens && (
        <p data-testid="reopens" data-reopens-kind={day.reopens.kind} className="measure text-ground/80">
          {day.reopens.sentence}
          {day.reopens.at && (
            <span className="mt-1 block text-olive">{onDay(day.reopens.at)}</span>
          )}
        </p>
      )}

      {day.recommended ? (
        <section
          className={`rounded-3xl p-6 shadow-soft sm:p-7 ${
            failing ? "border border-ground/15 bg-linen" : "bg-ground text-ivory"
          }`}
        >
          <h2 className="type-display text-2xl font-medium">{day.recommended.title}</h2>
          <p className={`mt-2 ${failing ? "text-ground/80" : "text-ivory/85"}`}>
            {day.recommended.description}
          </p>
          <p className={`mt-3 text-sm ${failing ? "text-olive" : "text-ivory/70"}`}>
            About {day.recommended.approximateMinutes} minutes. {day.recommended.pausePromise}
          </p>
          <Link
            href={day.recommended.startHref}
            className="mt-5 inline-block min-h-11 rounded-full bg-sage px-7 py-3 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Begin
          </Link>
        </section>
      ) : (
        // Null is a real answer on a crisis day, a paused day, and a day that
        // did not load. §4.2: on those the strongest thing on the screen is not
        // an activity, so nothing is invented to fill the slot.
        <section className="rounded-3xl border border-ground/15 bg-linen p-6">
          <h2 className="type-display text-xl font-medium text-ground">{day.dayStateLabel}</h2>
          <p className="measure mt-2 text-sm leading-relaxed text-ground/90">
            {day.state === "crisis"
              ? "Nothing here needs doing right now. The options below are what this screen is for."
              : "The paths below stay open whatever else is happening."}
          </p>
        </section>
      )}

      {/* What this state offers beyond the dock. Empty on a crisis day, where
          the dock IS the answer — so the section is absent rather than a
          heading with nothing under it. */}
      {paths.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-olive">
            Always open
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {paths.map((p) => (
              <li key={p.href}>
                <Link
                  href={p.href}
                  className="inline-block min-h-11 rounded-full border border-ground/25 px-5 py-2.5 text-sm text-ground transition-colors hover:bg-linen"
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Below the primary card, never beside it. */}
      {day.tools.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-olive">
            Other things you can do
          </h2>
          <ul className="mt-3 space-y-2">
            {day.tools.map((t) => (
              <li key={t.href}>
                <Link
                  href={t.href}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-ground/10 bg-linen p-4 transition-colors hover:bg-ivory"
                >
                  <span>
                    <span className="block font-medium text-ground">{t.label}</span>
                    <span className="mt-0.5 block text-sm text-olive">{t.description}</span>
                  </span>
                  <span className="mt-1 text-olive" aria-hidden="true">
                    &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Quietly. What happened and when — nothing that counts it into a run. */}
      {day.recent.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-olive">Recently</h2>
          <ul className="mt-2 space-y-1 text-sm text-olive">
            {day.recent.map((r, i) => (
              <li key={`${r.kind}-${r.occurredAt}-${i}`}>
                {r.kind} &middot; {onDay(r.occurredAt)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A date a person reads, not the one a database stores.
 *
 *  The same defect as the clinician load panel's raw ISO timestamps, found the
 *  same way — by looking at the screen. "2026-09-01" is a value; "1 September"
 *  is a day somebody remembers having. No year, because everything in this list
 *  is inside a fortnight and a year would make it read as a record. */
function onDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}
