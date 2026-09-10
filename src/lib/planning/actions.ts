"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordReview } from "./service";
import { readableSignalTenants } from "./scope";

// The review form's server action.
//
// It calls the SAME `recordReview` the API route calls, which re-derives the
// permitted action set from the signal's state and the caller's role. p49's
// rule — the client never invents or widens the action set — has to hold for a
// form post exactly as it does for a fetch, and the way to make sure of that
// is for both to go through one function rather than two that agree today.

export async function submitSignalReview(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenants = readableSignalTenants(user.role);
  const signalId = String(formData.get("signalId") ?? "");
  const action = String(formData.get("action") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  const limits = String(formData.get("limits") ?? "").trim();
  if (!signalId || !action || tenants.length === 0) return;

  await recordReview({
    signalId,
    tenantIds: tenants,
    actorId: user.id,
    role: user.role,
    action,
    comment: comment || null,
    limits: limits || null,
  });
  revalidatePath(`/review/planning/${signalId}`);
  revalidatePath("/review/planning");
}
