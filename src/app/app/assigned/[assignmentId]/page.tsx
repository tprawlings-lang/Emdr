import Link from "next/link";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { laneGate, laneVisibility, myLaneRuns, type LaneReason } from "@/lib/assigned-lane";
import { startLaneRunAction } from "@/lib/assigned-lane-actions";
import { LANE_COPY } from "@/lib/content/h10-assigned-lane";
import { PENDING_REVIEW_CHIP } from "@/lib/content-signoff";
import { SubmitButton } from "@/components/experience/SubmitButton";

// A clinician-assigned practice (Handoff 10 Phase 3; CV10_E01). Reached only
// from an assignment. Without a live one — another person's id, a guessed id,
// one that has run out — the page says it is not available and nothing more,
// the same words for every case so a guessed link reveals nothing.
//
// No rating is ever shown back here: the distress numbers go to the assigning
// clinician, not onto the member's screen (§2.2).

const NOT_TODAY: ReadonlySet<LaneReason> = new Set(["tier_below_steady", "crisis_today", "high_dissociation", "engine_unreadable"]);

export default async function AssignedPracticePage({
  params, searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ done?: string; stopped?: string; steady?: string; error?: string }>;
}) {
  const user = await requireMember();
  const { assignmentId } = await params;
  const q = await searchParams;
  const { decision, assignment, module: mod } = await laneGate(user.id, assignmentId);
  const back = <Link href="/app/today" className="mt-8 inline-flex min-h-11 items-center text-sm text-olive underline">← Today</Link>;

  const reasons = decision.reasonCodes as LaneReason[];
  const unavailable = !assignment || !mod || reasons.some((r) => !NOT_TODAY.has(r));
  if (unavailable) {
    return (
      <MemberPage layer="actions" title="Your practice">
        <p className="measure text-ground/90">{LANE_COPY.unavailable}</p>
        {back}
      </MemberPage>
    );
  }
  const draft = (await laneVisibility(mod)) === "draft";
  const runs = await myLaneRuns(user.id, assignmentId);

  return (
    <MemberPage layer="actions" title={mod.title} lede={LANE_COPY.aboutMinutes(mod.expectedMinutes)}>
      {draft && <p className="inline-block rounded-full bg-state-unknown-bg px-3 py-1 text-xs text-state-unknown">{PENDING_REVIEW_CHIP}</p>}

      {q.steady && (
        <div role="status" className="mt-4 rounded-3xl border border-state-caution/40 bg-state-caution-bg p-5">
          <p className="font-medium text-ground">{LANE_COPY.steady}</p>
          <p className="measure mt-1 text-ground/90">{LANE_COPY.steadyBody}</p>
          <Link href="/app/ground" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-sage px-6 font-medium text-ground hover:bg-sage-deep">
            Ground now
          </Link>
        </div>
      )}
      {q.stopped && <p role="status" className="mt-4 text-ground/90">{LANE_COPY.stopped}</p>}
      {q.done && <p role="status" className="mt-4 text-ground/90">{LANE_COPY.complete}</p>}

      <div className="mt-4 space-y-1 text-sm text-olive">
        <p>{LANE_COPY.assignedBy(assignment.assignedByName)}</p>
        {assignment.reviewAt && <p>{LANE_COPY.reviewDate(assignment.reviewAt.slice(0, 10))}</p>}
      </div>
      <p className="measure mt-4 rounded-2xl bg-linen px-4 py-3 text-ground">{assignment.explanation}</p>

      {q.steady ? null /* straight after a hard run: steady first, never "go again" */ : reasons.length > 0 ? (
        <>
          <p className="measure mt-6 text-ground/90">{LANE_COPY.notToday}</p>
          <Link href="/app/ground" className="mt-4 inline-block rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
            Something grounding instead
          </Link>
        </>
      ) : (
        <form action={startLaneRunAction} className="mt-6">
          <input type="hidden" name="assignmentId" value={assignment.id} />
          {q.error === "choose_distress" && (
            <p role="alert" className="mb-3 rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-sm text-ground">Choose a number from 0 to 10.</p>
          )}
          <fieldset>
            <legend className="measure text-ground">{LANE_COPY.before}</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from({ length: 11 }, (_, v) => (
                <label key={v} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-ground/15 bg-linen text-sm hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
                  <input type="radio" name="distressBefore" value={v} className="sr-only" required />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Starting…" className="rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
              {LANE_COPY.start}
            </SubmitButton>
            <Link href="/app/today" className="inline-flex min-h-11 items-center rounded-full border border-ground/20 px-6 text-ground hover:bg-moss">
              {LANE_COPY.notNow}
            </Link>
          </div>
          <p className="mt-3 text-sm text-olive">{LANE_COPY.canStop}</p>
        </form>
      )}

      {runs.some((r) => r.written.length > 0 || r.note) && (
        <section aria-labelledby="written" className="mt-10">
          <h2 id="written" className="text-sm font-semibold text-ground">What you&apos;ve written</h2>
          <p className="mt-1 text-sm text-olive">Only you and {assignment.assignedByName} can see this.</p>
          <ul className="mt-3 space-y-3">
            {runs.filter((r) => r.written.length > 0 || r.note).map((r) => (
              <li key={r.id} className="rounded-2xl border border-ground/10 bg-app-surface p-4 text-sm text-ground/90">
                <p className="text-xs text-olive">{r.startedAt.slice(0, 10)}</p>
                {r.written.map((w) => (
                  <div key={w.stepId} className="mt-2 whitespace-pre-line">
                    {typeof w.answer === "string" ? w.answer : Object.values(w.answer).filter(Boolean).join("\n")}
                  </div>
                ))}
                {r.note && <p className="mt-2 italic">{r.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {back}
    </MemberPage>
  );
}
