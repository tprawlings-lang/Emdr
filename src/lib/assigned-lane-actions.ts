"use server";

// Member actions for the clinician-assigned lane (Handoff 10 Phase 3). Thin:
// the rules are in assigned-lane.ts, where the tests reach them.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "./auth";
import { endLaneRun, laneRun, LaneRefused, saveLaneStep, startLaneRun, type StepAnswer } from "./assigned-lane";

const id = (v: FormDataEntryValue | null) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
const num = (v: FormDataEntryValue | null) => (typeof v === "string" && /^(10|[0-9])$/.test(v) ? Number(v) : undefined);

export async function startLaneRunAction(formData: FormData) {
  const user = await requireMember();
  const assignmentId = id(formData.get("assignmentId"));
  let runId: string;
  try {
    runId = await startLaneRun(user.id, assignmentId, num(formData.get("distressBefore")));
  } catch (e) {
    if (e instanceof LaneRefused) redirect(`/app/assigned/${assignmentId}?error=${e.code}`);
    throw e;
  }
  redirect(`/app/assigned/${assignmentId}/run/${runId}?step=0`);
}

export async function saveLaneStepAction(formData: FormData) {
  const user = await requireMember();
  const runId = id(formData.get("runId"));
  const stepId = id(formData.get("stepId"));
  const next = Number(formData.get("next") ?? 0);
  const found = await laneRun(user.id, runId);
  if (!found) redirect("/app/today");
  const step = found.steps.find((s) => s.id === stepId);
  let answer: StepAnswer = "";
  if (step?.kind === "write") answer = String(formData.get("text") ?? "");
  if (step?.kind === "fields") answer = Object.fromEntries(step.fields.map((f) => [f.id, String(formData.get(`f:${f.id}`) ?? "")]));
  const r = await saveLaneStep(user.id, runId, stepId, answer).catch((e) => {
    if (e instanceof LaneRefused) return null;
    throw e;
  });
  if (r && !r.ok) redirect("/crisis?from=assigned-practice");
  const base = `/app/assigned/${found.assignmentId}/run/${runId}`;
  redirect(Number.isInteger(next) && next < found.steps.length ? `${base}?step=${next}` : `${base}/end`);
}

export async function endLaneRunAction(formData: FormData) {
  const user = await requireMember();
  const runId = id(formData.get("runId"));
  const found = await laneRun(user.id, runId);
  if (!found) redirect("/app/today");
  const stopped = formData.get("stopped") === "1";
  let result: Awaited<ReturnType<typeof endLaneRun>>;
  try {
    result = await endLaneRun(user.id, runId, {
      stopped, distressAfter: num(formData.get("distressAfter")),
      useful: String(formData.get("useful") ?? ""), note: String(formData.get("note") ?? ""),
    });
  } catch (e) {
    if (e instanceof LaneRefused) {
      redirect(e.code === "no_run" ? `/app/assigned/${found.assignmentId}` : `/app/assigned/${found.assignmentId}/run/${runId}/end?${stopped ? "stopped=1&" : ""}error=${e.code}`);
    }
    throw e;
  }
  if (!result.ok) redirect("/crisis?from=assigned-practice");
  revalidatePath(`/app/assigned/${found.assignmentId}`);
  redirect(`/app/assigned/${found.assignmentId}?${result.flagged ? "steady=1" : stopped ? "stopped=1" : "done=1"}`);
}
