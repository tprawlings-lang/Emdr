"use server";

import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import { thoughtsSurfaceAvailable } from "./thoughts-flags";
import type { TenantContext } from "../repository";
import {
  acceptMembership, rejectMembership, revisitMembership, createThread,
  proposeMembership, NotProposedError, DuplicateMembershipError,
} from "./thread-store";
import {
  recordThreadCreated, recordConnectionProposed,
  recordConnectionAccepted, recordConnectionRejected,
} from "./thoughts";
import type { ActionResult } from "./thought-actions";

// Server actions for threads (§14's command surface, Phase 3).
//
// The store persists and this layer records. Same split as memory-store and
// save-thoughts: an event is emitted only after the write it describes has
// landed, because the ledger is append-only and there is no taking back an
// event for a write that failed.
//
// EVERY ACTION IS BEHIND THE THREADS FLAG, checked here as well as in the
// component — a form post does not go through the component that decided
// whether to render the form.

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

function off(): ActionResult {
  return { ok: false, error: "Threads are not enabled in this environment." };
}

/** Connect. */
export async function acceptConnectionAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THREADS")) return off();
  const { ctx, clinicianId } = await clinicianContext();
  const membershipId = String(formData.get("membershipId") ?? "");
  try {
    const m = await acceptMembership(ctx, membershipId, new Date().toISOString());
    await recordConnectionAccepted({
      membershipId: m.id, tenantId: ctx.tenantId, personId: m.personId, decidedBy: clinicianId,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "clinical_thread_connection_accepted", target: m.threadId,
      detail: { personId: m.personId, memoryItemId: m.memoryItemId },
    });
    revalidatePath(`/clinician/member/${m.personId}/thoughts`);
    return { ok: true };
  } catch (e) {
    if (e instanceof NotProposedError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Not related. */
export async function rejectConnectionAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THREADS")) return off();
  const { ctx, clinicianId } = await clinicianContext();
  const membershipId = String(formData.get("membershipId") ?? "");
  try {
    const m = await rejectMembership(ctx, membershipId, new Date().toISOString());
    await recordConnectionRejected({
      membershipId: m.id, tenantId: ctx.tenantId, personId: m.personId, decidedBy: clinicianId,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "clinical_thread_connection_rejected", target: m.threadId,
      detail: { personId: m.personId, memoryItemId: m.memoryItemId },
    });
    revalidatePath(`/clinician/member/${m.personId}/thoughts`);
    return { ok: true };
  } catch (e) {
    if (e instanceof NotProposedError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Reopen a refusal, deliberately (Phase 3's definition of done). */
export async function revisitConnectionAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THREADS")) return off();
  const { ctx, clinicianId } = await clinicianContext();
  const membershipId = String(formData.get("membershipId") ?? "");
  try {
    const m = await revisitMembership(ctx, membershipId);
    await recordConnectionProposed({
      membershipId: m.id, threadId: m.threadId, memoryItemId: m.memoryItemId,
      tenantId: ctx.tenantId, personId: m.personId,
      // The clinician is now the one asking. Recording it as a system proposal
      // would make a person's deliberate change of mind look like the matcher
      // trying again, which is the thing the rule forbids.
      proposedBy: "clinician", score: null, policyVersion: null,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "clinical_thread_connection_revisited", target: m.threadId,
      detail: { personId: m.personId, memoryItemId: m.memoryItemId },
    });
    revalidatePath(`/clinician/member/${m.personId}/thoughts`);
    return { ok: true };
  } catch (e) {
    if (e instanceof NotProposedError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Open a thread and attach an item to it, in one step.
 *
 *  The clinician's own path into threads: they have an item and a theme in
 *  mind, and no existing thread matches. The membership is created ACCEPTED
 *  here — a clinician naming a theme and filing an item under it in one action
 *  has made the connection themselves, and asking them to confirm their own
 *  intent on the next screen is ceremony. `proposedBy` records that it was
 *  theirs, so nothing downstream mistakes it for a model suggestion. */
export async function createThreadWithItemAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THREADS")) return off();
  const { ctx, clinicianId } = await clinicianContext();
  const personId = String(formData.get("personId") ?? "");
  const memoryItemId = String(formData.get("memoryItemId") ?? "");
  const label = String(formData.get("canonicalLabel") ?? "").trim().slice(0, 120);
  const threadType = String(formData.get("threadType") ?? "theme").slice(0, 40);
  if (!personId || !label) return { ok: false, error: "A thread needs a name." };

  const now = new Date().toISOString();
  const thread = await createThread(ctx, {
    personId, threadType, canonicalLabel: label, createdBy: "clinician", firstSeenAt: now,
  });
  await recordThreadCreated({
    threadId: thread.id, tenantId: ctx.tenantId, personId,
    threadType, canonicalLabel: label, createdBy: "clinician", actorId: clinicianId,
  });

  if (memoryItemId) {
    try {
      const m = await proposeMembership(ctx, {
        personId, threadId: thread.id, memoryItemId, proposedBy: "clinician",
      });
      await recordConnectionProposed({
        membershipId: m.id, threadId: thread.id, memoryItemId,
        tenantId: ctx.tenantId, personId, proposedBy: "clinician",
        score: null, policyVersion: null,
      });
      await acceptMembership(ctx, m.id, now);
      await recordConnectionAccepted({
        membershipId: m.id, tenantId: ctx.tenantId, personId, decidedBy: clinicianId,
      });
    } catch (e) {
      if (!(e instanceof DuplicateMembershipError)) throw e;
    }
  }

  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "clinical_thread_created", target: thread.id,
    detail: { personId, threadType },
  });
  revalidatePath(`/clinician/member/${personId}/thoughts`);
  return { ok: true };
}
