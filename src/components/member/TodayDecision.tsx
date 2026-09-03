import Link from "next/link";
import type { MemberToday, TodayAction } from "@/lib/member/today";
import { Horizon } from "./DayCanvas";

// The member's decision surface (Web GUI handoff §10.1, page example
// "Member Today", schema member_today.v4).
//
// "Action first. Meaning second. Evidence third." — one primary action with its
// expected duration, one sentence of why, at most two alternatives, and support.
//
// §3.4 described what this replaces: a Home that stacked greeting, check-in,
// autopilot, five practice cards, a distress trend, twelve module rows and a
// disclaimer. "This is a content catalog. It tells the member everything Steady
// can do, but it makes the member decide what matters now. On a hard day, that
// choice load is exactly what the system should reduce."
//
// Every value here comes from the projection. The component computes nothing —
// no gating call, no score, no ordering decision. That is the point: §8.1 says
// the client may "render, collect an authorized action, show state" and must
// not "infer safety".
//
// It supersedes DayCanvas, which is handoff 04 §8's version of the same
// surface: same primary, same secondaries, same MemberDay source. Rendering
// both put the member's three options on screen twice, which is worse than
// either alone. Handoff 06 §10.1 is the more specific spec — expected duration,
// one sentence of why, support as a peer of the plan — so it wins.
//
// The Horizon comes with it. That is handoff 04 §7's signature element, the
// thin rule sitting higher on an open day and lower on a narrow one, carrying
// the day's shape "without a number, a color code, or a label". It is the one
// part of DayCanvas that has no equivalent in §10.1, and dropping it would
// discard a deliberate decision (with a guard behind it) as collateral damage
// from a merge.

function Duration({ minutes }: { minutes: number | null }) {
  if (minutes === null) return null;
  // Before the label rather than after it: a member deciding whether they have
  // capacity needs the cost first. A duration is not a score.
  return <span className="text-sm font-normal text-olive">about {minutes} minutes</span>;
}

function Secondary({ action }: { action: TodayAction }) {
  return (
    <Link
      href={action.href}
      className="block rounded-3xl border border-ground/10 bg-linen p-4 transition-colors hover:border-ground/25"
    >
      <p className="font-medium text-ground">{action.label}</p>
      <Duration minutes={action.minutes} />
    </Link>
  );
}

export function TodayDecision({ today }: { today: MemberToday }) {
  return (
    <section aria-labelledby="today-decision" data-shape={today.shape} className="rounded-3xl border border-ground/10 bg-linen p-6">
      <Horizon shape={today.shape} />
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-decision" className="type-identity text-xl font-medium text-ground">
          Up next
        </h2>
        {today.primary && <Duration minutes={today.primary.minutes} />}
      </div>

      {today.primary ? (
        <>
          {/* One dominant action (§26 member acceptance: "No page presents more
              than one dominant action"). It is the only filled button here. */}
          <Link
            href={today.primary.href}
            className="mt-4 block w-full rounded-full bg-ground px-6 py-4 text-center text-lg font-medium text-ivory transition-colors hover:bg-ground/90"
          >
            {today.primary.label}
          </Link>
          {/* The one sentence of why (§10.1). Not a rationale, not the engine's
              reasoning — the reason a person would give. */}
          <p className="mt-3 text-ground/90">{today.primary.why}</p>
        </>
      ) : (
        <p className="mt-3 text-ground/90">
          Nothing is scheduled for you right now. Grounding and support stay open.
        </p>
      )}

      {today.alternatives.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-olive">
            Or something lighter
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {today.alternatives.map((a) => (
              <Secondary key={a.id} action={a} />
            ))}
          </div>
        </div>
      )}

      {/* Support and the companion are peers of the plan, not footnotes under
          it. Both present in every state, including the one where there is
          nothing else to show.

          The companion used to be reachable only from a banner that appears in
          the moment after a check-in, and from inside the messages screen — so
          a member who signed in and landed here, which is what a member does,
          had no route to it. Neither is gated: both are conversation rather
          than activating content, and a companion that disappears on the days
          somebody is struggling is exactly backwards. */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-ground/10 pt-4">
        <Link href={today.companion.href} className="font-medium text-state-info underline">
          {today.companion.label}
        </Link>
        <Link href={today.support.href} className="font-medium text-state-info underline">
          {today.support.label}
        </Link>
      </div>
    </section>
  );
}
