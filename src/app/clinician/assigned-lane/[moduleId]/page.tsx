import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { getLaneModule, laneSteps, laneVisibility } from "@/lib/assigned-lane";
import { LANE_COPY } from "@/lib/content/h10-assigned-lane";
import { LaneStepView } from "@/components/LaneStepView";
import { PENDING_REVIEW_CHIP } from "@/lib/content-signoff";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preview — Steady" };

// Preview a clinician-assigned practice exactly as the person will see it
// (Handoff 03 §4). The steps are drawn by the same component the member's
// run uses, with the boxes disabled. Absent while the lane's rows are
// unsigned, except in the demo.
export default async function LanePreviewPage({ params }: { params: Promise<{ moduleId: string }> }) {
  await requireClinician();
  const { moduleId } = await params;
  const mod = getLaneModule(moduleId);
  if (!mod) notFound();
  const visibility = await laneVisibility(mod);
  if (visibility === "absent") notFound();
  const steps = laneSteps(mod);

  return (
    <ClinicianPage layer="actions" title={mod.title} lede={`Preview · what the person sees · ${LANE_COPY.aboutMinutes(mod.expectedMinutes)}`}>
      {visibility === "draft" && <p className="mt-2 inline-block rounded-full bg-state-unknown-bg px-3 py-1 text-xs text-state-unknown">{PENDING_REVIEW_CHIP}</p>}

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-olive">Gates</dt><dd>{mod.requiredGates.join(", ")}</dd>
        <dt className="text-olive">Not when</dt><dd>{mod.contraindicationRuleIds.join(", ")}</dd>
        <dt className="text-olive">Content from</dt><dd>{mod.content ? mod.contentOwner : `${mod.contentOwner} — not supplied; ${steps ? "demo placeholders shown" : "cannot be run"}`}</dd>
        <dt className="text-olive">Review row</dt><dd>{mod.clinicalReviewId} ({mod.state})</dd>
      </dl>

      <ol className="mt-6 space-y-4">
        <li className="rounded-3xl border border-ground/10 bg-linen p-5 text-ground">{LANE_COPY.before}</li>
        {(steps ?? []).map((s, i) => (
          <li key={s.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
            <p className="mb-2 text-sm text-olive">{LANE_COPY.stepOf(i + 1, steps!.length)} · {LANE_COPY.stop} is on every step</p>
            <LaneStepView step={s} preview />
          </li>
        ))}
        <li className="rounded-3xl border border-ground/10 bg-linen p-5 text-ground">
          {LANE_COPY.after} {LANE_COPY.useful} {LANE_COPY.note}
        </li>
      </ol>
    </ClinicianPage>
  );
}
