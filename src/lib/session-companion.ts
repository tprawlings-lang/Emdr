// In-session dynamic responder (live spoken sessions). When a member SPEAKS
// during a session, this composes a response that draws on memory + rules + the
// therapy KB and adapts to what they just said — dynamic, not a fixed script.
//
// NON-NEGOTIABLE SAFETY INVARIANTS (enforced by construction here):
//  1. This layer NEVER changes the session's clinical flow. It returns words
//     and at most a UI hint (suggestGroundMe). The deterministic session engine
//     alone decides to continue / contain / stop (SUDS → sudsDecision). Nothing
//     in this file advances a set, ends closure, or overrides a stop.
//  2. Crisis and high-activation responses are SCRIPTED, never AI-generated
//     (same rule as the companion). detectRisk runs first, before anything.
//  3. Every returned line passes validateCompanionOutput; on any violation or
//     error the SAFE_FALLBACK / a deterministic line is used instead.
//  4. It never instructs reprocessing ("bring up the memory", "stay with it")
//     — preparation-style reflection only.
//
// The deterministic core (composeSessionResponse) is pure and fully testable.
// An optional AI phrasing pass only *rewords* an already-chosen safe line.

import { AccessTier } from "./safety/types";
import type { SelectedTechnique } from "./therapy-kb";
import { validateCompanionOutput, SAFE_FALLBACK } from "./safety/companion-guard";
import { detectRisk } from "./companion";

export type SessionResponseKind = "crisis" | "ground" | "technique" | "acknowledge";

export interface SessionResponseInputs {
  /** What the member just said (already transcribed). */
  transcript: string;
  /** Latest distress rating during the session, if known. */
  currentSuds: number | null;
  /** The member's current deterministic access tier. */
  tier: AccessTier;
  /** KB techniques cleared for the member's current state (may be empty). */
  techniques: SelectedTechnique[];
  /** Personalization slots. */
  calmPlace: string | null;
  name: string | null;
}

export interface SessionResponse {
  text: string;
  kind: SessionResponseKind;
  /** UI hint only — the member's screen may emphasize Ground-me. Never an
   *  instruction to the engine; the engine's stop rules are independent. */
  suggestGroundMe: boolean;
  crisis: boolean;
  source: "deterministic" | "ai";
}

const HIGH_ACTIVATION =
  /\b(panic|can'?t breathe|flashback|not real|unreal|dissociat|frozen|shaking|overwhelm|spiral|too much|losing it|scared)\b/i;

const CRISIS_LINE =
  "I want to pause here and make sure you're safe. If you're in danger or thinking about harming yourself, please use the Ground-me button now and reach 988 — call or text — or 911 if you're in immediate danger. We can stop the exercise; that's completely okay.";

function firstName(name: string | null): string {
  const n = (name ?? "").trim();
  return n ? `${n}, ` : "";
}

function safe(text: string): string {
  // Deterministic lines should always pass; this is a belt-and-braces backstop.
  return validateCompanionOutput(text).ok ? text : SAFE_FALLBACK;
}

/** Pure: choose the safest, most fitting response for what the member said and
 *  their current state. No DB, no model — deterministic and testable. */
export function composeSessionResponse(inputs: SessionResponseInputs): SessionResponse {
  const { transcript, currentSuds, techniques } = inputs;
  const calm = (inputs.calmPlace ?? "").trim() || "your calm place";

  // 1. Crisis — scripted, always first, never AI, always surfaces Ground-me.
  if (detectRisk(transcript)) {
    return { text: CRISIS_LINE, kind: "crisis", suggestGroundMe: true, crisis: true, source: "deterministic" };
  }

  // 2. High activation or high distress → ground. Prefer a cleared grounding
  //    technique; otherwise a plain orientation line. Suggest Ground-me.
  const activated = HIGH_ACTIVATION.test(transcript) || (currentSuds ?? 0) >= 7;
  if (activated) {
    const grounding = techniques.find((t) => t.technique.category === "grounding");
    const body = grounding
      ? grounding.technique.guidance
      : "Let's slow right down together. Feel your feet on the floor and press them gently. Name three things you can see in the room right now.";
    return {
      text: safe(`${firstName(inputs.name)}let's steady things for a moment. ${body}`),
      kind: "ground",
      suggestGroundMe: true,
      crisis: false,
      source: "deterministic",
    };
  }

  // 3. Their words matched a cleared technique → offer it, briefly and gently.
  if (techniques.length > 0) {
    return {
      text: safe(techniques[0].technique.guidance),
      kind: "technique",
      suggestGroundMe: false,
      crisis: false,
      source: "deterministic",
    };
  }

  // 4. Otherwise, attune — acknowledge and hold space, referencing their own
  //    calm place. No clinical instruction, no pushing forward.
  return {
    text: safe(
      `${firstName(inputs.name)}thank you for saying that. There's no rush here — you can stay with ${calm} for as long as you need, and we'll go at your pace.`
    ),
    kind: "acknowledge",
    suggestGroundMe: false,
    crisis: false,
    source: "deterministic",
  };
}

/** The bounded system prompt for the optional AI phrasing pass. It may only
 *  reword an already-safe line — never add clinical content. */
export function buildSessionRephrasePrompt(base: SessionResponse, calmPlace: string | null): string {
  return [
    "You are a calm, warm presence speaking to someone DURING a live, gentle EMDR preparation exercise.",
    "You will be given an intended message. Reword it in one or two short, natural sentences, in a warm human voice.",
    "HARD RULES:",
    "- Keep the exact meaning and any safety guidance. Do not add new instructions.",
    "- Never tell them to continue, do another set, bring up or stay with a memory, or that anything is cured or will be fixed.",
    "- Never claim feelings ('I care', 'I'm proud'), never diagnose, never imply a human is watching.",
    "- Always leave stopping and grounding as safe, welcome options.",
    calmPlace ? `- Their calm place is "${calmPlace}"; you may reference it.` : "",
    `INTENDED MESSAGE: ${base.text}`,
  ]
    .filter(Boolean)
    .join("\n");
}
