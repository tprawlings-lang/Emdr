"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Navigation for the review and administration console (§26).
//
// Split from ClinicianNav rather than shared, because the two roles ask
// different first questions. A clinician asks "who needs my attention?"; a
// reviewer asks "what decisions are open, and can the record be trusted?"
// Sharing one nav is what put audit and engine validation beside the caseload
// in the first place.
//
// §26 lists thirteen review screens. Four exist; the rest are Wave 5. Listing
// only what resolves is deliberate — tests/navigation.test.ts fails the build
// on a nav item that goes nowhere, which is the guard that made this console
// navigable at all.

const ITEMS: Array<{ href: string; label: string; hint: string }> = [
  { href: "/review/audit", label: "Audit trail", hint: "Who did what, and the hash chain" },
  { href: "/review/autonomous", label: "Autonomous flow", hint: "The engine's parallel decision" },
  { href: "/review/bls", label: "BLS oversight", hint: "Gates, rollout, live configuration" },
  { href: "/review/testing", label: "Testing console", hint: "What you can exercise, and change requests" },
];

export function ReviewNav({
  name, logout,
}: { name: string; logout: () => void | Promise<void> }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-ground/10 bg-linen">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/review" className="type-display text-lg text-ground">
          Steady Review
        </Link>

        <nav aria-label="Review" className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {ITEMS.map((i) => {
            const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
            return (
              <Link
                key={i.href}
                href={i.href}
                title={i.hint}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  active ? "bg-ground text-ivory" : "text-ground hover:bg-ground/10"
                }`}
              >
                {i.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4 text-sm">
          <Link href="/clinician/today" className="text-ground underline">Clinical console</Link>
          <span className="text-olive">{name}</span>
          <form action={logout}>
            <button type="submit" className="text-ground underline">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
