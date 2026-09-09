"use server";

// Creating a fabricated patient, as a command (demo only).
//
// Thin, like every other action in this codebase: authenticate, resolve the
// tenant from the actor's own record, delegate, revalidate. The depth and the
// presentation are closed sets and are validated against them rather than
// trusted — a form field is a string somebody can change.
//
// THE TENANT IS READ, NEVER ACCEPTED, AND IT COMES FROM THE CLINICIAN. The
// caseload selects members by tenant, so the tenant IS the clinical assignment:
// a patient in a clinician's tenant is in their caseload and one anywhere else
// is invisible to them. A tenant supplied by the caller would be a tenant an
// attacker could choose, and here it would mean creating a person inside
// somebody else's organization — so the chosen clinician's id is looked up
// against the active clinicians and their own tenant is used.

import { revalidatePath } from "next/cache";
import { requireDemoAdmin } from "../auth";

import {
  DEPTHS, PRESENTATIONS, type Depth, type Presentation,
} from "./new-patient";
import {
  createDemoPatient, NotDemoError, assignableClinicians, type CreatedPatient,
} from "./new-patient-store";
import { NotFabricatedError } from "./new-patient";

export interface NewPatientResult {
  ok: boolean;
  patient?: CreatedPatient;
  error?: string;
}

export async function createDemoPatientAction(formData: FormData): Promise<NewPatientResult> {
  const admin = await requireDemoAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const emailRaw = String(formData.get("email") ?? "").trim();
  const depth = String(formData.get("depth") ?? "");
  const presentation = String(formData.get("presentation") ?? "");

  if (!DEPTHS.includes(depth as Depth)) {
    return { ok: false, error: "Pick how far to take them." };
  }
  if (!PRESENTATIONS.includes(presentation as Presentation)) {
    return { ok: false, error: "Pick a presentation." };
  }

  // THE TENANT COMES FROM THE CHOSEN CLINICIAN, NOT FROM THE ADMIN. The
  // caseload selects members by tenant, so the tenant is the assignment — and
  // the demo admin is in the platform tenant while every clinician and member
  // is in an organization tenant. Using the admin's created a patient nobody
  // could see, which is the whole point of the feature.
  //
  // The clinician ID arrives from a form field, so it is looked up rather than
  // trusted: an id that is not an active clinician gets no tenant and the
  // request is refused.
  const clinicianId = String(formData.get("clinicianId") ?? "").trim();
  const clinicians = await assignableClinicians();
  const clinician = clinicians.find((x) => x.id === clinicianId);
  if (!clinician) {
    return { ok: false, error: "Pick the clinician who will see them." };
  }
  const tenantId = clinician.tenantId;

  try {
    const patient = await createDemoPatient({
      name,
      email: emailRaw || undefined,
      depth: depth as Depth,
      presentation: presentation as Presentation,
      tenantId,
      actorId: admin.id,
    });
    // The caseload and the patient directory both read this tenant, so they are
    // stale the moment this returns.
    revalidatePath("/admin/demo");
    revalidatePath("/clinician/today");
    revalidatePath("/clinician/patients");
    revalidatePath("/clinician/caseload");
    return { ok: true, patient };
  } catch (err) {
    if (err instanceof NotFabricatedError || err instanceof NotDemoError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
