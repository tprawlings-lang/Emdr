import { notFound } from "next/navigation";
import { ClinicalFigure, EventTimeline } from "@/components/charts/clinical";
import { buildSafetyTimeline } from "@/lib/clinical/safety-timeline";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { activePolicy } from "@/lib/clinical-policy";
import { alertQueue } from "@/lib/clinical/alerts";
import { closeAlertAction } from "@/lib/clinical/actions";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { PriorityBadge, DueLabel, EmptyState, relativeAge } from "@/components/clinical/primitives";
import { deliveryNotice } from "@/lib/notify/delivery";
import { MODULES } from "@/lib/modules";
import { gateDecisionsFor, groupGateDecisions, gateHolds } from "@/lib/clinical/gate-review";
import { SafetyRestrictions } from "@/components/clinical/SafetyRestrictions";

export const dynamic = "force-dynamic";

// Clinician safety review (§26, page example "Clinician Safety Review",
// schema safety_review.v7).
//
// "Respond to a fixed gate — contact; document; handoff."
//
// The acceptance line is the design: "Response does not erase or alter the
// gate." The screen says that where the clinician acts, not in a footnote —
// "This records care response. It does not erase the gate." A clinician who
// believes documenting a response clears the stop will document one in order
// to clear it, which corrupts both the record and the gate.
//
// UX 004: "Load links to Safety for an access hold, while Safety says no
// response is pending. Separate current restrictions from unresolved safety
// events."
//
// Both screens were telling the truth about different things. Therapeutic Load
// stops when a GATE is holding a module and sends the clinician here — "the
// safety screen, where access is actually decided". This screen only ever knew
// about ALERTS, so it answered a question nobody had asked: nothing is awaiting
// a documented response. A clinician following the link read that as a
// contradiction, and the only way to find the real constraint was to go back to
// the overview and open a drawer.
//
// So the screen now answers both questions, in that order and under names that
// cannot be confused:
//
//   RESTRICTIONS IN FORCE — what this person cannot do right now, which rule
//   decided it, and the step that resolves it. An incomplete screening appears
//   here, with "complete the program-fit questions" beside it, which is the
//   acceptance condition.
//
//   UNRESOLVED SAFETY EVENTS — gate events with no documented human response.
//   Work for a clinician, and a different kind of thing entirely: closing one
//   does not lift a restriction, and the copy at the point of action says so.
//
// An empty section states its own cause rather than going quiet, because "no
// restriction is in force" and "nothing is awaiting a response" are different
// facts and a blank space means neither.
//
// The gate record below is the page example's five-step sequence, rendered from
// what is actually known. Step five in the example reads "Clinician owner
// notified" as a completed fact; here it renders the real delivery state, which
// in this environment is "not configured". Asserting a notification we cannot
// evidence is the defect the notification-truth work removed, and it would
// return here more plausibly than anywhere else.

