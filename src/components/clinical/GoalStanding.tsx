import type { GoalStanding as Standing } from "@/lib/clinical/goal-standing";
import { SetReviewDate } from "@/components/clinical/GoalLadderForm";

// Where one goal stands, above the ladder (17 September handoff, P4).
//
//   "Goals — show patient wording, observable milestone, last observation, and
//   next review."
//
// The wording is the blockquote this sits under; these are the other three, and
// they were each present-but-unfindable in a different way. The next rung was
// somewhere in a list of five. The last observation was the first row of an
// evidence list at the bottom of the panel, dated but not aged. The review date
// was not rendered anywhere at all.
//
// THREE LABELLED ROWS, ALWAYS ALL THREE. A row that disappears when it has
// nothing in it teaches a reader to read absence as "not applicable here",
// and the whole point of the review row is that an unset date is a fact worth
// seeing.

export function GoalStanding({
  standing, goalId, personId,
}: { standing: Standing; goalId: string; personId: string }) {
  const overdue = standing.review.state === "overdue" || standing.review.state === "today";
  return (
    <dl className="mt-3 grid gap-2 rounded-xl border border-ground/10 bg-app-surface/60 px-4 py-3 sm:grid-cols-[10rem_1fr]">
      <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Next step</dt>
      <dd className="measure text-sm text-app-ink" data-testid="goal-milestone">
        {standing.milestoneSaid}
      </dd>

      <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Last observed</dt>
      <dd
        className={`measure text-sm ${standing.last ? "text-app-ink" : "text-olive italic"}`}
        data-testid="goal-last-observation"
      >
        {standing.lastSaid}
      </dd>

      <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Next review</dt>
      <dd className="measure text-sm" data-testid="goal-review">
        {/* Overdue is marked, and marked quietly. A date that has passed is
            worth seeing; it is not an alert, and a goal is not a task. */}
        <span className={overdue ? "font-medium text-app-ink" : standing.review.date ? "text-app-ink" : "text-olive italic"}>
          {standing.review.said}
        </span>{" "}
        <SetReviewDate goalId={goalId} personId={personId} current={standing.review.date} />
      </dd>
    </dl>
  );
}
