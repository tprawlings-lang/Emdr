import Link from "next/link";
import { DemoClockBadge } from "@/components/app/DemoClockBadge";
import { logout } from "@/lib/actions";
import type { NavigationManifest } from "@/lib/experience/navigation";

// The experience shell (handoff 09 §3, §8.2; Package 2).
//
// §3's geometry: "Use a full-height application canvas. On large screens, start
// with a sidebar near 232 pixels and a main region that expands with the task."
// §8.2's selected state: "icon, text, filled background, a left marker on
// desktop, and aria-current. Hover alone never communicates location."
//
// WHAT MAKES THIS DIFFERENT FROM AppShell IS NOT THE GEOMETRY. AppShell renders
// §25's five information layers, identical for every role, and a screen tells
// it which layer it belongs to. This renders a NavigationManifest — a list of
// destinations with capability state already applied — so the shell cannot
// promote something that does not work, and does not need to be told which
// slot a screen occupies.
//
// THE SIDEBAR DOES NOT CHANGE MEANING WHEN A RECORD OPENS. §1.5: "Never swap
// the entire meaning of the sidebar when a patient record opens — use a local
// navigation region plus a labeled return control." So `core` renders in the
// same place with the same items whether or not a person is open, and `local`
// appears BELOW it with the return control at its head. A reader who opens
// somebody has not lost the console.
//
// AND THE ABSENT CAPABILITIES ARE NOT DRAWN. §1.1: they are omitted entirely,
// and named on /review/status instead. There is deliberately no greyed-out
// item and no padlock: a disabled nav item is a promise with a lock on it,
// which is worse than no promise at all.

export function ExperienceShell({
  role,
  navigation,
  pathname,
  title,
  lede,
  children,
  aside,
}: {
  /** The workspace name, for the bar. */
  role: string;
  navigation: NavigationManifest;
  /** The current route, for the selected state. Passed rather than read, so
   *  the shell is a server component and the active item is decided once. */
  pathname: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  // Computed here rather than per item, so exactly one destination can be
  // active. Two selected states is the same failure as none (§8.2).
  const activeHref = activeFor(navigation, pathname);

  return (
    <div className="min-h-dvh bg-ivory">
      <div className="mx-auto max-w-[92rem] px-3 py-3 sm:px-6 sm:py-6">
        <div className="overflow-hidden rounded-3xl bg-app-surface shadow-sm ring-1 ring-ground/5">
          {/* The bar. Light, with the wordmark and avatar in deep green — the
              detail §3 warns gets rebuilt as a dark bar from memory. */}
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ground/10 px-4 py-3 sm:px-6">
            <div className="flex items-baseline gap-2.5">
              <Link href="/" className="type-display text-xl font-semibold text-ground">
                Steady
              </Link>
              <span className="text-sm text-olive">{role}</span>
            </div>
            <div className="flex items-center gap-3">
              <DemoClockBadge />
              <span
                className="rounded-full bg-app-accent px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-app-ink"
                title="Every person and record in this environment is invented."
              >
                Fabricated
              </span>
            </div>
          </header>

          <div className="flex flex-col lg:flex-row">
            {/* §3: "a sidebar near 232 pixels". A design token to validate
                against real content, not a constant to defend. */}
            <nav
              aria-label={`${role} navigation`}
              className="shrink-0 border-b border-ground/10 bg-linen px-3 py-4 lg:w-[232px] lg:border-b-0 lg:border-r"
            >
              <ul className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
                {navigation.core.map((d) => (
                  <li key={d.href}>
                    <NavItem href={d.href} label={d.label} active={d.href === activeHref} />
                  </li>
                ))}
              </ul>

              {/* The local region. Below the global row, never replacing it. */}
              {navigation.local && (
                <div className="mt-5 border-t border-ground/10 pt-4">
                  <Link
                    href={navigation.local.returnTo.href}
                    className="block px-3 text-xs text-olive underline-offset-2 hover:underline"
                  >
                    &larr; {navigation.local.returnTo.label}
                  </Link>
                  <p className="mt-3 px-3 text-xs font-semibold uppercase tracking-wide text-olive">
                    {navigation.local.label}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {navigation.local.items.map((d) => (
                      <li key={d.href}>
                        <NavItem href={d.href} label={d.label} active={d.href === activeHref} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 border-t border-ground/10 pt-4 lg:mt-6">
                <ul className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
                  {navigation.utility.map((d) => (
                    <li key={d.href}>
                      <NavItem href={d.href} label={d.label} active={d.href === activeHref} />
                    </li>
                  ))}
                </ul>
                <div className="mt-3 space-y-1.5 px-3 text-xs text-olive">
                  <Link href="/review/status" className="block hover:underline">
                    What works and what does not
                  </Link>
                  <form action={logout}>
                    <button className="hover:underline">Sign out</button>
                  </form>
                </div>
              </div>
            </nav>

            <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
              <h1 className="type-display text-2xl font-medium text-ground sm:text-3xl">{title}</h1>
              {lede && <p className="measure mt-1.5 text-olive">{lede}</p>}
              <div className="mt-6">{children}</div>
            </main>

            {aside && (
              <aside className="shrink-0 border-t border-ground/10 px-4 py-6 lg:w-[22rem] lg:border-l lg:border-t-0 lg:px-6">
                {aside}
              </aside>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** §8.2's selected state: text, a filled background, a left marker on desktop,
 *  and aria-current. Four signals, because hover alone communicates nothing to
 *  a keyboard user and colour alone communicates nothing at all (§8.1). */
function NavItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative block rounded-xl px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-app-accent font-medium text-app-ink lg:before:absolute lg:before:inset-y-1.5 lg:before:-left-3 lg:before:w-[3px] lg:before:rounded-full lg:before:bg-ground"
          : "text-olive hover:bg-app-accent/40 hover:text-app-ink"
      }`}
    >
      {label}
    </Link>
  );
}

/** Longest match wins, so exactly one item is active. Duplicated from the
 *  manifest's own `activeDestination` in effect but not in code — this walks the
 *  rendered lists, which is the set that actually has a selected state to give. */
function activeFor(navigation: NavigationManifest, pathname: string): string | null {
  const all = [...navigation.core, ...(navigation.local?.items ?? []), ...navigation.utility];
  let best: string | null = null;
  for (const d of all) {
    if (d.href !== pathname && !pathname.startsWith(`${d.href}/`)) continue;
    if (!best || d.href.length > best.length) best = d.href;
  }
  return best;
}