export default async function SafetyReviewPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const clinician = await requireClinician();
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? "";

  const person = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!person) notFound();

  const policy = activePolicy();

  // The restrictions actually in force, collapsed by cause. An incomplete
  // screener holds every module, so the ungrouped list is eleven rows carrying
  // one decision — which makes a single unresolved form look like eleven
  // problems. `gateHolds` is the same list Therapeutic Load stops on, so the
  // screen that sent the clinician here and the screen they arrive at cannot
  // disagree about whether anything is held.
  const gates = await gateDecisionsFor({
    personId: id, moduleIds: MODULES.map((m) => m.id), policy,
  });
  const restrictions = groupGateDecisions(gates.filter((g) => gateHolds(g.state)));

  const all = await alertQueue({ tenantId, includeResolved: true, policy });
  const mine = all.filter((a) => a.personId === id);
  const open = mine.filter((a) => a.status === "open");
  const closed = mine.filter((a) => a.status === "reviewed");

  // What the fixed gates did, in order, and what a person did about each.
  const timeline = await buildSafetyTimeline(id, tenantId);

  return (
    <PersonShell person={person} active="/safety" title="Safety review">
      {error && (
        <p className="mb-4 rounded-2xl border border-state-support/40 bg-state-support-bg/50 px-4 py-3 text-sm text-ground">
          {error}
        </p>
      )}

      {/* ---- Restrictions in force (UX 004) ---- */}
      <SafetyRestrictions
        groups={restrictions}
        personId={id}
        policyVersion={policy.version}
      />

      {timeline && (
        <section className="mb-8 rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
          <ClinicalFigure
            title="Fixed gate events and human response"
            summary={`${timeline.events.length} safety events in order, each showing the rule that fired and whether a person responded.`}
            footnote={
              timeline.awaitingResponse > 0
                ? `${timeline.awaitingResponse} gate event(s) have no recorded human response. Every mark is an event that happened; nothing here is computed forward.`
                : "Every gate event on record has a documented human response. Every mark is an event that happened; nothing here is computed forward."
            }
          >
            <EventTimeline events={timeline.events} />
          </ClinicalFigure>
        </section>
      )}

      <section aria-labelledby="open">
        <h2 id="open" className="type-display text-xl font-medium text-ground">
          Unresolved safety events <span className="text-base font-normal text-olive">({open.length})</span>
        </h2>
        <p className="mt-1 max-w-measure text-sm text-olive">
          Gate events with no documented human response. Responding is care work and a record of
          it; it does not lift a restriction above.
        </p>

        {open.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              kind="clear"
              title="Nothing is awaiting a documented response"
              detail={
                restrictions.length > 0
                  ? "No safety event is outstanding. The restrictions above are separate and still in force."
                  : "No safety event is outstanding. Resolved events remain below."
              }
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-4">
            {open.map((a) => (
              <li key={a.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <PriorityBadge band={a.band} />
                  <DueLabel dueAt={a.dueAt} overdue={a.overdue} now={person.now} />
                </div>
                <p className="mt-2 font-medium text-ground">{a.detail}</p>
                <p className="mt-0.5 text-sm text-olive">
                  {/* NOT "session remains blocked". An event is a thing that
                      happened and has not been answered; whether anything is
                      blocked is the restrictions section's question, and this
                      line was answering it from the wrong record. */}
                  Rule met {relativeAge(a.createdAt, person.now)} ago, with no response on file.
                </p>

                {/* The gate record. Each line is a thing that either happened or
                    did not, rather than a reassurance that the process ran. */}
                <div className="mt-4 rounded-2xl border border-ground/10 bg-ivory p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-olive">Gate record</p>
                  <ol className="mt-2 space-y-1 text-sm text-ground/90">
                    <li>1. Direct answer persisted at {a.createdAt}</li>
                    <li>2. Consent and scope validated before this record was assembled</li>
                    <li>3. Fixed rule evaluated — no model made or cleared this decision</li>
                    <li>4. Support options shown to the member</li>
                    {/* Not "owner notified". There is no delivery channel, so
                        the honest line is the state machine's own. */}
                    <li>5. Owner notification — {deliveryNotice({ state: "not_configured" })}</li>
                  </ol>
                </div>

                <form action={closeAlertAction} className="mt-4">
                  <input type="hidden" name="alertId" value={a.id} />
                  <label className="block text-sm">
                    <span className="font-medium text-ground">Document response</span>
                    <textarea
                      name="resolution"
                      required
                      minLength={12}
                      rows={3}
                      placeholder="What you did. Not 'acknowledged'."
                      className="mt-1 w-full rounded-2xl border border-ground/20 bg-ivory px-3 py-2 text-sm"
                    />
                  </label>
                  {/* §27.5 and the page example, at the point of action. */}
                  <p className="mt-2 text-xs text-olive">
                    This records a care response. It does not erase the gate, and it does not
                    re-open the session — re-entry is a fresh evaluation of the same fixed rules.
                  </p>
                  <button
                    type="submit"
                    className="mt-3 rounded-full bg-ground px-5 py-2.5 text-sm font-medium text-ivory"
                  >
                    Record response
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 && (
        <section aria-labelledby="closed" className="mt-8">
          <h2 id="closed" className="type-display text-xl font-medium text-ground">
            Responded <span className="text-base font-normal text-olive">({closed.length})</span>
          </h2>
          <ul className="mt-3 space-y-3">
            {closed.map((a) => (
              <li key={a.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
                <p className="font-medium text-ground">{a.detail}</p>
                <p className="mt-1 text-sm text-ground/90">{a.resolution}</p>
                <p className="mt-1 text-xs text-olive">
                  Responded {a.resolvedAt?.slice(0, 16)} · the gate event itself remains on the record
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PersonShell>
  );
}
