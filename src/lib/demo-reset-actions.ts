"use server";

import { revalidatePath } from "next/cache";
import { requireDemoAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { resetDemoData } from "@/lib/demo-reset";
import { runQualityChecks, qualitySummary } from "@/lib/demo-quality";

// p9's Reset control, as a server action.
//
// WHY THIS EXISTS AT ALL. p29 says a presenter "must never repair the demo by
// editing database rows directly", and the admin console already blocks
// external demonstrations when the manifest fails — so it told a presenter the
// environment was unfit and offered them nothing to do about it. The only
// remedy was a shell on the instance, which is precisely the row-editing
// access p29 is trying to avoid handing out. A deployment found in that state
// is the reason this is being written now: 240 profiles and no history,
// nothing on the page to fix it.
//
// THREE GUARDS, IN THREE PLACES, ON PURPOSE.
//
//   The ENVIRONMENT check lives in `resetDemoData`, because this deletes every
//   row and must refuse outside a demonstration however it is reached.
//   The ROLE check lives here, because this is where a session exists.
//   The REASON is p9's own condition — "reset with a typed reason" — and it is
//   checked here because it is a property of the request, not of the data.
//
// It is destructive and it is meant to be: a reset is how a versioned dataset
// returns to its baseline, and the baseline is rebuilt through the same path a
// fresh environment uses so the two can never drift.

/** Long enough to be a sentence rather than a keystroke. The clock control
 *  uses the same floor for the same reason: a control whose reason may be "x"
 *  records nothing anybody can act on afterwards. */
const MIN_REASON = 4;

export async function resetDemoEnvironment(formData: FormData): Promise<void> {
  const user = await requireDemoAdmin();
  const reason = String(formData.get("reason") ?? "").trim();

  if (reason.length < MIN_REASON) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_reset_refused", target: "environment",
      detail: { refusal: "a typed reason is required", supplied: reason.length },
    });
    revalidatePath("/admin/demo");
    return;
  }

  try {
    const result = resetDemoData(getDb());
    const summary = qualitySummary(runQualityChecks(getDb()));
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_reset", target: "environment",
      // The baseline hash is the point of recording this: it is what makes two
      // resets comparable, and what a reviewer checks when they are told the
      // environment "was reset" between two sessions.
      detail: {
        reason, rowsRemoved: result.totalDeleted, baseline: result.baseline.hash,
        checksPassed: summary.passed, checksFailed: summary.failed,
      },
    });
  } catch (err) {
    // RECORDED, not swallowed. A reset that failed and said nothing leaves a
    // presenter believing the environment was rebuilt when it was not.
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_reset_failed", target: "environment",
      detail: { reason, error: err instanceof Error ? err.message : String(err) },
    });
  }

  // Every console reads this data, so every console is stale after it.
  revalidatePath("/", "layout");
}
