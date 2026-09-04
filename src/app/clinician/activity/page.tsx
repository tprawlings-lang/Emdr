import { requireClinician } from "@/lib/auth";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { activePolicy } from "@/lib/clinical-policy";
import { audit } from "@/lib/audit";
import {
  buildRecentActivity, ACTIVITY_KINDS, ACTIVITY_LABEL, type ActivityKind,
} from "@/lib/clinical/recent-activity";
import { commandCenterSurfaceAvailable } from "@/lib/clinical/command-center-flags";
import { RecentActivityFeed } from "@/components/clinical/RecentActivityFeed";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recent activity — Steady Clinical" };

// Recent activity (expansion handoff 03 §7; Phase 4).
//
// §7: "a clinician situational-awareness feed built from authorized events. It
// is not a raw audit log and not a firehose of every patient action." The
// filtering rules live in recent-activity.ts, where they are tested; this page
// renders what the projection produced and adds no rules of its own.
//
// THE FILTERS ARE SERVER-DEFINED. §7: "optional clinically relevant filters
// remain server-defined and explainable." So the filter set is
// `ACTIVITY_KINDS`, the same list the projection includes from — a client-side
// filter over a longer list would mean the page had already loaded events the
// projection decided not to show.

function parseKinds(v: string | string[] | undefined): ActivityKind[] | undefined {
  const raw = typeof v === "string" ? v.split(",") : undefined;
  if (!raw) return undefined;
  const kinds = raw.filter((k): k is ActivityKind => (ACTIVITY_KINDS as readonly string[]).includes(k));
  return kinds.length > 0 ? kinds : undefined;
}

export default async function RecentActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const clinician = await requireClinician();
  const params = await searchParams;
  const kinds = parseKinds(params.kind);

  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;
  const policy = activePolicy();

  if (!commandCenterSurfaceAvailable("CLINICAL_COMMAND_CENTER_ACTIVITY")) {
    return (
      <ClinicianPage layer="overview" here="/clinician/activity" title="Recent activity">
        <p className="measure mt-6 text-sm text-ground">
          The activity feed is not switched on in this environment. Nothing recorded is lost — a
          flag change makes it visible again.
        </p>
      </ClinicianPage>
    );
  }

  const activity = await buildRecentActivity({
    clinicianId: clinician.id, tenantId, policy, kinds,
  });

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "recent_activity_opened",
    detail: { people: activity.coveredPeople, items: activity.items.length, kinds: kinds ?? "all" },
  });

  return (
    <ClinicianPage
      layer="overview"
      here="/clinician/activity"
      title="Recent activity"
      lede="What has happened across your caseload, newest first. Situational awareness, not an audit log — the audit trail is its own screen."
    >
      <nav aria-label="Filter by kind" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href="/clinician/activity"
              aria-current={kinds ? undefined : "true"}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                kinds ? "border-ground/15 text-app-ink" : "border-ground/40 bg-app-accent/50 text-app-ink"
              }`}
            >
              Everything
            </Link>
          </li>
          {ACTIVITY_KINDS.map((k) => {
            const active = kinds?.length === 1 && kinds[0] === k;
            return (
              <li key={k}>
                <Link
                  href={active ? "/clinician/activity" : `/clinician/activity?kind=${k}`}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    active ? "border-ground/40 bg-app-accent/50 text-app-ink" : "border-ground/15 text-app-ink"
                  }`}
                >
                  {ACTIVITY_LABEL[k]}
                  {active && <span className="sr-only">. Filter applied. Select again to clear.</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <RecentActivityFeed activity={activity} />
    </ClinicianPage>
  );
}
