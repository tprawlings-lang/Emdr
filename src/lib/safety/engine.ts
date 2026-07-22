// Deterministic safety core — the intersection engine (Autonomous Step 1).
//
// evaluateAccess() is a PURE function: given resolved safety facts, it returns
// the deterministic access decision by intersecting every triggered rule
// (most restrictive wins). No I/O, no model, no clock reads (now is an input).
// This is the "safety brain" the corpus mandates: conversational AI is advisory
// only and can never call this on the member's behalf to widen access.

import { BETA_CONFIG } from "./config";
import { RULES, Rule } from "./rules";
import {
  AccessDecision,
  AccessTier,
  Capabilities,
  Dispositions,
  RuleHit,
  SafetyInputs,
  TIER_LABEL,
} from "./types";

function trackCeiling(track?: "grounding" | "cautious" | "steady"): AccessTier {
  switch (track) {
    case "grounding":
      return AccessTier.GROUNDING_ONLY;
    case "cautious":
      return AccessTier.CAUTIOUS;
    case "steady":
      return AccessTier.STEADY;
    default:
      return AccessTier.STEADY;
  }
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function evaluateAccess(inputs: SafetyInputs): AccessDecision {
  // Start permissive, then only ever tighten. Clinical-review revision: beta
  // runs NO autonomous bilateral stimulation / reprocessing, so the stimulation
  // capability starts OFF unless explicitly enabled (ledger A3/A5/A7). Visual
  // stimulation is off globally in beta regardless (ledger A7).
  let tier: AccessTier = trackCeiling(inputs.readiness?.track);
  const capabilities: Capabilities = {
    stimulation: BETA_CONFIG.autonomousStimulationEnabled,
    visualStimulation: BETA_CONFIG.visualStimulationEnabled,
    imagery: true,
  };
  const dispositions: Dispositions = {
    crisis: false,
    safetyQuestionRequired: false,
    referralSurfaced: false,
    standingExclusion: false,
    autoRefund: false,
    cooldownUntil: null,
    forcedStabilizationUntil: null,
    retakeAllowedAt: null,
    humanReviewPending: false,
    presentSafetyClarificationRequired: false,
    jurisdictionAwareResources: false,
    reviewTriggered: false,
    urgentMedicalReferral: false,
  };
  const hits: RuleHit[] = [];
  // Track which rule produced the current lowest tier, for the primary reason.
  let tierSetBy: Rule | null = null;

  const maxTs = (a: number | null, b: number | null): number | null =>
    a === null ? b : b === null ? a : Math.max(a, b);

  const fold = (rule: Rule) => {
    const e = rule.effect;
    if (e.tierCeiling !== undefined && e.tierCeiling < tier) {
      tier = e.tierCeiling;
      tierSetBy = rule;
    } else if (e.tierCeiling !== undefined && e.tierCeiling === tier && tierSetBy === null) {
      tierSetBy = rule;
    }
    if (e.removeStimulation) capabilities.stimulation = false;
    if (e.removeVisualStimulation) capabilities.visualStimulation = false;
    if (e.removeImagery) capabilities.imagery = false;
    if (e.crisis) dispositions.crisis = true;
    if (e.safetyQuestion) dispositions.safetyQuestionRequired = true;
    if (e.referral) dispositions.referralSurfaced = true;
    if (e.standingExclusion) dispositions.standingExclusion = true;
    if (e.autoRefund) dispositions.autoRefund = true;
    if (e.humanReviewPending) dispositions.humanReviewPending = true;
    if (e.presentSafetyClarification) dispositions.presentSafetyClarificationRequired = true;
    if (e.jurisdictionAwareResources) dispositions.jurisdictionAwareResources = true;
    if (e.reviewTrigger) dispositions.reviewTriggered = true;
    if (e.urgentMedicalReferral) dispositions.urgentMedicalReferral = true;
    if (e.forcedStabilizationHours) {
      dispositions.forcedStabilizationUntil = maxTs(
        dispositions.forcedStabilizationUntil,
        inputs.nowMs + e.forcedStabilizationHours * HOUR_MS
      );
    }
    if (e.retakeDays) {
      const base = inputs.programFit?.stateHardStopAtMs ?? inputs.nowMs;
      dispositions.retakeAllowedAt = maxTs(dispositions.retakeAllowedAt, base + e.retakeDays * DAY_MS);
    }
    hits.push({ id: rule.id, category: rule.category, reason: rule.reason });
  };

  // 1. Static predicate rules.
  for (const rule of RULES) {
    if (rule.triggers(inputs)) fold(rule);
  }

  // 2. Active cooldowns (input-driven). Any active cooldown blocks activating
  //    content (stabilization + grounding remain) until its absolute expiry.
  for (const cd of inputs.activeCooldowns ?? []) {
    if (cd.untilMs > inputs.nowMs) {
      dispositions.cooldownUntil = maxTs(dispositions.cooldownUntil, cd.untilMs);
      fold({
        id: `COOLDOWN_${cd.kind.toUpperCase()}`,
        category: "cooldown",
        reason:
          "A recent session is resting for a bit — grounding and stabilization stay open, and your companion is here.",
        triggers: () => true,
        effect: { tierCeiling: AccessTier.STABILIZATION, removeStimulation: true },
      });
    }
  }

  // 3. Post-cooldown / worsening cautious ceiling (input-driven).
  if (inputs.cautiousCeilingUntilMs && inputs.cautiousCeilingUntilMs > inputs.nowMs) {
    fold({
      id: "CAUTIOUS_CEILING",
      category: "cooldown",
      reason: "Keeping the track cautious for a little while as things settle.",
      triggers: () => true,
      effect: { tierCeiling: AccessTier.CAUTIOUS },
    });
  }

  // Derived facts.
  const crisisActive = dispositions.crisis || tier === AccessTier.CRISIS;
  const cooldownActive =
    (dispositions.cooldownUntil ?? 0) > inputs.nowMs ||
    (dispositions.forcedStabilizationUntil ?? 0) > inputs.nowMs;
  const activatingSessionsAllowed =
    !crisisActive &&
    !dispositions.standingExclusion &&
    !dispositions.humanReviewPending &&
    !cooldownActive &&
    capabilities.stimulation &&
    tier >= AccessTier.CAUTIOUS;

  // Primary member-facing reason: crisis first, else the rule that set the tier.
  const crisisHit = hits.find((h) => h.category === "crisis");
  const primaryReason = crisisActive
    ? crisisHit?.reason ?? "Support that can help right now comes first."
    : (tierSetBy as Rule | null)?.reason ?? null;

  return {
    tier,
    tierLabel: TIER_LABEL[tier],
    capabilities,
    activatingSessionsAllowed,
    groundingOnly: tier <= AccessTier.GROUNDING_ONLY,
    dispositions,
    hits,
    primaryReason,
  };
}

/** Build a content-free, coded audit detail for a routing decision (Vol I B-5).
 *  No member free text — only ids, coded scores, and triggered rule ids. The
 *  caller writes this into the hash-chained audit log. */
export function buildRoutingAuditDetail(inputs: SafetyInputs, decision: AccessDecision) {
  return {
    tier: decision.tierLabel,
    activatingAllowed: decision.activatingSessionsAllowed,
    groundingOnly: decision.groundingOnly,
    rules: decision.hits.map((h) => h.id),
    dispositions: {
      crisis: decision.dispositions.crisis,
      safetyQuestion: decision.dispositions.safetyQuestionRequired,
      referral: decision.dispositions.referralSurfaced,
      standingExclusion: decision.dispositions.standingExclusion,
      humanReviewPending: decision.dispositions.humanReviewPending,
      presentSafetyClarification: decision.dispositions.presentSafetyClarificationRequired,
      jurisdictionAwareResources: decision.dispositions.jurisdictionAwareResources,
      reviewTriggered: decision.dispositions.reviewTriggered,
      urgentMedicalReferral: decision.dispositions.urgentMedicalReferral,
      cooldownUntil: decision.dispositions.cooldownUntil,
      forcedStabilizationUntil: decision.dispositions.forcedStabilizationUntil,
    },
    // Coded input fingerprint (no free text): presence + numeric route inputs.
    inputs: {
      hasCheckin: !!inputs.dailyCheckin,
      programFitFlags: Object.entries(inputs.programFit ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k),
      phq9Item9: inputs.instruments?.phq9Item9 ?? null,
      pcl5Item16: inputs.instruments?.pcl5Item16 ?? null,
      readinessTrack: inputs.readiness?.track ?? null,
    },
  };
}

export { AccessTier } from "./types";
