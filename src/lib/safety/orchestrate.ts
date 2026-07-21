// Orchestration control-plane (Autonomous Step 5) — Vol V Ch.5.
//
// Combines the member's journey stage with the deterministic access decision to
// choose the next appropriate action. It personalizes WITHIN the gates and only
// ever CONSUMES the risk engine's output — it never invents an escalation of its
// own (Vol V: "the Preparation Engine consumes structured risk output; it must
// not independently invent escalation"). Pure and side-effect-free.

import { AccessTier, type AccessDecision } from "./types";
import {
  JourneyStage,
  STAGE_GATE_ROUTE,
  STAGE_OWNER,
  type TransitionOwner,
} from "./journey";

export type OrchestrationCategory =
  | "safety_pathway"
  | "route_to_gate"
  | "offer_session"
  | "offer_stabilization"
  | "offer_grounding"
  | "offer_reflection"
  | "closed";

export interface OrchestrationDecision {
  stage: JourneyStage;
  owner: TransitionOwner;
  category: OrchestrationCategory;
  route: string | null;
  reason: string;
}

export function orchestrateNext(stage: JourneyStage, access: AccessDecision): OrchestrationDecision {
  const owner = STAGE_OWNER[stage];
  const base = { stage, owner };

  // 1. Safety pathway — consumed from the risk engine, never invented here.
  if (access.dispositions.crisis || access.tier === AccessTier.CRISIS || stage === JourneyStage.ElevatedRisk) {
    return { ...base, category: "safety_pathway", route: "/crisis", reason: access.primaryReason ?? "Support comes first." };
  }

  // 2. Account closure.
  if (stage === JourneyStage.AccountClosure) {
    return { ...base, category: "closed", route: STAGE_GATE_ROUTE[stage] ?? "/settings/account", reason: "Winding down your account." };
  }

  // 3. Pre-dashboard gates — the member must complete a pipeline step.
  const gate = STAGE_GATE_ROUTE[stage];
  const inProgramLoop =
    stage === JourneyStage.ModuleParticipation ||
    stage === JourneyStage.LongitudinalUse ||
    stage === JourneyStage.Disengagement;
  if (gate && !inProgramLoop) {
    return { ...base, category: "route_to_gate", route: gate, reason: "One step to finish before this opens." };
  }

  // 4. In the program loop — personalize within the deterministic tier.
  if (access.activatingSessionsAllowed) {
    return { ...base, category: "offer_session", route: "/session", reason: "You're clear for a session today — your choice." };
  }
  if (access.groundingOnly) {
    return { ...base, category: "offer_grounding", route: "/ground", reason: access.primaryReason ?? "Grounding is the steadier place today." };
  }
  if (access.tier === AccessTier.STABILIZATION) {
    return { ...base, category: "offer_stabilization", route: "/dashboard", reason: access.primaryReason ?? "Stabilization is open today." };
  }
  // Cautious/steady but not activating (e.g. cooldown) — reflection + companion.
  return { ...base, category: "offer_reflection", route: "/companion", reason: access.primaryReason ?? "A gentler day — your companion is here." };
}
