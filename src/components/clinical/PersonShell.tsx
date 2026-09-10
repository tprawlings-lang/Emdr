import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { personRail } from "@/lib/app/rails";
import { ClinicianRailFooter } from "./ClinicianPage";
import { PriorityBadge, OwnerChip, FreshnessLabel } from "./primitives";
import type { PriorityBand } from "@/lib/clinical/caseload";
import type { ProjectionMeta } from "@/lib/presentation/envelope";

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
  /** Which build and which policy produced the facts above (§30.6 step 8). */
  meta: ProjectionMeta;
}

/**
 * The sub-routes, by the layer each belongs to.
 *
 * HANDOFF 09 §5 REGROUPED THIS, and the problem it solved was one this build
 * created. Expansion handoffs 04 and 05 added Trajectory and Load, taking the
 * Progress row to five tabs — Measures, Life goals, Sessions, Responses,
 * Trajectory — which is exactly the "long second horizontal menu that wraps
 * into several rows" §5 rules out. Every addition was right on its own and the
 * row got worse with each one.
 *
 * §5's grouping: "Person sections should group around Overview, Course,
 * Sessions, Notes, and Safety where the existing content supports it. Course
 * can contain measures, life goals, responses, and trajectory through clearly
 * named local links."
 *
 * So Course is a landing that holds those four, and the four are no longer in
 * this list. NOTHING WAS REMOVED: each still has its own address, its own
 * screen, and a link from Course with room to say what it is for. What went is
 * the wrapping row.
 */
const SCREENS: Array<{ slug: string; label: string; layer: RailSlug }> = [
  { slug: "", label: "Overview", layer: "overview" },
  // §5's Course. The four course-shaped screens are reached from here.
  { slug: "/course", label: "Course", layer: "progress" },
  { slug: "/sessions", label: "Sessions", layer: "progress" },
  { slug: "/safety", label: "Safety", layer: "actions" },
  // §5 calls this section Notes. The ROUTE keeps its name — renaming a route
  // breaks every link anybody saved — and the tab carries §5's word.
  { slug: "/thoughts", label: "Notes", layer: "actions" },
  // Load and readiness (expansion handoff 05 §8). Under actions: it is a
  // reading a clinician decides what to do with, and §8's six clinician
  // actions live on it.
  { slug: "/load", label: "Load", layer: "actions" },
  { slug: "/plan", label: "Plan", layer: "evidence" },
  { slug: "/record", label: "Full record", layer: "evidence" },
  { slug: "/audit", label: "Audit", layer: "audit" },
];

/**
 * The four screens Course holds, so the layer nav does not.
 *
 * Listed here as well as on the Course page because `layerFor` has to resolve
 * them: a clinician deep-linked to /measures is inside the Progress layer, and
 * a route the shell does not know renders with the wrong rail item selected.
 */
export const COURSE_SECTIONS = ["/measures", "/goals", "/responses", "/trajectory"] as const;

/**
 * Screens reached from Notes rather than from the rail, for the same reason
 * Course holds its four: the tab row is the thing §5 shortened, and a bridge
 * that only makes sense once items are approved belongs behind the screen where
 * they are approved.
 */
export const NOTES_SECTIONS = ["/note"] as const;

export function layerFor(slug: string): RailSlug {
  if ((COURSE_SECTIONS as readonly string[]).includes(slug)) return "progress";
  if ((NOTES_SECTIONS as readonly string[]).includes(slug)) return "actions";
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
          {/* The version the facts on this line were computed under.
              Recessive on purpose — it is for the reader who is checking a
              screenshot against the live record, not for the clinician
              reading the band. Rendered rather than kept in a payload,
              because a version nobody can see settles no argument. */}
          <span className="font-mono text-[11px] text-olive/70" title="Projection version">
            {person.meta.projectionVersion}
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
