// Deterministic safety core — program-fit mapping (Autonomous Step 2).
//
// Maps the 8-item program-fit screener answers to the engine's state/trait/soft
// classification (Vol II §2). The distinction is safety-critical:
//   - STATE hard-stops (recent ideation, unsafe situation) → crisis + auto-refund
//     + 14-day retake window.
//   - TRAIT hard-stops (psychotic/dissociative dx, recent hospitalization,
//     substance dependence) → standing exclusion, reversible ONLY by support
//     contact (never by re-answering).
//   - SOFT flags (seizure/photosensitivity, acute medical) → modality removal /
//     gentler pacing.
// Item wording + mapping are PROVISIONAL pending clinician sign-off (ledger A8).
//
// Pure and side-effect-free.

import type { SafetyInputs } from "./types";

/** Answers keyed by the existing screener item ids (see fitness-screener.ts). */
export type FitnessAnswers = Record<string, boolean>;

export const STATE_HARD_STOP_ITEMS = ["selfharm_30d", "unsafe_situation"] as const;
export const TRAIT_HARD_STOP_ITEMS = [
  "psychotic_dissociative_dx",
  "hospitalization_12m",
  "substance_coping",
] as const;

export function mapProgramFit(
  answers: FitnessAnswers,
  opts: { under18?: boolean; stateHardStopAtMs?: number | null } = {}
): NonNullable<SafetyInputs["programFit"]> {
  const yes = (id: string) => answers[id] === true;
  return {
    under18: opts.under18 === true,
    // state
    selfHarm30d: yes("selfharm_30d"),
    unsafeSituation: yes("unsafe_situation"),
    // trait
    psychoticOrDissociativeDx: yes("psychotic_dissociative_dx"),
    hospitalized12m: yes("hospitalization_12m"),
    substanceDependence: yes("substance_coping"),
    // soft
    seizureOrPhotosensitive: yes("seizure_disorder"),
    acuteMedical: yes("acute_medical"),
    stateHardStopAtMs: opts.stateHardStopAtMs ?? null,
  };
}

/** True if a state hard-stop is still inside its retake window (blocked). */
export function stateHardStopActive(
  answers: FitnessAnswers,
  stateHardStopAtMs: number | null,
  nowMs: number,
  retakeDays = 14
): boolean {
  const fired = STATE_HARD_STOP_ITEMS.some((id) => answers[id] === true);
  if (!fired) return false;
  if (stateHardStopAtMs === null) return true; // unknown time → treat as active
  return nowMs < stateHardStopAtMs + retakeDays * 24 * 3600 * 1000;
}

/** True if any trait hard-stop is present (standing exclusion). */
export function traitHardStopActive(answers: FitnessAnswers): boolean {
  return TRAIT_HARD_STOP_ITEMS.some((id) => answers[id] === true);
}
