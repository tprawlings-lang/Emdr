"use server";

// Server actions for the Steady Clinical console (Phase 4).
//
// Thin by design: every action authenticates, resolves the acting clinician's
// tenant, delegates to the service layer where the rules live, and redirects.
// No clinical logic here — the rules are tested in `tests/clinical-surface.test.ts`
// and must not acquire a second, untested copy in a form handler.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { closeAlert, AlertClosureError } from "./alerts";
import { approve, correct, override, recordFeedback, ReviewError, type FeedbackCategory } from "./review";
import {
  fileNote, setNoteStatus, ReviewNoteError,
  type NotePriority, type NoteStatus,
} from "./review-notes";

/** The tenant the acting clinician belongs to.
 *
 *  Read from their own record rather than accepted from the request: a tenant
 *  supplied by the caller is a tenant an attacker can choose. */
async function actingTenant(clinicianId: string): Promise<string> {
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinicianId])) as
    | { tenant_id: string } | undefined;
  return row?.tenant_id ?? PLATFORM_TENANT_ID;
}

export async function closeAlertAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const alertId = String(formData.get("alertId") ?? "");
  const resolution = String(formData.get("resolution") ?? "").slice(0, 2000);

  try {
    await closeAlert({ alertId, clinicianId: clinician.id, tenantId, resolution });
  } catch (e) {
    if (e instanceof AlertClosureError) {
      redirect(`/clinician/caseload?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  revalidatePath("/clinician/caseload");
  redirect("/clinician/caseload");
}

export async function approveSummaryAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const personId = String(formData.get("personId") ?? "");
  const evidenceIds = String(formData.get("evidenceIds") ?? "").split(",").filter(Boolean);
  const note = String(formData.get("note") ?? "").slice(0, 1000) || undefined;

  await approve({ clinicianId: clinician.id, personId, tenantId, subject: "summary", evidenceIds, note });
  revalidatePath(`/clinician/member/${personId}/record`);
  redirect(`/clinician/member/${personId}/record?done=approved`);
}

export async function correctRecordAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const personId = String(formData.get("personId") ?? "");
  const supersedesEventId = String(formData.get("eventId") ?? "");
  const rationale = String(formData.get("rationale") ?? "").slice(0, 2000);
  const correctionText = String(formData.get("correction") ?? "").slice(0, 2000);

  try {
    await correct({
      clinicianId: clinician.id, personId, tenantId, supersedesEventId, rationale,
      correction: { note: correctionText },
    });
  } catch (e) {
    if (e instanceof ReviewError) {
      redirect(`/clinician/member/${personId}/record?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  revalidatePath(`/clinician/member/${personId}/record`);
  redirect(`/clinician/member/${personId}/record?done=corrected`);
}

export async function overrideAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const personId = String(formData.get("personId") ?? "");
  const target = String(formData.get("target") ?? "");
  const reason = String(formData.get("reason") ?? "").slice(0, 2000);

  try {
    await override({ clinicianId: clinician.id, personId, tenantId, target, reason });
  } catch (e) {
    if (e instanceof ReviewError) {
      redirect(`/clinician/member/${personId}/record?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  revalidatePath(`/clinician/member/${personId}/record`);
  redirect(`/clinician/member/${personId}/record?done=overridden`);
}

/** Override recorded from the gate-review drawer (§9.2, §15.1, §15.3).
 *
 *  A sibling of `overrideAction` rather than a parameter on it, because the two
 *  return to different surfaces and a redirect target smuggled through a hidden
 *  form field is a redirect a caller can choose.
 *
 *  §15.1 forbids an optimistic update here: the drawer posts and waits, and
 *  what comes back is the re-derived server state. §15.3 wants the audit record
 *  reachable from the result, which `override()` already appends — an event and
 *  an audit row, both carrying the actor, the target and the reason.
 *
 *  The safety boundary is NOT re-implemented here. `override()` refuses a
 *  never-overridable target itself; this only routes the refusal somewhere the
 *  clinician can read it. */
export async function gateOverrideAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const personId = String(formData.get("personId") ?? "");
  const target = String(formData.get("target") ?? "");
  const reason = String(formData.get("reason") ?? "").slice(0, 2000);

  try {
    await override({ clinicianId: clinician.id, personId, tenantId, target, reason });
  } catch (e) {
    if (e instanceof ReviewError) {
      redirect(`/clinician/member/${personId}?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  revalidatePath(`/clinician/member/${personId}`);
  redirect(`/clinician/member/${personId}?done=overridden`);
}

export async function feedbackAction(formData: FormData) {
  const clinician = await requireClinician();
  const tenantId = await actingTenant(clinician.id);
  const personId = String(formData.get("personId") ?? "");
  const category = String(formData.get("category") ?? "accurate") as FeedbackCategory;
  const note = String(formData.get("note") ?? "").slice(0, 1000) || undefined;
  const generator = String(formData.get("generator") ?? "unknown");

  const r = await recordFeedback({
    clinicianId: clinician.id, personId, tenantId, category, subject: "summary",
    provenance: { generator }, note,
  });
  revalidatePath(`/clinician/member/${personId}/record`);
  redirect(`/clinician/member/${personId}/record?done=${r.requiresImmediateReview ? "flagged" : "feedback"}`);
}

// ---------------------------------------------------------------------------
// Reviewer change requests (Phase 4 testing cycle)
// ---------------------------------------------------------------------------

export async function fileNoteAction(formData: FormData) {
  const clinician = await requireClinician();
  const returnTo = String(formData.get("returnTo") ?? "/review/testing");

  try {
    await fileNote({
      reviewerId: clinician.id,
      reviewerRole: clinician.role,
      surface: String(formData.get("surface") ?? "Other"),
      category: String(formData.get("category") ?? "Workflow fit"),
      priority: String(formData.get("priority") ?? "change") as NotePriority,
      observed: String(formData.get("observed") ?? ""),
      requested: String(formData.get("requested") ?? ""),
      subjectId: (formData.get("subjectId") as string) || null,
    });
  } catch (e) {
    if (e instanceof ReviewNoteError) {
      redirect(`${returnTo}?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }

  revalidatePath("/review/testing");
  redirect(`${returnTo}?done=note`);
}

export async function setNoteStatusAction(formData: FormData) {
  const clinician = await requireClinician();
  await setNoteStatus({
    noteId: String(formData.get("noteId") ?? ""),
    status: String(formData.get("status") ?? "acknowledged") as NoteStatus,
    actorId: clinician.id,
  });
  revalidatePath("/review/testing");
  redirect("/review/testing?done=status");
}
