import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { ORGANIZATION_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";
import { SummaryCards } from "@/components/app/surfaces";
import { pct } from "@/components/charts/aggregate";
import { buildOrgHeader } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";
import { hasData } from "@/lib/presentation/envelope";

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

/**
 * The standing three, above every organization screen.
 *
 * Every one of the organization page examples carries the same three numbers —
 * first contact, engaged, measure coverage — regardless of what the screen
 * below them is about. That is deliberate and it is the shell's job rather
 * than each page's: a capacity chart read without knowing the network's
 * engagement is a chart about nothing, and a header each screen opts into is a
 * header two screens will forget.
 *
 * It renders nothing at all when the projection has no data, rather than three
 * cards of dashes. §30.8's empty state belongs to the screen's own content,
 * where it can say why.
 */
async function StandingHeader() {
  const tenantId = await resolveOrgTenant();
  if (!tenantId) return null;
  const envelope = await buildOrgHeader(tenantId);
  if (!hasData(envelope)) return null;
  const h = envelope.data;

  return (
    <div className="mb-6">
      <SummaryCards
        cards={[
          {
            label: "First contact",
            value: h.firstContactDays === null ? "Not enough contacts" : `${h.firstContactDays} days`,
            // The comparison anchor §29.1 asks for, and the page examples put
            // directly under the value. A duration with nothing to compare it
            // to cannot be acted on.
            detail:
              h.firstContactDays === null || h.firstContactPrior === null
                ? "no comparable prior period"
                : `${h.firstContactPrior} days in the prior 90, ${
                    h.firstContactDays === h.firstContactPrior
                      ? "unchanged"
                      : h.firstContactDays < h.firstContactPrior
                        ? "down"
                        : "up"
                  }`,
          },
          { label: "Engaged", value: pct(h.engaged), detail: "of covered lives, started care" },
          { label: "Measure coverage", value: pct(h.measureCoverage), detail: "of people who started care" },
        ]}
      />
      {/* §29.1's range rule: the refresh time is visible on a READY screen, not
          only inside a state notice when something has gone wrong. */}
      <p className="mt-2 text-xs text-olive">
        Last 90 days against the 90 before it · computed {h.generatedAt} · aggregate only
      </p>
    </div>
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
      <StandingHeader />
      {children}
    </AppShell>
  );
}
