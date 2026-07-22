import {
  CareTrack,
  EvidenceGrade,
  INTAKE_OPTIONS,
  TRACKS,
  TrackIntake,
  getTrack,
  getTrackIntake,
  isReferralOnly,
} from "./tracks";
import { getFitnessState } from "./fitness-screener";
import { getTodayCheckin, screeningComplete } from "./gating";
import { getActiveTriggers, getLatestReadiness } from "./profile";

// Rules-first pathway recommender (handoff §8). Deterministic safety gates run
// BEFORE any pathway is scored — the model never overrides them, and an
// incomplete safety screen returns no recommendation. Output mirrors §8.1:
// a ranked set of candidates with rationale, evidence grade, missing inputs,
// and the clinician-review level, plus a member-facing message.
//
// This recommends *focus*, never deeper access: every module a pathway points
// to is still independently gated by gating.ts.

export const RULES_VERSION = "track-rules-2026-06";

export type SafetyLevel = "ok" | "incomplete" | "blocked";

export interface TrackCandidate {
  trackId: string;
  name: string;
  score: number;
  evidenceGrade: EvidenceGrade;
  /** Plain-language reasons this pathway surfaced — handoff §8.3. */
  rationale: string[];
  clinicianReview: CareTrack["clinicianReview"];
  referralOnly: boolean;
}

export interface TrackRecommendation {
  rulesVersion: string;
  safety: {
    level: SafetyLevel;
    /** When blocked/incomplete, where to send the member. */
    action: "screening" | "checkin" | "crisis" | null;
    reason: string | null;
  };
  candidates: TrackCandidate[];
  missingInputs: string[];
  memberMessage: string;
}

function evidenceTiebreak(g: EvidenceGrade): number {
  // Higher = preferred when scores tie. Strong evidence and fully self-guided
  // lanes sort above referral lanes.
  return { high: 3, moderate: 2, emerging: 1, specialist: 0 }[g];
}

// ---- Pure safety gate. No DB; takes already-resolved signals so it can be ----
// ---- unit-tested deterministically (mirrors the @safety suite's style). ----

export interface SafetySignals {
  /** From getFitnessState().status. */
  fitnessStatus: string;
  screeningComplete: boolean;
  /** Today's check-in recommended_action, or null if not done yet. */
  checkinAction: string | null;
}

export type SafetyGate =
  | { proceed: true }
  | { proceed: false; safety: TrackRecommendation["safety"]; missingInputs: string[]; memberMessage: string };

/**
 * The deterministic safety gate for pathway recommendation. Returns proceed
 * only when the program-fit screen passed, baseline measures are complete, and
 * no current safety flag is present. These mirror gating.ts and §12.2 — a
 * pathway is never recommended through an incomplete or flagged safety screen.
 */
export function trackSafetyGate(s: SafetySignals): SafetyGate {
  if (s.fitnessStatus === "none") {
    return {
      proceed: false,
      safety: { level: "incomplete", action: "screening", reason: "Program-fit questions aren't answered yet." },
      missingInputs: ["program_fit_screen"],
      memberMessage: "Before we suggest a path, let's finish the quick program-fit questions.",
    };
  }
  if (s.fitnessStatus === "cooldown") {
    return {
      proceed: false,
      safety: {
        level: "blocked",
        action: "crisis",
        reason: "Your fit answers point to support from a person as the safest next step right now.",
      },
      missingInputs: [],
      memberMessage: "Right now the steadiest step is support from a person — the crisis page has options that help today.",
    };
  }
  if (!s.screeningComplete) {
    return {
      proceed: false,
      safety: { level: "incomplete", action: "screening", reason: "Baseline measures aren't complete yet." },
      missingInputs: ["baseline_screening"],
      memberMessage: "Let's finish your baseline measures first — they help us point you the right way.",
    };
  }
  if (s.checkinAction === "crisis") {
    return {
      proceed: false,
      safety: { level: "blocked", action: "crisis", reason: "Today's check-in flagged safety concerns." },
      missingInputs: [],
      memberMessage: "Today's check-in flagged some concerns, so paths are paused while support is offered. You're not alone in this.",
    };
  }
  return { proceed: true };
}

// ---- Pure scoring over intake tags. No DB. ----

