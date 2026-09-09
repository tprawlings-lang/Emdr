import Link from "next/link";
import { SupportDock } from "./SupportDock";
import type { NavigationManifest } from "@/lib/experience/navigation";
import { MAIN_ID } from "@/lib/experience/quality";
import { logout } from "@/lib/actions";

// The member shell (handoff 09 §3, §4.1, §8.2; Package 3).
//
// §3's member geometry is NOT the clinician's: "Member: Today, Tools, Progress;
// Account; persistent Get support." A member is not running a console. They are
// on a phone, often at night, often activated, and the shell that serves a
// clinician scanning forty rows is the wrong shape for one person deciding
// whether they can manage ten minutes.
//
// SO THE NAVIGATION IS A BOTTOM ROW ON A PHONE AND A TOP ROW ON A DESKTOP, not
// a 232px sidebar. Same manifest, same capability filtering, same §8.2 selected
// state — a different arrangement of it, because §1.2's three-to-five is about
// how many destinations a person can hold, and the member's three fit across
// the top of a 320px screen where a sidebar does not fit at all.
//
// AND THE DOCK IS NOT NAVIGATION. It sits below everything, it is fixed, and it
// is rendered by this shell rather than by each page — because a page that
// renders its own support is a page somebody forgets to. `SupportDock` takes no
// switch (see the component), so there is no route through this file that
// produces a member screen without support on it.

export function MemberShell({
  navigation,
  pathname,
  title,
  lede,
  children,
}: {
  navigation: NavigationManifest;
  /** The current route, for the selected state. Passed rather than read, so
   *  this stays a server component. */
  pathname: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  const activeHref = activeFor(navigation, pathname);

  return (
    <div className="min-h-dvh bg-ivory">
      <header className="border-b border-ground/10 bg-linen">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/app/today" className="type-display text-lg font-semibold text-ground">
            Steady
          </Link>
          <div className="flex items-center gap-2">
            {navigation.utility
              // §3's member utility is Account. "Get support" is in the dock,
              // where it cannot be scrolled past — rendering it twice in the
              // same viewport makes the fixed one look optional.
              .filter((d) => d.href !== "/app/ground")
              .map((d) => (
                <Link
                  key={d.href}
                  href={d.href}
                  className="rounded-full px-3 py-1.5 text-sm text-olive transition-colors hover:bg-ivory hover:text-ground"
                >
                  {d.label}
                </Link>
              ))}
            {/* SIGN OUT STAYS IN THE HEADER, and it is not a layout preference.
                src/components/member/MemberPage.tsx — the frame this shell
                replaces — carries the decision in as many words: "a member who
                cannot leave an account on a shared computer is a privacy
                problem, not a layout one." This shell dropped it, and behind
                the member-shell flag a member's only route out was Account →
                Signed-in devices → sign out everywhere, which is a different
                and much larger action than leaving this browser.

                §3's member utility is Account; this is not a fourth
                destination competing with it — it is a form, it changes state,
                and it reads as the small control it is. */}
            <form action={logout}>
              <button className="rounded-full px-3 py-1.5 text-sm text-olive transition-colors hover:bg-ivory hover:text-ground">
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* §1.2's core row. Three destinations for a member with everything on,
            fewer when a capability is off — never padded to reach a count. */}
        {/* SCROLLS RATHER THAN WRAPS. At 390px a four-destination row broke
            "Care team" across two lines mid-phrase, which reads as two items.
            A destination is a promise (§1.1) and a promise split in half is
            worse than one off the end of a scroll. */}
        <nav aria-label="Member navigation" className="mx-auto max-w-3xl overflow-x-auto px-2 pb-2">
          <ul className="flex min-w-max gap-1">
            {navigation.core.map((d) => (
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
      </header>

      <main id={MAIN_ID} className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <h1 className="type-display text-2xl font-medium text-ground sm:text-3xl">{title}</h1>
        {lede && <p className="measure mt-1.5 text-olive">{lede}</p>}
        <div className="mt-6">{children}</div>
      </main>

      <SupportDock />
    </div>
  );
}

/** Longest match wins, so exactly one destination is selected. Two selected
 *  states is the same failure as none (§8.2). */
function activeFor(navigation: NavigationManifest, pathname: string): string | null {
  const all = [...navigation.core, ...navigation.utility];
  let best: string | null = null;
  for (const d of all) {
    if (d.href !== pathname && !pathname.startsWith(`${d.href}/`)) continue;
    if (!best || d.href.length > best.length) best = d.href;
  }
  return best;
}
