// Therapy knowledge base — catalog (content layer).
//
// A file-based, git-versioned library of supportive techniques drawn from
// established therapy modalities. File storage is deliberate: it is the most
// cost-effective option (no extra database or vector infra), every edit is
// code-reviewed and diffable, and the clinician signs off the catalog exactly
// like the safety rules. Retrieval is deterministic keyword/state scoring
// (select.ts) — no embeddings, no network calls.
//
// HARD CONSTRAINTS (mirrored in THERAPY_KB_RULES for clinician sign-off):
//  • Advisory only. Entries shape HOW the companion supports — they are never
//    treatment, never reprocessing, never exposure work. Actual EMDR happens
//    only in the guided session modules.
//  • Tier-gated. Every entry declares the minimum access tier and an
//    activation ceiling; the selector filters by the member's current
//    deterministic tier/state, most-restrictive-wins.
//  • Guard-checked. Everything the model produces still passes
//    validateCompanionOutput — the KB widens vocabulary, never authority.
//
// PROVISIONAL modality list — pending the founder's reference sheet and
// clinician sign-off. Structured so modalities/techniques slot in per line.

import { AccessTier } from "../safety/types";

export type TechniqueCategory =
  | "grounding" // orientation to the present; safe at every non-crisis tier
  | "stabilization" // settling arousal; safe when dissociation is low
  | "cognitive" // noticing/relating to thoughts; needs a settled state
  | "reflection" // pattern noticing, meaning, values; needs a settled state
  | "activation"; // behavioral activation / values-led action; most demanding

export interface TherapyTechnique {
  id: string;
  /** Machine id of the modality (one sign-off row per modality). */
  modality: string;
  name: string;
  /** One line: what this is for. Shown to the clinician. */
  purpose: string;
  category: TechniqueCategory;
  /** Minimum access tier at which the selector may surface this entry. */
  minTier: AccessTier;
  /** Activation ceiling: not offered when current distress exceeds this. */
  maxActivation: number;
  /** Keyword signals for deterministic retrieval (lowercase). */
  signals: string[];
  /** Prompt-injectable guidance for the companion. Advisory voice only. */
  guidance: string;
  /** Contraindication notes (also shown to the clinician). */
  avoidWhen: string[];
}

export interface TherapyModality {
  id: string;
  name: string;
  /** Why this modality is in the library, in clinician-reviewable terms. */
  rationale: string;
}

export const MODALITIES: TherapyModality[] = [
  {
    id: "emdr_stabilization",
    name: "EMDR preparation & stabilization",
    rationale:
      "The program's core lane: resourcing, calm-place, container — preparation-phase skills only; reprocessing stays inside the guided modules.",
  },
  {
    id: "cbt",
    name: "Cognitive-behavioral (CBT)",
    rationale:
      "Noticing thought–feeling–behavior links and gently testing unhelpful thoughts; well-evidenced for low-intensity self-guided support.",
  },
  {
    id: "dbt_skills",
    name: "DBT skills (distress tolerance & emotion regulation)",
    rationale:
      "Concrete crisis-adjacent coping skills (temperature, paced breathing, self-soothing) that fit the app's grounding lane.",
  },
  {
    id: "act",
    name: "Acceptance & Commitment (ACT)",
    rationale:
      "Defusion and values work — relating differently to thoughts rather than disputing them; pairs well with pacing and choice.",
  },
  {
    id: "somatic",
    name: "Somatic / body-based grounding",
    rationale:
      "Orientation and body-anchored settling (senses, contact points, breath length); the app's primary de-activation route.",
  },
  {
    id: "mindfulness_sc",
    name: "Mindfulness & self-compassion",
    rationale:
      "Present-moment attention and a kinder inner stance; buffers shame spikes that trauma work can raise.",
  },
  {
    id: "parts_informed",
    name: "Parts-informed language (IFS-informed)",
    rationale:
      "Psychoeducational 'a part of you' framing only — normalizes mixed feelings without doing parts therapy.",
  },
  {
    id: "behavioral_activation",
    name: "Behavioral activation & positive psychology",
    rationale:
      "Small values-led actions and savoring; counters withdrawal between sessions when the member is stable.",
  },
];

