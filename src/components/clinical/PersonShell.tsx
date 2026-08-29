import Link from "next/link";
import { PriorityBadge, OwnerChip, FreshnessLabel } from "./primitives";
import type { PriorityBand } from "@/lib/clinical/caseload";

// The person record shell (Web GUI handoff §26, §10.4).
//
// §26 gives one person address with six sub-routes. Before this, opening a
// member meant landing on whichever of three overlapping records a link
// happened to point at, each with its own header and its own back-link.
//
// The sticky header carries the facts a clinician must not lose while reading
// any of the six: who, current state, owner, freshness, and the consent
// boundary — which governs what they may do next and is therefore the one that
// must never scroll away.

export interface PersonHeader {
  id: string;
  name: string;
  band: PriorityBand;
  ownerName: string | null;
  evidenceAt: string | null;
  now: string;
  consentActive: boolean;
}

const TABS: Array<{ slug: string; label: string }> = [
  { slug: "", label: "Overview" },
  { slug: "/safety", label: "Safety" },
  { slug: "/measures", label: "Measures" },
  { slug: "/sessions", label: "Sessions" },
  { slug: "/plan", label: "Plan" },
  { slug: "/audit", label: "Audit" },
  // The full clinical record — timeline, cited summary, review actions. §26's
  // real split is /measures, /sessions, /plan, /safety and /audit; this is the
  // holding address for what has not been split out yet, and it is listed
  // rather than hidden because it is where approve and correct still live.
  { slug: "/record", label: "Full record" },
];

export function PersonShell({
  person, active, children,
}: {
  person: PersonHeader;
  /** The sub-route slug, "" for the overview. */
  active: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="sticky top-0 z-10 -mx-6 border-b border-ground/10 bg-ivory/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="type-display text-2xl font-medium text-ground">{person.name}</h1>
              <PriorityBadge band={person.band} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <OwnerChip name={person.ownerName} />
              <FreshnessLabel evidenceAt={person.evidenceAt} now={person.now} />
              {/* Stated either way. A boundary shown only when present reads as
                  absent-by-omission the rest of the time. */}
              <span className={`text-xs font-medium ${person.consentActive ? "text-state-safe" : "text-state-caution"}`}>
                {person.consentActive ? "◆ Consent active" : "○ No consent on record"}
              </span>
            </div>
          </div>
        </div>

        <nav aria-label="Person record" className="mt-3 flex flex-wrap gap-1">
          {TABS.map((t) => {
            const href = `/clinician/member/${person.id}${t.slug}`;
            const on = active === t.slug;
            return (
              <Link
                key={t.slug}
                href={href}
                aria-current={on ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  on ? "bg-ground text-ivory" : "text-ground hover:bg-ground/10"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="mt-6">{children}</div>
    </main>
  );
}
