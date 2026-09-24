import { clinicianPlan, type BetweenVisitPlan } from "@/lib/clinical/between-visit-plan";

// The shared between-visit plan, clinician side (17 September handoff, P3).
//
// THE SAME OBJECT THE PERSON READS. This renders `clinicianPlan(plan)`, which
// selects a wording from the assembled plan; `patientPlan(plan)` selects the
// other from the same fields and the same sources. Neither assembles anything,
// which is the mechanism by which the two people in the room are looking at one
// document rather than two that happen to agree today.
//
// Each section shows what it rests on, because the handoff's clinician column
// asks for provenance on every row and because a plan a clinician cannot trace
// is a plan they will re-derive by hand.

function Sources({ sources }: { sources: readonly { kind: string; id: string; version: string }[] }) {
  if (sources.length === 0) {
    return (
      <p className="mt-1 text-xs text-olive">
        {/* Absence with a name. A row resting on nothing is a real state and a
            blank space claims the opposite. */}
        Nothing on the record supports this yet.
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-olive">
      From {sources.map((s) => `${s.kind.replace(/_/g, " ")} ${s.id.slice(0, 8)} (${s.version})`).join(", ")}
    </p>
  );
}

export function BetweenVisitPlanView({ plan }: { plan: BetweenVisitPlan }) {
  const v = clinicianPlan(plan);

  return (
    <section aria-labelledby="between-visit" className="mt-8">
      <h2 id="between-visit" className="type-display text-xl font-medium text-ground">
        Between visits
      </h2>
      <p className="mt-1 measure text-sm text-olive">
        Assembled from the care plan, goals, assignments, sessions and safety state — not stored
        anywhere. The person sees these same facts in their own words, from the same sources.
      </p>

      <dl className="mt-4 space-y-5">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Current focus</dt>
          <dd className="mt-1 text-sm text-ground">
            {v.currentFocus.value.focus ?? "No focus is stated on this record."}
            <span className="mt-1 block text-sm text-olive">{v.currentFocus.value.provenance}</span>
            <Sources sources={v.currentFocus.sources} />
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Assigned support</dt>
          <dd className="mt-1 text-sm text-ground">
            {v.assignedSupport.value.length === 0 ? (
              <span className="text-olive">Nothing is assigned.</span>
            ) : (
              <ul className="space-y-2">
                {v.assignedSupport.value.map((a) => (
                  <li key={`${a.what}-${a.expires ?? "none"}`}>
                    <span className="font-medium">{a.what}</span> — {a.rationale}
                    {/* THE PLAN LINK. Its absence is stated rather than left
                        blank: support that is not working towards a stated goal
                        is an ordinary thing, and a silent gap here would read as
                        a rendering fault instead of a fact. */}
                    <span className="block text-xs text-ground/80">
                      {a.towards
                        ? `Working towards ${a.towards}.`
                        : "Not linked to a goal."}
                    </span>
                    {a.linkNote && (
                      <span className="block text-xs text-state-caution">{a.linkNote}</span>
                    )}
                    <span className="block text-xs text-olive">
                      {a.authority}
                      {a.expires ? ` Runs out ${a.expires.slice(0, 10)}.` : " No end date."}
                      {a.review ? ` Review ${a.review.slice(0, 10)}.` : ""}
                      {" "}Currently {a.status}.
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Sources sources={v.assignedSupport.sources} />
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Completion</dt>
          <dd className="mt-1 text-sm text-ground">
            {v.completion.value.length === 0 ? (
              <span className="text-olive">Nothing is assigned, so there is nothing to complete.</span>
            ) : (
              <ul className="space-y-2">
                {v.completion.value.map((cLine) => (
                  <li key={cLine.what}>
                    <span className="font-medium">{cLine.what}</span> — {cLine.state.replace(/_/g, " ")}
                    {/* THE MEANING, not just the state. "Not recorded" read as
                        "did not do it" is a conversation a clinician will open
                        in session on evidence that does not exist. */}
                    <span className="block text-xs text-olive">{cLine.meaning} ({cLine.source})</span>
                  </li>
                ))}
              </ul>
            )}
            <Sources sources={v.completion.sources} />
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Next review</dt>
          <dd className="mt-1 text-sm text-ground">
            {v.nextReview.value.on ?? "No date is set."}
            <span className="mt-1 block text-sm text-olive">
              {v.nextReview.value.owner} {v.nextReview.value.queueState}
            </span>
            <span className="mt-1 block text-xs text-olive">
              Evidence needed: {v.nextReview.value.evidenceRequired}
            </span>
            <Sources sources={v.nextReview.sources} />
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">
            If they need help between visits
          </dt>
          <dd className="mt-1 text-sm text-ground">
            {v.supportPath.value.delivery}
            <span className="mt-1 block text-xs text-olive">
              {v.supportPath.value.coverage} {v.supportPath.value.responsePolicy}
            </span>
            <Sources sources={v.supportPath.sources} />
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">
            What the person can be shown
          </dt>
          <dd className="mt-1 text-sm text-ground">
            {v.patientReport.value.note}
            <Sources sources={v.patientReport.sources} />
          </dd>
        </div>
      </dl>
    </section>
  );
}
