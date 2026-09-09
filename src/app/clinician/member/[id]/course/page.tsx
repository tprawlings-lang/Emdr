import { notFound } from "next/navigation";
import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel } from "@/components/app/surfaces";

export const dynamic = "force-dynamic";
export const metadata = { title: "Course — Steady Clinical" };

// The person's course (handoff 09 §5, Package 2).
//
// §5's grouping instruction and the reason for it:
//
//   "Person sections should group around Overview, Course, Sessions, Notes,
//    and Safety where the existing content supports it. Course can contain
//    measures, life goals, responses, and trajectory through clearly named
//    local links. Avoid a long second horizontal menu that wraps into several
//    rows."
//
// THE PROBLEM THIS SOLVES IS ONE I MADE. Building expansion handoffs 04 and 05
// added Trajectory and Load to the person record, taking the Progress row to
// five tabs — Measures, Life goals, Sessions, Responses, Trajectory — which is
// exactly the wrapping second menu §5 rules out. Each addition was right on its
// own and the row got worse with every one.
//
// SO THIS IS A LANDING RATHER THAN A SIXTH TAB. It holds the four
// course-shaped screens as named links with a line each saying what the reader
// will find, and the tab row collapses to §5's five. Nothing was removed: every
// screen is still there, still at its own address, still linked — from one
// place that has room to say what they are for.
//
// AND THE ORDER IS THE READING ORDER. Measures first because a clinician
// arriving at "how is this person doing" starts with the instruments; goals
// second because §9 of handoff 01 puts what somebody can do again beside what
// their scores say; responses third because it explains what has followed the
// work; trajectory last because it is the layer above the other three.

const SECTIONS: Array<{ slug: string; label: string; note: string }> = [
  {
    slug: "/measures",
    label: "Measures",
    note: "The scored instruments over time, each on its own validated scale.",
  },
  {
    slug: "/goals",
    label: "Life goals",
    note: "What this person is trying to get back to, and whether it is moving.",
  },
  {
    slug: "/responses",
    label: "Observed responses",
    note: "What they have been exposed to and what was observed after it, window by window.",
  },
  {
    slug: "/trajectory",
    label: "Recovery trajectory",
    note: "Whether the course has changed, domain by domain, against their own earlier windows.",
  },
];

export default async function MemberCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const c = await data();

  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!header) notFound();

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "person_course_opened", target: id,
    detail: { sections: SECTIONS.length },
  });

  return (
    <PersonShell person={header} active="/course" title="Course">
      <Panel
        title="How this person is doing, in four readings"
        footnote="Each of these is read on its own terms. Nothing here combines them into a single figure, and none of them is a grade."
      >
        <p className="measure text-sm text-ground">
          Four screens answer four different questions about the same person. They are separate
          because the answers can disagree — somebody can be sleeping better and going out less —
          and a page that reconciled them would have to pick a winner.
        </p>
        <ul className="mt-4 space-y-2">
          {SECTIONS.map((s) => (
            <li
              key={s.slug}
              data-testid="course-section"
              className="rounded-2xl border border-ground/10 px-4 py-3"
            >
              <Link
                href={`/clinician/member/${id}${s.slug}`}
                className="font-medium text-ground underline-offset-2 hover:underline"
              >
                {s.label}
              </Link>
              <p className="measure mt-0.5 text-sm text-olive">{s.note}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Read alongside" className="mt-6">
        <ul className="space-y-1 text-sm">
          <li>
            <Link href={`/clinician/member/${id}/load`} className="underline">
              Load and readiness
            </Link>{" "}
            <span className="text-olive">
              — how much the work appears to be costing, and what they recover from it with.
            </span>
          </li>
          <li>
            <Link href={`/clinician/member/${id}/record`} className="underline">
              The full longitudinal record
            </Link>{" "}
            <span className="text-olive">— every reading above, plotted on a shared time axis.</span>
          </li>
        </ul>
      </Panel>
    </PersonShell>
  );
}
