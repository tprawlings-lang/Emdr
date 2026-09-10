import Link from "next/link";
import { SupportDock } from "./SupportDock";
import { mayClaimSaved, type ActivityShellView } from "@/lib/experience/activity-shell";
import { MAIN_ID } from "@/lib/experience/quality";

// The active-session shell (handoff 09 §1.6, §4.3, §4.4; Package 3).
//
// §1.6: "Define an active-session shell carrying Pause, Stop, and Get support.
// Ground remains one direct support action. Routine navigation is removed
// during an activity and returns after a safe exit."
//
// THERE IS NO NAVIGATION PROP AND NO WAY TO ADD ONE. This component does not
// import the navigation manifest at all, so no arrangement of props renders the
// member's Today/Tools/Progress row over a session in progress. That is the
// difference between a rule and a property: a `showNav` prop defaulting to
// false is a prop somebody passes true to on the one screen where it seemed
// harmless.
//
// THE DOCK STAYS BECAUSE THE DOCK IS NOT NAVIGATION. It is the exit. §1.6:
// "Ground remains one direct support action" — one press from inside the
// activity, not two presses through a menu.
//
// WHAT THE SAVE LINE MAY SAY IS NOT THIS COMPONENT'S DECISION. It renders
// `view.save.label`, and the only route to the word "Saved" is a confirmed
// CommandResult passed through `saveState`. §4.4: "Replace blanket claims such
// as Your answers are saved with confirmed state."

export function ActivityShell({
  view,
  pauseHref,
  stopHref,
  children,
}: {
  view: ActivityShellView;
  /** Where Pause goes. §4: "Pause preserves permitted progress." */
  pauseHref: string;
  /** Where Stop goes. §4: "Stop follows the existing exit and closure rules" —
   *  so it is a close-down route, not a bare link back to Today. */
  stopHref: string;
  children: React.ReactNode;
}) {
  const hrefFor: Record<string, string> = {
    pause: pauseHref,
    stop: stopHref,
    // §1.6's "one direct support action". The same route the dock's first
    // entry uses, so there is no second grounding page to keep in step.
    support: view.groundHref,
  };

  return (
    <div className="min-h-dvh bg-ivory">
      {/* No <header> with navigation in it. See the note above.

          A <main> landmark, because removing navigation removed the landmark
          too: this shell was the one route in the product a screen-reader user
          could not skip into, and it is the route where the person is midway
          through an activity. §8.6 asks for one main landmark on every route,
          and "every" includes the screens that deliberately have no chrome. */}
      <main id={MAIN_ID} className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="type-display text-2xl font-medium text-ground sm:text-3xl">
            {view.title}
          </h1>
          <p className="text-sm text-olive">
            {view.step.total === null
              ? `Step ${view.step.index}`
              : `Step ${view.step.index} of ${view.step.total}`}
          </p>
        </div>

        {/* §4.3: one primary task per screen, named. */}
        <p className="measure mt-2 text-olive">{view.step.instruction}</p>

        <div className="mt-8">{children}</div>

        {/* §4.4's honest line. Absent entirely when there is nothing to say —
            an empty "Not saved yet" on a screen nobody has typed on reads as a
            warning about a problem that does not exist. */}
        {view.save.name !== "unsaved" && (
          <p
            aria-live="polite"
            className={`mt-6 text-sm ${
              mayClaimSaved(view.save) ? "text-olive" : "text-ground"
            }`}
          >
            {view.save.label}
            {view.save.detail && (
              <span className="mt-1 block text-olive">{view.save.detail}</span>
            )}
          </p>
        )}

        {/* The exits. All three, always, in the module's order. */}
        <div className="mt-10 border-t border-ground/10 pt-6">
          <ul className="flex flex-wrap gap-2">
            {view.exits.map((e) => (
              <li key={e.exit}>
                <Link
                  href={hrefFor[e.exit]}
                  title={e.note}
                  className="inline-block min-h-11 rounded-full border border-ground/25 px-5 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-linen"
                >
                  {e.label}
                </Link>
                <span className="mt-1 block max-w-[16rem] text-xs leading-relaxed text-olive">
                  {e.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </main>

      <SupportDock during="activity" />
    </div>
  );
}
