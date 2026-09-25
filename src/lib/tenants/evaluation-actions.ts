"use server";

// The one-click rebuild of an evaluation tenant (Handoff 11 W1: "a one-click
// reset in /admin"). The refusals — not an evaluation tenant, a real person in
// it — live in rebuildEvaluationTenant, so the script and this button refuse
// the same way. What is left here is who is asking, the typed reason, and the
// record.

import { revalidatePath } from "next/cache";
import { requireDemoAdmin } from "../auth";
import { audit } from "../audit";
import { EvaluationRefused, rebuildEvaluationTenant } from "./evaluation-admin";

const MIN_REASON = 4;

export async function rebuildEvaluationTenantAction(formData: FormData): Promise<void> {
  const user = await requireDemoAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < MIN_REASON) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "evaluation_rebuild_refused", target: tenantId,
      detail: { refusal: "a typed reason is required", supplied: reason.length },
    });
    revalidatePath("/admin/demo");
    return;
  }
  try {
    const result = await rebuildEvaluationTenant(tenantId);
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "evaluation_rebuilt", target: tenantId,
      detail: { reason, counts: { ...result.counts, roster: undefined }, eventsInserted: result.eventsInserted },
    });
  } catch (err) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: err instanceof EvaluationRefused ? "evaluation_rebuild_refused" : "evaluation_rebuild_failed",
      target: tenantId,
      detail: { reason, error: err instanceof Error ? err.message : String(err) },
    });
  }
  revalidatePath("/", "layout");
}
