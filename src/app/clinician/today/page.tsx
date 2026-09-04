import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { data } from "@/lib/data";
import { activePolicy } from "@/lib/clinical-policy";
import {
  clinicianQueueProjection, inGroup, uiGroupFor,
  GROUP_LABEL, UI_GROUP_LABEL,
  type WorkGroup, type UiGroup, type WorkQueue,
} from "@/lib/clinical/work-queue";
import { commandCenterSurfaceAvailable } from "@/lib/clinical/command-center-flags";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { WorkQueueRow } from "@/components/clinical/WorkQueueRow";
import { CommandCenterHeader } from "@/components/clinical/CommandCenterHeader";
import { relativeAge } from "@/components/clinical/primitives";

// The clinician's Command Center (GUI and Decision-Surface Handoff §10.3;
// expansion handoff 03 §1–§4).
//
// Appendix C of handoff 03 is the instruction this page follows: "do not build
// the Command Center as a new dashboard beside the current clinician work
// queue. The Command Center is the evolution of that work queue." So this is
// the same page it always was — same projection, same server-side ordering,
// same one-row-action contract — with §2's four clinician-readable buckets over
// the five machine groups, and §3's counts as filters.
//
// TWO RENDERS, AND THE OLD ONE IS NOT A FALLBACK. With the Command Center flag
// off, the page renders the five machine groups exactly as it did before this
// handoff — that is Phase 1's definition of done ("existing queue unchanged
// when feature is off") carried through to the screen, not a degraded mode.
//
// EVERYTHING IS DECIDED ON THE SERVER. The page maps a projection to rows and
// does not sort, filter, or re-band anything (§20.1, and §11: "model output
// does not sort the queue"). The `filter` query parameter selects which bucket
// to show; it does not reorder within one, because §6's rule holds here too:
// "user filters do not rewrite server clinical priority semantics."

export const metadata = { title: "Command Center — Steady Clinical" };

// The order the groups are worked, which is not the order they were defined.
const GROUP_ORDER: WorkGroup[] = [
  "needs_action", "review_today", "waiting_member", "waiting_staff", "recently_resolved",
];

const UI_ORDER: UiGroup[] = ["needs_attention", "review_today", "waiting"];

/** How many rows a bucket shows before it asks to be opened.
 *
 *  §1's brief for this screen is "the first 10 seconds", and a caseload where
 *  fifty people are waiting on something produces fifty rows that nobody reads
 *  in ten seconds. THE COUNT ABOVE IS NEVER CAPPED — this is paging, not
 *  hiding, and the filter link opens the whole bucket. Appendix C's warning is
 *  about turning Steady into an alert wall, and an un-paged bucket is how a
 *  queue becomes one without anybody deciding to. */
const ROWS_PER_BUCKET = 10;

function parseFilter(v: string | undefined): UiGroup | "stable" | null {
  if (v === "stable") return "stable";
  return UI_ORDER.includes(v as UiGroup) ? (v as UiGroup) : null;
}

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const clinician = await requireClinician();
  const params = await searchParams;
  const filter = parseFilter(typeof params.filter === "string" ? params.filter : undefined);

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

  const commandCenter = commandCenterSurfaceAvailable("CLINICAL_COMMAND_CENTER");
  // Phase 3's drawer, behind its own flag and everything it rests on.
  const drawer = commandCenterSurfaceAvailable("CLINICAL_COMMAND_CENTER_DRAWER");

  return (
    <ClinicianPage
      layer="overview"
      here="/clinician/today"
      title={commandCenter ? "Command Center" : "Work queue"}
    >
      <div className="mt-6">
        <EnvelopeView envelope={envelope} title={commandCenter ? "Command Center" : "Work queue"}>
          {(queue) =>
            commandCenter
              ? <CommandCenterView queue={queue} filter={filter} drawer={drawer} />
              : <MachineGroupView queue={queue} />
          }
        </EnvelopeView>
      </div>

      {commandCenter && (
        <p className="mt-8 text-sm">
          <Link href="/clinician/caseload" className="underline">The whole caseload</Link>
          {" · "}
          <Link href="/clinician/activity" className="underline">Recent activity</Link>
        </p>
      )}

      <p className="mt-10 text-xs text-olive">
        Queue order is deterministic for a given policy version and evidence set. Duplicate
        events for one person and reason collapse into a single item with its event count.
      </p>
    </ClinicianPage>
  );
}

