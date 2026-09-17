"use server";

import { redirect } from "next/navigation";

import { requireDemoAdmin } from "../auth";
import { PilotAccessError, resetParticipantPassword } from "./pilot-access";

// The operator's side of the reset. Guard, domain, message — nothing decided
// here that `pilot-access` does not decide, so the rule cannot differ between
// this caller and a test.
//
// NO `revalidatePath`, and that is not an oversight. Calling it before a
// redirect to the same path drops the query string, which is where the whole
// answer lives; `/admin/pilot` is `force-dynamic` and re-reads on every
// request anyway.

export async function resetParticipantPasswordAction(formData: FormData): Promise<void> {
  // THE GUARD IS HERE, not only on the page. A server action is its own
  // entry point — reachable by POST without the page ever rendering — so a
  // control protected by the screen that draws it is not protected.
  const operator = await requireDemoAdmin();

  const personId = String(formData.get("personId") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");

  try {
    const done = await resetParticipantPassword({
      operatorId: operator.id,
      personId,
      newPassword,
    });
    const cleared = done.clearedFailures > 0
      ? ` ${done.clearedFailures} failed attempt${done.clearedFailures === 1 ? "" : "s"} no longer count, so they can sign in now.`
      : "";
    redirect(`/admin/pilot?done=${encodeURIComponent(
      `New password set for ${done.name} (${done.email}).${cleared}`,
    )}`);
  } catch (e) {
    // Only our own refusals become a message. `redirect` throws to unwind, and
    // swallowing that would turn a successful reset into a silent no-op.
    if (e instanceof PilotAccessError) {
      redirect(`/admin/pilot?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
}
