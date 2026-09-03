import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { personRail } from "@/lib/app/rails";
import { ClinicianRailFooter } from "./ClinicianPage";
import { PriorityBadge, OwnerChip, FreshnessLabel } from "./primitives";
import type { PriorityBand } from "@/lib/clinical/caseload";

// The person record shell (§26, §10.4, and the clinician mockups p59–p63).
//
// §26 gives one person address with six sub-routes. Before this, opening a
// member meant landing on whichever of three overlapping records a link
// happened to point at, each with its own header and its own back-link.
//
// The tab row this used to carry is gone. Inside a person record every one of
// §25's layers has a destination, so the record IS the rail — which is what
// p59 through p63 draw, and why the clinician mockups show all five items live
// while the console-level ones do not.
//
// The identity header stays, and stays first. §27.4 orders a person overview
// identity → what changed → why it matters, and the consent boundary is the
// line that governs what a clinician may do next, so it must not be something
// the reader scrolls past to reach the content.

export interface PersonHeader {
  id: string;
  name: string;
  band: PriorityBand;
  ownerName: string | null;
  evidenceAt: string | null;
  now: string;
  consentActive: boolean;
}

/** The sub-routes, by the layer each belongs to. Two layers hold more than one
 *  screen, so those get a sibling row under the title; the rest do not need
 *  one. */
const SCREENS: Array<{ slug: string; label: string; layer: RailSlug }> = [
  { slug: "", label: "Overview", layer: "overview" },
  { slug: "/measures", label: "Measures", layer: "progress" },
  { slug: "/sessions", label: "Sessions", layer: "progress" },
  { slug: "/safety", label: "Safety", layer: "actions" },
  // §17.1: "Place Record Thoughts in the existing action rail/header region so
  // it is available without scrolling into the formal record." Recording a
  // thought IS an action — the clinician does it, deliberately, after a
  // session — so it belongs beside the other things they do here rather than
  // under evidence, where it would read as something to consult.
  { slug: "/thoughts", label: "Thoughts", layer: "actions" },
  { slug: "/plan", label: "Plan", layer: "evidence" },
  // The full clinical record — timeline, cited summary, review actions. §26's
  // real split is /measures, /sessions, /plan, /safety and /audit; this is the
  // holding address for what has not been split out yet, and it is listed
  // rather than hidden because it is where approve and correct still live.
  { slug: "/record", label: "Full record", layer: "evidence" },
  { slug: "/audit", label: "Audit", layer: "audit" },
];

export function layerFor(slug: string): RailSlug {
  return SCREENS.find((s) => s.slug === slug)?.layer ?? "overview";
}

export function PersonShell({
  person, active, title, children,
}: {
  person: PersonHeader;
  /** The sub-route slug, "" for the overview. */
  active: string;
  /** What this screen is. Defaults to the person's name, which is what the
   *  overview wants; the sub-routes name themselves. */
  title?: string;
  children: React.ReactNode;
}) {
  const layer = layerFor(active);
  const siblings = SCREENS.filter((s) => s.layer === layer);

  return (
    <AppShell
      role="Steady Clinical"
      title={title ?? person.name}
      active={layer}
      railHref={personRail(person.id)}
      railFooter={<ClinicianRailFooter />}
    >
      <header className="mb-6 border-b border-ground/10 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/clinician/member/${person.id}`}
            className="text-lg font-medium text-app-ink hover:underline"
          >
            {person.name}
          </Link>
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

        {siblings.length > 1 && (
          <nav aria-label="Screens in this layer" className="mt-3 flex flex-wrap gap-1">
            {siblings.map((s) => {
              const on = s.slug === active;
              return (
                <Link
                  key={s.slug}
                  href={`/clinician/member/${person.id}${s.slug}`}
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
        )}
      </header>

      {children}
    </AppShell>
  );
}
