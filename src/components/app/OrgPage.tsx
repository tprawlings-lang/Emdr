import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { ORGANIZATION_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";
import { SummaryCards } from "@/components/app/surfaces";
import { pct } from "@/components/charts/aggregate";
import { buildOrgHeader } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";
import { hasData } from "@/lib/presentation/envelope";
import { ScopeStrip } from "@/components/aggregate/ScopeStrip";
import {
  defaultScope, scopeForRequest, currentPath, periodHref, periodDaysOf, PERIOD_OPTIONS,
} from "@/lib/intelligence/aggregate-scope";
import { headers } from "next/headers";

// The organization console shell (§26's nine-screen atlas, §28's frame).
//
// Same frame as every other role, and the same rule about the rail: five
// information layers, not a menu. §26 gives the organization nine screens, so
// the screens within a layer are listed under the title — the arrangement the
// clinician console already uses.

export const ORG_SCREENS: Array<{ href: string; label: string; layer: RailSlug }> = [
  { href: "/organization/population", label: "Population", layer: "overview" },
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
  // The window the reader chose, so the header and the strip above it cannot
  // state different periods for the same two figures.
  const scope = await scopeForRequest(tenantId);
  const envelope = await buildOrgHeader(tenantId, periodDaysOf(scope));
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
      {/* WHAT THE WINDOW GOVERNS, said precisely. The first-contact pair is
          the only windowed figure this console computes; engaged and measure
          coverage are all-time counts. A footnote that implied the period
          governed all three would be the strip over-claiming one line down. */}
      <p className="mt-2 text-xs text-olive">
        First contact covers the last {h.windowDays} days against the {h.windowDays} before it.
        Engaged and measure coverage are counted over the whole record. Computed{" "}
        {h.generatedAt} · aggregate only
      </p>
    </div>
  );
}

/**
 * The scope strip, above everything (handoff 09 §6, Package 5).
 *
 * §6: "Scope before charts… Organization, period, and data freshness travel
 * together in a scope strip, carried into every drilldown."
 *
 * IN THE SHELL, FOR THE SAME REASON THE STANDING HEADER IS. "Carried into
 * every drilldown" is not a thing ten pages remember to do; it is a thing the
 * frame does, or it is a thing two screens forget. Every organization route
 * renders through OrgPage, so putting it here makes the carrying structural.
 *
 * ABOVE the standing header, because §6 opens with "scope before charts" and
 * those three cards are charts. A reader who takes in a number before they
 * know what it is scoped to has already formed an impression, and a strip
 * below then reads as a caveat rather than as the frame.
 */
async function Scope() {
  const tenantId = await resolveOrgTenant();
  if (!tenantId) return null;
  const [current, base, path, h] = await Promise.all([
    // From the request, not from a page prop — see the note in src/proxy.ts.
    scopeForRequest(tenantId),
    defaultScope({ tenantId }),
    currentPath(),
    headers(),
  ]);
  const search = h.get("x-search") ?? "";
  const periods = PERIOD_OPTIONS.map((o) => ({
    label: o.label,
    days: o.days,
    href: periodHref(path, search, o.days),
    selected: current.period.label === o.label,
  }));
  // The reset goes to the UNPARAMETERISED route, which is the default by
  // construction rather than by a second encoding of it.
  return (
    <ScopeStrip
      scope={current}
      defaultScope={base}
      resetHref="/organization/overview"
      periods={periods}
      governs="Applies to first contact. Other figures count the whole record."
    />
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
      <Scope />
      <StandingHeader />
      {children}
    </AppShell>
  );
}
