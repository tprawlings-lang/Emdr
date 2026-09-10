import Link from "next/link";

import { AppShell } from "@/components/app/AppShell";
import { Panel, SummaryCards } from "@/components/app/surfaces";
import { requireDemoAdmin } from "@/lib/auth";
import { ADMIN_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";
import { FITNESS_ITEMS, screenerCaveat } from "@/lib/fitness-screener";
import { enrollmentState } from "@/lib/enrollment/gate";
import {
  pilotParticipants, pilotSummary, STAGE_LABEL, type Participant,
} from "@/lib/enrollment/pilot-console";

// What the pilot's participants entered (demo admin only).
//
// THIS IS REAL PEOPLE'S DATA and the page says so in the first line, because
// every other screen in this environment is fabricated and a reader arrives
// with that expectation. A table of safety answers laid out like a caseload
// gets read as a caseload unless it says otherwise.
//
// NOT A CLINICAL SURFACE. Nothing here routes anybody, closes an alert or
// changes a gate — those actions do not exist on this page and the copy does
// not imply them. It is the operator reading what the pilot produced.
//
// COUNTS, NEVER PERCENTAGES. With a cap of twenty-five, a percentage turns two
// people out of three into "67%", which reads like a finding and is not one.

export const dynamic = "force-dynamic";
export const metadata = { title: "Pilot participants — Steady" };

function StageBadge({ stage }: { stage: Participant["stage"] }) {
  return (
    <span className="rounded-full border border-ground/20 px-2 py-0.5 text-xs text-app-ink">
      {STAGE_LABEL[stage]}
    </span>
  );
}

export default async function PilotConsolePage() {
  await requireDemoAdmin();
  const rows = await pilotParticipants();
  const summary = pilotSummary(rows);
  const gate = await enrollmentState();
  const screenerProvisional = screenerCaveat();

  return (
    <AppShell
      role="Steady Demo"
      title="Pilot participants"
      active="overview"
      railHref={ADMIN_RAIL}
      railFooter={<form action={logout}><button className="hover:underline">Sign out</button></form>}
    >
      <div className="space-y-6">
        <Panel title="What this screen is">
          <p className="measure text-sm text-app-ink">
            <strong>These are real people.</strong> Everyone below created their own account
            through the access-coded signup form and answered these questions about themselves.
            Nothing on this page is fabricated, and nothing on it is a clinical record.
          </p>
          <p className="measure mt-2 text-sm text-olive">
            No control here routes anybody, closes an alert or changes a safety gate — those
            actions do not exist on this page. It reports what the pilot produced so the
            questions and the rules can be judged against real answers.
          </p>
          <p className="measure mt-2 text-sm text-olive">
            Nobody is watching this in real time. A safety positive below did not reach anybody
            when it happened; it is a record, read afterwards.
          </p>
        </Panel>

        <SummaryCards
          cards={[
            { label: "Participants", value: `${summary.participants} of ${gate.limit}` },
            { label: "Reached daily check-ins", value: `${summary.reachedActive} of ${summary.participants}` },
            { label: "Check-ins recorded", value: String(summary.totalCheckins) },
          ]}
        />

        {(summary.peopleWithSafetyPositive > 0 || summary.hardStopped > 0) && (
          <Panel title="Safety answers">
            <p className="measure text-sm text-app-ink">
              {summary.hardStopped > 0 && (
                <>
                  <strong>
                    {summary.hardStopped} {summary.hardStopped === 1 ? "person was" : "people were"} stopped
                  </strong>{" "}
                  by the fit questions — the programme declined to let them start self-guided
                  processing.{" "}
                </>
              )}
              {summary.peopleWithSafetyPositive > 0 && (
                <>
                  <strong>
                    {summary.peopleWithSafetyPositive}{" "}
                    {summary.peopleWithSafetyPositive === 1 ? "person has" : "people have"} at least one
                    check-in
                  </strong>{" "}
                  where the harm-urge item was positive, they said they did not feel safe, or the
                  rules routed to crisis.
                </>
              )}
            </p>
            <p className="measure mt-2 text-sm text-olive">
              Counts of people, not of events, and not a rate: at this size a percentage would
              read as a finding.
            </p>
          </Panel>
        )}

        {screenerProvisional && (
          <Panel title="The fit questions are provisional">
            <p className="measure text-sm text-app-ink">{screenerProvisional}</p>
          </Panel>
        )}

        <Panel
          title="Participants"
          footnote="Ordered by when they joined, newest first. Stage is derived from what each person has actually written — a consent row, a screener, a measure, a check-in — rather than from a stored step, which would drift the moment somebody went back."
        >
          {rows.length === 0 ? (
            <p className="measure text-sm text-olive">
              Nobody has enrolled yet.{" "}
              {gate.open
                ? `Enrollment is open with ${gate.remaining} of ${gate.limit} places left; the sign-in screen offers it.`
                : "Enrollment is closed — set EMDR_ENROLLMENT_CODE to open it."}
            </p>
          ) : (
            <ul className="space-y-4">
              {rows.map((r) => (
                <li key={r.personId} className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-app-ink">{r.name}</span>
                    <StageBadge stage={r.stage} />
                    <span className="text-xs text-olive">joined {r.joinedAt.slice(0, 10)}</span>
                  </div>

                  {r.fit ? (
                    <div className="mt-3 text-sm">
                      <p className="text-app-ink">
                        Fit questions:{" "}
                        <strong>
                          {r.fit.outcome === "hard_stop" ? "stopped"
                            : r.fit.outcome === "soft_flag" ? "flagged, allowed to continue"
                            : "no flags"}
                        </strong>{" "}
                        <span className="text-olive">({r.fit.takenAt.slice(0, 10)})</span>
                      </p>
                      {r.fit.positives.length > 0 && (
                        // The QUESTION, not the item id. A reader should not
                        // have to reconstruct what was asked from `selfharm_30d`.
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-olive">
                          {r.fit.positives.map((p) => (
                            <li key={p.question}>
                              Answered yes: &ldquo;{p.question}&rdquo;{" "}
                              <span className="text-app-ink">
                                ({p.onYes === "hard_stop" ? "hard stop" : "soft flag"})
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-olive">Has not taken the fit questions yet.</p>
                  )}

                  {r.measures.length > 0 && (
                    <p className="mt-2 text-sm text-app-ink">
                      Baseline:{" "}
                      {r.measures.map((m, i) => (
                        <span key={`${m.instrument}-${m.takenAt}`}>
                          {i > 0 && " · "}
                          {m.title} <strong>{m.score}</strong>
                          <span className="text-olive"> (cutoff {m.cutoff})</span>
                        </span>
                      ))}
                    </p>
                  )}

                  <p className="mt-2 text-sm text-app-ink">
                    Check-ins: <strong>{r.checkins}</strong>
                    {r.lastCheckin && (
                      <span className="text-olive">
                        {" "}· last {r.lastCheckin.date}, rules said{" "}
                        <span className="text-app-ink">{r.lastCheckin.action.replace(/_/g, " ")}</span>
                        {(r.lastCheckin.harmUrge || !r.lastCheckin.feelsSafe) && (
                          <span className="text-app-ink">
                            {" "}· {r.lastCheckin.harmUrge ? "harm urge reported" : "did not feel safe"}
                          </span>
                        )}
                      </span>
                    )}
                    {r.safetyPositives > 0 && (
                      <span className="text-olive">
                        {" "}· {r.safetyPositives} safety-positive check-in
                        {r.safetyPositives === 1 ? "" : "s"} in total
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="The eight fit questions"
          footnote="Listed once here rather than repeated per person. Each person's row names only the ones they answered yes to."
        >
          <ol className="space-y-2 text-sm">
            {FITNESS_ITEMS.map((item, i) => (
              <li key={item.id} className="text-app-ink">
                {i + 1}. {item.text}{" "}
                <span className="text-olive">
                  (yes &rarr; {item.onYes === "hard_stop" ? "hard stop" : "soft flag"})
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <p className="text-sm text-olive">
          <Link href="/admin/demo" className="underline">
            Back to demo administration
          </Link>{" "}
          — where enrollment is counted and a reset is refused while these people exist.
        </p>
      </div>
    </AppShell>
  );
}
