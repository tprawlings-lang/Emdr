"use server";

import { revalidatePath } from "next/cache";
import { requireDemoAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { resetDemoData } from "@/lib/demo-reset";
import { runQualityChecks, qualitySummary } from "@/lib/demo-quality";
import { recordReset } from "@/lib/demo/preflight";
import { canReset, releaseLock } from "@/lib/demo/environment-lock";
import { applyDataScenario } from "@/lib/demo/data-scenario";
import { exportQaReport } from "@/lib/demo/qa-export";

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

// ---------------------------------------------------------------------------
// Data scenarios (handoff 07 Wave 8, p9's "Inject data scenario")
// ---------------------------------------------------------------------------

/**
 * Apply an approved, versioned event bundle.
 *
 * THINNER THAN THE RESET ACTION ABOVE, and deliberately. Every refusal a
 * bundle can hit — wrong environment, unknown scenario, a reason too short to
 * be reviewable, a version already applied, a cohort out of bounds, a target
 * outside the fabricated population — lives in `applyDataScenario`, so it
 * refuses the same way whether it is reached from this form, a test, or a
 * script somebody writes later. What is left here is the two things that are
 * properties of the REQUEST rather than of the data: who is asking, and
 * telling the screen to redraw.
 *
 * THE LOCK IS NOT CONSULTED, and that is a decision rather than an omission.
 * §7.3's lock protects against a dataset being REPLACED under somebody's
 * meeting; a bundle appends to the population that is already there and
 * changes nothing a presenter has shown so far. A presenter mid-walkthrough
 * who wants to demonstrate a safety pause is the intended user of this
 * control, and blocking them would be the mechanism working against the
 * situation it was built for.
 */
export async function applyDemoDataScenario(formData: FormData): Promise<void> {
  const user = await requireDemoAdmin();
  const scenarioId = String(formData.get("scenarioId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  const outcome = await applyDataScenario({
    scenarioId,
    actorId: user.id,
    actorName: user.name ?? user.email,
    reason,
  });

  if (!outcome.ok) {
    // A refusal is recorded, because an operator who cannot tell a refusal
    // apart from a silent failure will reach for the shell p29 forbids.
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_data_scenario_refused", target: scenarioId || "unknown",
      detail: { refusal: outcome.reason },
    });
  }

  revalidatePath("/admin/demo");
}

// ---------------------------------------------------------------------------
// The QA report (handoff 07 Wave 8, p9's "Export QA report")
// ---------------------------------------------------------------------------

/**
 * Release the QA report through the governed export path.
 *
 * THE ONE CONTROL ON THIS PAGE THAT DOES NOT REFUSE ON A FAILING ENVIRONMENT.
 * Every other gate here exists because demonstrating from a broken environment
 * is the harm; this one exists to describe a broken environment to somebody who
 * is not in the room. Withholding it when the checks fail would remove the
 * artifact at the exact moment it is the thing being asked for.
 */
export async function exportDemoQaReport(formData: FormData): Promise<void> {
  const user = await requireDemoAdmin();
  const purpose = String(formData.get("purpose") ?? "");

  const outcome = await exportQaReport({
    db: getDb(),
    requestedBy: user.id,
    requestedByRole: user.role,
    purpose,
  });

  if (!outcome.ok) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "demo_qa_export_refused", target: "admin/demo/qa-report",
      detail: { refusal: outcome.reason },
    });
  }

  revalidatePath("/admin/demo");
}
