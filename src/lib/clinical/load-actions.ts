"use server";

import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import type { TenantContext } from "../repository";
import {
  computeTherapeuticLoad, saveTherapeuticLoad, recordLoadReview,
  TherapeuticLoadError, LOAD_DECISIONS, type LoadDecision,
} from "./therapeutic-load";

// Server actions for the therapeutic-load surface (expansion handoff 05 §8,
// §12 Phase 3).
//
// THE THING THIS FILE DOES NOT HAVE is the point of it. §8: "these actions
// record judgement; they do not automatically change plan/gates." §13: "no
// system action autonomously changes treatment intensity, module access, or
// trauma-processing status." So there is no action here that writes to a gate,
// a module unlock, a plan, or an alert — `review_progression` records that a
// clinician intends to look at something, and looking is theirs to do.
//
// The tenant is read from the caller's own record, never accepted from the
// browser. A tenant supplied by the caller is a tenant an attacker can choose.

export interface LoadActionResult {
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

/** Record a clinician's decision (§8's six actions). */
export async function reviewTherapeuticLoad(formData: FormData): Promise<LoadActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const personId = String(formData.get("personId") ?? "");
  const decision = String(formData.get("decision") ?? "") as LoadDecision;
  const note = String(formData.get("note") ?? "");

  if (!(LOAD_DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, error: "Choose what you make of this." };
  }
  try {
    // The snapshot is computed and stored HERE rather than trusted from the
    // form, so a decision always lands on a reading Steady can still produce
    // from the record — and so a clinician cannot record a judgement about a
    // state that no longer exists.
    const snapshot = await computeTherapeuticLoad(ctx, personId);
    await saveTherapeuticLoad(ctx, snapshot, clinicianId);
    await recordLoadReview(ctx, {
      personId, snapshotId: snapshot.id, clinicianPersonId: clinicianId, decision, note,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "therapeutic_load_reviewed", target: personId,
      detail: { decision, snapshotId: snapshot.id, state: snapshot.state },
    });
    revalidatePath(`/clinician/member/${personId}/load`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof TherapeuticLoadError ? err.message : "That could not be recorded.",
    };
  }
}
