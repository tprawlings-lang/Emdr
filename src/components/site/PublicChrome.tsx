import Link from "next/link";
import {
  BOUNDARY, STATUS_LABEL, STATUS_MEANING, type Capability, type CapabilityStatus,
} from "@/lib/site/registry";

// Shared chrome and content components for the institutional site
// (Redesign handoff §5, §6).
//
// Every status label on every public page comes from the registry through
// <StatusBadge>. Nothing here accepts a free-text status string, because a
// hand-written status is how two pages come to disagree about whether a control
// is active — and a security reviewer reading both has no way to tell which is
// true.

export const NAV = [
  { href: "/platform", label: "Platform" },
  { href: "/clinical", label: "Clinical" },
  { href: "/organizations", label: "Organizations" },
  { href: "/payers", label: "Payers" },
  { href: "/trust", label: "Trust & Safety" },
  { href: "/evidence", label: "Evidence" },
  { href: "/faq", label: "FAQ" },
] as const;

export function PublicHeader() {
  return (
    <header className="border-b border-ground/10 bg-linen/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
        <Link href="/" className="font-serif text-xl font-medium text-ground">
          Steady
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-olive hover:text-ground">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/request-review"
            className="rounded-full bg-ground px-4 py-1.5 text-sm font-medium text-ivory"
          >
            Request a review
          </Link>
          <Link href="/login" className="text-sm text-olive underline">
            Review sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-ground/10 bg-linen/60">
      <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-olive">
        <p className="font-medium text-ground">{BOUNDARY.primary}</p>
        <p className="mt-2">{BOUNDARY.noEnrollment}</p>

        {/* A professional site about trauma can still receive a visitor in
            distress. The crisis route is a safety utility, kept visible and
            never styled as a product call to action (§5). */}
        <p className="mt-4 rounded-2xl border border-support/30 bg-support/5 px-4 py-3 text-ground">
          <strong>Need help now?</strong> {BOUNDARY.crisis}{" "}
          <Link href="/crisis" className="underline">Immediate help resources</Link>
        </p>

        <nav aria-label="Footer" className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/about" className="underline">Why Steady</Link>
          <Link href="/trust" className="underline">Trust &amp; Safety</Link>
          <Link href="/evidence" className="underline">Evidence</Link>
          <Link href="/faq" className="underline">Questions</Link>
          <Link href="/terms" className="underline">Demo Terms</Link>
          <Link href="/privacy" className="underline">Demo Privacy Notice</Link>
          <Link href="/request-review" className="underline">Request a review</Link>
        </nav>

        <p className="mt-6 text-xs">
          Steady Platform · development prototype · reviewed content version{" "}
          <code>site-claims-2026-08-v1</code>
        </p>
      </div>
    </footer>
  );
}

const STATUS_STYLE: Record<CapabilityStatus, string> = {
  working_demo: "bg-safe/20 text-ground border-safe/40",
  simulation: "bg-pause-soft text-ground border-pause/50",
  in_review: "bg-moss/50 text-ground border-sage/60",
  planned: "bg-linen text-olive border-ground/15",
};

/** The only way a status reaches a page. Reads from the registry entry itself,
 *  so a card cannot label itself. */
export function StatusBadge({ status }: { status: CapabilityStatus }) {
  return (
    <span
      data-testid="status-badge"
      title={STATUS_MEANING[status]}
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A capability, with its status and — where one exists — what supports it. */
export function CapabilityCard({ c }: { c: Capability }) {
  return (
    <li
      data-testid="capability-card"
      className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-ground">{c.name}</h3>
        <StatusBadge status={c.status} />
      </div>
      <p className="mt-1 text-sm text-ground/80">{c.summary}</p>
      {c.evidence && (
        <p className="mt-2 text-xs text-olive">
          Evidence: <code className="text-[11px]">{c.evidence}</code>
        </p>
      )}
    </li>
  );
}

export function AudienceCard({
  href, title, body, cta,
}: { href: string; title: string; body: string; cta: string }) {
  return (
    <li className="rounded-2xl border border-ground/10 bg-ivory px-5 py-4">
      <h3 className="font-serif text-xl font-medium text-ground">{title}</h3>
      <p className="mt-1 text-sm text-ground/80">{body}</p>
      <Link href={href} className="mt-3 inline-block text-sm font-medium text-ground underline">
        {cta} →
      </Link>
    </li>
  );
}

/** The boundary line. Present on the homepage and every audience page. */
export function BoundaryNote({ extra }: { extra?: string }) {
  return (
    <p
      data-testid="boundary-note"
      className="rounded-2xl border border-pause/50 bg-pause-soft px-5 py-4 text-sm text-ground"
    >
      <strong>{BOUNDARY.primary}</strong>
      {extra ? ` ${extra}` : ""}
    </p>
  );
}

/** The single call to action across the site. There is no purchase path. */
export function ReviewCTA({
  heading = "Request a review",
  body = "Reviewers receive a guided fabricated scenario and the matching evidence packet.",
}: { heading?: string; body?: string }) {
  return (
    <section className="mt-14 rounded-2xl border border-ground/15 bg-moss/30 px-6 py-8">
      <h2 className="font-serif text-2xl font-medium text-ground">{heading}</h2>
      <p className="mt-2 max-w-2xl text-sm text-ground/80">{body}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/request-review"
          className="rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory"
        >
          Request a review
        </Link>
        <Link
          href="/platform"
          className="rounded-full border border-ground/25 px-5 py-2 text-sm font-medium text-ground"
        >
          See how the platform works
        </Link>
      </div>
    </section>
  );
}

/** Shared page shell so every public route carries the same chrome. */
export function PublicPage({
  eyebrow, title, lede, children,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-6 py-12">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-wide text-olive">{eyebrow}</p>
        )}
        <h1 className="mt-1 font-serif text-4xl font-medium text-ground">{title}</h1>
        {lede && <p className="mt-3 max-w-2xl text-lg text-ground/80">{lede}</p>}
        {children}
      </main>
      <PublicFooter />
    </>
  );
}
