import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel } from "@/components/app/surfaces";
import {
  InterventionEntryForm, ConfirmInstance, RemapInstance,
} from "@/components/clinical/InterventionEntryForm";
import {
  syncInterventionInstances, listDefinitions, listInstances,
} from "@/lib/clinical/interventions";
import { CLASS_LABEL } from "@/lib/clinical/intervention-vocabulary";
import {
  syncResponseObservations, observationsForPerson,
} from "@/lib/clinical/response-observations";
import {
  describeObservation, missingWindowsFor, isMixed, isSettling, inWindowOrder,
  MISSING_WINDOW_LABEL, EVIDENCE_LABEL,
} from "@/lib/clinical/response-vocabulary";
import type { TenantContext } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const metadata = { title: "Observed responses — Steady" };

// The intervention record for one person (expansion handoff 02, Phase 1).
//
// §12's Phase 1 ships an ontology and instances, and its definition of done has
// two halves: "instances reconstruct from source events" AND "no benefit labels
// yet". This screen is the first half made visible and the second half held to.
//
// SO THERE IS NOTHING ON THIS PAGE ABOUT WHETHER ANYTHING HELPED. Not a
// direction, not an arrow, not a "typical change". That is not an oversight to
// be corrected in review — it is the phase. §6 lets a pattern be displayed only
// after three comparable instances and calls it repeated only after five, from
// evidence in named windows with its provenance attached. None of that exists
// yet, and a screen that implied it did would be making the exact claim the
// handoff spends seven pages forbidding.
//
// WHAT IT DOES SHOW is the thing a clinician currently cannot see anywhere: one
// list of what this person has actually been exposed to, across sessions,
// practices and the clinician's own record, with counts. That is useful on its
// own — "she has done the container practice eleven times and the calm place
// twice" is a fact worth having before any pattern is computed from it.
//
// AND IT SHOWS THE UNFINISHED SESSIONS. §13: "session response keeps hard stops
// and missing closes visible." A hard stop is an exposure that happened, and
// hiding it here would quietly make the record a record of the sessions that
// went well.
//
// PHASE 2 ADDS THE WINDOWS, AND STILL NOT A VERDICT. Each exposure now shows
// what was observed in each named window, what disagreed with what, and what
// nobody recorded. Phase 2's definition of done is "mixed and missing outcomes
// remain visible", and this is where visible has to actually mean visible: a
// mixed exposure is MARKED as mixed rather than shown as two rows a reader
// might average, and a window with no observation is printed as a missing
// window rather than omitted. An omitted row and a settled one look identical,
// and only one of them is true.

function dayOf(ts: string): string {
  return ts.slice(0, 10);
}

function contextLine(context: Record<string, unknown>): string | null {
  const bits: string[] = [];
  if (context.sessionStatus === "hard_stop") {
    bits.push("stopped by a safety rule");
  } else if (context.sessionStatus === "abandoned") {
    bits.push("left early");
  } else if (context.sessionStatus === "in_progress") {
    bits.push("still open");
  }
  if (context.missingClose === true && context.sessionStatus !== "in_progress") {
    bits.push("no close reading");
  }
  if (typeof context.activationAtOpen === "number") {
    bits.push(`distress ${context.activationAtOpen} at the start`);
  }
  if (typeof context.note === "string" && context.note.trim()) {
    bits.push(context.note.trim());
  }
  return bits.length > 0 ? bits.join(" · ") : null;
}

function doseLine(dose: Record<string, unknown>): string | null {
  if (typeof dose.durationSec === "number" && dose.durationSec > 0) {
    const mins = Math.round(dose.durationSec / 60);
    return mins >= 1 ? `${mins} min` : `${dose.durationSec}s`;
  }
  return null;
}

const SOURCE_LABEL: Record<string, string> = {
  therapy_session: "Session",
  practice_completion: "Practice",
  companion_interaction: "Companion",
  return_goal_observation: "Life goal",
  clinician_thought: "Your thoughts",
  clinician_entry: "You recorded it",
};

