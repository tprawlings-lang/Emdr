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
