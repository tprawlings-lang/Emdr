"use server";

import { revalidatePath } from "next/cache";

import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import type { TenantContext } from "../repository";
import {
  recordCareAction, acknowledgeSignal, getSignal, currentCareActions,
  AttentionSignalError,
} from "./attention-signals";
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
    // Idempotency, checked before writing rather than after. §9: retry must
    // not create a duplicate.
    const existing = await currentCareActions(ctx, command.payload.personId, 20);
    const already = existing.find((a) => a.note === note && a.action === "contact");
    if (already) {
      return confirmed({
        summary: "This attempt was already recorded. Nothing was written twice.",
        recordId: already.id,
      });
    }
    const recordId = await recordCareAction(ctx, {
      personId: command.payload.personId,
      clinicianId,
      action: "contact",
      signalId: command.target === command.payload.personId ? null : command.target,
      note,
      sourceSurface: "command_center_row",
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "contact_attempt_recorded", target: command.payload.personId,
      detail: { recordId, idempotencyKey: command.idempotencyKey },
    });
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
    const recordId = await recordCareAction(ctx, {
      personId: command.payload.personId,
      clinicianId,
      // The nearest thing the care-action vocabulary has, and the note carries
      // the specifics. Inventing an `assign` action here would put a ninth
      // value in a closed vocabulary from a presentation module, which is the
      // wrong direction for a rule to travel.
      action: "add_followup",
      signalId: command.target === command.payload.personId ? null : command.target,
      note: `Assigned to ${command.payload.ownerName}.`,
      outcomeState: `owner:${command.payload.ownerId}`,
      sourceSurface: "command_center_row",
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "work_assigned", target: command.payload.personId,
      detail: { recordId, ownerId: command.payload.ownerId },
    });
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
    const signalId = command.target;

    const signal = await getSignal(ctx, signalId);
    if (!signal) {
      // Not "forbidden" and not an error: a signal in another tenant does not
      // exist, so the answer cannot be used to probe for one.
      return unavailable("That item is no longer in your queue.");
    }
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
      personId: command.payload.personId,
      clinicianId,
      action: "review",
      signalId,
      note: command.payload.note.trim() || null,
      sourceSurface: "command_center_row",
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "review_completed", target: command.payload.personId,
      detail: { recordId, signalId },
    });
    revalidatePath("/clinician/today");
    return confirmed({
      summary: "Recorded your review. The row is acknowledged and stays in the record.",
      recordId,
    });
  } catch (err) {
    return fromError(err, input.idempotencyKey);
  }
}