// ---------------------------------------------------------------------------
// The Command Center (§2, §3)
// ---------------------------------------------------------------------------

function CommandCenterView({
  queue, filter, drawer,
}: {
  queue: WorkQueue;
  filter: UiGroup | "stable" | null;
  drawer: boolean;
}) {
  // Recently-resolved has no bucket. §2: it "belongs in Recent Activity and
  // patient history, not as a permanent front-page section."
  const live = queue.items.filter((i) => uiGroupFor(i.group) !== null);
  const shown = filter === null || filter === "stable" ? UI_ORDER : [filter];

  return (
    <>
      <CommandCenterHeader queue={queue} active={filter} />

      {filter === "stable" ? (
        <StablePanel queue={queue} />
      ) : (
        <div className="mt-8 space-y-8">
          {shown.map((ui) => {
            const items = live.filter((i) => uiGroupFor(i.group) === ui);
            if (items.length === 0) return null;
            // Filtered to one bucket means the clinician asked for all of it.
            const visible = filter === null ? items.slice(0, ROWS_PER_BUCKET) : items;
            const hidden = items.length - visible.length;
            return (
              <section key={ui} aria-labelledby={`ui-${ui}`}>
                <h2 id={`ui-${ui}`} className="type-display text-xl font-medium text-ground">
                  {UI_GROUP_LABEL[ui]}{" "}
                  <span className="text-base font-normal text-olive">({items.length})</span>
                </h2>
                <ul className="mt-3 overflow-hidden rounded-3xl border border-ground/10 bg-linen">
                  {visible.map((i) => (
                    <WorkQueueRow key={i.id} item={i} now={queue.computedAt} drawer={drawer} />
                  ))}
                </ul>
                {hidden > 0 && (
                  <p className="mt-2 text-sm">
                    <Link href={`/clinician/today?filter=${ui}`} className="underline">
                      {hidden} more in {UI_GROUP_LABEL[ui].toLowerCase()}
                    </Link>{" "}
                    <span className="text-xs text-olive">
                      — in the same server order, nothing filtered out.
                    </span>
                  </p>
                )}
              </section>
            );
          })}

          {/* §20's empty state: "say No clinician action is suggested right
              now. Still show Caseload and Recent Activity navigation." A blank
              area would read as a page that failed. */}
          {live.length === 0 && (
            <section className="rounded-3xl border border-ground/10 bg-linen px-5 py-6">
              <h2 className="type-display text-xl font-medium text-ground">
                No clinician action is suggested right now
              </h2>
              <p className="measure mt-2 text-sm text-ground">
                Nothing on your caseload has open work under policy {queue.policyVersion}. That is
                a statement about the current evidence, not about how anyone is doing.
              </p>
              {/* §20: "still show Caseload and Recent Activity navigation."
                  A clear day is not a dead end. */}
              <p className="mt-3 text-sm">
                <Link href="/clinician/caseload" className="underline">Open your caseload</Link>
                {" · "}
                <Link href="/clinician/activity" className="underline">Recent activity</Link>
              </p>
            </section>
          )}
        </div>
      )}
    </>
  );
}

/** The stable filter. §3: "clicking opens filtered Caseload."
 *
 *  A count and a route, not a list of names. Rendering the stable population as
 *  rows would put every quiet person on the front page and make the Command
 *  Center exactly the alert wall Appendix C warns against — and a person with
 *  nothing to do about them does not belong on a screen whose whole job is
 *  showing work. */
function StablePanel({ queue }: { queue: WorkQueue }) {
  return (
    <section className="mt-8 rounded-3xl border border-ground/10 bg-linen px-5 py-6">
      <h2 className="type-display text-xl font-medium text-ground">
        {queue.stableCount} with no suggested action
      </h2>
      <p className="measure mt-2 text-sm text-ground">
        These are people on your caseload with no open safety obligation, no open attention signal
        and nothing due, under policy {queue.policyVersion}. It is not a statement that they are
        well — it is a statement that Steady is not suggesting anything today.
      </p>
      <p className="mt-3 text-sm">
        <Link href="/clinician/caseload?filter=stable" className="underline">
          Open the caseload filtered to them
        </Link>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The queue as it was before this handoff (§21 Phase 1)
// ---------------------------------------------------------------------------

function MachineGroupView({ queue }: { queue: WorkQueue }) {
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
}
