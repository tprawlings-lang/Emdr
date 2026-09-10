"use server";

import { revalidatePath } from "next/cache";
import { noteSignal } from "../telemetry/store";

import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import type { TenantContext } from "../repository";
import {
  recordCareAction, acknowledgeSignal, getSignal, currentCareActions,
  AttentionSignalError,
} from "./attention-signals";
import { alertQueue, closeAlert, AlertClosureError } from "./alerts";
import type { AttentionSignal } from "./attention-vocabulary";
import { experienceContextFor } from "../experience/context";
import {
  resolveCommand, confirmed, rejected, stale, unavailable, indeterminate,
  CommandError, type CommandInput, type CommandResult,
} from "../experience/command";

// The clinician's separated commands (handoff 09 §5, §9; Package 2).
//
// WHY THIS LIVES IN src/lib/clinical AND NOT src/lib/experience. Package 1's
// exit evidence is "contract tests prove no raw SQL... in the experience
// layer", and this module resolves a tenant from the session — which needs a
// query. That guard caught it the first time this file was written next to the
// contracts, and it was right to: the experience layer is composition over
// existing readers and commands, and a module that queries is a module with its
// own idea of what a clinician may see.
//
// So it sits beside the other action modules — attention-actions.ts,
// trajectory-actions.ts, load-actions.ts — which is where a server action that
// authenticates, resolves a tenant and delegates already belongs. It USES the
// experience contracts; it is not one of them.
//
// §5: "Distinguish Open, Record contact, Assign, and Complete review. Opening
// is not acknowledgement. Recording that an attempted contact occurred is not
// proof of delivery. Show exactly what the action changed after the server
// confirms it."
//
// THREE COMMANDS, AND NO `open`. Opening is a navigation — a `Link` — and it
// deliberately has no server action at all, because §12 of handoff 03 requires
// that "opening a row or drawer does not silently acknowledge it" and the surest
// way to keep that promise is for there to be nothing to call. A codebase where
// `open` is a command is a codebase where somebody eventually makes it write.
//
// EVERY ONE RETURNS A `CommandResult`, never a boolean and never a throw at the
// boundary. §9: "Distinguish confirmed, rejected, stale, unavailable,
// indeterminate", because "a failed network acknowledgement is not proof that no
// write occurred". A function returning `void` on success tells the caller
// nothing it can show, and §5's "show exactly what the action changed after the
// server confirms it" needs the change in the result.
//
// THE TENANT IS READ, NEVER ACCEPTED, and the payload is refused if it carries
// one — `resolveCommand` does that, and these functions go through it rather
// than around it.
//
// AND THEY COMPOSE, they do not reimplement. Each delegates to the domain
// writer that already owns the rule: `recordCareAction` for contact and
// assignment, `acknowledgeSignal` for a completed review. The lifecycle rules
// live where they are tested; a second copy in an action handler is how the two
// come to disagree.

async function clinicianContext(): Promise<{ ctx: TenantContext; clinicianId: string; experience: ReturnType<typeof experienceContextFor> }> {
  const clinician = await requireClinician();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = row?.tenant_id ?? PLATFORM_TENANT_ID;
  return {
    ctx: { tenantId, personId: clinician.id },
    clinicianId: clinician.id,
    experience: experienceContextFor({ ...clinician, tenantId }),
  };
}

export interface RecordedChange {
  /** What to tell the clinician happened. §5: shown only after the server
   *  confirms it. */
  summary: string;
  /** The care-action row, so a surface can point at what it wrote. */
  recordId: string;
}

/**
 * Turn a domain failure into a result the surface can render.
 *
 * `indeterminate` IS THE INTERESTING BRANCH and it is not reachable from a
 * throw. A domain writer that throws has decided nothing happened; an
 * indeterminate outcome is what a CALLER observes when the answer never
 * arrived, which is a transport condition rather than a domain one. It is
 * constructed at the surface — see the comment on `reconcileHint` — and appears
 * here only so the mapping is exhaustive.
 */
