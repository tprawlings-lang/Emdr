// Therapy knowledge base — deterministic selector (logic layer). Pure.
//
// Given the member's current gated state and conversational signals, choose
// which catalog techniques the companion may draw on for THIS reply. This is
// retrieval, not generation: the same inputs always select the same entries,
// so every selection is reproducible and auditable. Most-restrictive-wins:
//  • tier gate      — entry.minTier must be at or below the member's tier
//  • activation gate — entry.maxActivation must cover current distress
//  • dissociation    — elevated dissociation restricts to grounding entries
//  • crisis          — no KB at all; crisis flow is fully scripted elsewhere
//  • restricted     — entries whose signals graze a member's restricted
//                      topics are dropped for that member

import { AccessTier } from "../safety/types";
import { SESSION } from "../safety/config";
import { TECHNIQUES, type TherapyTechnique } from "./catalog";

export interface SelectionInputs {
  /** The member's current deterministic access tier (shadow or governing). */
  tier: AccessTier;
  /** Current distress 0–10 (latest SUDS / check-in activation), if known. */
  activation: number | null;
  /** Current dissociation 0–10, if known. */
  dissociation: number | null;
  /** Lowercased free text to match signals against (message + trigger names). */
  text: string;
  /** Member's restricted topics (never surface entries that touch them). */
  restrictedTopics?: string[];
  /** Maximum number of techniques to return. */
  limit?: number;
}

export interface SelectedTechnique {
  technique: TherapyTechnique;
  /** Number of distinct signal hits (for audit/explanation). */
  score: number;
}

/** True when this entry is permitted for this member-state (ignores signals). */
export function techniqueAllowed(
  t: TherapyTechnique,
  tier: AccessTier,
  activation: number | null,
  dissociation: number | null
): boolean {
  if (tier === AccessTier.CRISIS) return false; // crisis flow is scripted, never KB
  if (tier < t.minTier) return false;
  if (activation !== null && activation > t.maxActivation) return false;
  // Elevated dissociation: orientation/grounding only (same threshold the
  // session engine uses to stop stimulation).
  if (dissociation !== null && dissociation >= SESSION.dissociationStop && t.category !== "grounding") {
    return false;
  }
  return true;
}

function touchesRestricted(t: TherapyTechnique, restricted: string[]): boolean {
  if (restricted.length === 0) return false;
  const hay = `${t.name} ${t.purpose} ${t.guidance} ${t.signals.join(" ")}`.toLowerCase();
  return restricted.some((topic) => {
    const needle = topic.trim().toLowerCase();
    return needle.length >= 3 && hay.includes(needle);
  });
}

/** Deterministically select the techniques the companion may draw on now. */
export function selectTechniques(inputs: SelectionInputs): SelectedTechnique[] {
  const { tier, activation, dissociation } = inputs;
  const restricted = inputs.restrictedTopics ?? [];
  const limit = Math.max(0, Math.min(inputs.limit ?? 3, 5));
  const text = inputs.text.toLowerCase();

  const scored: SelectedTechnique[] = [];
  for (const t of TECHNIQUES) {
    if (!techniqueAllowed(t, tier, activation, dissociation)) continue;
    if (touchesRestricted(t, restricted)) continue;
    let score = 0;
    for (const s of t.signals) if (text.includes(s)) score++;
    if (score > 0) scored.push({ technique: t, score });
  }

  // Deterministic order: score desc, then catalog order (stable by id).
  scored.sort((a, b) => b.score - a.score || a.technique.id.localeCompare(b.technique.id));
  const top = scored.slice(0, limit);

  // Nothing matched but the member is activated → fall back to the safest
  // applicable grounding entry so the companion always has a cleared move.
  if (top.length === 0 && activation !== null && activation >= 6) {
    const grounding = TECHNIQUES.filter(
      (t) => t.category === "grounding" && techniqueAllowed(t, tier, activation, dissociation)
    ).sort((a, b) => a.id.localeCompare(b.id));
    if (grounding.length > 0) return [{ technique: grounding[0], score: 0 }];
  }
  return top;
}

/** Render selected techniques as a system-prompt block. The framing keeps the
 *  KB advisory: approaches to draw on, never a script to recite. */
export function buildTechniqueBlock(selected: SelectedTechnique[]): string {
  if (selected.length === 0) return "";
  const lines = [
    "APPROACHES YOU MAY DRAW ON RIGHT NOW (cleared for this member's current state — advisory, not a script; weave at most one in naturally, in your own words, only if it fits what they just said):",
  ];
  for (const s of selected) {
    lines.push(`- ${s.technique.name}: ${s.technique.guidance}`);
  }
  lines.push(
    "Never present these as treatment or run trauma processing in chat. If the member's distress is rising, drop the approach and ground instead."
  );
  return lines.join("\n");
}
