"use server";

import { revalidatePath } from "next/cache";
import { requireDemoAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { setClock } from "@/lib/demo-clock";

// p9's Advance clock control, as a server action.
//
// The guard is p9's: "demo only" — checked inside `setClock`, so it holds for
// every caller — plus the role, checked here, plus a recorded reason. The
// three are deliberately in different places: the environment check belongs to
// the clock because it must hold however the clock is reached, and the role
// check belongs to the entry point because that is where a session exists.
//
// Every attempt is audited, including the refused ones. A control that only
// records its successes cannot answer "who kept trying to move this".

export async function advanceDemoClock(formData: FormData): Promise<void> {
  const user = await requireDemoAdmin();
  const raw = String(formData.get("milestone") ?? "");
  const reason = String(formData.get("reason") ?? "");
  // The empty string is the form's way of saying "back to live", and it has to
  // be distinguishable from an absent field rather than falling through to a
  // milestone lookup that would fail with a confusing message.
  const milestoneId = raw === "live" ? null : raw;

  const result = await setClock({ milestoneId, reason, actorId: user.id });

  await audit({
    actorId: user.id,
    actorRole: user.role,
    family: "security",
    type: result.ok ? "demo_clock_set" : "demo_clock_refused",
    target: milestoneId ?? "live",
    detail: result.ok
      ? { milestone: milestoneId ?? "live", reason: reason.trim(), viewingAt: result.state.now.toISOString() }
      : { milestone: milestoneId ?? "live", refusal: result.reason },
  });

  // Every console reads the clock, so every console is stale after this.
  revalidatePath("/", "layout");
}