export const TECHNIQUES: TherapyTechnique[] = [
  // ── EMDR preparation & stabilization ────────────────────────────────────
  {
    id: "emdr-calm-place-return",
    modality: "emdr_stabilization",
    name: "Return to calm place",
    purpose: "Re-anchor in the member's own established calm-place resource.",
    category: "stabilization",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 8,
    signals: ["overwhelmed", "activated", "panic", "spiral", "too much", "flooded"],
    guidance:
      "If the member has a saved calm place, invite them back to it in their own word for it: picture it, then name what they see, hear, and feel there, one sense at a time, unhurried. If it will not come or turns sour, drop it without comment and move to simple orientation instead.",
    avoidWhen: ["No calm place saved yet", "Calm place has become linked to distressing material"],
  },
  {
    id: "emdr-container",
    modality: "emdr_stabilization",
    name: "Container for between-session material",
    purpose: "Put difficult material away until its proper time, without suppressing it.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 7,
    signals: ["can't stop thinking", "keeps coming back", "intrusive", "won't go away", "stuck in my head"],
    guidance:
      "Offer the container image: something with a lid strong enough to hold what keeps intruding — a vault, a chest, a filing drawer, their choice. The material is not erased or denied; it is set somewhere safe until they choose to work with it in a session. Let them describe the container; details do the holding.",
    avoidWhen: ["Member reads it as being told to suppress or 'get over' something"],
  },

  // ── CBT ─────────────────────────────────────────────────────────────────
  {
    id: "cbt-thought-noticing",
    modality: "cbt",
    name: "Catch the thought",
    purpose: "Separate the situation, the thought, and the feeling so they stop being one solid block.",
    category: "cognitive",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 6,
    signals: ["always", "never", "everyone", "no one", "i'm a failure", "it's my fault", "worthless", "stupid"],
    guidance:
      "When a harsh global thought appears, get curious about it as a thought: what went through their mind right before the feeling hit? Write the thought down in their words. Then one gentle question — not a debate: what would they say to a friend who had that thought after the same moment?",
    avoidWhen: ["High activation — disputation reads as invalidation when the alarm is loud"],
  },
  {
    id: "cbt-behavior-link",
    modality: "cbt",
    name: "Notice the loop",
    purpose: "See the trigger → feeling → response loop so the response becomes a choice point.",
    category: "reflection",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 5,
    signals: ["i always end up", "every time this happens", "pattern", "again", "why do i keep"],
    guidance:
      "Map one recent loop concretely with them: what set it off, what they felt in the body, what they did next, and how the doing affected the feeling. No judgment on any link — the map itself is the win, and it can go straight into their trigger map.",
    avoidWhen: ["Member is mid-activation rather than reflecting afterwards"],
  },

  // ── DBT skills ──────────────────────────────────────────────────────────
  {
    id: "dbt-temperature",
    modality: "dbt_skills",
    name: "Cold water / temperature shift",
    purpose: "Fast physiological down-shift when intensity is high.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 9,
    signals: ["panic", "can't calm down", "heart racing", "about to explode", "urge", "right now"],
    guidance:
      "For high-intensity moments, offer the temperature skill: cool water on the face or wrists, or holding something cold, for thirty seconds or so, noticing the change. Practical framing — a way the body's own dive response settles the system. Mention the cold-water caution for anyone with a heart condition.",
    avoidWhen: ["Known cardiac condition (skip cold-water framing; use paced breathing instead)"],
  },
  {
    id: "dbt-paced-breathing",
    modality: "dbt_skills",
    name: "Paced breathing (longer exhale)",
    purpose: "Lengthened exhale to engage the brake, usable anywhere.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 9,
    signals: ["anxious", "tight chest", "can't breathe", "shaky", "on edge", "wired"],
    guidance:
      "Walk one round together in text, slowly: in through the nose for four, out for six or eight, and let the out-breath be the long one. Three rounds, then check what shifted, if anything — no requirement that it worked.",
    avoidWhen: ["Breath focus itself is a trigger (some members; offer senses-based grounding instead)"],
  },
  {
    id: "dbt-self-soothe",
    modality: "dbt_skills",
    name: "Self-soothe with the senses",
    purpose: "Deliberate comfort through one sense at a time.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 7,
    signals: ["raw", "fragile", "tender", "wrung out", "exhausted after", "depleted"],
    guidance:
      "Invite one sense-based comfort available right now — warm drink, soft texture, a piece of music, something good to look at — chosen by them, treated as legitimate care rather than indulgence.",
    avoidWhen: [],
  },

  // ── ACT ─────────────────────────────────────────────────────────────────
  {
    id: "act-defusion",
    modality: "act",
    name: "Name the thought as a thought",
    purpose: "A half-step of distance: 'I'm having the thought that…'.",
    category: "cognitive",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 6,
    signals: ["i know it's true", "my mind keeps saying", "the thought", "i can't stop believing"],
    guidance:
      "Offer the reframe of prefacing the sticky thought with 'I'm having the thought that…' and saying it that way once. Not to argue with the thought — just to stand half a step back from it and notice it is a mental event. Ask what, if anything, changed in how it sits.",
    avoidWhen: ["Member experiences it as wordplay dismissing real circumstances"],
  },
  {
    id: "act-values-compass",
    modality: "act",
    name: "Values check-in",
    purpose: "Reconnect a hard moment to what the member cares about.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["what's the point", "why bother", "lost", "direction", "stuck", "give up"],
    guidance:
      "When the member is settled and questioning the point of the work, ask what they'd want to be about this month if the difficult stuff took up a little less room — in their words, small and concrete. Connect today's effort to that, lightly. Never use values as pressure to continue.",
    avoidWhen: ["Any active crisis signals — meaning questions can deepen a pit when acute"],
  },

  // ── Somatic / body-based ────────────────────────────────────────────────
  {
    id: "somatic-orientation",
    modality: "somatic",
    name: "Orient to the room (5-4-3-2-1)",
    purpose: "Sensory anchoring to the present; first-line for dissociation.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 10,
    signals: ["not real", "floating", "far away", "foggy", "outside my body", "spacing out", "numb"],
    guidance:
      "Go slowly and concretely: five things they can see, four they can hear, three they can touch — actually touching them — two they can smell, one they can taste. One at a time, waiting for each answer. Then feet on the floor, pressing down gently, and today's date. Short sentences.",
    avoidWhen: [],
  },
  {
    id: "somatic-contact-points",
    modality: "somatic",
    name: "Contact points & support",
    purpose: "Feel the body being held up — chair, floor, backrest.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 9,
    signals: ["ungrounded", "unsteady", "shaking", "can't settle", "restless"],
    guidance:
      "Direct attention to where the body is supported right now — seat, back, feet — and the simple fact that the chair and floor are doing the holding; nothing needs to be done for that support to be there. A few breaths there, noticing weight.",
    avoidWhen: ["Body-focus is itself flooding (switch to external senses: what they can see and hear)"],
  },

  // ── Mindfulness & self-compassion ───────────────────────────────────────
  {
    id: "msc-kind-voice",
    modality: "mindfulness_sc",
    name: "Speak to yourself as to a friend",
    purpose: "Interrupt shame spirals with a deliberately kind inner stance.",
    category: "cognitive",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["hate myself", "ashamed", "pathetic", "weak", "should be over this", "embarrassed"],
    guidance:
      "Name the double standard gently: if someone they loved were carrying this exact moment, what would they say to them? Invite them to offer themselves that same sentence, even if it feels unearned. Shame shrinks in a kind voice; nothing has to be believed yet.",
    avoidWhen: ["Self-compassion backdraft — if kindness itself floods them, ground first"],
  },
  {
    id: "msc-one-breath-noticing",
    modality: "mindfulness_sc",
    name: "One-breath noticing",
    purpose: "A single deliberate pause — not a meditation program.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 7,
    signals: ["racing", "everything at once", "scattered", "overwhelmed by tasks", "buzzing"],
    guidance:
      "Offer one breath done on purpose: notice the in-breath, the out-breath, and one thing that is true right now (sounds in the room, light, temperature). Just one. Small enough to actually happen.",
    avoidWhen: [],
  },

  // ── Parts-informed language ─────────────────────────────────────────────
  {
    id: "parts-both-and",
    modality: "parts_informed",
    name: "'A part of you' framing",
    purpose: "Normalize mixed feelings without either side being wrong.",
    category: "reflection",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 6,
    signals: ["part of me", "torn", "conflicted", "want to but", "half of me", "mixed feelings"],
    guidance:
      "When the member voices conflict, reflect both sides as parts with jobs: a part that wants to move forward, and a part working to keep them safe — both allowed to be there, neither needing to win tonight. Stay at this psychoeducational level; do not run dialogues with parts or assign them histories.",
    avoidWhen: ["Dissociative symptoms are elevated — parts language can amplify fragmentation"],
  },

  // ── Behavioral activation & positive psychology ─────────────────────────
  {
    id: "ba-tiny-next-step",
    modality: "behavioral_activation",
    name: "One tiny next step",
    purpose: "Counter withdrawal with the smallest meaningful action.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["haven't left the house", "cancelled again", "avoiding everyone", "no energy", "haven't done anything"],
    guidance:
      "When the member is stable but withdrawn, help them pick one action small enough to be nearly guaranteed — a five-minute walk, one message to one person, one dish washed. Done is the metric; mood is allowed to catch up later. Celebrate completion at the size it deserves.",
    avoidWhen: ["Low tier or high distress — activation pressure on an unstable day backfires"],
  },
  {
    id: "pp-savoring",
    modality: "behavioral_activation",
    name: "Savor one good moment",
    purpose: "Stretch attention on something that went okay; builds the positive ledger.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["actually went well", "good day", "proud", "small win", "managed to"],
    guidance:
      "When something went well — even slightly — slow the telling down: where were they, what did it feel like in the body, what does it say about what is becoming possible? Thirty extra seconds on a good moment is training, not indulgence.",
    avoidWhen: [],
  },
];
