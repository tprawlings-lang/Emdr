import Link from "next/link";
import { supportDock, activitySupportDock } from "@/lib/experience/support-dock";

// The support dock (handoff 09 §9, §4.1, §1.6; Package 3).
//
// §4.1: "Support fixed, high-contrast, keyboard reachable, and independent of
// subscription, tier, gate, or module state."
//
// THE COMPONENT HAS NO PROPS THAT COULD HIDE IT. It takes `during`, which
// chooses between the two shapes the module already defines, and nothing else.
// There is no `show`, no `tier`, no `enabled` — because §9's reason for the
// dock is "support must never depend on payment or module state", and a
// boolean prop is exactly how that dependency arrives six months later.
//
// AND IT RESERVES ITS OWN SPACE RATHER THAN FLOATING OVER THE PAGE. §1.6: "No
// fixed element may obscure a focused control at 320 CSS pixels." A fixed bar
// that overlaps the button a switch user has just focused is not a cosmetic
// problem. The spacer below the dock is the same height as the dock, so the
// last control on a page can always be scrolled clear of it.
//
// RED IS NOT THE SIGNAL. §8.1: "Red is never the dominant signal on a member
// surface, including the crisis screen. High-vibrancy red is processed as
// threat, which is the wrong physiological response to induce in someone who is
// already activated." Contrast and placement carry the urgency instead.

export function SupportDock({ during }: { during?: "activity" }) {
  const dock = during === "activity" ? activitySupportDock() : supportDock();

  return (
    <>
      {/* THE SPACER IS NOT HERE, AND THAT IS THE FIX RATHER THAN AN OMISSION.
          It was here, as a sibling div of the fixed bar, and it protected only
          the page: the root layout renders the site footer AFTER the page, so
          the 988 notice and the policy links at the end of a member screen
          still slid under the bar. A screenshot at 320px showed it; nothing
          else could have. The reserve now sits on the body — `body:has(
          [data-support-dock])` in globals.css — which is where the document
          actually ends, and the same rule lifts the SOS panic button clear of
          the bar instead of leaving the two fixed elements to overlap.

          The attribute below is what both rules key off. Removing it silently
          reintroduces both bugs, so a guard asserts it is here. */}
      <div
        data-support-dock=""
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ground/15 bg-linen/95 backdrop-blur supports-[backdrop-filter]:bg-linen/85"
      >
        <nav
          aria-label="Support"
          className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4"
        >
          {dock.entries.map((entry, i) => (
            <Link
              key={entry.href}
              href={entry.href}
              title={entry.description}
              className={
                i === 0
                  ? "min-h-11 flex-1 rounded-full bg-sage px-4 py-2.5 text-center text-sm font-semibold text-ground transition-colors hover:bg-sage-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ground"
                  : "min-h-11 flex-1 rounded-full border border-ground/25 px-4 py-2.5 text-center text-sm font-medium text-ground transition-colors hover:bg-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ground"
              }
            >
              {entry.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
