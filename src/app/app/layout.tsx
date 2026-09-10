import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireMember } from "@/lib/auth";
import { subscriptionActive } from "@/lib/billing";
import { hasConsent, screeningComplete } from "@/lib/gating";
import { profileComplete } from "@/lib/profile";
import {
  treatmentFor, redirectFor, GATE_ORDER, type GateStep,
} from "@/lib/member/care-gate";

// The member tree's gate, enforced once (handoff 06 §30.6 step 4).
//
// THE MEMBER TREE WAS THE ONE CONSOLE WITHOUT A LAYOUT, and it showed. Five
// pages ran five different prefixes of the same four-step chain and nineteen
// more ran none of it, so a member whose consent had been revoked could still
// read their plan and their progress. The access inventory found it: nineteen
// member routes owed the consent step and showed no evidence of it.
//
// Enforced here rather than only per page, for the reason the clinician
// layout gives for doing the same: a new route cannot ship ungated by
// forgetting a line.
//
// THE PATH COMES FROM THE PROXY. A layout is not given the pathname, and it
// needs one — the gate's own destinations must not run the gate, or
// `/app/onboarding` sends a member without consent to `/app/onboarding`
// forever. `src/proxy.ts` already sets `x-pathname` for exactly this class of
// problem.
//
// THE QUERIES RUN IN ORDER AND STOP. A member with no active subscription is
// never asked about a consent they were not going to be asked for, which is one
// fewer query on every render of every member screen as well as the correct
// reading of the chain.

export default async function MemberLayout({
  children,
}: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const treatment = treatmentFor(pathname);

  // Grounding, and anything under it. No account required, so no `requireMember`
  // — calling it here would send a signed-out person in distress to the login
  // page, which is the one thing this route exists not to do.
  if (treatment === "open") return <>{children}</>;

  // Gate destinations and the account surfaces. The second group is the one
  // that is easy to get wrong: a member who revokes consent must still be able
  // to reach the page that shows what they revoked, and the one that closes
  // their account.
  const user = await requireMember();
  if (treatment === "authenticate_only") return <>{children}</>;

  const passed: Partial<Record<GateStep, boolean>> = {};
  for (const step of GATE_ORDER) {
    passed[step] = await checkStep(step, user.id);
    if (passed[step] === false) break;
  }
  const to = redirectFor(passed);
  if (to) redirect(to);

  return <>{children}</>;
}

function checkStep(step: GateStep, userId: string): Promise<boolean> {
  switch (step) {
    case "subscription": return subscriptionActive(userId);
    case "consent": return hasConsent(userId);
    case "screening": return screeningComplete(userId);
    case "profile": return profileComplete(userId);
  }
}
