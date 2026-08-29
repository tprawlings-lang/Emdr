"use server";

// Server actions for the paced gate (Presentation Layer Handoff §5).
//
// One answer per submission, written immediately. No JavaScript is required:
// each step is a form post that redirects to the next step, so the sequence
// works before hydration and survives a reload — which is what "resumable by
// default" has to mean for someone on a bad connection at 2am.

import { redirect } from "next/navigation";
import { requireMember } from "../auth";
import { audit } from "../audit";
import { recordAnswer, GateError } from "./gate";

export async function answerGateItemAction(formData: FormData) {
  const user = await requireMember();
  const instrumentId = String(formData.get("instrument") ?? "");
  const index = Number(formData.get("index") ?? -1);
  const value = Number(formData.get("value") ?? -1);
  const base = `/app/screening/${encodeURIComponent(instrumentId)}`;

  let result;
  try {
    result = await recordAnswer({ userId: user.id, instrumentId, index, value });
  } catch (e) {
    if (e instanceof GateError) redirect(`${base}?i=${Math.max(0, index)}&error=${encodeURIComponent(e.message)}`);
    throw e;
  }

  if (result.safetyFired) {
    // The disposition has already been recorded by recordAnswer. This is the
    // audit trail for it, filed under safety rather than clinical so the
    // review that looks for these actually finds them.
    await audit({
      actorId: user.id, actorRole: "member", family: "safety",
      type: "gate_safety_item_fired", target: instrumentId,
      detail: { itemIndex: index },
    });
  }

  // A fired safety rule does not interrupt the sequence here. Vol 2 owns what
  // happens next, and it acts on the recorded answer — the questionnaire's job
  // was to record it immediately, which it has now done. Yanking the member to
  // a crisis screen mid-questionnaire would also make the remaining questions
  // unanswerable, which loses the rest of the clinical picture.
  if (result.nextIndex === null) redirect(`${base}?done=1`);
  redirect(`${base}?i=${result.nextIndex}`);
}

/** The no-guilt close. Nothing to save — every answer is already written — so
 *  this is purely a route away, and it says so. */
export async function pauseGateAction() {
  await requireMember();
  redirect("/app/today?paused=gate");
}