function fromError(err: unknown, key: string): CommandResult<never> {
  if (err instanceof AttentionSignalError || err instanceof CommandError) {
    return rejected(err.message);
  }
  // An unrecognised failure is not a refusal: Steady does not know what
  // happened, and a caller told "rejected" would retry into a possible
  // duplicate. §9: reconcile by idempotency key before inviting retry.
  console.error("clinician command failed:", err instanceof Error ? err.name : "unknown");
  return indeterminate(
    "Steady could not confirm this. Do not repeat it — the state is being reconciled.",
    key
  );
}

/**
 * The person a row action is about, resolved from the RECORD when the target
 * names one.
 *
 * A row action carries two things about a person: the subject in its payload,
 * and a target that is either that same person or the signal being acted on.
 * The subject cannot be refused — the clinician chose it by clicking a row, and
 * there is no way for a client not to send it — but it cannot be trusted
 * either. When the target names a signal, THAT SIGNAL'S OWN personId is
 * authoritative: a payload that disagrees would record a review against one
 * person citing another person's signal. Both are in the same tenant, so this
 * is not a disclosure; it is a wrong entry in a clinical chart, which is its
 * own harm.
 *
 * Returns the signal when the target named one, so a caller that needs the rest
 * of it does not load it twice.
 */
async function subjectFor(
  ctx: TenantContext,
  command: { target: string; payload: { personId: string } }
): Promise<
  | { ok: true; personId: string; signalId: string | null; signal: AttentionSignal | null }
  | { ok: false; reason: string }
> {
  const claimed = command.payload.personId.trim();
  if (!claimed) return { ok: false, reason: "That row does not say who it is about." };
  // The target IS the person when the row has no signal behind it.
  if (command.target === claimed) {
    return { ok: true, personId: claimed, signalId: null, signal: null };
  }
  const signal = await getSignal(ctx, command.target);
  if (!signal) {
    // Not "forbidden" and not an error: a signal in another tenant does not
    // exist, so the answer cannot be used to probe for one.
    return { ok: false, reason: "That item is no longer in your queue." };
  }
  if (signal.personId !== claimed) {
    return {
      ok: false,
      reason: "That row and that item are about different people. Reopen the queue and try again.",
    };
  }
  return { ok: true, personId: signal.personId, signalId: signal.id, signal };
}

/**
 * §5's "Record contact". Records an ATTEMPT and says so.
 *
 * The vocabulary matters more than the mechanism here. There is no delivery
 * path in this build, so a clinician recording contact is recording that they
 * tried — §4.5's content rule: "Your care team has a new item to review", never
 * "Your care team was notified". The stored note is the clinician's own account
 * of what happened, and the result's summary says "recorded" rather than "sent".
 */
export async function recordContact(input: CommandInput<{ personId: string; note: string }>): Promise<CommandResult<RecordedChange>> {
  const { ctx, clinicianId, experience } = await clinicianContext();
  try {
    const command = resolveCommand(experience, input);
    const note = command.payload.note.trim();
    if (!note) {
      return rejected(
        "Say what happened. A contact attempt with no account of it is a row that proves somebody pressed a button."
      );
    }
    const subject = await subjectFor(ctx, command);
    if (!subject.ok) return unavailable(subject.reason);
    // Idempotency, checked before writing rather than after. §9: retry must
    // not create a duplicate.
    const existing = await currentCareActions(ctx, subject.personId, 20);
    const already = existing.find((a) => a.note === note && a.action === "contact");
    if (already) {
      return confirmed({
        summary: "This attempt was already recorded. Nothing was written twice.",
        recordId: already.id,
      });
    }
    const recordId = await recordCareAction(ctx, {
      personId: subject.personId,
      clinicianId,
      action: "contact",
      signalId: subject.signalId,
      note,
      sourceSurface: "command_center_row",
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "contact_attempt_recorded", target: command.payload.personId,
      detail: { recordId, idempotencyKey: command.idempotencyKey },
    });
    // §31.7: which action the row's hierarchy actually produced. Code only.
    noteSignal("primary_action_selected", { actionCode: "record_contact" }, { actorRole: "clinician" });
    revalidatePath("/clinician/today");
    return confirmed({
      // Says what it is. Not "contacted", not "notified".
      summary: "Recorded that you attempted contact, and what happened. This is not proof of delivery.",
      recordId,
    });
  } catch (err) {
    return fromError(err, input.idempotencyKey);
  }
}

