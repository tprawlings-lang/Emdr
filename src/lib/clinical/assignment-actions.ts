"use server";

// Server actions for assigned support (17 September handoff, P3).
//
// Thin, like every other action file here: authenticate, resolve the acting
// clinician's tenant from their OWN record rather than from the request, hand
// the decision to the domain, and redirect. The rules live in
// assigned-support.ts and are tested there; a second copy in a form handler is
// a second copy that will differ.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import type { TenantContext } from "../repository";
import {
  assignSupport, changeAssignment, AssignmentRefused,
  type Availability, type AssignmentChange,
} from "./assigned-support";

async function actingTenant(clinicianId: string): Promise<string> {
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinicianId])) as
    | { tenant_id: string } | undefined;
  return row?.tenant_id ?? PLATFORM_TENANT_ID;
}

/** Back to the person's Care screen, carrying a refusal the clinician can read. */
function back(personId: string, error?: string): never {
  redirect(
    `/clinician/member/${personId}/care${error ? `?error=${encodeURIComponent(error)}` : "#support"}`
  );
}

export async function assignSupportAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const personId = String(formData.get("personId") ?? "");
  const ctx: TenantContext = { tenantId, personId: clinician.id };

  const expires = String(formData.get("expiresAt") ?? "").trim();

  try {
    await assignSupport(ctx, {
      personId,
      supportId: String(formData.get("supportId") ?? ""),
      purposeCode: String(formData.get("purposeCode") ?? ""),
      patientExplanation: String(formData.get("patientExplanation") ?? "").slice(0, 2000),
      availability: String(formData.get("availability") ?? "assigned") as Availability,
      // A date, kept as a day boundary. An expiry recorded to the second on a
      // control that offers a date would be a precision the clinician did not
      // choose.
      expiresAt: expires ? `${expires} 23:59:59` : null,
      // FROM THE FORM, not generated here. The key is rendered into the page
      // when the form is drawn, so re-submitting the SAME form — a double
      // click, a refresh, a back button — carries the same key and produces one
      // assignment. A key minted in the action would be new every time, which
      // is the bug the key exists to prevent.
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
  } catch (e) {
    if (e instanceof AssignmentRefused) back(personId, e.message);
    throw e;
  }

  revalidatePath(`/clinician/member/${personId}/care`);
  back(personId);
}

export async function changeAssignmentAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const personId = String(formData.get("personId") ?? "");
  const ctx: TenantContext = { tenantId, personId: clinician.id };

  try {
    await changeAssignment(ctx, {
      assignmentId: String(formData.get("assignmentId") ?? ""),
      to: String(formData.get("to") ?? "") as AssignmentChange,
      note: String(formData.get("note") ?? "").slice(0, 2000),
    });
  } catch (e) {
    if (e instanceof AssignmentRefused) back(personId, e.message);
    throw e;
  }

  revalidatePath(`/clinician/member/${personId}/care`);
  back(personId);
}

// ---------------------------------------------------------------------------
// Caseload assignment — who this person's clinician is
// ---------------------------------------------------------------------------

/**
 * Assign a person to a clinician, or leave them unassigned with a reason.
 *
 * ON THE CARE SCREEN BECAUSE THAT IS WHAT IT IS FOR: its own docstring says
 * "what is active for this person and who is accountable for it", and the
 * accountability section could only propose a handoff — a transfer between two
 * people, which is not the same as saying who holds somebody in the first
 * place, and which nobody could do because nobody held anybody.
 *
 * THE CLINICIAN IS CHOSEN FROM ROLE ASSIGNMENTS, NOT FROM ACCOUNTS. Eleven of
 * the twelve fabricated clinicians are persons with a role and no login, and
 * being able to sign in was never a condition of holding a caseload — the same
 * correction the Assign control on the queue already needed.
 */
export async function assignCaseloadAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const personId = String(formData.get("personId") ?? "").trim();
  const clinicianPersonId = String(formData.get("clinician_person_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || null;
  if (!personId) back(personId, "No person was named.");

  const { assignToCaseload, endAssignment } = await import("./caseload-assignment");

  // UNASSIGNING IS A DECISION, NOT AN ABSENCE, so it goes through its own path
  // and requires a reason. Somebody leaves and their people are unassigned
  // until a person decides where they go; the product has to be able to say
  // that rather than keeping a name on the row nobody is behind.
  if (clinicianPersonId === "__none__") {
    const r = await endAssignment({ tenantId, personId, reason: reason ?? "" });
    if (!r.ok) back(personId, r.reason ?? "That could not be recorded.");
  } else {
    if (!clinicianPersonId) back(personId, "Choose a clinician, or say why nobody holds this person.");
    const r = await assignToCaseload({
      tenantId, personId, clinicianPersonId,
      // The acting clinician's PERSON id, which for an account holder is the
      // same value as their user id.
      assignedBy: clinician.id,
      reason,
    });
    if (!r.ok) back(personId, r.reason);
  }

  revalidatePath(`/clinician/member/${personId}/care`);
  revalidatePath("/clinician/today");
  revalidatePath("/clinician/caseload");
  back(personId);
}
