"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The member's navigation.
//
// Deliberately much quieter than the clinician console's. Vol 1 B-6 requires
// one primary task per screen and minimal reading during activation; a dense
// nav bar competes with the task and adds reading before anyone has started.
// So this is five destinations, plain words, no icons, no counts, no badges.
//
// A count on a nav item is a notification, and a notification is a demand. In
// this population, arriving at an app that opens with three demands is how a
// person decides not to come back.
//
// Crisis is NOT in here. It is a fixed-position affordance rendered on every
// screen by SosMount — §6 calls that a safety requirement rather than a layout
// preference, because it must be findable without reading. Putting it in a nav
// row would make it one option among five, findable only by reading them.

const ITEMS: Array<{ href: string; label: string }> = [
  { href: "/app/today", label: "Today" },
  { href: "/app/ground", label: "Ground" },
  { href: "/app/activities", label: "Practices" },
  { href: "/app/companion", label: "Companion" },
  { href: "/app/learn", label: "Learn" },
];

export function MemberNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      data-testid="member-nav"
      className="border-b border-ground/10 bg-linen/60"
    >
      <ul className="mx-auto flex max-w-3xl flex-wrap gap-x-1 gap-y-1 px-6 py-2">
        {ITEMS.map((i) => {
          const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block rounded-full px-4 py-1.5 transition-colors ${
                  active ? "bg-moss text-ground" : "text-olive hover:bg-moss/40"
                }`}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
