"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavDestination } from "@/lib/experience/navigation";

// The member's core row, and the only reason it is a client component.
//
// THE SELECTED STATE NEEDS THE CURRENT ROUTE, and the shell that draws this row
// is a server component. It used to be handed `pathname` as a prop, which works
// for exactly as long as one screen renders the shell: the moment every member
// screen does, thirty-one route files have to remember to pass their own path
// correctly, and the first one that passes a stale or hard-coded value shows a
// person the wrong "you are here" with no error anywhere.
//
// `usePathname` is the route, read from the router rather than restated. A
// destination is a promise (§1.1); so is a selected state.

/** Longest match wins, so exactly one destination is selected. Two selected
 *  states is the same failure as none (§8.2). */
function activeFor(core: readonly NavDestination[], pathname: string): string | null {
  let best: string | null = null;
  for (const d of core) {
    if (d.href !== pathname && !pathname.startsWith(`${d.href}/`)) continue;
    if (!best || d.href.length > best.length) best = d.href;
  }
  return best;
}

export function MemberNav({ core }: { core: readonly NavDestination[] }) {
  const pathname = usePathname() ?? "";
  const activeHref = activeFor(core, pathname);

  return (
    // §1.2's core row. Three destinations for a member with everything on,
    // fewer when a capability is off — never padded to reach a count.
    //
    // SCROLLS RATHER THAN WRAPS. At 390px a four-destination row broke "Care
    // team" across two lines mid-phrase, which reads as two items. A promise
    // split in half is worse than one off the end of a scroll.
    <nav aria-label="Member navigation" className="mx-auto max-w-3xl overflow-x-auto px-2 pb-2">
      <ul className="flex min-w-max gap-1">
        {core.map((d) => (
          <li key={d.href} className="flex-1">
            <Link
              href={d.href}
              aria-current={d.href === activeHref ? "page" : undefined}
              className={`block min-h-11 whitespace-nowrap rounded-xl px-3 py-2.5 text-center text-sm transition-colors ${
                d.href === activeHref
                  ? "bg-app-accent font-semibold text-app-ink"
                  : "text-olive hover:bg-app-accent/40 hover:text-app-ink"
              }`}
            >
              {d.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
