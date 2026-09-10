"use server";

import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import type { TenantContext } from "../repository";
import {
  recordClinicianIntervention, confirmInstance, remapInstance, InterventionError,
} from "./interventions";
import { isInterventionClass } from "./intervention-vocabulary";
import { proposeNormalization, type NormalizationCandidate } from "./response-intelligence";

// Server actions for the intervention record (expansion handoff 02).
//
// Thin, like the console's other actions: authenticate, resolve the tenant from
// the caller's own record, delegate, revalidate. The clinical rules live in
// interventions.ts where they are tested; a second copy in a form handler is
// how the two come to disagree.
//
// THE TENANT IS READ, NEVER ACCEPTED. A tenant supplied by the caller is a
// tenant an attacker can choose.

export interface InterventionActionResult {
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

/** Record an intervention that happened outside Steady (§2's
 *  external_clinician_entered, §10's clinician-notes adapter). */
export async function recordInterventionAction(
  formData: FormData
): Promise<InterventionActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const personId = String(formData.get("personId") ?? "");
  const wording = String(formData.get("wording") ?? "").trim().slice(0, 160);
  const cls = String(formData.get("interventionClass") ?? "");
  const occurredAt = String(formData.get("occurredAt") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  if (!personId) return { ok: false, error: "Missing person." };
  if (!wording) return { ok: false, error: "Name what you did." };
  if (!isInterventionClass(cls)) return { ok: false, error: "Choose what kind of thing it was." };

  try {
    await recordClinicianIntervention(ctx, {
      personId,
      wording,
      interventionClass: cls,
      // A date with no time is midnight, which is a lie about when a session
      // happened but an honest one about the day — and the day is the
      // granularity §6's windows actually need.
      occurredAt: occurredAt ? `${occurredAt} 12:00:00` : new Date().toISOString().slice(0, 19).replace("T", " "),
      clinicianId,
      note: note || null,
    });
  } catch (err) {
    if (err instanceof InterventionError) return { ok: false, error: err.message };
    throw err;
  }

  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "intervention_recorded", target: personId,
    detail: { interventionClass: cls },
  });
  revalidatePath(`/clinician/member/${personId}/responses`);
  return { ok: true };
}

/** Accept the normalization Steady inferred for one exposure (§8's review). */
export async function confirmInstanceAction(
  instanceId: string, personId: string
): Promise<InterventionActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  try {
    await confirmInstance(ctx, instanceId, clinicianId);
  } catch (err) {
    if (err instanceof InterventionError) return { ok: false, error: err.message };
    throw err;
  }
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "intervention_confirmed", target: personId, detail: { instanceId },
  });
  revalidatePath(`/clinician/member/${personId}/responses`);
  return { ok: true };
}

/** Correct a mis-normalization. Appends; never erases (§7). */
export async function remapInstanceAction(
  formData: FormData
): Promise<InterventionActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const personId = String(formData.get("personId") ?? "");
  const instanceId = String(formData.get("instanceId") ?? "");
  const toDefinitionId = String(formData.get("toDefinitionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!personId || !instanceId || !toDefinitionId) return { ok: false, error: "Missing details." };

  try {
    await remapInstance(ctx, { instanceId, toDefinitionId, clinicianId, reason: reason || undefined });
  } catch (err) {
    if (err instanceof InterventionError) return { ok: false, error: err.message };
    throw err;
  }
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "intervention_remapped", target: personId,
    detail: { instanceId, toDefinitionId },
  });
  revalidatePath(`/clinician/member/${personId}/responses`);
  return { ok: true };
}

/**
 * Which already-recorded interventions a clinician's wording might mean (§8).
 *
 * SUGGESTS AND NOTHING ELSE. §8 lets the normalizer "map clinician wording to
 * candidate canonical intervention" and forbids it to "auto-create clinical
 * intervention identity without review when ambiguous" — so this returns
 * candidates and writes nothing at all. The clinician either picks one or types
 * their own words, and either way a person made the decision.
 *
 * It exists because the alternative is silent: "cold water" and "Cold water at
 * the sink" become two canonical keys, one person's evidence splits across two
 * counts, and a five-exposure pattern quietly reads as two insufficient ones.
 */
export async function suggestNormalizationAction(
  wording: string
): Promise<{ ok: boolean; candidates: NormalizationCandidate[] }> {
  const { ctx } = await clinicianContext();
  const text = wording.trim();
  if (text.length < 3) return { ok: true, candidates: [] };
  try {
    return { ok: true, candidates: await proposeNormalization(ctx, text) };
  } catch {
    // A suggestion that fails is a suggestion nobody sees, not an error a
    // clinician has to dismiss before recording what they did.
    return { ok: true, candidates: [] };
  }
}
