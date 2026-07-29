// Entitlements — the single source of truth for "what does this member's tier
// include?" (pricing strategy, Phase A). Three tiers:
//
//   base    $6.99  — the daily practice: check-ins, the full regulate suite
//                    (breathe/meditate/move/sleep), Learn, Ground, SOS, and the
//                    companion once a week.
//   plus   $19.99  — the program that remembers you: everything in base, plus
//                    the guided module program, measures & trends, and the
//                    companion unlimited with full memory.
//   premium $34.99 — Steady runs the program WITH you: everything in plus,
//                    plus Autopilot (the autonomous care loop), live/voice
//                    sessions, and priority specialist review.
//
// Every new membership starts with 7 days of PREMIUM regardless of the tier
// chosen at signup (status "trialing" ⇒ premium entitlements); billing then
// starts on the chosen tier. Safety surfaces (crisis, Ground, SOS) are NEVER
// tier-gated — that is a hard invariant, not a pricing decision.

import { getCurrentSubscription } from "./billing";

export type Tier = "base" | "plus" | "premium";

export interface Entitlements {
  tier: Tier;
  /** Companion conversations per week; null = unlimited. */
  companionPerWeek: number | null;
  /** Companion long-term memory bank active (write + recall). */
  companionMemory: boolean;
  /** Guided EMDR module program + measures & progress trends. */
  program: boolean;
  /** Autonomous care loop: daily plan, proactive outreach, adaptive pacing. */
  autopilot: boolean;
  /** Live / hands-free spoken sessions. */
  liveSessions: boolean;
  /** Priority specialist review on gated-module requests. */
  priorityReview: boolean;
}

export const TIER_ENTITLEMENTS: Record<Tier, Entitlements> = {
  base: {
    tier: "base",
    companionPerWeek: 1,
    companionMemory: false,
    program: false,
    autopilot: false,
    liveSessions: false,
    priorityReview: false,
  },
  plus: {
    tier: "plus",
    companionPerWeek: null,
    companionMemory: true,
    program: true,
    autopilot: false,
    liveSessions: false,
    priorityReview: false,
  },
  premium: {
    tier: "premium",
    companionPerWeek: null,
    companionMemory: true,
    program: true,
    autopilot: true,
    liveSessions: true,
    priorityReview: true,
  },
};

/** Map a stored subscription plan id to a tier. Legacy single-plan members
 *  ("monthly", $34.99) are grandfathered into premium — same price, strictly
 *  more product. Unknown ids fail safe to base. */
export function planToTier(plan: string): Tier {
  if (plan === "base" || plan === "plus" || plan === "premium") return plan;
  if (plan === "monthly") return "premium";
  return "base";
}

/** The member's current tier, or null with no active membership. A trialing
 *  membership always runs at PREMIUM — the trial is a taste of the top of the
 *  ladder, whatever tier was chosen for billing. */
export async function getTier(userId: string): Promise<Tier | null> {
  const sub = await getCurrentSubscription(userId);
  if (!sub) return null;
  if (sub.status === "trialing") return "premium";
  if (sub.status !== "active") return null;
  return planToTier(sub.plan);
}

/** Entitlements for the member's current tier; null with no active membership. */
export async function getEntitlements(userId: string): Promise<Entitlements | null> {
  const tier = await getTier(userId);
  return tier ? TIER_ENTITLEMENTS[tier] : null;
}
