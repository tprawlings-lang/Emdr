// Phase-4a resourcing session — Calm/Safe Place installation with short, slow BLS.
//
// Deterministic content only: the installation step sequence, the light directive
// cues the app may speak DURING a set, and the between-set prompts. Every spoken
// line here is fixed and passes the companion output guard (verified in tests) —
// no generative text runs while stimulation is active. This is RESOURCING (pairing
// a POSITIVE resource with short slow BLS), NOT trauma-memory desensitization,
// which stays disabled. docs/autonomous/bls-validation.

import { BLS_RESOURCING, blsResourcingEnabled } from "./config";
import { blsDisabled } from "./governance";
import { hasProcessingConsent } from "../gating";

export type ResourcingPhase =
  | "settle"
  | "choose_place"
  | "sense_place"
  | "cue_word"
  | "set"
  | "between"
  | "closure";

export interface ResourcingStep {
  phase: ResourcingPhase;
  prompt: string;
}

/** The installation sequence (member-facing prompts). Positive resource only. */
export const RESOURCING_STEPS: ResourcingStep[] = [
  { phase: "settle", prompt: "Let's settle first. Notice where your body already feels a little more at ease." },
  { phase: "choose_place", prompt: "Bring to mind a calm or safe place — real or imagined — that feels good to be in." },
  { phase: "sense_place", prompt: "Notice what's here: what you see, any sounds, the temperature, how it feels to be here." },
  { phase: "cue_word", prompt: "Choose a word that fits this place — a word you can come back to." },
  { phase: "closure", prompt: "Let's close. Come back to the room at your own pace; your word and your place are yours to return to any time." },
];

/** Short, light directive cues the app may speak DURING a resourcing set.
 *  Deterministic and output-guard-clean; positive-resource only. */
export const RESOURCING_CUES: string[] = [
  "Stay with your calm place.",
  "Notice what's pleasant here.",
  "Let it be as clear as it wants to be.",
  "Breathe.",
  "Your word, and this place.",
];

/** Between-set prompts (the responsive window — asked BETWEEN sets, not during). */
export const RESOURCING_BETWEEN: string[] = [
  "How does the place feel now?",
  "What do you notice?",
];

export const RESOURCING_PARAMS = BLS_RESOURCING;

/** If the resource turns unpleasant, resourcing STOPS — a positive resource that
 *  has become distressing is never pushed (research: a single 'safe place' can
 *  feel unsafe to a part; do not force it). The caller ends to grounding/closure. */
export function resourceTurnedUnpleasant(feltBetter: boolean): boolean {
  return !feltBetter;
}

/** Whether a self-guided resourcing (Calm/Safe Place) BLS session may be offered
 *  to this member right now: the Phase-4a flag is on, the BLS kill switch is off,
 *  and the member has granted the processing-session consent. Clinical exclusions
 *  (dissociation, acute trauma, standing restrictions, not-safe-today) are
 *  enforced separately by the access gate chain — this is the feature/consent gate. */
export async function resourcingBlsAvailable(userId: string): Promise<boolean> {
  if (!blsResourcingEnabled() || blsDisabled()) return false;
  return hasProcessingConsent(userId);
}
