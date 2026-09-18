import Link from "next/link";
import {
  TODAY_WORK_CONTRACT, type TodayWorkState, type AssignedPresentation,
} from "@/lib/member/today-work";

// What is in front of the person today, and where it came from (17 September
// handoff, P5).
//
// ASSIGNED AND SUGGESTED WERE THE SAME CARD. A module a clinician asked for and
// a module the day shape happened to surface appeared in the same place with
// the same words, so the person could not tell whether somebody had asked them
// to do this. Four of the five facts the handoff requires beside an assigned
// item are about trust rather than about the activity — who asked, why, what it
// shares, when it stops mattering — and none of them was on the screen.
//
// ONE PRIMARY ACTION. The contract names it per state; this renders that one
// and nothing beside it at the same weight.

export function TodayWorkPanel({
  state, assigned, supportHref, unavailable,
}: {
  state: TodayWorkState;
  /** Present in `assigned_due`. */
  assigned?: { presentation: AssignedPresentation; label: string; href: string } | null;
  /** Where the support action goes in the states whose action IS support.
   *  Passed rather than hard-coded, so one place decides where grounding
   *  lives. */
  supportHref: string;
  /** Present in `partial_failure`: what could not be read. */
  unavailable?: readonly string[];
}) {
  const contract = TODAY_WORK_CONTRACT[state];

  if (state === "assigned_due" && assigned) {
    const p = assigned.presentation;
    return (
      <section
        data-testid="today-work"
        data-state={state}
        className="rounded-3xl border border-ground/15 bg-app-surface px-5 py-5"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-olive">
          Asked for by your care team
        </p>
        <h2 className="type-display mt-1 text-lg font-medium text-ground">{assigned.label}</h2>

        <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
          <dt className="text-xs text-olive">Who asked</dt>
          <dd className="measure text-sm text-ground" data-fact="care_team_source">{p.source}</dd>

          <dt className="text-xs text-olive">Why</dt>
          <dd className="measure text-sm text-ground" data-fact="purpose">{p.purpose}</dd>

          <dt className="text-xs text-olive">How long</dt>
          <dd className="measure text-sm text-ground" data-fact="estimated_time">{p.estimatedTime}</dd>

          <dt className="text-xs text-olive">What it shares</dt>
          <dd className="measure text-sm text-ground" data-fact="sharing_rule">{p.sharingRule}</dd>

          <dt className="text-xs text-olive">Until when</dt>
          <dd className="measure text-sm text-ground" data-fact="expiration">{p.expiration}</dd>
        </dl>

        <p className="mt-4">
          <Link
            href={assigned.href}
            className="inline-block rounded-full bg-ground px-5 py-2.5 text-sm font-medium text-ivory"
          >
            {contract.action}
          </Link>
        </p>
        {/* Asked for is not required. Nothing here opens by itself and nothing
            closes if they do not. */}
        <p className="measure mt-2 text-xs text-olive">
          You can stop at any point, and nothing closes if you leave this.
        </p>
      </section>
    );
  }

  if (state === "partial_failure") {
    return (
      <section
        data-testid="today-work"
        data-state={state}
        className="rounded-3xl border border-ground/15 bg-app-surface px-5 py-5"
      >
        <h2 className="type-display text-lg font-medium text-ground">
          Some of today could not be loaded
        </h2>
        <ul className="mt-2 space-y-1" data-fact="what_is_unavailable">
          {(unavailable ?? []).map((u) => (
            <li key={u} className="measure text-sm text-ground">{u}</li>
          ))}
        </ul>
        {/* SAFE SUPPORT STAYS REACHABLE, in the state where the rest of the
            screen cannot be trusted. That is the half of this state that
            matters. */}
        <p className="mt-4" data-fact="safe_support_reachable">
          <Link
            href={supportHref}
            className="inline-block rounded-full bg-ground px-5 py-2.5 text-sm font-medium text-ivory"
          >
            {contract.action}
          </Link>
        </p>
      </section>
    );
  }

  // The remaining states are carried by the day view below this panel, which
  // already says what the day is and offers its one action. Rendering a second
  // headline for them would be two primary actions on one screen, which is the
  // thing the contract exists to prevent.
  return null;
}
