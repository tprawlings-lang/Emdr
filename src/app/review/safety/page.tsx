import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Note, WithNote } from "@/components/app/surfaces";
import { requireReviewer } from "@/lib/auth";
import { replayScenarios } from "@/lib/safety/scenarios";
import { BETA_CONFIG } from "@/lib/safety/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Safety rule results — Steady Review" };

// Safety rule results (handoff 06 §26 p44: "replay fixed scenarios — expected,
// actual, resources — open trace"; handoff 07 p6: the reviewer's landing page).
//
// This is the screen that makes one of handoff 07's release gates checkable
// rather than assertable. p3 requires the demo to "use the same deterministic
// gate engine and most-restrictive-rule precedence" and prohibits "a separate
// relaxed demo safety path"; p54 blocks release on "demo bypass or a relaxed
// safety rule".
//
// So nothing here is stored. Every row below calls `evaluateAccess` — the same
// function a member's daily check-in calls — at the moment the page renders,
// on the build being demonstrated. A fork of the engine for the demo turns
// these rows red in front of whoever is looking at them.
//
// The screen deliberately does NOT read a member's record. It reports the
// ENGINE's behaviour on fixed inputs, which is why a reviewer can be shown it
// without any question of whose data it is.

export default async function ReviewSafetyPage() {
  await requireReviewer();
  const results = replayScenarios();
  const failing = results.filter((r) => !r.pass);

  return (
    <ReviewPage
      title="Safety rule results"
      lede="Fixed scenarios replayed through the live gate engine — expected against actual, with the rules that fired."
      layer="evidence"
      here="/review/safety"
    >
      <div className="space-y-6">
        {failing.length > 0 ? (
          <div
            role="alert"
            className="rounded-2xl border border-state-support/50 bg-state-support-bg/60 px-5 py-4"
          >
            <p className="text-sm font-semibold text-ground">
              {failing.length} scenario{failing.length === 1 ? "" : "s"} did not match the expected
              result.
            </p>
            <p className="measure mt-1 text-sm text-ground">
              Treat this as a release blocker, not a display problem. Either the gate engine
              changed and the expectation was not revisited, or the engine no longer behaves the
              way this environment claims it does — and both are answers a reviewer needs before
              anything else on this console means anything.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-state-safe/40 bg-state-safe-bg/50 px-5 py-4">
            <p className="text-sm font-medium text-ground">
              All {results.length} scenarios match the expected result on this build.
            </p>
            <p className="measure mt-1 text-sm text-ground">
              Computed now, by calling the same function a member&rsquo;s daily check-in calls.
              Nothing on this page is a stored result.
            </p>
          </div>
        )}

        <WithNote
          note={
            <Note
              title="What this proves, and what it does not"
              boundary="It proves the demonstration environment runs the production gate engine on these ten inputs. It does not prove the thresholds are clinically correct — those are provisional and carry their own review — and it is not evidence about any real person."
              owner="Clinical review"
            >
              <p>
                Handoff 07 prohibits a separate relaxed demo safety path. The check for that
                cannot live only in a test suite: a suite proves the engine was right when CI
                ran, and this proves it is right in the environment being shown, at the moment
                someone asks.
              </p>
            </Note>
          }
        >
          <Panel
            title="Scenarios"
            footnote={`Beta configuration: autonomous stimulation ${BETA_CONFIG.autonomousStimulationEnabled ? "enabled" : "disabled"}. With it disabled, activating sessions are blocked for every input — including the settled baseline — so a blocked activating column is a product decision rather than a response to the person.`}
          >
            <ul className="divide-y divide-ground/10">
              {results.map((r) => (
                <li key={r.scenario.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-olive">{r.scenario.id}</span>
                    <span
                      className={
                        r.pass
                          ? "text-sm font-medium text-state-safe"
                          : "text-sm font-semibold text-state-support"
                      }
                    >
                      {/* A glyph AND a word: colour alone is not an encoding
                          (§29.1's accessibility rule). */}
                      {r.pass ? "✓ matches" : "✕ does not match"}
                    </span>
                  </div>

                  <p className="measure mt-1.5 text-sm text-ground">{r.scenario.situation}</p>
                  <p className="measure mt-1 text-sm text-olive">{r.scenario.rationale}</p>

                  <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
                    <dt className="text-olive">Expected</dt>
                    <dd className="font-mono text-ground">
                      tier {tierName(r.scenario.expect.tier)} · activating{" "}
                      {r.scenario.expect.activating ? "allowed" : "blocked"}
                    </dd>
                    <dt className="text-olive">Actual</dt>
                    <dd className="font-mono text-ground">
                      tier {r.actualTierLabel} · activating{" "}
                      {r.actualActivating ? "allowed" : "blocked"}
                    </dd>
                    {r.primaryReason && (
                      <>
                        <dt className="text-olive">Shown to the member</dt>
                        <dd className="text-ground">{r.primaryReason}</dd>
                      </>
                    )}
                    <dt className="text-olive">Rules that fired</dt>
                    <dd className="font-mono text-ground">
                      {r.hits.length === 0 ? "none" : r.hits.map((h) => h.id).join(", ")}
                    </dd>
                  </dl>

                  {!r.pass && (
                    <p className="mt-2 rounded-xl bg-state-support-bg/60 px-3 py-2 text-xs text-ground">
                      {r.failures.join("; ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </WithNote>

        <Panel
          title="What a reviewer cannot do here"
          footnote="Handoff 07 p6: the reviewer role sees fixed gates, evidence, replay, corrections and audit — and not routine treatment decisions or credential management."
        >
          <p className="measure text-sm text-ground">
            There is no control on this page that changes a threshold, clears a gate, or reaches
            a person&rsquo;s record. A reviewer who disagrees with a result records that
            disagreement; they do not resolve it by editing the thing being reviewed. Threshold
            changes carry a named owner and an approval date, and they are not made from a
            review screen.
          </p>
        </Panel>
      </div>
    </ReviewPage>
  );
}

const TIER_NAMES = ["crisis", "grounding_only", "stabilization", "cautious", "steady"];
function tierName(t: number): string {
  return TIER_NAMES[t] ?? String(t);
}
