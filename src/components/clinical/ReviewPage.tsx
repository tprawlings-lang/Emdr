import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { REVIEW_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";

// The review console shell (§26, "Review and administration"; the frame from
// §28, drawn at p70 and p71).
//
// The four consoles each opened with their own header at their own width — one
// at max-w-4xl, three at max-w-5xl, each with a different subtitle convention
// and one with a stray top margin. Individually invisible; together it is why
// moving between them felt like moving between four tools. They then all moved
// to one shell of their own, which was better and still not the frame the
// handoff draws. Now they share the product's.
//
// §26 lists thirteen review screens. Six exist. The layer nav lists what
// resolves, because a nav item that goes nowhere reads as a missing feature
// rather than a missing link.

export const REVIEW_SCREENS: Array<{ href: string; label: string; layer: RailSlug }> = [
  { href: "/review", label: "Review home", layer: "overview" },
  { href: "/review/testing", label: "Testing console", layer: "actions" },
  { href: "/review/safety", label: "Safety rule results", layer: "evidence" },
  { href: "/review/planning", label: "Planning signals", layer: "evidence" },
  { href: "/review/bls", label: "BLS oversight", layer: "evidence" },
  { href: "/review/autonomous", label: "Autonomous flow", layer: "evidence" },
  { href: "/review/status", label: "Service status", layer: "evidence" },
  { href: "/review/audit", label: "Audit trail", layer: "audit" },
  { href: "/review/lineage", label: "Lineage trace", layer: "audit" },
];

function LayerNav({ layer, here }: { layer: RailSlug; here?: string }) {
  const siblings = REVIEW_SCREENS.filter((s) => s.layer === layer);
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
              on ? "bg-app-accent font-medium text-app-ink" : "text-olive hover:bg-app-accent/50"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ReviewPage({
  title, lede, layer = "overview", here, children,
}: {
  title: string;
  lede?: string;
  layer?: RailSlug;
  /** This screen's own route, so the layer nav can mark it. */
  here?: string;
  children: React.ReactNode;
}) {
  return (
    <AppShell
      role="Steady Review"
      title={title}
      active={layer}
      railHref={REVIEW_RAIL}
      railFooter={
        <>
          <Link href="/clinician/today" className="block hover:underline">
            Clinical console
          </Link>
          <form action={logout} className="mt-2">
            <button className="hover:underline">Sign out</button>
          </form>
        </>
      }
    >
      <LayerNav layer={layer} here={here} />
      {lede && <p className="measure -mt-2 mb-6 text-olive">{lede}</p>}
      {children}
    </AppShell>
  );
}
