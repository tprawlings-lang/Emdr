import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { ORGANIZATION_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";

// The organization console shell (§26's nine-screen atlas, §28's frame).
//
// Same frame as every other role, and the same rule about the rail: five
// information layers, not a menu. §26 gives the organization nine screens, so
// the screens within a layer are listed under the title — the arrangement the
// clinician console already uses.

export const ORG_SCREENS: Array<{ href: string; label: string; layer: RailSlug }> = [
  { href: "/organization/overview", label: "Operating overview", layer: "overview" },
  { href: "/organization/safety", label: "Safety operations", layer: "overview" },
  { href: "/organization/outcomes", label: "Outcomes", layer: "progress" },
  { href: "/organization/care-delivery", label: "Care delivery", layer: "progress" },
  { href: "/organization/access", label: "Access pipeline", layer: "actions" },
  { href: "/organization/capacity", label: "Capacity", layer: "actions" },
  { href: "/organization/locations", label: "Locations", layer: "actions" },
  { href: "/organization/teams", label: "Teams", layer: "actions" },
  { href: "/organization/reports", label: "Reports", layer: "evidence" },
];

function LayerNav({ layer, here }: { layer: RailSlug; here?: string }) {
  const siblings = ORG_SCREENS.filter((s) => s.layer === layer);
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

export function OrgPage({
  title, lede, layer, here, children, aside,
}: {
  title: string;
  lede?: string;
  layer: RailSlug;
  here?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <AppShell
      role="Steady Intelligence"
      title={title}
      active={layer}
      railHref={ORGANIZATION_RAIL}
      railFooter={
        <form action={logout}>
          <button className="hover:underline">Sign out</button>
        </form>
      }
      aside={aside}
    >
      <LayerNav layer={layer} here={here} />
      {lede && <p className="measure -mt-2 mb-6 text-olive">{lede}</p>}
      {children}
    </AppShell>
  );
}
