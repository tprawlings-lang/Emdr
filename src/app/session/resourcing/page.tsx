import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { hasConsent, resourcingBlsAvailable } from "@/lib/gating";
import { decideAccess } from "@/lib/safety/decide";
import { resourcingClinicallyBlocked } from "@/lib/safety/resourcing";
import ResourcingSession from "@/components/ResourcingSession";

// Phase-4a resourcing (calm-place BLS) session route. Gated on: care-program
// consent, the feature flag + kill switch + processing consent
// (resourcingBlsAvailable), and a same-day clinical check via the deterministic
// engine (resourcingClinicallyBlocked) — excluded users are routed away, never
// shown a set. docs/autonomous/bls-validation.
export default async function ResourcingSessionPage() {
  const user = await requireMember();
  if (!(await hasConsent(user.id))) redirect("/onboarding");

  // Feature + kill switch + processing consent.
  if (!(await resourcingBlsAvailable(user.id))) redirect("/settings/sessions");

  // Same-day clinical exclusion (crisis / human-review / low-tier day / missing check-in).
  const decision = await decideAccess(user.id, Date.now());
  if (resourcingClinicallyBlocked(decision)) {
    redirect(decision.dispositions.crisis ? "/crisis" : "/dashboard");
  }

  return <ResourcingSession />;
}
