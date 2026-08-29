import Link from "next/link";

// The application shell (Web GUI handoff, the 20 page examples).
//
// Every page example in the annex draws the same frame, and it is the frame
// rather than any individual screen that makes the product look like itself:
//
//   - an ivory page, with the app in a rounded near-white panel;
//   - a bar carrying the Steady wordmark, the role, a FABRICATED pill and an
//     avatar;
//   - a pale rail on the left: Overview, Progress, Actions, Evidence, Audit;
//   - a title, the standing line "Action first. Meaning second. Evidence
//     third.", then content.
//
// The rail is the part most likely to be mistaken for a feature menu and
// rebuilt as one. It is not. §25 defines four layers — action, meaning,
// evidence, raw record — and the rail is those layers made navigable, which is
// why it is identical for a member, a clinician, an organization and a payer.
// The roles differ in what each layer CONTAINS, not in which layers exist.
//
// The bar is light. It reads as dark at a glance because the wordmark and the
// avatar sit on it in deep green, and that is exactly the detail that gets
// rebuilt wrong from memory.

export type ShellRole = "Patient or member" | "Steady Clinical" | "Steady Intelligence" | "Steady Review";

/** §25's information layers, in the order the mockups draw them. */
export const RAIL = [
  { slug: "overview", label: "Overview" },
  { slug: "progress", label: "Progress" },
  { slug: "actions", label: "Actions" },
  { slug: "evidence", label: "Evidence" },
  { slug: "audit", label: "Audit" },
] as const;

export type RailSlug = (typeof RAIL)[number]["slug"];

export function AppShell({
  role, title, active, railHref, accountHref, railFooter, children, aside,
}: {
  role: ShellRole;
  title: string;
  /** Which information layer this screen belongs to. */
  active: RailSlug;
  /** Where each rail item points for this role. A layer with no destination
   *  for a role renders as plain text rather than a link that goes nowhere —
   *  tests/navigation.test.ts has failed the build on that since the console
   *  had no navigation at all. */
  railHref: Partial<Record<RailSlug, string>>;
  /** Where the avatar goes. The mockups draw an avatar on every screen and
   *  give it no label, which works on paper and strands a keyboard user in a
   *  product — so it is a link with a name when a role has an account surface,
   *  and a plain mark when it does not. */
  accountHref?: string;
  /** A small block under the rail. The mockups draw nothing there, and nothing
   *  belongs there by default — but a console with no account surface still has
   *  to let someone sign out, and burying that is not a design decision. */
  railFooter?: React.ReactNode;
  children: React.ReactNode;
  /** Optional right-hand column, for the record's action rail. */
  aside?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="overflow-hidden rounded-3xl border border-ground/10 bg-app-surface shadow-soft">
        {/* The bar. */}
        <div className="flex flex-wrap items-center gap-3 border-b border-ground/10 px-5 py-4 sm:px-7">
          <Link href="/" className="type-identity text-2xl font-semibold text-app-ink">
            Steady
          </Link>
          <span className="text-sm text-olive">{role}</span>

          <div className="ml-auto flex items-center gap-3">
            {/* The demonstration boundary, on every screen, in the frame
                itself rather than as a banner a page can forget. */}
            <span className="rounded-full bg-app-flag px-3 py-1 text-xs font-semibold uppercase tracking-wide text-app-ink">
              Fabricated
            </span>
            {accountHref ? (
              <Link
                href={accountHref}
                className="block h-8 w-8 shrink-0 rounded-full bg-app-ink transition-opacity hover:opacity-80"
              >
                <span className="sr-only">Profile and privacy</span>
              </Link>
            ) : (
              <span aria-hidden className="h-8 w-8 shrink-0 rounded-full bg-app-ink" />
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row">
          {/* The rail. */}
          <nav
            aria-label="Information layers"
            className="shrink-0 bg-app-rail px-3 py-5 sm:w-52 sm:px-4 sm:py-7"
          >
            <ul className="flex gap-1 overflow-x-auto sm:block sm:space-y-1 sm:overflow-visible">
              {RAIL.map((r) => {
                const href = railHref[r.slug];
                const on = r.slug === active;
                const base = "block whitespace-nowrap rounded-full px-4 py-2.5 text-sm transition-colors";
                if (!href) {
                  return (
                    <li key={r.slug}>
                      <span className={`${base} cursor-default text-olive/60`} aria-disabled>
                        {r.label}
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={r.slug}>
                    <Link
                      href={href}
                      aria-current={on ? "page" : undefined}
                      className={`${base} ${
                        on
                          ? "bg-app-surface font-medium text-app-ink shadow-sm"
                          : "text-olive hover:bg-app-surface/60"
                      }`}
                    >
                      {r.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {railFooter && (
              <div className="mt-4 border-t border-ground/10 px-4 pt-3 text-xs text-olive sm:mt-6 sm:pt-4">
                {railFooter}
              </div>
            )}
          </nav>

          {/* The content column. A <main> landmark: the frame moved the page's
              chrome out of every screen, and the landmark has to move with it
              or the product loses the one element a screen-reader user jumps
              to. It is here rather than around the whole frame because the bar
              and the rail are not the main content. */}
          <main className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8">
            <h1 className="type-identity text-2xl font-medium text-app-ink sm:text-3xl">{title}</h1>
            {/* The standing line. It appears under the title on all twenty
                examples, so it belongs to the shell rather than to any page. */}
            <p className="mt-1 text-sm text-olive">
              Action first. Meaning second. Evidence third.
            </p>

            <div className={aside ? "mt-6 grid gap-6 lg:grid-cols-[1fr_16rem]" : "mt-6"}>
              <div className="min-w-0">{children}</div>
              {aside && <aside className="min-w-0">{aside}</aside>}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