export function scoreTrackCandidates(tags: string[]): TrackCandidate[] {
  const scores = new Map<string, number>();
  const reasons = new Map<string, string[]>();
  const optById = new Map(INTAKE_OPTIONS.map((o) => [o.id, o]));

  for (const tag of tags) {
    const opt = optById.get(tag);
    if (!opt) continue;
    for (const w of opt.weights) {
      scores.set(w.trackId, (scores.get(w.trackId) ?? 0) + w.weight);
      const list = reasons.get(w.trackId) ?? [];
      list.push(`You named: ${opt.label.toLowerCase()}`);
      reasons.set(w.trackId, list);
    }
  }

  return buildCandidates(scores, reasons);
}

function buildCandidates(scores: Map<string, number>, reasons: Map<string, string[]>): TrackCandidate[] {
  return TRACKS.filter((t) => (scores.get(t.id) ?? 0) > 0)
    .map((t) => ({
      trackId: t.id,
      name: t.name,
      score: scores.get(t.id) ?? 0,
      evidenceGrade: t.evidenceGrade,
      rationale: [...new Set(reasons.get(t.id) ?? []), `Evidence: ${t.evidenceNote}`],
      clinicianReview: t.clinicianReview,
      referralOnly: isReferralOnly(t),
    }))
    .sort(
      (a, b) => b.score - a.score || evidenceTiebreak(b.evidenceGrade) - evidenceTiebreak(a.evidenceGrade)
    )
    .slice(0, 3);
}

/**
 * Recommend care pathways for a member. Safety first, then a transparent
 * weighted score over their intake tags, with a small boost from readiness and
 * mapped triggers. Never returns a pathway when the safety screen is incomplete
 * or a current safety flag is present (handoff §6.3, §8.2, §12.2).
 */
export async function recommendTracks(userId: string, intakeOverride?: TrackIntake): Promise<TrackRecommendation> {
  const gate = trackSafetyGate({
    fitnessStatus: (await getFitnessState(userId)).status,
    screeningComplete: await screeningComplete(userId),
    checkinAction: (await getTodayCheckin(userId))?.recommended_action ?? null,
  });
  if (!gate.proceed) {
    return {
      rulesVersion: RULES_VERSION,
      safety: gate.safety,
      candidates: [],
      missingInputs: gate.missingInputs,
      memberMessage: gate.memberMessage,
    };
  }

  const intake = intakeOverride ?? getTrackIntake(userId);
  const tags = intake?.tags ?? [];

  // Base scores from the member's intake tags.
  const scores = new Map<string, number>();
  const reasons = new Map<string, string[]>();
  const optById = new Map(INTAKE_OPTIONS.map((o) => [o.id, o]));
  for (const tag of tags) {
    const opt = optById.get(tag);
    if (!opt) continue;
    for (const w of opt.weights) {
      scores.set(w.trackId, (scores.get(w.trackId) ?? 0) + w.weight);
      const list = reasons.get(w.trackId) ?? [];
      list.push(`You named: ${opt.label.toLowerCase()}`);
      reasons.set(w.trackId, list);
    }
  }

  // A high-dissociation readiness reading steers toward the readiness lane even
  // if the member didn't pick the "numb / losing time" tag.
  const readiness = await getLatestReadiness(userId);
  if (readiness && readiness.recommended_track === "stabilization") {
    scores.set("complex_readiness", (scores.get("complex_readiness") ?? 0) + 1);
    const list = reasons.get("complex_readiness") ?? [];
    list.push("Your current readiness suggests grounding before deeper work.");
    reasons.set("complex_readiness", list);
  }

  // Triggers already on the map gently reinforce the trauma pathway.
  if ((await getActiveTriggers(userId)).length >= 3 && scores.has("ptsd_trauma")) {
    scores.set("ptsd_trauma", (scores.get("ptsd_trauma") ?? 0) + 1);
    const list = reasons.get("ptsd_trauma") ?? [];
    list.push("You've already mapped several triggers.");
    reasons.set("ptsd_trauma", list);
  }

  const candidates = buildCandidates(scores, reasons);

  const missingInputs: string[] = [];
  if (tags.length === 0) missingInputs.push("goal_tags");

  let memberMessage: string;
  if (candidates.length === 0) {
    memberMessage =
      "Tell us a little about what you'd like to work on and we'll suggest a path — or browse all of them below.";
  } else if (candidates.some((c) => c.referralOnly)) {
    memberMessage =
      "Here's where we'd start. Some paths build grounding with you and bring in a specialist for the deeper work — that's by design.";
  } else {
    memberMessage = "Based on what you shared, here's where we'd start. You can choose more than one.";
  }

  return {
    rulesVersion: RULES_VERSION,
    safety: { level: "ok", action: null, reason: null },
    candidates,
    missingInputs,
    memberMessage,
  };
}

// Re-exported so callers/tests can reach the catalog through one module.
export { getTrack };
