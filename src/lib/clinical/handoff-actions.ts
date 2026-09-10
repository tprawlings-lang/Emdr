"use server";

import { redirect } from "next/navigation";

import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { proposeHandoff, resolveHandoff, type HandoffOutcome } from "./handoff";

// The write paths for a transfer of accountability (§26).
//
// THIN ON PURPOSE. Every refusal — a reason too short to act on, a transfer to
// yourself, somebody outside your tenant, a second open proposal for the same
// person, answering a transfer that is not yours to answer, declining without
// saying why — lives in `handoff.ts`, so it refuses identically whether it is
// reached from this form, a test, or a script somebody writes next year. What
// is left here is the two things that are properties of the REQUEST: who is
// asking, and telling the screen to redraw.
//
// THE ACTOR IS NEVER TAKEN FROM THE FORM. `fromClinicianId` on a proposal and
// `actorId` on a resolution both come from the session. A hidden field would
// let anybody who can post a form transfer a person out of somebody else's
// caseload, or accept a transfer on their behalf — and the audit trail would
// record the impersonation as legitimate.

async function actingClinician(): Promise<{ id: string; tenantId: string }> {
  const clinician = await requireClinician();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  return { id: clinician.id, tenantId: row?.tenant_id ?? PLATFORM_TENANT_ID };
}

/**
 * THE OUTCOME REACHES THE SCREEN, which the first version of this did not.
 *
 * `proposeHandoff` refuses carefully — a reason too short to act on, a transfer
 * to yourself, somebody outside the tenant, a second open proposal for the same
 * person — and every one of those refusals was being discarded here. A
 * clinician who typed "handover" got a page that redrew with nothing on it and
 * no idea why, which is a worse failure than the one the refusal prevents: they
 * would reasonably conclude the transfer went through.
 *
 * Carried in the query string, like the governed export's refusals, so the
 * message survives the redirect that a server action's redraw performs.
 */
export async function proposeHandoffAction(formData: FormData): Promise<void> {
  const me = await actingClinician();
  const outcome = await proposeHandoff({
    tenantId: me.tenantId,
    fromClinicianId: me.id,
    personId: String(formData.get("personId") ?? ""),
    toClinicianId: String(formData.get("toClinicianId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    dueAt: String(formData.get("dueAt") ?? "") || null,
  });
  // NO `revalidatePath` BEFORE THIS. Calling it and then redirecting to the
  // same path dropped the query string — the browser landed on a bare
  // /clinician/handoffs and the message went with it. `redirect` re-renders
  // the destination on its own, which is what the governed export's actions
  // already rely on.
  redirect(said(outcome));
}

/** The screen's address, carrying what just happened. A refusal and a
 *  confirmation are different query keys rather than one `message`, so the
 *  screen can render them in different registers without parsing prose. */
function said(outcome: HandoffOutcome): string {
  const key = outcome.ok ? "done" : "refused";
  const text = outcome.ok ? outcome.note : outcome.reason;
  return `/clinician/handoffs?${key}=${encodeURIComponent(text)}`;
}

export async function resolveHandoffAction(formData: FormData): Promise<void> {
  const me = await actingClinician();
  const raw = String(formData.get("outcome") ?? "");
  // A closed set, checked. An unrecognised outcome would otherwise reach the
  // state column's CHECK constraint as a database error rather than a refusal.
  if (raw !== "accepted" && raw !== "declined" && raw !== "withdrawn") {
    redirect("/clinician/handoffs?refused=" + encodeURIComponent("That is not an answer this screen offers."));
  }
  const outcome = await resolveHandoff({
    handoffId: String(formData.get("handoffId") ?? ""),
    actorId: me.id,
    tenantId: me.tenantId,
    outcome: raw,
    note: String(formData.get("note") ?? ""),
  });
  // NO `revalidatePath` BEFORE THIS. Calling it and then redirecting to the
  // same path dropped the query string — the browser landed on a bare
  // /clinician/handoffs and the message went with it. `redirect` re-renders
  // the destination on its own, which is what the governed export's actions
  // already rely on.
  redirect(said(outcome));
}
