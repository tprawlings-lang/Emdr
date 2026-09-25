import { redirect } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { laneRun } from "@/lib/assigned-lane";
import { endLaneRunAction } from "@/lib/assigned-lane-actions";
import { LANE_COPY } from "@/lib/content/h10-assigned-lane";
import { SubmitButton } from "@/components/experience/SubmitButton";

// The end of a run, finished or stopped (CV10_E01). The rating after is asked
// either way; after a stop it may be left blank, and nothing is lost by that.
export default async function LaneRunEndPage({
  params, searchParams,
}: {
  params: Promise<{ assignmentId: string; runId: string }>;
  searchParams: Promise<{ stopped?: string; error?: string }>;
}) {
  const user = await requireMember();
  const { assignmentId, runId } = await params;
  const q = await searchParams;
  const found = await laneRun(user.id, runId);
  if (!found || found.assignmentId !== assignmentId || found.run.status !== "started") redirect(`/app/assigned/${assignmentId}`);
  const stopped = q.stopped === "1";

  return (
    <MemberPage layer="actions" title={stopped ? found.module.title : LANE_COPY.complete} lede={stopped ? LANE_COPY.stopped : undefined}>
      <form action={endLaneRunAction} className="space-y-6">
        <input type="hidden" name="runId" value={runId} />
        {stopped && <input type="hidden" name="stopped" value="1" />}
        {q.error === "choose_distress" && (
          <p role="alert" className="rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-sm text-ground">Choose a number from 0 to 10.</p>
        )}
        <fieldset>
          <legend className="measure text-ground">{LANE_COPY.after}</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }, (_, v) => (
              <label key={v} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-ground/15 bg-linen text-sm hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
                <input type="radio" name="distressAfter" value={v} className="sr-only" required={!stopped} />
                {v}
              </label>
            ))}
          </div>
        </fieldset>
        {!stopped && (
          <fieldset>
            <legend className="text-ground">{LANE_COPY.useful}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LANE_COPY.usefulChoices.map((label, i) => (
                <label key={label} className="cursor-pointer rounded-full border border-ground/15 bg-linen px-5 py-2.5 text-sm hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
                  <input type="radio" name="useful" value={["yes", "not_sure", "no"][i]} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="block">
          <span className="text-ground">{LANE_COPY.note}</span>
          <textarea name="note" rows={3} maxLength={500} className="mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground" />
        </label>
        <SubmitButton pendingLabel="Saving…" className="rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
          {LANE_COPY.finish}
        </SubmitButton>
      </form>
    </MemberPage>
  );
}
