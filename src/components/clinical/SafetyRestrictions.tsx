import Link from "next/link";
import { EmptyState } from "@/components/clinical/primitives";
import { gateCause, GATE_STATE_LABEL, type GateGroup } from "@/lib/clinical/gate-review";

// What this person cannot do right now (UX 004).
//
//   "Load links to Safety for an access hold, while Safety says no response is
//   pending. Separate current restrictions from unresolved safety events.
//   Acceptance: missing screening appears with its actual next step."
//
// A RESTRICTION AND AN EVENT ARE DIFFERENT THINGS and the product had one word
// for both. A restriction is a gate state holding a module now; an event is
// something that happened and has not been answered. Closing every event lifts
// no restriction, and a screen that lists only events answers "is anything
// held?" with "no" while something is held.
//
// A COMPONENT RATHER THAN MARKUP IN THE PAGE, so the acceptance condition can
// be asserted on rendered output. "Missing screening appears with its actual
// next step" is a statement about a screen, and a test that reads the page
// source for a phrase would pass on a phrase in a comment.

export function SafetyRestrictions({
  groups, personId, policyVersion,
}: {
  groups: GateGroup[];
  personId: string;
  policyVersion: string;
}) {
  return (
    <section aria-labelledby="restrictions" className="mb-8">
      <h2 id="restrictions" className="type-display text-xl font-medium text-ground">
        Restrictions in force <span className="text-base font-normal text-olive">({groups.length})</span>
      </h2>
      <p className="mt-1 measure text-sm text-olive">
        What this person cannot do right now, and the step that resolves it. A restriction is not
        work awaiting a response — those are below, and documenting one does not lift one.
      </p>

      {groups.length === 0 ? (
        <div className="mt-3">
          {/* §30.8 in miniature: absence is a state with a name, and this one
              has to be distinguishable from the empty state below it. "No
              restriction is in force" and "nothing is awaiting a response" are
              different facts; a blank space claims neither. */}
          <EmptyState
            kind="clear"
            title="No restriction is in force"
            detail={
              `Every module is open for this person under ${policyVersion}. That is a reading of ` +
              "the gates as they stand, not a promise about the next check-in."
            }
          />
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {groups.map((g) => (
            <li
              key={`${g.decision.state}-${g.decision.moduleId}`}
              className="rounded-3xl border border-ground/10 bg-linen p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-olive">
                  {GATE_STATE_LABEL[g.decision.state]}
                </span>
                <span className="text-xs text-olive">
                  Decided by {g.decision.policy.id} {g.decision.policy.version}
                </span>
              </div>
              <p className="mt-1 font-medium text-ground first-letter:uppercase">
                {gateCause(g.decision)}
              </p>
              <p className="mt-0.5 text-sm text-olive">
                {/* An incomplete screener holds every module, so the modules are
                    named rather than listed as eleven identical rows — one
                    unresolved form is one problem. */}
                {g.moduleNames.length === 1
                  ? g.moduleNames[0]
                  : `${g.moduleNames.length} modules — ${g.moduleNames.join(", ")}`}
              </p>

              {/* THE ACCEPTANCE CONDITION. The step is the gate's own — the same
                  sentence the member is given — so a clinician and a member are
                  never working from two different answers about what opens it. */}
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-olive">Next step</dt>
                  <dd className="font-medium text-ground">{g.decision.memberAction}</dd>
                </div>
                {g.decision.safeAlternative && (
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-olive">Open meanwhile</dt>
                    <dd className="text-ground">{g.decision.safeAlternative}</dd>
                  </div>
                )}
              </dl>

              {/* The full decision — evidence, prior state, member copy, what may
                  and may not be overridden — belongs to the gate-review drawer
                  and is linked rather than restated. Two renderings of one
                  decision is how they come to disagree. */}
              <Link
                href={`/clinician/member/${personId}#gates`}
                className="mt-3 inline-block text-sm text-state-info underline"
              >
                The rule, its evidence and what may be overridden
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
