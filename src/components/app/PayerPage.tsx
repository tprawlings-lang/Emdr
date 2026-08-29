import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { PAYER_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";
import { SummaryCards } from "@/components/app/surfaces";
import { pct } from "@/components/charts/aggregate";
import { buildPayerHeader } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";
import { hasData } from "@/lib/presentation/envelope";

// The payer console shell (§26's ten payer screens, §28's frame).

export const PAYER_SCREENS: Array<{ href: string; label: string; layer: RailSlug }> = [
  { href: "/payer/population", label: "Population", layer: "overview" },
  { href: "/payer/overview", label: "Population overview", layer: "overview" },
  { href: "/payer/utilization", label: "Utilisation", layer: "overview" },
  { href: "/payer/outcomes", label: "Outcomes", layer: "progress" },
  { href: "/payer/engagement", label: "Engagement", layer: "progress" },
  { href: "/payer/access", label: "Access", layer: "actions" },
  { href: "/payer/population-access", label: "Population access", layer: "actions" },
  { href: "/payer/evidence", label: "Evidence registry", layer: "evidence" },
  { href: "/payer/contract", label: "Contract report", layer: "evidence" },
  { href: "/payer/cohorts", label: "Cohorts", layer: "evidence" },
  { href: "/payer/data-quality", label: "Data quality", layer: "audit" },
];

function LayerNav({ layer, here }: { layer: RailSlug; here?: string }) {
  const siblings = PAYER_SCREENS.filter((s) => s.layer === layer);
  if (siblings.length < 2) return null;
  return (
    <nav aria-label="Screens in this layer" className="mb-6 flex flex-wrap gap-1">
      {siblings.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          aria-current={s.href === here ? "page" : undefined}
          className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
            s.href === here ? "bg-app-accent font-medium text-app-ink" : "text-olive hover:bg-app-accent/50"
          }`}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The standing three, above every payer screen: engaged, follow-up, claims lag.
 *
 * Claims lag is on the header rather than buried on the data-quality screen
 * because it governs how every other number should be read. A utilisation rate
 * without the lag beside it is a number a reader will trust more than it
 * deserves — and it is shown against what the contract EXPECTS, since "66
 * days" means nothing on its own.
 */
async function StandingHeader() {
  const tenantId = await resolvePayerTenant();
  if (!tenantId) return null;
  const envelope = await buildPayerHeader(tenantId);
  if (!hasData(envelope)) return null;
  const h = envelope.data;
  const lagOver = h.observedLagDays !== null && h.observedLagDays > h.expectedLagDays;

  return (
    <div className="mb-6">
      <SummaryCards
        cards={[
          { label: "Engaged", value: pct(h.engaged), detail: "of eligible members, started care" },
          { label: "Follow-up", value: pct(h.followUp), detail: "of those who started care" },
          {
            label: "Claims lag",
            value: h.observedLagDays === null ? "Not enough claims" : `${h.observedLagDays} days`,
            detail: `contract expects ${h.expectedLagDays}${lagOver ? " — running late" : ""}`,
          },
        ]}
      />
      <p className="mt-2 text-xs text-olive">
        Observed from received claims · computed {h.generatedAt} · aggregate only
      </p>
    </div>
  );
}

export function PayerPage({
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
      railHref={PAYER_RAIL}
      railFooter={
        <>
          <Link href="/organization/overview" className="block hover:underline">
            Provider network
          </Link>
          <form action={logout} className="mt-2">
            <button className="hover:underline">Sign out</button>
          </form>
        </>
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
