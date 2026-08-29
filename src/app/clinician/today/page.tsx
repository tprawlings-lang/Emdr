import { requireClinician } from "@/lib/auth";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { data } from "@/lib/data";
import { activePolicy } from "@/lib/clinical-policy";
import { clinicianQueueProjection, inGroup, GROUP_LABEL, type WorkGroup } from "@/lib/clinical/work-queue";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { WorkQueueRow } from "@/components/clinical/WorkQueueRow";
import { relativeAge } from "@/components/clinical/primitives";

// The clinician work queue (GUI and Decision-Surface Handoff §10.3).
//
// This replaces opening on two stacked lists — alerts, then caseload — that a
// clinician had to reconcile by hand, because the same person appears in both
// for the same underlying reason. §6 names the clinician's first question as
// "Who needs my attention and why?", and §4.2's lesson from Blueprint is that a
// clinician home should open on work rather than on charts.
//
// Everything here is decided on the server. The page maps a projection to rows
// and does not sort, filter, or re-band anything: §20.1, "no client component
// recalculates safety or priority."

export const metadata = { title: "Work queue — Steady Clinical" };

// The order the groups are worked, which is not the order they were defined.
const GROUP_ORDER: WorkGroup[] = [
  "needs_action", "review_today", "waiting_member", "waiting_staff", "recently_resolved",
];

export default async function WorkQueuePage() {
  const clinician = await requireClinician();
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string }
    | undefined;
  const tenantId = me?.tenant_id ?? "";
  const policy = activePolicy();
  // Wave 1's clinician vertical slice. The envelope is what separates "your
  // day is clear" from "this failed to load" — which a page mapping over an
  // items array cannot do, and which is the difference between good news and a
  // clinician working blind.
  const envelope = await clinicianQueueProjection({
    clinicianId: clinician.id, tenantId, policy,
    correlationId: `queue-${clinician.id.slice(0, 8)}`,
  });

  return (
    <ClinicianPage layer="overview" here="/clinician/today" title="Work queue">

      <div className="mt-6">
        <EnvelopeView envelope={envelope} title="Work queue">
          {(queue) => {
            const needsAction = queue.groupCounts.needs_action;
            const dueToday = needsAction + queue.groupCounts.review_today;
            return (
              <>
                {/* §6.1's shared grammar: state, change, owner, freshness. The
                    computed time comes from the projection, never the browser
                    clock (§8.1). */}
                <p className="text-sm text-olive">
                  {needsAction} {needsAction === 1 ? "needs" : "need"} action · {dueToday} due today ·
                  Updated {relativeAge(queue.computedAt, queue.computedAt)} · Policy {queue.policyVersion}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {GROUP_ORDER.filter((g) => g !== "recently_resolved").map((g) => (
                    <div key={g} className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-olive">{GROUP_LABEL[g]}</p>
                      <p className="mt-1 text-2xl font-semibold text-ground">{queue.groupCounts[g]}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 space-y-8">
                  {GROUP_ORDER.map((g) => {
                    const items = inGroup(queue, g);
                    if (items.length === 0) return null;
                    return (
                      <section key={g} aria-labelledby={`group-${g}`}>
                        <h2 id={`group-${g}`} className="type-display text-xl font-medium text-ground">
                          {GROUP_LABEL[g]}{" "}
                          <span className="text-base font-normal text-olive">({items.length})</span>
                        </h2>
                        <ul className="mt-3 overflow-hidden rounded-3xl border border-ground/10 bg-linen">
                          {items.map((i) => (
                            <WorkQueueRow key={i.id} item={i} now={queue.computedAt} />
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </>
            );
          }}
        </EnvelopeView>
      </div>

      <p className="mt-10 text-xs text-olive">
        Queue order is deterministic for a given policy version and evidence set. Duplicate
        events for one person and reason collapse into a single item with its event count.
      </p>
    </ClinicianPage>
  );
}