/**
 * §5's "Assign". Records who owns this.
 *
 * AND SAYS THAT NOBODY WAS TOLD. §6's rule about ownership is the one that
 * applies: "A decorative owner chip must not imply that somebody accepted
 * responsibility." There is no delivery path, so assignment records an
 * intention rather than a handover, and the result says so.
 */
export async function assignWork(input: CommandInput<{ personId: string; ownerId: string; ownerName: string }>): Promise<CommandResult<RecordedChange>> {
  const { ctx, clinicianId, experience } = await clinicianContext();
  try {
    const command = resolveCommand(experience, input);
    if (!command.payload.ownerId.trim()) return rejected("Choose who owns this.");
    const subject = await subjectFor(ctx, command);
    if (!subject.ok) return unavailable(subject.reason);
    const recordId = await recordCareAction(ctx, {
      personId: subject.personId,
      clinicianId,
      // The nearest thing the care-action vocabulary has, and the note carries
      // the specifics. Inventing an `assign` action here would put a ninth
      // value in a closed vocabulary from a presentation module, which is the
      // wrong direction for a rule to travel.
      action: "add_followup",
      signalId: subject.signalId,
      note: `Assigned to ${command.payload.ownerName}.`,
      outcomeState: `owner:${command.payload.ownerId}`,
      sourceSurface: "command_center_row",
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "work_assigned", target: command.payload.personId,
      detail: { recordId, ownerId: command.payload.ownerId },
    });
    // §31.7: which action the row's hierarchy actually produced. Code only.
    noteSignal("primary_action_selected", { actionCode: "assign_work" }, { actorRole: "clinician" });
    revalidatePath("/clinician/today");
    return confirmed({
      summary: `Recorded ${command.payload.ownerName} as the owner. Nobody has been notified — there is no delivery path in this build.`,
      recordId,
    });
  } catch (err) {
    return fromError(err, input.idempotencyKey);
  }
}

/**
 * Completing a review on a row that has no attention signal behind it.
 *
 * TWO CASES, and they close differently because they mean different things.
 *
 * An ALERT-DERIVED row is the safety engine's output. Reviewing it means
 * closing this person's open alerts, and `closeAlert` already carries the rule
 * that matters: an urgent- or high-band alert closes with a documented action,
 * not an acknowledgement. So the note the drawer calls optional is REQUIRED
 * here, and the refusal says why rather than failing quietly. Closing the
 * alerts is also what makes the row change: the queue reads an alert's status,
 * so a reviewed alert stops asking.
 *
 * A CASELOAD-DERIVED row is a person the caseload surfaced with no alert at
 * all — days since contact, unresolved distress. There is nothing to close, so
 * the review is exactly what it says: a recorded care action. The row will
 * still be there tomorrow, because the thing that raised it has not changed,
 * and saying otherwise would be the false confirmation §4.4 forbids.
 */
async function completeReviewWithoutSignal(args: {
  ctx: TenantContext;
  clinicianId: string;
  personId: string;
  note: string;
}): Promise<CommandResult<RecordedChange>> {
  const note = args.note.trim();
  const open = (await alertQueue({ tenantId: args.ctx.tenantId }))
    .filter((a) => a.personId === args.personId && a.status === "open");

  let closed = 0;
  for (const alert of open) {
    try {
      await closeAlert({
        alertId: alert.id, tenantId: args.ctx.tenantId,
        clinicianId: args.clinicianId, resolution: note,
      });
      closed += 1;
    } catch (err) {
      if (err instanceof AlertClosureError) return rejected(err.message);
      throw err;
    }
  }

  const recordId = await recordCareAction(args.ctx, {
    personId: args.personId,
    clinicianId: args.clinicianId,
    action: "review",
    signalId: null,
    note: note || null,
    sourceSurface: "command_center_row",
  });
  await audit({
    actorId: args.clinicianId, actorRole: "clinician", family: "clinical",
    type: "review_completed", target: args.personId,
    detail: { recordId, signalId: null, alertsClosed: closed },
  });
  noteSignal("queue_item_resolved", {
    // No signal, so no signal type. The reason code says which kind of row
    // this was, which is the honest answer and still a code.
    reasonCode: closed > 0 ? "alert_review" : "caseload_review",
    ownerRole: "clinician",
  }, { actorRole: "clinician" });
  noteSignal("primary_action_selected", { actionCode: "complete_review" }, { actorRole: "clinician" });
  revalidatePath("/clinician/today");

  return confirmed({
    summary: closed > 0
      ? `Recorded your review and closed ${closed} open ${closed === 1 ? "alert" : "alerts"} for this person.`
      : "Recorded your review. Nothing was closed — this row came from the caseload, not an alert, so it stays until what raised it changes.",
    recordId,
  });
}

