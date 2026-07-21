// Deterministic safety core — decision + shadow logging (Autonomous Step 2).
//
// decideAccess() gathers real inputs and runs the pure engine. shadowDecide()
// additionally writes a content-free routing-audit entry so we can validate the
// engine against production behavior WITHOUT governing any member-facing
// decision. Governance stays off until EMDR_AUTONOMOUS_SAFETY=1 (staged rollout,
// per the corpus). Best-effort: shadow logging never throws into a request.

import { audit } from "../audit";
import { autonomousSafetyEnabled } from "./config";
import { evaluateAccess, buildRoutingAuditDetail } from "./engine";
import { gatherSafetyInputs } from "./gather";
import type { AccessDecision } from "./types";

export function decideAccess(userId: string, nowMs: number): AccessDecision {
  return evaluateAccess(gatherSafetyInputs(userId, nowMs));
}

/**
 * Compute the deterministic decision and record it in the audit chain. Returns
 * the decision, or null if anything failed (never throws). In shadow mode the
 * caller ignores the result; when governance is enabled the caller may act on
 * it. `context` labels where the evaluation happened (e.g. "session_start").
 */
export function shadowDecide(userId: string, context: string, nowMs: number): AccessDecision | null {
  try {
    const inputs = gatherSafetyInputs(userId, nowMs);
    const decision = evaluateAccess(inputs);
    audit({
      actorId: userId,
      actorRole: "member",
      family: "module_runtime",
      type: autonomousSafetyEnabled() ? "safety_routing" : "safety_routing_shadow",
      target: context,
      detail: buildRoutingAuditDetail(inputs, decision),
    });
    return decision;
  } catch {
    return null;
  }
}

export { autonomousSafetyEnabled };
