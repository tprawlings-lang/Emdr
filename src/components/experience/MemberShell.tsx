import Link from "next/link";
import { SupportDock } from "./SupportDock";
import { MemberNav } from "./MemberNav";
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
  title,
  lede,
  children,
}: {
  navigation: NavigationManifest;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
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

        <MemberNav core={navigation.core} />
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
