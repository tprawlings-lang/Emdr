import Link from "next/link";
import { moveWalkthrough } from "@/lib/demo/scenario-actions";
import {
  TRANSITION_LABEL, transition,
  type Scenario, type ScenarioProgress, type ScenarioStep, type Transition,
} from "@/lib/experience/scenario";

// The progress guide (handoff 09 §7.2; Package 4).
//
// §7.2: "The presenter can move backward, resume, or choose a shorter story."
//
// WHICH CONTROLS APPEAR IS DECIDED BY THE PURE RULE, NOT BY THIS COMPONENT.
// Every control below asks `transition` whether it is permitted and renders
// the refusal instead of the button when it is not — so the screen cannot
// offer a move the domain would reject, and the reasons a presenter reads are
// the reasons the rule actually gives. A component with its own `index > 0`
// condition is a second implementation of the rule, and the two drift the
// first time somebody adds a state.
//
// AND "NEXT" IS GATED ON THE ENVIRONMENT. `ready` comes from a preflight
// re-read on every render. §7.3's "a reset failure never displays ready" is
// usually read as a rule about an admin console; it is worse here, because the
// consequence of ignoring it is a broken screen in front of an audience rather
// than in front of an operator.
//
// THE CLOSEOUT IS PART OF THE STORY, NOT AN APPENDIX. §7.2 requires "a concise
// statement of what exists, what is unfinished, and what decision is being
// asked for", and it renders on the last step where a presenter cannot skip
// past it — which is also the moment it is most useful, because the audience
// has just watched the thing being described.

export function WalkthroughGuide({
  scenario,
  progress,
  at,
  ready,
}: {
  scenario: Scenario;
  progress: ScenarioProgress;
  at: { step: ScenarioStep; number: number; total: number; remainingMinutes: number; atEnd: boolean };
  ready: boolean;
}) {
  const offer = (to: Transition) => transition(scenario, progress, to, ready);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-olive">
          Step {at.number} of {at.total}
          {progress.shortened && " · shorter story"}
          {at.remainingMinutes > 0 && ` · about ${at.remainingMinutes} minutes left`}
        </p>
        <p className="text-xs text-olive">
          <code className="font-mono">{scenario.version}</code>
        </p>
      </div>

      <section className="mt-3 rounded-2xl border border-ground/15 bg-linen/40 px-6 py-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="type-display text-xl font-medium text-ground">{at.step.title}</h2>
          {/* §7.2: "clearly labeled simulations." On the step, where the
              presenter reads it out, rather than only in a footnote. */}
          {at.step.simulated && (
            <span className="rounded-full bg-pause-soft px-2.5 py-0.5 text-xs font-medium text-ground">
              Simulated figures
            </span>
          )}
        </div>
        <p className="measure mt-2 text-ground">{at.step.say}</p>
        <Link
          href={at.step.href}
          className="mt-4 inline-block rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory"
        >
          Open this screen
        </Link>
        <p className="mt-2 text-xs text-olive">
          <code className="font-mono">{at.step.href}</code> — a real screen in this build, not a
          mock-up.
        </p>
      </section>

      {/* The closeout, on the last step. */}
      {at.atEnd && (
        <section className="mt-6 rounded-2xl border border-ground/20 bg-ivory px-6 py-5">
          <h3 className="type-display text-lg font-medium text-ground">Where this leaves us</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">What exists</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ground/85">
                {scenario.closeout.exists.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">What is unfinished</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ground/85">
                {scenario.closeout.unfinished.map((u) => <li key={u}>{u}</li>)}
              </ul>
            </div>
          </div>
          <p className="measure mt-4 rounded-xl bg-linen/60 px-4 py-3 text-sm font-medium text-ground">
            The decision being asked for: {scenario.closeout.decision}
          </p>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-start gap-3">
        {(["back", "next", "shorter", "restart", "exit"] as Transition[]).map((to) => {
          const result = offer(to);
          if (!result.allowed) {
            // The refusal, in the rule's own words. Only for the two moves a
            // presenter is actively reaching for — a "start again" that is
            // always available needs no explanation of why it is not.
            return to === "next" || to === "back" ? (
              <p key={to} className="max-w-sm text-xs text-olive">
                {TRANSITION_LABEL[to]}: {result.reason}
              </p>
            ) : null;
          }
          return (
            <form key={to} action={moveWalkthrough}>
              <input type="hidden" name="to" value={to} />
              <button
                className={
                  to === "next"
                    ? "rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory"
                    : "rounded-full border border-ground/25 px-4 py-2 text-sm text-ground"
                }
              >
                {TRANSITION_LABEL[to]}
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
