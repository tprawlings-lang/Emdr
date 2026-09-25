import Link from "next/link";
import { redirect } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { laneRun } from "@/lib/assigned-lane";
import { saveLaneStepAction } from "@/lib/assigned-lane-actions";
import { LANE_COPY } from "@/lib/content/h10-assigned-lane";
import { LaneStepView } from "@/components/LaneStepView";
import { SubmitButton } from "@/components/experience/SubmitButton";

// One step of a clinician-assigned practice. Stop is on every step and ends
// the run without a mark against anyone (CV10_E01).
export default async function LaneRunStepPage({
  params, searchParams,
}: {
  params: Promise<{ assignmentId: string; runId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const user = await requireMember();
  const { assignmentId, runId } = await params;
  const { step: raw } = await searchParams;
  const found = await laneRun(user.id, runId);
  if (!found || found.assignmentId !== assignmentId || found.run.status !== "started") redirect(`/app/assigned/${assignmentId}`);
  const i = Math.max(0, Math.min(found.steps.length - 1, Number(raw) || 0));
  const step = found.steps[i];
  const base = `/app/assigned/${assignmentId}/run/${runId}`;
  const nextHref = i + 1 < found.steps.length ? `${base}?step=${i + 1}` : `${base}/end`;

  return (
    <MemberPage layer="actions" title={found.module.title} lede={LANE_COPY.stepOf(i + 1, found.steps.length)}>
      {step.kind === "read" ? (
        <>
          <LaneStepView step={step} />
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {i > 0 && <Link href={`${base}?step=${i - 1}`} className="inline-flex min-h-11 items-center rounded-full border border-ground/20 px-6 text-ground hover:bg-moss">{LANE_COPY.back}</Link>}
            <Link href={nextHref} className="inline-flex min-h-11 items-center rounded-full bg-sage px-6 font-medium text-ground hover:bg-sage-deep">{LANE_COPY.continue}</Link>
          </div>
        </>
      ) : (
        <form action={saveLaneStepAction}>
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="stepId" value={step.id} />
          <input type="hidden" name="next" value={i + 1} />
          <LaneStepView step={step} />
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {i > 0 && <Link href={`${base}?step=${i - 1}`} className="inline-flex min-h-11 items-center rounded-full border border-ground/20 px-6 text-ground hover:bg-moss">{LANE_COPY.back}</Link>}
            <SubmitButton pendingLabel="Saving…" className="rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">{LANE_COPY.continue}</SubmitButton>
          </div>
        </form>
      )}
      <Link href={`${base}/end?stopped=1`} className="mt-6 inline-flex min-h-11 items-center text-ground underline">{LANE_COPY.stop}</Link>
    </MemberPage>
  );
}
