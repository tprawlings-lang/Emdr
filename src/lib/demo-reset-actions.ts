"use server";

import { revalidatePath } from "next/cache";
import { requireDemoAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { resetDemoData } from "@/lib/demo-reset";
import { runQualityChecks, qualitySummary } from "@/lib/demo-quality";
import { recordReset } from "@/lib/demo/preflight";
import { canReset, releaseLock } from "@/lib/demo/environment-lock";

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
  // Handoff 09 §7.3: an interruption is deliberate. The checkbox is the
  // deliberation, and it carries its own reason so the interrupted presenter
  // can read what happened to their environment.
  const interrupt = String(formData.get("interrupt") ?? "") === "on";
  const interruptReason = String(formData.get("interruptReason") ?? "").trim();

  if (reason.length < MIN_REASON) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_reset_refused", target: "environment",
      detail: { refusal: "a typed reason is required", supplied: reason.length },
    });
    revalidatePath("/admin/demo");
    return;
  }

  // Handoff 09 §7.3: "prevent a reset during another walkthrough unless an
  // authorized operator deliberately interrupts."
  //
  // BEFORE THE DESTRUCTIVE CALL, not after. The failure this prevents is a
  // dataset changing under somebody else's investor meeting, and the only
  // moment that can be prevented is this one.
  const permission = canReset({ interrupt, interruptReason });
  if (!permission.allowed) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_reset_refused", target: "environment",
      detail: {
        refusal: "a walkthrough is running",
        heldBy: permission.blockedBy?.heldBy ?? null,
        scenario: permission.blockedBy?.scenarioId ?? null,
      },
    });
    revalidatePath("/admin/demo");
    return;
  }
  if (permission.blockedBy) {
    // Interrupting somebody. Recorded against the lock as well as the audit
    // chain, so the record is where the other operator will look.
    releaseLock(`Interrupted by ${user.name ?? user.email}: ${interruptReason}`);
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_walkthrough_interrupted", target: "environment",
      detail: {
        heldBy: permission.blockedBy.heldBy,
        scenario: permission.blockedBy.scenarioId,
        minutesHeld: permission.blockedBy.minutesHeld,
        interruptReason,
      },
    });
  }

  try {
    const result = resetDemoData(getDb());
    const summary = qualitySummary(runQualityChecks(getDb()));
    // §7.3: "A reset failure never displays ready." The outcome is recorded on
    // BOTH paths, and the environment status reads it — so a rebuild that
    // threw cannot be papered over by a database that happens to pass the
    // manifest afterwards. Written after the reset, because the reset clears
    // this table (see demo-reset.ts) and a row written before it would not
    // survive its own success.
    recordReset(getDb(), { status: "succeeded", reason });
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_reset", target: "environment",
      // The baseline hash is the point of recording this: it is what makes two
      // resets comparable, and what a reviewer checks when they are told the
      // environment "was reset" between two sessions.
      detail: {
        reason, rowsRemoved: result.totalDeleted, baseline: result.baseline.hash,
        checksPassed: summary.passed, checksFailed: summary.failed,
        interrupted: permission.blockedBy !== null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // RECORDED IN TWO PLACES, and the second one is the fix. The audit chain
    // already held this and nothing read it, so the console recomputed health
    // from the live database and drew whatever it found — which for a reset
    // that failed part-way can be a perfectly healthy-looking manifest about a
    // dataset nobody meant to be showing.
    try {
      recordReset(getDb(), { status: "failed", reason, detail: message });
    } catch {
      // A database too broken to record the failure is a database whose
      // status checks will fail anyway. Not re-thrown: the audit row below is
      // the one that must be written.
    }
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_reset_failed", target: "environment",
      detail: { reason, error: message },
    });
  }

  // Every console reads this data, so every console is stale after it.
  revalidatePath("/", "layout");
}
