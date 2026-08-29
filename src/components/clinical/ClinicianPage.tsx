import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { CLINICIAN_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";

// The clinician console shell (§28's frame, §26's fourteen screens).
//
// The rail is five items and stays five items — it is §25's information
// layers, not a menu, and the mockups are unambiguous about that. But §26
// gives the clinician fourteen screens, and five links cannot reach fourteen
// destinations without stranding nine of them behind a URL.
//
// So the layer is the rail, and the screens WITHIN a layer are listed under
// the title of that layer's screens. That keeps the frame literal and keeps
// the console navigable, which the previous seven-item nav bar did by making
// audit and referrals look like peers of the daily queue — the exact flattening
// §26 separates the review role to undo.

/** Which layer each console screen belongs to, and what it is called. */
export const CONSOLE_SCREENS: Array<{
  href: string;
  label: string;
  layer: RailSlug;
}> = [
  { href: "/clinician/today", label: "Work queue", layer: "overview" },
  { href: "/clinician/caseload", label: "Caseload", layer: "progress" },
  { href: "/clinician/patients", label: "Patients", layer: "progress" },
  { href: "/clinician/handoffs", label: "Handoffs", layer: "actions" },
  { href: "/clinician/messages", label: "Messages", layer: "actions" },
  { href: "/clinician/referrals", label: "Referrals", layer: "actions" },
  { href: "/clinician/schedule", label: "Schedule", layer: "actions" },
  { href: "/clinician/reports", label: "Reports", layer: "evidence" },
];

function LayerNav({ layer, here }: { layer: RailSlug; here?: string }) {
  const siblings = CONSOLE_SCREENS.filter((s) => s.layer === layer);
  if (siblings.length < 2) return null;
  return (
    <nav aria-label="Screens in this layer" className="mb-6 flex flex-wrap gap-1">
      {siblings.map((s) => {
        const on = s.href === here;
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              on
                ? "bg-app-accent font-medium text-app-ink"
                : "text-olive hover:bg-app-accent/50"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The review console is one link out rather than eight items in the rail. §26
 *  gives review its own role precisely so audit, engine validation, BLS
 *  oversight and the testing console stop reading as peers of daily clinical
 *  work — but a clinician still has to be able to get there, and to leave. */
export function ClinicianRailFooter() {
  return (
    <>
      <Link href="/review/audit" className="block hover:underline">
        Review console
      </Link>
      <form action={logout} className="mt-2">
        <button className="hover:underline">Sign out</button>
      </form>
    </>
  );
}

export function ClinicianPage({
  title,
  lede,
  layer,
  here,
  children,
  aside,
}: {
  title: string;
  lede?: string;
  layer: RailSlug;
  /** This screen's own route, so the layer nav can mark it. */
  here?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  // The review console is one link out rather than eight items in the rail.
  // §26 gives review its own role precisely so audit, engine validation, BLS
  // oversight and the testing console stop reading as peers of daily clinical
  // work — but a clinician still has to be able to get there.
  return (
    <AppShell
      role="Steady Clinical"
      title={title}
      active={layer}
      railHref={CLINICIAN_RAIL}
      railFooter={<ClinicianRailFooter />}
      aside={aside}
    >
      <LayerNav layer={layer} here={here} />
      {lede && <p className="measure -mt-2 mb-6 text-olive">{lede}</p>}
      {children}
    </AppShell>
  );
}
