import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { activePolicy } from "@/lib/clinical-policy";
import { buildWorkQueue, inGroup, GROUP_LABEL, type WorkGroup } from "@/lib/clinical/work-queue";
import { WorkQueueRow } from "@/components/clinical/WorkQueueRow";
import { EmptyState, relativeAge } from "@/components/clinical/primitives";

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
  const queue = await buildWorkQueue({ clinicianId: clinician.id, tenantId, policy });

  const needsAction = queue.groupCounts.needs_action;
  const dueToday = needsAction + queue.groupCounts.review_today;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header>
        <h1 className="type-display text-3xl font-medium text-ground">Work queue</h1>
        {/* §6.1's shared grammar, in the summary line: state, change, owner,
            freshness. The computed time comes from the projection, never from
            the browser's clock (§8.1). */}
        <p className="mt-1.5 text-sm text-olive">
          {needsAction} {needsAction === 1 ? "needs" : "need"} action · {dueToday} due today · Updated{" "}
          {relativeAge(queue.computedAt, queue.computedAt) === "just now"
            ? "just now"
            : `${relativeAge(queue.computedAt, queue.computedAt)} ago`}{" "}
          · Policy {queue.policyVersion}
        </p>
      </header>

      {/* Group counts before the list, so the shape of the day is legible
          without scrolling it. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {GROUP_ORDER.filter((g) => g !== "recently_resolved").map((g) => (
          <div key={g} className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-olive">{GROUP_LABEL[g]}</p>
            <p className="mt-1 text-2xl font-semibold text-ground">{queue.groupCounts[g]}</p>
          </div>
        ))}
      </div>

      {queue.items.length === 0 ? (
        <div className="mt-8">
          {/* §14 again: a clear day and a failed projection must not look the
              same. This branch means the projection ran and found nothing. */}
          <EmptyState
            kind="clear"
            title="Nothing is waiting on you"
            detail={`The queue ran at ${queue.computedAt} against policy ${queue.policyVersion} and found no open work. This is an empty result, not a failure to load.`}
            action={{ href: "/clinician/patients", label: "Browse the patient directory" }}
          />
        </div>
      ) : (
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
      )}

      <p className="mt-10 text-xs text-olive">
        Queue order is deterministic for a given policy version and evidence set. Duplicate
        events for one person and reason collapse into a single item with its event count.
      </p>
    </main>
  );
}