export default async function MemberResponsesPage({
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
  const ctx: TenantContext = { tenantId, personId: clinician.id };

  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!header) notFound();

  // Reconstructed on read. `recordInstance` is idempotent on (source_type,
  // source_id), so this converges rather than accumulating — which is what lets
  // the screen be current without a background job to fall behind.
  await syncInterventionInstances(ctx, id);
  // Phase 2's windows, from the same sources, on the same read.
  await syncResponseObservations(ctx, id);

  const definitions = await listDefinitions(ctx);
  const instances = await listInstances(ctx, id);
  const observations = await observationsForPerson(ctx, id);
  const obsByInstance = new Map<string, typeof observations>();
  for (const o of observations) {
    const list = obsByInstance.get(o.instanceId) ?? [];
    list.push(o);
    obsByInstance.set(o.instanceId, list);
  }
  const byId = new Map(definitions.map((d) => [d.id, d]));

  // Grouped by intervention, ordered by how much evidence there is and then by
  // recency. Count first because count is what §6's thresholds are about, and
  // a clinician scanning this page is looking for the things with enough
  // history to eventually mean something.
  const groups = [...new Map<string, typeof instances>(
    instances.reduce((m, i) => {
      const list = m.get(i.definitionId) ?? [];
      list.push(i);
      m.set(i.definitionId, list);
      return m;
    }, new Map<string, typeof instances>())
  )]
    .map(([definitionId, list]) => ({
      definition: byId.get(definitionId),
      list,
      lastAt: list[0]?.occurredAt ?? "",
    }))
    .filter((g) => g.definition)
    .sort((a, b) => b.list.length - a.list.length || b.lastAt.localeCompare(a.lastAt));

  const options = definitions.map((d) => ({ id: d.id, displayName: d.displayName }));
  const unconfirmed = instances.filter((i) => !i.clinicianConfirmed).length;

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "intervention_record_opened", target: id,
    detail: { instances: instances.length, interventions: groups.length },
  });

  return (
    <PersonShell person={header} active="/responses" title="Observed responses">
      <Panel
        title="What this person has actually been exposed to"
        footnote="A record of what happened and what followed it — never a claim that one caused the other. Windows are shown separately and are never combined: an exposure that settled someone in the room and left them worse the next day is mixed, and saying so is the honest answer. Where nobody recorded a follow-up, that is printed too; it is not recovery."
      >
        <p className="measure text-sm text-ground">
          Sessions, practices and anything you have recorded yourself, gathered into one list and
          counted. {instances.length === 0
            ? "Nothing has been recorded for this person yet."
            : `${instances.length} exposure${instances.length === 1 ? "" : "s"} across ${groups.length} intervention${groups.length === 1 ? "" : "s"}, with ${observations.length} observation${observations.length === 1 ? "" : "s"} of what followed.`}
        </p>
        <div className="mt-4">
          <InterventionEntryForm personId={id} />
        </div>
      </Panel>

      {groups.length === 0 ? (
        <Panel title="Nothing yet" className="mt-6">
          <p className="measure text-sm text-ground">
            Once this person completes a session or a practice, or you record something you did
            with them, it appears here. Until then there is nothing to count — which is a fact
            about the record, not about the person.
          </p>
        </Panel>
      ) : (
        <div className="mt-6 space-y-4">
          {groups.map(({ definition, list }) => (
            <Panel key={definition!.id} title={definition!.displayName}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-app-accent/60 px-2.5 py-1 text-xs font-medium text-app-ink">
                  {CLASS_LABEL[definition!.interventionClass]}
                </span>
                <span className="text-xs text-olive">
                  {list.length} time{list.length === 1 ? "" : "s"}
                </span>
                {definition!.sourceScope === "clinician_entered" && (
                  <span className="text-xs text-olive">recorded by you</span>
                )}
              </div>

              <ul className="mt-3 space-y-2">
                {list.slice(0, 12).map((i) => {
                  const ctxLine = contextLine(i.context);
                  const dose = doseLine(i.dose);
                  const obs = obsByInstance.get(i.id) ?? [];
                  const missing = missingWindowsFor(i, obs);
                  const mixed = isMixed(obs);
                  return (
                    <li key={i.id} className="border-t border-ground/10 pt-2 first:border-0 first:pt-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-sm text-app-ink">{dayOf(i.occurredAt)}</span>
                        <span className="text-xs text-olive">
                          {SOURCE_LABEL[i.sourceType] ?? i.sourceType.replace(/_/g, " ")}
                        </span>
                        {dose && <span className="text-xs text-olive">{dose}</span>}
                        {/* The two controls sit on the SAME line as the date,
                            not under it. A record this long — a person with
                            forty exposures is ordinary — becomes unreadable
                            when every row grows a control stack, and the row's
                            job is to be scanned. */}
                        {!i.clinicianConfirmed && (
                          <ConfirmInstance instanceId={i.id} personId={id} />
                        )}
                        <RemapInstance
                          instanceId={i.id}
                          personId={id}
                          options={options}
                          currentDefinitionId={i.definitionId}
                        />
                      </div>
                      {ctxLine && <p className="measure mt-0.5 text-xs text-olive">{ctxLine}</p>}

                      {mixed && (
                        <p className="mt-1 text-xs font-medium text-app-ink">
                          Mixed — the windows below did not agree, and they are not combined.
                        </p>
                      )}

                      {obs.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {inWindowOrder(obs).map((o) => {
                            const settling = isSettling(o.outcomeType, o.direction);
                            {/* NOT an arrow. An arrow reads as "the number went
                                down", and on sleep quality the number going up
                                is the settled direction — so an arrow would
                                call a good night a deterioration. The filled
                                and hollow marks say "toward settled" and "away
                                from settled", which is what the reader needs
                                and what the raw reading beside them can be
                                checked against. */}
                            return (
                              <li key={o.id} className="measure text-xs text-ground">
                                <span aria-hidden className="text-olive">
                                  {settling === true ? "◆ " : settling === false ? "◇ " : "· "}
                                </span>
                                <span className="sr-only">
                                  {settling === true ? "toward settled: "
                                    : settling === false ? "away from settled: "
                                    : "recorded: "}
                                </span>
                                {describeObservation(o)}{" "}
                                <span className="text-olive">({EVIDENCE_LABEL[o.evidenceClass]})</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {missing.length > 0 && (
                        <p className="measure mt-1 text-xs text-olive">
                          Not followed up: {missing.map((w) => MISSING_WINDOW_LABEL[w]).join(", ")}.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {list.length > 12 && (
                <p className="mt-2 text-xs text-olive">
                  and {list.length - 12} earlier — the count above includes them.
                </p>
              )}
            </Panel>
          ))}
        </div>
      )}

      {unconfirmed > 0 && (
        <p className="measure mt-6 text-xs text-olive">
          {unconfirmed} of these {unconfirmed === 1 ? "was" : "were"} named by Steady from the
          source record rather than by you. The exposure happened either way; it is the name that
          is waiting on you.
        </p>
      )}
    </PersonShell>
  );
}
