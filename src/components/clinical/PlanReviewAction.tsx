import { SubmitButton } from "@/components/experience/SubmitButton";
import { reviewPlanAction } from "@/lib/clinical/actions";
import {
  PLAN_REVIEW_MEANS, type PlanReviewStanding,
} from "@/lib/clinical/plan-review";

// The permitted review action, beside the plan (17 September handoff, P4).
//
// ONE CONTROL, AND WHAT IT DOES NOT DO BESIDE IT. The screen used to send the
// reader to the full record, where the only approval control is about the
// generated SUMMARY — so following the instruction would have attested to
// something else. The action here records reading and accepting THIS plan, at
// the version on screen, and the three things it does not touch are printed
// next to it rather than left to be inferred from the fact that no other
// buttons appeared.

export function PlanReviewAction({
  personId, planId, planVersion, standing, done,
}: {
  personId: string;
  planId: string;
  /** The plan's generated-at. What the approval is bound to. */
  planVersion: string;
  standing: PlanReviewStanding;
  done?: boolean;
}) {
  const stale = standing.currency?.state === "out_of_date";
  return (
    <section
      data-testid="plan-review"
      className="mt-4 rounded-3xl border border-ground/10 bg-app-surface px-5 py-4"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">Your review</h3>

      {done && (
        <p className="measure mt-2 text-sm text-state-safe">
          <span aria-hidden>◆</span> Recorded. The plan is unchanged.
        </p>
      )}

      <p
        data-testid="plan-review-standing"
        className={`measure mt-2 text-sm ${standing.review ? "text-app-ink" : "text-olive"}`}
      >
        {standing.said}
      </p>
      {stale && standing.currency && (
        <p className="measure mt-1 text-xs text-olive">
          {standing.currency.because} Under policy {standing.currency.policyVersion}.
        </p>
      )}

      <form action={reviewPlanAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="planId" value={planId} />
        {/* The version travels with the approval. A plan regenerated afterwards
            makes this review out of date rather than silently inheriting it. */}
        <input type="hidden" name="planVersion" value={planVersion} />
        <input
          name="note" placeholder="What you make of it (optional)"
          className="min-w-56 rounded border border-ground/20 bg-linen px-2 py-1 text-xs text-app-ink"
        />
        <SubmitButton
          pendingLabel="Recording…"
          className="rounded-full bg-app-ink px-3.5 py-1.5 text-xs font-medium text-app-surface"
        >
          {standing.review ? "Read it again — record that" : "I have read this plan"}
        </SubmitButton>
      </form>

      <p className="measure mt-2 text-xs text-olive">{PLAN_REVIEW_MEANS.does}</p>
      <ul className="mt-1 space-y-0.5">
        {PLAN_REVIEW_MEANS.doesNot.map((d) => (
          <li key={d} className="measure text-xs text-olive">{d}</li>
        ))}
      </ul>
    </section>
  );
}
