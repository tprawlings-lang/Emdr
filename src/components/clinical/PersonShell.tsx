import Link from "next/link";
import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { ExperienceShell } from "@/components/experience/ExperienceShell";
import { personRail } from "@/lib/app/rails";
import { requireClinician } from "@/lib/auth";
import { experienceContextFor } from "@/lib/experience/context";
import { navigationFor, sectionFor } from "@/lib/experience/navigation";
import { clinicianShellEnabled } from "@/lib/experience/flags";
import { ClinicianRailFooter } from "./ClinicianPage";
import { PriorityBadge, OwnerChip, FreshnessLabel } from "./primitives";
import type { PriorityBand } from "@/lib/clinical/caseload";
import type { ProjectionMeta } from "@/lib/presentation/envelope";

// The person record shell.
//
// WHAT THE 17 SEPTEMBER AMENDMENT CHANGES HERE, and why it is a defect fix
// rather than a preference:
//
//   "Observed and source confirmed. Patient pages replace global navigation
//    with abstract information layers. Keep global clinician navigation stable
//    and add patient-local navigation."                              (UX 002)
//
// That was literally what this file did. It rendered AppShell with
// `personRail(id)`, so opening somebody REPLACED the console's five rail
// destinations with five person-scoped ones under the same five abstract
// labels — Overview, Progress, Actions, Evidence, Audit. A clinician who
// opened a record lost Command Center, Patients, Reports and Handoffs from the
// screen, and the words that replaced them named information layers rather
// than anything a clinician was trying to do.
//
// It was also, by then, the OLDER of two shells in one product. Command Center
// has rendered ExperienceShell — stable global navigation, a local region
// below it, a labeled return control — since Package 2, so the jump from the
// queue into a person changed sidebars mid-task.
//
// So this renders ExperienceShell too, and the manifest supplies both rows.
// Nothing about the person record's ADDRESSES changed: all sixteen screens
// keep their routes, and the sixteen pages that call this component did not
// change either, which is the reason the props are the same as before.
//
// THE OLD SHELL IS STILL HERE, under the flag that has gated this work since
// §10.1 ("keep new work behind role-level flags and prove the current
// experience is unchanged with each flag off"). With EMDR_EXPERIENCE_CLINICIAN
// _SHELL=0 the record renders exactly as it did.

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

/** The screens reached by name rather than from the local navigation. */
const CONTEXTUAL: Array<{ slug: string; label: string }> = [
  { slug: "/load", label: "Load and readiness" },
  { slug: "/record", label: "Full record" },
  { slug: "/audit", label: "Audit" },
];

// ---------------------------------------------------------------------------
// The layer shell, kept for the flag-off path
// ---------------------------------------------------------------------------

const SCREENS: Array<{ slug: string; label: string; layer: RailSlug }> = [
  { slug: "", label: "Overview", layer: "overview" },
  { slug: "/course", label: "Course", layer: "progress" },
  { slug: "/sessions", label: "Sessions", layer: "progress" },
  { slug: "/safety", label: "Safety", layer: "actions" },
  { slug: "/thoughts", label: "Notes", layer: "actions" },
  { slug: "/load", label: "Load", layer: "actions" },
  { slug: "/plan", label: "Plan", layer: "evidence" },
  { slug: "/record", label: "Full record", layer: "evidence" },
  { slug: "/audit", label: "Audit", layer: "audit" },
];

export const COURSE_SECTIONS = ["/measures", "/goals", "/responses", "/trajectory"] as const;
export const NOTES_SECTIONS = ["/note", "/notes"] as const;

export function layerFor(slug: string): RailSlug {
  if ((COURSE_SECTIONS as readonly string[]).includes(slug)) return "progress";
  if ((NOTES_SECTIONS as readonly string[]).includes(slug)) return "actions";
  return SCREENS.find((s) => s.slug === slug)?.layer ?? "overview";
}

// ---------------------------------------------------------------------------

export async function PersonShell({
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
  if (!clinicianShellEnabled()) {
    return <LayerShell person={person} active={active} title={title}>{children}</LayerShell>;
  }

  // The context comes from the session, not from a prop. Every one of the
  // sixteen callers has already called requireClinician() before it reaches
  // here — this reads the same verified token again rather than adding a
  // parameter to sixteen call sites, and `experienceContextFor` takes a
  // SessionUser precisely so there is no other way in.
  const clinician = await requireClinician();
  const navigation = navigationFor(experienceContextFor(clinician), { personId: person.id });

  const base = `/clinician/member/${person.id}`;
  // The section's address rather than the screen's, so a reader on /measures
  // lights Course. A screen no section owns passes its own address, which no
  // destination matches — nothing is selected, and the contextual row says
  // where they are instead.
  const section = sectionFor(active);
  const pathname = section === null ? `${base}${active}` : `${base}${section}`;

  const onContextual = CONTEXTUAL.find((c) => c.slug === active);

  return (
    <ExperienceShell
      role="Steady Clinical"
      navigation={navigation}
      pathname={pathname}
      title={title ?? person.name}
    >
      {/* The identity header. The amendment asks for "a patient header with
          identity, current restriction, owner, evidence freshness, and a
          labeled return control" — the return control is the manifest's, in
          the sidebar, so this carries the other four.

          THE NAME IS NOT REPEATED AS A SECOND HEADING. "Do not repeat the
          patient name as competing headings": on a sub-route the h1 is the
          screen and the name is a link back to the overview; on the overview
          the h1 IS the name, so this strip does not print it again. */}
      <div className="-mt-2 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ground/10 pb-4">
        {title && (
          <Link href={base} className="font-medium text-app-ink hover:underline">
            {person.name}
          </Link>
        )}
        <PriorityBadge band={person.band} />
        <OwnerChip name={person.ownerName} />
        <FreshnessLabel evidenceAt={person.evidenceAt} now={person.now} />
        {/* Stated either way. A boundary shown only when present reads as
            absent-by-omission the rest of the time. */}
        <span className={`text-xs font-medium ${person.consentActive ? "text-state-safe" : "text-state-caution"}`}>
          {person.consentActive ? "◆ Consent active" : "○ No consent on record"}
        </span>
        <span className="font-mono text-[11px] text-olive/70" title="Projection version">
          {person.meta.projectionVersion}
        </span>
      </div>

      {children}

      {/* The named contextual links, at the foot of the record rather than in
          the local navigation. Below the content because they are where a
          reader goes NEXT, after the screen they came for. */}
      <nav
        aria-label="Elsewhere in this record"
        className="mt-10 flex flex-wrap gap-x-4 gap-y-1 border-t border-ground/10 pt-4 text-sm"
      >
        {CONTEXTUAL.map((c) => {
          const here = c.slug === active;
          return (
            <Link
              key={c.slug}
              href={`${base}${c.slug}`}
              aria-current={here ? "page" : undefined}
              className={here ? "font-medium text-app-ink" : "text-olive hover:underline"}
            >
              {c.label}
            </Link>
          );
        })}
        {onContextual && (
          <span className="text-xs text-olive/80">
            Reached by name: {onContextual.label} is not one of the record&rsquo;s six sections.
          </span>
        )}
      </nav>
    </ExperienceShell>
  );
}

/** The pre-amendment shell, rendered when the clinician-shell flag is off. */
function LayerShell({
  person, active, title, children,
}: {
  person: PersonHeader;
  active: string;
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
          <span className={`text-xs font-medium ${person.consentActive ? "text-state-safe" : "text-state-caution"}`}>
            {person.consentActive ? "◆ Consent active" : "○ No consent on record"}
          </span>
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
