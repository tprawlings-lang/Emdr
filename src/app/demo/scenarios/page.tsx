import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { SCENARIOS } from "@/lib/demo/scenario-registry";
import { environmentStatus, meetsRequirements } from "@/lib/demo/preflight";
import { activeLock } from "@/lib/demo/environment-lock";
import { readWalkthrough, startWalkthrough } from "@/lib/demo/scenario-actions";
import { AUDIENCE_LABEL, actualMinutes, hasShorterStory, position, shorterStory } from "@/lib/experience/scenario";
import { WalkthroughGuide } from "@/components/demo/WalkthroughGuide";
import { EnvironmentHealth } from "@/components/demo/EnvironmentHealth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guided walkthroughs — Steady" };

// The launcher and the progress guide (handoff 09 §7.2, §7.3; Package 4).
//
// ONE SCREEN, TWO STATES, and that is the point rather than a saving. A
// presenter mid-story does not want a launcher, and a presenter about to start
// does not want somebody else's progress: the page shows the running
// walkthrough when there is one and the list when there is not. A guide on its
// own route would let a presenter navigate to a story they had not started.
//
// ENVIRONMENT HEALTH LEADS. §7.3: "Lead with environment health and failed
// preflight." Above the stories, not below them, because the decision a
// presenter is making on this page is whether to start — and the answer to
// that is the environment's state, not the list of titles.
//
// A BLOCKED ENVIRONMENT OFFERS NO START BUTTON. Not a disabled one: §1.1's
// rule about navigation applies to a control just as well, and a greyed-out
// "Begin" three minutes before a meeting is a promise with a lock on it. What
// replaces it is the reason and the route to fix it.

export default async function ScenarioLauncher() {
  // Any signed-in operator. Deliberately not demo-admin only: the person
  // presenting to an investor is often not the person who administers the
  // environment, and making the story require the reset role would hand out
  // the reset role.
  const user = await requireUser();
  const status = environmentStatus(getDb());
  const lock = activeLock();
  const { progress, refusal } = await readWalkthrough();

  const running = progress ? SCENARIOS.find((s) => s.id === progress.scenarioId) ?? null : null;

  return (
    <PublicPage
      eyebrow="Review environment"
      title={running ? running.title : "Guided walkthroughs"}
      lede={
        running
          ? running.purpose
          : "Named stories that run on the fabricated dataset. Each one opens real screens and says what it does not claim."
      }
    >
      <div className="mt-8">
        <BoundaryNote extra="Every person, record and clinician in these walkthroughs is invented." />
      </div>

      {/* §7.3: health first. Present in both states — an environment can stop
          being fit in the middle of a story, and the presenter is the person
          who needs to know. */}
      <div className="mt-8">
        <EnvironmentHealth status={status} lock={lock} />
      </div>

      {refusal && (
        <p className="mt-6 rounded-2xl border border-pause/50 bg-pause-soft px-5 py-4 text-sm text-ground">
          {refusal}
        </p>
      )}

      {running && progress ? (
        <WalkthroughGuide
          scenario={running}
          progress={progress}
          at={position(running, progress)}
          ready={meetsRequirements(status, running.requires).ready}
        />
      ) : (
        <section className="mt-10 space-y-5">
          {SCENARIOS.map((s) => {
            const met = meetsRequirements(status, s.requires);
            const heldByOther = lock !== null && lock.heldBy !== user.id;
            return (
              <article key={s.id} className="rounded-2xl border border-ground/15 bg-linen/40 px-6 py-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="type-display text-xl font-medium text-ground">{s.title}</h2>
                  <span className="rounded-full bg-ground/10 px-2.5 py-0.5 text-xs text-ground">
                    {AUDIENCE_LABEL[s.audience]}
                  </span>
                  {/* The short duration only when there IS a shorter story.
                      This read "5 minutes · 5 screens · 5 minutes short" on the
                      investor story, whose five beats are all essential — an
                      offer of nothing, made to a presenter who is out of
                      time. */}
                  <span className="text-xs text-olive">
                    {actualMinutes(s.steps)} minutes · {s.steps.length} screens
                    {hasShorterStory(s) && ` · ${actualMinutes(shorterStory(s))} minutes short`}
                  </span>
                </div>
                <p className="measure mt-2 text-sm text-ground/85">{s.purpose}</p>

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-state-info">
                    What this story claims, and what it does not
                  </summary>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-olive">Claims</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ground/85">
                        {s.claims.map((c) => <li key={c}>{c}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-olive">Does not claim</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ground/85">
                        {s.limitations.map((l) => <li key={l}>{l}</li>)}
                      </ul>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-olive">
                    Attached to version <code className="font-mono">{s.version}</code>. A
                    walkthrough that began under a different version is not resumed.
                  </p>
                </details>

                {/* No disabled button. The reason, or the control. */}
                {!met.ready ? (
                  <p className="mt-4 rounded-xl border border-pause/50 bg-pause-soft px-4 py-3 text-sm text-ground">
                    Not startable: {met.missing.map((c) => c.label).join(", ")}
                    {met.unknown.length > 0 && ` (unrecognised requirement: ${met.unknown.join(", ")})`}.{" "}
                    <Link href="/admin/demo" className="underline">Environment administration</Link> can rebuild it.
                  </p>
                ) : heldByOther ? (
                  <p className="mt-4 rounded-xl border border-ground/20 bg-ivory px-4 py-3 text-sm text-ground">
                    {lock!.heldByName ?? "Another operator"} has been running &ldquo;{lock!.scenarioId}&rdquo; for{" "}
                    {lock!.minutesHeld} minutes. Wait, or ask them to end it.
                  </p>
                ) : (
                  <form action={startWalkthrough} className="mt-4">
                    <input type="hidden" name="scenario" value={s.id} />
                    <button className="rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory">
                      Begin this walkthrough
                    </button>
                  </form>
                )}
              </article>
            );
          })}
        </section>
      )}
    </PublicPage>
  );
}
