import { redirect } from "next/navigation";
import { requestNow } from "@/lib/request-clock";
import { requireMember } from "@/lib/auth";
import { hasConsent, resourcingBlsAvailable } from "@/lib/gating";
import { decideAccess } from "@/lib/safety/decide";
import { resourcingClinicallyBlocked } from "@/lib/safety/resourcing";
import { AccessTier } from "@/lib/safety/types";
import ResourcingSession from "@/components/ResourcingSession";

// Phase-4a resourcing (calm-place BLS) session route. Gated on: care-program
// consent, the feature flag + kill switch + processing consent
// (resourcingBlsAvailable), and a same-day clinical check via the deterministic
// engine (resourcingClinicallyBlocked) — excluded users are routed away, never
// shown a set. docs/autonomous/bls-validation.
export default async function ResourcingSessionPage() {
  const user = await requireMember();
  // The page's clock, read once. Every "how long ago" and every gate below
  // uses this reading, so nothing on the screen can disagree with anything
  // else about what time it is.
  const now = requestNow();
  if (!(await hasConsent(user.id))) redirect("/app/onboarding");

  // Feature + kill switch + processing consent.
  if (!(await resourcingBlsAvailable(user.id))) redirect("/app/settings/sessions");

  // Same-day clinical exclusion (crisis / human-review / low-tier day / missing check-in).
  const decision = await decideAccess(user.id, now);
  if (resourcingClinicallyBlocked(decision)) {
    redirect(decision.dispositions.crisis ? "/crisis" : "/app/today");
  }

  // "Borderline but approved": cleared for resourcing, but on a lower tier than
  // the top steady band. These members get an extra, explicit permission-to-stop
  // reminder in case a set becomes too stimulating.
  const borderline = decision.tier <= AccessTier.CAUTIOUS;

  return <ResourcingSession borderline={borderline} />;
}
