// The deterministic engine's per-module verdict — a PURE function of an
// AccessDecision (no DB, no gating import), so it can be shared by both the live
// gate (src/lib/gating.ts, when EMDR_AUTONOMOUS_SAFETY governs) and the
// shadow-vs-live divergence report without an import cycle.
//
// It intentionally does NOT require a clinician unlock (the human artifact the
// engine would replace). On gated modules it may therefore be more permissive
// than today's live gate — which is exactly what auto-unlock means, and what the
// divergence report surfaces for review.

import { AccessTier, type AccessDecision } from "./types";
import type { TherapyModule } from "../modules";

/** Grounding modules — always available above crisis. Single source of truth. */
export const GROUNDING_MODULE_IDS = new Set(["calm-place", "containment"]);

export function engineModuleVerdict(d: AccessDecision, mod: TherapyModule, nowMs: number): boolean {
  // Crisis: nothing but crisis resources.
  if (d.dispositions.crisis || d.tier === AccessTier.CRISIS) return false;

  const grounding = GROUNDING_MODULE_IDS.has(mod.id);

  // Grounding-only day: only grounding modules.
  if (d.groundingOnly) return grounding;

  // Autonomous (non-gated) stabilization/resourcing content: available from the
  // stabilization tier up; grounding is always available above crisis.
  if (mod.tier !== "gated") return grounding || d.tier >= AccessTier.STABILIZATION;

  // Gated = activating/processing work.
  if (!d.activatingSessionsAllowed) return false;
  if (d.dispositions.humanReviewPending || d.dispositions.standingExclusion) return false;
  if (d.dispositions.cooldownUntil && d.dispositions.cooldownUntil > nowMs) return false;
  if (d.dispositions.forcedStabilizationUntil && d.dispositions.forcedStabilizationUntil > nowMs) return false;
  return d.tier >= AccessTier.CAUTIOUS;
}