/**
 * §5's "Complete review". The one that acknowledges.
 *
 * EXPECTED VERSION IS CHECKED, and this is where §5's concurrency rule lands:
 * "If another clinician completes or changes the item, present the updated
 * state and preserve any unsent draft according to policy. Do not silently
 * overwrite. Reconcile with the server before accepting a decision."
 *
 * So a review submitted against a signal that has already moved returns
 * `stale` with what the server now holds, rather than acknowledging on top of
 * somebody else's decision.
 */
export async function completeReview(input: CommandInput<{ personId: string; note: string }>): Promise<CommandResult<RecordedChange>> {
  const { ctx, clinicianId, experience } = await clinicianContext();
  try {
    const command = resolveCommand(experience, input);
    const subject = await subjectFor(ctx, command);
    if (!subject.ok) return unavailable(subject.reason);

    // MOST OF THE QUEUE IS NOT AN ATTENTION SIGNAL, and this action refused all
    // of it.
    //
    // A work item comes from one of three places. An attention signal has a
    // lineage and a state machine. An ALERT-DERIVED row is the safety engine's
    // own output — the rows that carry safety authority, and the ones a
    // clinician most needs to close. A CASELOAD-DERIVED row is a person the
    // caseload flagged with no alert at all. Only the first has a signal, and
    // this function began by loading one and giving up when there was none —
    // so "Complete review" on a safety row produced "Not available here", every
    // time.
    //
    // Found the same way as the missing alerts it now closes: by pressing the
    // button on a running queue.
    if (!subject.signal) {
      return completeReviewWithoutSignal({
        ctx, clinicianId, personId: subject.personId, note: command.payload.note,
      });
    }
    const signal = subject.signal;
    const signalId = signal.id;
    // §5's reconcile-before-accept. The version is the signal's own state plus
    // its last update, which is what changes when somebody else acts.
    const currentVersion = `${signal.state}@${signal.evidenceAt}`;
    if (command.expectedVersion && command.expectedVersion !== currentVersion) {
      return stale(
        "Somebody else changed this while you were reading it. Read what changed before deciding again.",
        currentVersion
      );
    }
    if (signal.state !== "open" && signal.state !== "acknowledged") {
      return stale(`This item is already ${signal.state.replace(/_/g, " ")}.`, currentVersion);
    }

    await acknowledgeSignal(ctx, {
      signalId, clinicianId, sourceSurface: "command_center_row",
    });
    const recordId = await recordCareAction(ctx, {
      personId: signal.personId,
      clinicianId,
      action: "review",
      signalId,
      note: command.payload.note.trim() || null,
      sourceSurface: "command_center_row",
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "review_completed", target: signal.personId,
      detail: { recordId, signalId },
    });
    // §31.7's two action signals, from the one place a review is completed.
    //
    // `queue_item_resolved` measures TIME TO ACCOUNTABLE ACTION, so the
    // duration is from when the signal was first detected to now — not from
    // when this request started, which would measure the form and not the
    // queue. Its privacy rule allows a reason code, an owner role and a
    // duration, and the signal type IS the reason code; the person, the note
    // and the clinician stay out.
    noteSignal("queue_item_resolved", {
      reasonCode: signal.signalType,
      ownerRole: "clinician",
      durationMs: Math.max(0, Date.now() - Date.parse(signal.firstDetectedAt)),
    }, { actorRole: "clinician" });
    noteSignal("primary_action_selected", { actionCode: "complete_review" }, { actorRole: "clinician" });

    revalidatePath("/clinician/today");
    return confirmed({
      summary: "Recorded your review. The row is acknowledged and stays in the record.",
      recordId,
    });
  } catch (err) {
    return fromError(err, input.idempotencyKey);
  }
}
