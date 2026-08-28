"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The clinician console's navigation.
//
// A client component only because it needs the current path to say where you
// are — which is the whole point. Knowing what exists is half of navigation;
// knowing which one you are looking at is the other half, and every console
// page previously left that to the browser's title bar.
//
// Ordered by how often a clinician needs them, not by how the code is
// organised. Today is the entry point; the caseload is the wider scan behind
// it; the directory finds anyone.
//
// The oversight surfaces are no longer here. Web GUI handoff §26 gives audit,
// engine validation, BLS oversight and the testing console their own review
// role at /review/*, because listing them beside daily clinical work made this
// nav longer and the clinician's actual job harder to find. One link out is
// enough; the reviewer's own nav takes over from there.

const ITEMS: Array<{ href: string; label: string; hint: string }> = [
  { href: "/clinician/today", label: "Today", hint: "Everything waiting on you, in one order" },
  { href: "/clinician/caseload", label: "Caseload", hint: "Scan change, owner and freshness" },
  { href: "/clinician/patients", label: "Patients", hint: "Find anyone, alphabetically" },
  { href: "/review/audit", label: "Review console", hint: "Audit, engine validation, BLS oversight, testing" },
];

export function ClinicianNav({
  name, logout,
}: { name: string; logout: () => void | Promise<void> }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-ground/10 bg-linen">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/clinician" className="type-display text-lg text-ground">
          Steady Clinical
        </Link>

        <nav aria-label="Clinician" className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {ITEMS.map((i) => {
            // A nested route counts as being "on" its section — a member record
            // is still the caseload, and an alert trail is still the audit
            // trail. Otherwise the indicator goes blank exactly when someone is
            // deepest in and most needs to know where they are.
            const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
            return (
              <Link
                key={i.href}
                href={i.href}
                title={i.hint}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-ground text-ivory"
                    : "text-ground hover:bg-moss/50"
                }`}
              >
                {i.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4 text-sm text-olive">
          <span className="hidden sm:inline">{name}</span>
          <form action={logout}>
            <button className="underline">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
