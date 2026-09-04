"use server";

import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import type { TenantContext } from "../repository";
import {
  acknowledgeSignal, setSignalState, recordCareAction, getSignal,
  AttentionSignalError, DISMISS_REASONS,
  type DismissReason, type CareAction,
} from "./attention-signals";
import { buildCommandContext, type CommandContext } from "./command-context";
import { composeCommandSummary, type SummaryOutcome } from "./command-summary";
import { commandCenterSurfaceAvailable } from "./command-center-flags";

// Server actions for the Quick Review Drawer (expansion handoff 03 §12, §13).
//
// Thin, like the console's other actions: authenticate, resolve the tenant from
// the caller's own record, delegate, revalidate. The lifecycle rules live in
// attention-signals.ts where they are tested; a second copy in a form handler
// is how the two come to disagree.
//
// THE TENANT IS READ, NEVER ACCEPTED. §14: "tenant and clinician identity are
// resolved server-side. Browser-supplied tenant_id is ignored." A tenant
// supplied by the caller is a tenant an attacker can choose.
//
// AND EVERY ONE OF THESE IS AN EXPLICIT ACT. §12: "opening a row or drawer does
// not silently acknowledge it. Acknowledgement is explicit." There is
// deliberately no action here that a page render could reach — the drawer loads
// through `loadCommandContext`, which writes nothing, and every other function
// in this file requires somebody to have pressed something.

export interface AttentionActionResult {
  ok: boolean;
  error?: string;
}

async function clinicianContext(): Promise<{ ctx: TenantContext; clinicianId: string }> {
  const clinician = await requireClinician();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  return {
    ctx: { tenantId: row?.tenant_id ?? PLATFORM_TENANT_ID, personId: clinician.id },
    clinicianId: clinician.id,
  };
}

/** Assemble the drawer. READS ONLY — see the header. */
export async function loadCommandContext(
  personId: string, signalId: string | null
): Promise<CommandContext | null> {
  const { ctx, clinicianId } = await clinicianContext();
  try {
    const context = await buildCommandContext(ctx, { personId, signalId });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "command_context_opened", target: personId,
      detail: { signalId, sections: context.coverage.assembled.length },
    });
    return context;
  } catch {
    // A drawer that fails to load must not take the queue behind it down.
    return null;
  }
}

/**
 * The optional cross-system sentence (§8, §16), fetched SEPARATELY from the
 * context.
 *
 * Two calls rather than one, and the split is the point: the drawer renders
 * everything deterministic first and asks for the sentence after. §20: "AI
 * summary failed → render deterministic reason/support facts. Never hide the
 * work item." A single call would make the whole drawer wait on a model, and a
 * slow model would look like a slow record.
 */
export async function loadCommandSummary(
  personId: string, signalId: string | null
): Promise<SummaryOutcome> {
  if (!commandCenterSurfaceAvailable("CLINICAL_COMMAND_CENTER_AI_SUMMARY")) {
    return { rendered: false, reason: "Steady is not composing summaries in this environment." };
  }
  const { ctx } = await clinicianContext();
  try {
    const context = await buildCommandContext(ctx, { personId, signalId });
    return await composeCommandSummary(ctx, context);
  } catch {
    return { rendered: false, reason: "The summary could not be composed just now." };
  }
}

/** §12: acknowledgement records clinician, timestamp, evidence cutoff and
 *  surface. Reviewing is not resolving — the signal stays open work. */
export async function acknowledgeSignalAction(
  signalId: string, personId: string, sourceSurface = "drawer"
): Promise<AttentionActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  try {
    await acknowledgeSignal(ctx, { signalId, clinicianId, sourceSurface });
    // §13: the review IS the care action. Recorded here rather than left to a
    // separate button, because a clinician who reviewed something and did not
    // also press "log that I reviewed it" still reviewed it.
    await recordCareAction(ctx, {
      personId, clinicianId, action: "review", signalId, sourceSurface,
    });
  } catch (err) {
    if (err instanceof AttentionSignalError) return { ok: false, error: err.message };
    throw err;
  }
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "attention_signal_acknowledged", target: personId, detail: { signalId },
  });
  revalidatePath("/clinician/today");
  return { ok: true };
}

/** Waiting, resolved or dismissed. The domain refuses a dismissal with no
 *  reason and a waiting state with no named dependency; this passes the
 *  refusal through rather than filling either in. */
export async function setSignalStateAction(
  formData: FormData
): Promise<AttentionActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const signalId = String(formData.get("signalId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const state = String(formData.get("state") ?? "");
  const dismissReason = String(formData.get("dismissReason") ?? "");
  const dependency = String(formData.get("dependency") ?? "").trim().slice(0, 300);
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  if (!signalId || !personId) return { ok: false, error: "Missing details." };
  if (!["waiting_member", "waiting_staff", "resolved", "dismissed"].includes(state)) {
    return { ok: false, error: "Unknown state." };
  }

  try {
    await setSignalState(ctx, {
      signalId,
      clinicianId,
      state: state as "waiting_member" | "waiting_staff" | "resolved" | "dismissed",
      dismissReason: (DISMISS_REASONS as readonly string[]).includes(dismissReason)
        ? (dismissReason as DismissReason)
        : undefined,
      dependency: dependency || undefined,
      note: note || null,
      sourceSurface: "drawer",
    });
    await recordCareAction(ctx, {
      personId, clinicianId,
      action: state === "resolved" ? "resolve" : "review",
      signalId, outcomeState: state, note: note || null, sourceSurface: "drawer",
    });
  } catch (err) {
    if (err instanceof AttentionSignalError) return { ok: false, error: err.message };
    throw err;
  }
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "attention_signal_state_changed", target: personId,
    detail: { signalId, state, dismissReason: dismissReason || null },
  });
  revalidatePath("/clinician/today");
  return { ok: true };
}

/**
 * Record a care action the clinician took from the drawer (§13).
 *
 * NO DURATION IS EVER MEASURED HERE. §13: "do not count passive browser-open
 * time as clinical work", and a server action that timed itself would be
 * timing a round trip. The domain accepts a duration only when a caller bounds
 * one explicitly, and no caller in this file does.
 */
export async function recordCareActionAction(
  personId: string, action: CareAction, signalId: string | null
): Promise<AttentionActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  try {
    await recordCareAction(ctx, {
      personId, clinicianId, action, signalId, sourceSurface: "drawer",
    });
  } catch (err) {
    if (err instanceof AttentionSignalError) return { ok: false, error: err.message };
    throw err;
  }
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "between_visit_care_action", target: personId, detail: { action, signalId },
  });
  return { ok: true };
}

/** Whether a signal is still the clinician's to act on, for a drawer that has
 *  been open while somebody else changed it. */
export async function signalStillOpenAction(signalId: string): Promise<boolean> {
  const { ctx } = await clinicianContext();
  const signal = await getSignal(ctx, signalId);
  return signal !== null && (signal.state === "open" || signal.state === "acknowledged");
}
