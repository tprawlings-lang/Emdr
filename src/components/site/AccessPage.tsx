import Link from "next/link";
import { Wordmark } from "@/components/Brand";

// The shared access states (§26, "Shared access states — 8 screens").
//
// These are the screens nobody designs and everybody sees: a mistyped URL, an
// expired session, a denied scope, a degraded service. Until now this product
// had one of the eight — /login — and a wrong URL fell through to Next's
// built-in error page, which is a black system-font "404" on white. It is the
// one screen in the product that looks like a different product, and it is the
// screen a reviewer is most likely to reach by accident.
//
// Three rules govern all of them, from §26's role-level acceptance:
//
//   THE DEMONSTRATION BOUNDARY REMAINS VISIBLE. Handled by the root layout's
//   banner, which is why none of these screens is allowed to be a bare page
//   outside it.
//
//   DENIED AND MISSING PAGES DO NOT REVEAL PROTECTED EXISTENCE. A 404 and a
//   403 must not let a visitor tell "no such thing" from "a thing you may not
//   see". So neither ever names what was asked for — no "no such member", no
//   echoed path — and the cross-tenant rule elsewhere in this codebase goes
//   further still, returning not-found rather than forbidden for any record.
//
//   KEYBOARD AND SCREEN-READER PATHS REACH EVERY ACTION. Ordinary links and
//   buttons, in reading order, with one primary action per screen.
//
// A fourth rule is this product's rather than the handoff's: an error state
// never takes away the way out. Crisis is a link on every one of these, not
// because a 404 is a crisis but because a person in one does not stop being in
// one because a URL was wrong.

export function AccessPage({
  title,
  children,
  primary,
  secondary,
}: {
  title: string;
  children: React.ReactNode;
  /** One primary action. §26 gives each of these screens exactly one. */
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-6 py-16">
      <Wordmark className="text-3xl" />

      <h1 className="type-identity mt-8 text-3xl font-medium text-ground">{title}</h1>

      <div className="measure mt-3 space-y-3 text-ground/90">{children}</div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={primary.href}
          className="rounded-full bg-app-ink px-7 py-3 font-medium text-app-surface transition-opacity hover:opacity-90"
        >
          {primary.label}
        </Link>
        {secondary && (
          <Link
            href={secondary.href}
            className="rounded-full border border-ground/25 px-7 py-3 font-medium text-ground transition-colors hover:bg-ground/5"
          >
            {secondary.label}
          </Link>
        )}
      </div>

      {/* The way out, on every one of these. Not because an error is a crisis
          — because a person in one does not stop being in one because a page
          was missing. */}
      <p className="mt-10 border-t border-ground/10 pt-5 text-sm text-olive">
        Need help right now?{" "}
        <Link href="/crisis" className="font-medium text-ground underline">
          Crisis support
        </Link>{" "}
        is open without signing in.
      </p>
    </main>
  );
}
