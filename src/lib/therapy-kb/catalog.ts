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
// Modality list follows the founder's reference sheet (uploaded 2026-07):
// CBT, DBT, IPT, ACT, Psychodynamic, Humanistic, Exposure, Gestalt, Adlerian,
// Jungian, Somatic, Relational — plus the program's own EMDR-stabilization
// lane and three supplemental lanes (mindfulness/self-compassion,
// parts-informed, behavioral activation). Every modality is translated into
// SELF-GUIDED-SAFE advisory techniques only; whatever a modality does in the
// therapy room that requires a clinician (exposure hierarchies, parts
// dialogues, dream interpretation, chair work) is deliberately absent here.
// All pending clinician sign-off.

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
  /** Uses guided imagery — dropped when the engine removes the imagery
   *  capability (high dissociation) or dissociation is unknown. */
  imagery?: boolean;
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
  {
    id: "ipt",
    name: "Interpersonal Therapy (IPT)",
    rationale:
      "Locating distress in one of the interpersonal areas (loss, role change, dispute, isolation) and rehearsing what needs saying; conversational and concrete, a natural fit for chat.",
  },
  {
    id: "psychodynamic",
    name: "Psychodynamic (pattern-level)",
    rationale:
      "Headline-level noticing that a present reaction is older than the moment; no childhood excavation in chat — depth stays with a human therapist.",
  },
  {
    id: "humanistic",
    name: "Humanistic / person-centered",
    rationale:
      "Primarily a stance: the member is the expert on their own experience; reflect their exact words, follow their lead, never rush to fix.",
  },
  {
    id: "exposure_informed",
    name: "Exposure-informed (avoidance work)",
    rationale:
      "STRICTLY BOUNDED: in-chat exposure to trauma material is prohibited by the companion rules. This lane only maps avoidance and supports tiny approach steps toward everyday-safe situations on stable days.",
  },
  {
    id: "gestalt",
    name: "Gestalt (here-and-now awareness)",
    rationale:
      "Present-moment noticing of what happens while the member is speaking; no chair work or enactment — awareness only.",
  },
  {
    id: "adlerian",
    name: "Adlerian (encouragement & capability)",
    rationale:
      "Encouragement grounded in concrete evidence the member has already produced (sessions done, hard days survived), never empty praise.",
  },
  {
    id: "jungian",
    name: "Jungian (recurring themes, receive-only)",
    rationale:
      "Receive dreams and recurring images as meaningful material in the member's own words; the companion never interprets or assigns meaning.",
  },
  {
    id: "relational",
    name: "Relational (patterns between people)",
    rationale:
      "Naming repeating relational dynamics at headline level and supporting small repair steps with safe people.",
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
    imagery: true,
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
    imagery: true,
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

  // ── Interpersonal Therapy (IPT) ─────────────────────────────────────────
  {
    id: "ipt-name-the-area",
    modality: "ipt",
    name: "Name the interpersonal thread",
    purpose: "Locate a hard stretch in one of the four IPT areas: a loss, a role change, a dispute, or isolation.",
    category: "reflection",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 5,
    signals: ["divorce", "breakup", "break up", "lost my", "passed away", "new job", "moved away", "argument", "fight with", "falling out", "lonely", "isolated", "no one to talk"],
    guidance:
      "When distress centers on people, help the member name which thread it is: losing someone, a role that changed, a dispute that keeps cycling, or being too alone. Naming the thread makes the problem workable — then ask what feels most stuck about that thread this week.",
    avoidWhen: ["Fresh acute grief — receive it, don't sort it into categories"],
  },
  {
    id: "ipt-rehearse-the-sentence",
    modality: "ipt",
    name: "Rehearse what needs saying",
    purpose: "Draft the unsaid sentence to a real person in the member's life, in their own words.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["wish i could tell", "never told", "can't say it", "need to talk to", "don't know how to tell", "if i could just say"],
    guidance:
      "When there is something unsaid to a specific person, invite them to draft the sentence here first, where nothing is at stake — exactly the words they would want the person to hear. Refine it with them until it sounds like them. Whether and when to say it stays entirely their choice.",
    avoidWhen: ["The person involved is unsafe to approach — rehearsal must not become pressure to contact"],
  },

  // ── Psychodynamic (pattern-level) ───────────────────────────────────────
  {
    id: "psyd-familiar-feeling",
    modality: "psychodynamic",
    name: "Is this feeling older than today?",
    purpose: "Notice when a reaction is bigger than the moment because it is familiar, headline level only.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["overreacted", "why did i react", "out of proportion", "bigger than it should", "reminds me of", "familiar feeling", "always felt this way"],
    guidance:
      "When a reaction surprises the member by its size, wonder together — lightly — whether the feeling is familiar from further back. A headline is plenty: 'this is the feeling I get when I'm dismissed.' Note it for their map and stop there; tracing its history belongs with a human therapist or a guided session, not chat.",
    avoidWhen: ["High activation", "Member starts narrating traumatic history in detail — slow down and ground"],
  },

  // ── Humanistic / person-centered ────────────────────────────────────────
  {
    id: "human-their-words",
    modality: "humanistic",
    name: "Their words, their lead",
    purpose: "Reflect the member's exact words back before anything else; they are the expert on their experience.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 7,
    signals: ["nobody listens", "not heard", "dismissed", "no one understands", "invisible", "talked over"],
    guidance:
      "Especially when the member feels unheard: reflect back their own key words — not a paraphrase that improves on them — and check you got it right before offering anything. Being received accurately is the intervention; resist the urge to fix, reframe, or advise until they ask.",
    avoidWhen: [],
  },

  // ── Exposure-informed (avoidance work — strictly bounded) ───────────────
  {
    id: "exp-avoidance-map",
    modality: "exposure_informed",
    name: "Map the avoidance",
    purpose: "Name what is being skipped and what it costs — information, not homework.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["avoiding", "avoid it", "can't go", "stopped going", "stay away from", "keep putting off", "dodging", "haven't been back"],
    guidance:
      "When avoidance comes up, map it gently: what gets skipped, what the avoidance protects against, and what it quietly costs. Save it to their trigger map as information. Do not build exposure exercises or push contact with the avoided thing — anything trauma-linked belongs in the guided modules or with their therapist.",
    avoidWhen: ["The avoided thing is a trauma reminder — map only, never approach in chat"],
  },
  {
    id: "exp-one-safe-approach",
    modality: "exposure_informed",
    name: "One small approach — everyday-safe things only",
    purpose: "A tiny approach step toward an avoided everyday situation on a stable day.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 3,
    signals: ["want to go back", "miss going", "used to love", "wish i still", "ready to try"],
    guidance:
      "Only when the member is stable and the avoided situation is everyday-safe (a store, a call, a street, a gathering) — help them choose the smallest version they'd bet on completing, with an exit allowed. Avoidance of trauma reminders is out of scope for chat: acknowledge it and point to the guided work instead. Never assign; they pick.",
    avoidWhen: ["Anything trauma-linked", "An unstable or depleted day", "Member feels pushed rather than choosing"],
  },

  // ── Gestalt (here-and-now awareness) ────────────────────────────────────
  {
    id: "gestalt-here-now",
    modality: "gestalt",
    name: "What happens as you say it",
    purpose: "Notice what shows up in the present moment while telling, not just the story told.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["as i say this", "saying it out loud", "talking about it", "telling you this", "even typing this"],
    guidance:
      "Occasionally bring attention from the story to the telling: what do they notice right now, as they write this — in their body, their breath, their pace? One noticing question, received without analysis. If the noticing raises distress, move to grounding.",
    avoidWhen: ["Elevated dissociation — present-moment body focus can be flooding; use external senses instead"],
  },

  // ── Adlerian (encouragement & capability) ───────────────────────────────
  {
    id: "adler-capability-evidence",
    modality: "adlerian",
    name: "Encouragement from evidence",
    purpose: "Counter 'I can't' with concrete things the member has already done — evidence, not praise.",
    category: "reflection",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["can't do this", "not strong enough", "giving up on myself", "hopeless about", "too weak", "never get better"],
    guidance:
      "When the member declares incapacity, respond with specific evidence from their own record — check-ins done on hard days, sessions completed, the grounding tool that worked twice, the fact they showed up today. State the facts and let them do the arguing. Never inflate and never argue with the feeling itself.",
    avoidWhen: ["Active crisis signals — capability arguments do not belong in a crisis moment"],
  },

  // ── Jungian (recurring themes — receive-only) ───────────────────────────
  {
    id: "jung-recurring-themes",
    modality: "jungian",
    name: "Receive recurring images and dreams",
    purpose: "Treat dreams and recurring images as meaningful material in the member's words — never interpret.",
    category: "reflection",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 5,
    signals: ["dream", "dreams", "nightmare", "keeps showing up", "recurring", "same image", "keep seeing"],
    guidance:
      "When the member brings a dream or a recurring image, receive it: let them describe it in their own words, ask what it feels like to carry it, and offer to note it in their map. Do not interpret, decode, or assign meaning — the image belongs to them. Recurring trauma nightmares are worth flagging for their guided work; if telling it activates them, ground first.",
    avoidWhen: ["Elevated dissociation", "Nightmare content is freshly activating — ground before any reflection"],
  },

  // ── Relational (patterns between people) ────────────────────────────────
  {
    id: "rel-pattern-between-people",
    modality: "relational",
    name: "The pattern between people",
    purpose: "Name a repeating relational dynamic at headline level — pursue/withdraw, test/leave, please/resent.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["every relationship", "always end up", "push people away", "they always leave", "abandoned again", "same thing with everyone", "keep choosing"],
    guidance:
      "When the same relational story repeats across different people, name the shape with them in one headline — 'I get close, then I test, then I leave first.' The pattern, once visible, becomes something they have rather than something they are. Save it to their map; working its roots belongs in their guided work.",
    avoidWhen: ["Fresh relational rupture at high intensity — stabilize first, pattern later"],
  },
  {
    id: "rel-one-repair-step",
    modality: "relational",
    name: "One small repair",
    purpose: "After a rupture with a safe person, plan the smallest genuine repair step.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["said something i regret", "we had a fight", "haven't spoken since", "want to apologize", "make it right", "cut them off"],
    guidance:
      "When they regret a rupture with someone safe, help them shape the smallest true repair — one message, one sentence of ownership without self-flagellation. Rehearse it here first. Repair is only offered where the relationship is safe; where it is not, honor the distance instead.",
    avoidWhen: ["The other person is unsafe or the relationship was ended for protection — do not encourage re-contact"],
  },

  // ══════════════════════════════════════════════════════════════════════
  // DEPTH INCREMENT 1 (clinician-review batch). Each entry is a self-guided-
  // safe, advisory translation of an established technique. Guard-checked in
  // tests; tier/activation/dissociation/imagery gated. Grouped by modality.
  // ══════════════════════════════════════════════════════════════════════

  // ── EMDR preparation & stabilization ────────────────────────────────────
  {
    id: "emdr-light-stream",
    modality: "emdr_stabilization",
    name: "Light-stream settling",
    purpose: "A gentle resourcing image that lets tension drain, preparation-phase only.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    imagery: true,
    signals: ["tense", "knotted", "carrying it in my body", "clenched", "heavy"],
    guidance:
      "If a soothing image helps them, offer a warm light or water in a color they find calming, moving slowly through wherever they hold tension and easing it. Their pace, their color. If the image will not settle, let it go and return to plain breath and contact points.",
    avoidWhen: ["High dissociation", "Imagery removed by the access engine"],
  },
  {
    id: "emdr-resource-figure",
    modality: "emdr_stabilization",
    name: "Bring to mind a supportive figure",
    purpose: "Recall a protective/nurturing/wise figure as an inner resource.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    imagery: true,
    signals: ["alone in this", "no one has my back", "unprotected", "wish someone", "on my own"],
    guidance:
      "Invite them to bring to mind someone who feels steady and on their side — real, historical, or imagined; a pet counts — and notice what it is like to have that presence nearby. What would that figure want them to know right now? A resource to keep, not a session to run.",
    avoidWhen: ["No safe figure comes to mind — offer a place or a pet instead, never force one"],
  },
  {
    id: "emdr-stop-signal-rehearsal",
    modality: "emdr_stabilization",
    name: "Rehearse your stop signal",
    purpose: "Practice the stop gesture so it is available before any processing work.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 8,
    signals: ["nervous about the session", "what if it's too much", "scared to start", "worried about processing"],
    guidance:
      "Ahead of session work, rehearse the stop signal with them: the raised hand, the Ground-Me button, the fact that stopping is always allowed and never a failure. Knowing the exit is rehearsed makes the work safer. Reassure them the session engine also stops on its own if distress climbs.",
    avoidWhen: [],
  },
  {
    id: "emdr-suds-check-in",
    modality: "emdr_stabilization",
    name: "Notice the number",
    purpose: "Name current distress 0–10 to build the interoceptive habit sessions rely on.",
    category: "reflection",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 7,
    signals: ["don't know how i feel", "hard to tell", "somewhere in the middle", "how bad is it"],
    guidance:
      "Help them put a number on where distress sits right now, 0 to 10, with no right answer — the skill is the noticing, not the value. Naming it tends to take a little of the charge out and builds the muscle their sessions use.",
    avoidWhen: [],
  },

  // ── CBT ─────────────────────────────────────────────────────────────────
  {
    id: "cbt-evidence-for-against",
    modality: "cbt",
    name: "Weigh the evidence",
    purpose: "Test a hot thought against what actually happened, gently.",
    category: "cognitive",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 5,
    signals: ["i know i'm right", "proof that", "this always means", "it definitely", "must mean"],
    guidance:
      "Once a sticky thought is named, get curious together: what facts fit it, and what facts sit awkwardly against it? Not to win an argument — just to loosen a thought that has been treated as settled fact. One counter-example is often enough to make room.",
    avoidWhen: ["High activation — weighing evidence lands as invalidation when the alarm is loud"],
  },
  {
    id: "cbt-thinking-traps",
    modality: "cbt",
    name: "Name the thinking trap",
    purpose: "Spot a common distortion (all-or-nothing, mind-reading, catastrophizing) by name.",
    category: "cognitive",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 5,
    signals: ["worst case", "they must think", "i ruined everything", "total disaster", "always screw up", "everyone will"],
    guidance:
      "When a thought fits a familiar shape — all-or-nothing, jumping to the worst case, assuming what others think — name the shape lightly and let them decide if it fits. Naming a trap makes it a habit of thought rather than the truth.",
    avoidWhen: ["Do not use labels to dismiss a real, ongoing threat the member is describing"],
  },
  {
    id: "cbt-reframe",
    modality: "cbt",
    name: "A kinder, truer sentence",
    purpose: "Draft a balanced alternative thought in the member's own voice.",
    category: "cognitive",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["how else could i see", "want to think differently", "stuck on this thought", "reframe"],
    guidance:
      "After a harsh thought is examined, help them write one alternative that is both kinder and honest — not fake-positive, just fairer. It has to sound like them or it will not stick. Let them keep the sentence.",
    avoidWhen: ["Toxic positivity — the reframe must stay believable, never paper over real pain"],
  },
  {
    id: "cbt-worry-window",
    modality: "cbt",
    name: "Postpone the worry",
    purpose: "Contain rumination to a set time rather than fighting it all day.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["can't stop worrying", "spinning all day", "rumination", "overthinking everything", "worry loop"],
    guidance:
      "For all-day worry, offer the worry-window idea: jot the worry down and agree to give it fifteen set minutes later rather than now. It is not suppression — it is an appointment. Often the worry is smaller by the time the window arrives.",
    avoidWhen: [],
  },

  // ── DBT skills ──────────────────────────────────────────────────────────
  {
    id: "dbt-tipp-move",
    modality: "dbt_skills",
    name: "Move the intensity out",
    purpose: "Brief intense movement to discharge a spike of distress.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 9,
    signals: ["want to jump out of my skin", "so much energy", "need to move", "restless and awful", "can't sit still"],
    guidance:
      "For a big spike, offer a short burst of movement — brisk walk, stairs, jumping in place for a minute — as a way to let the body metabolize the surge, then re-check the number. Practical, not a workout. Skip if injury or a health issue makes it unwise.",
    avoidWhen: ["Physical condition where exertion is unsafe"],
  },
  {
    id: "dbt-stop-skill",
    modality: "dbt_skills",
    name: "STOP before reacting",
    purpose: "Insert a pause between an urge and an action the member may regret.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 7,
    signals: ["about to send", "want to text them", "urge to", "before i do something", "about to react"],
    guidance:
      "When an urge to act is strong, walk the STOP steps with them: Stop, Take a step back, Observe what is happening, Proceed mindfully. The pause is the whole skill — what they choose after it is theirs.",
    avoidWhen: [],
  },
  {
    id: "dbt-radical-acceptance",
    modality: "dbt_skills",
    name: "Accepting what can't be changed",
    purpose: "Reduce the second layer of suffering that fighting reality adds.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["it's not fair", "shouldn't have happened", "can't accept", "keep fighting it", "why me"],
    guidance:
      "When the pain is partly the fight against a fact that cannot be changed, introduce radical acceptance gently: accepting is not approving or giving up — it is stopping the war with reality so energy is freed for what can change. Slow and non-preachy; this one takes practice.",
    avoidWhen: ["Fresh loss/acute grief — acceptance framing can feel like being rushed; just be with them"],
  },
  {
    id: "dbt-opposite-action",
    modality: "dbt_skills",
    name: "Act opposite to the urge",
    purpose: "When an emotion's urge is unhelpful, do the gentle opposite.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["want to hide", "urge to isolate", "avoid everyone", "stay in bed", "shut everyone out"],
    guidance:
      "When fear or shame urges withdrawal that would not actually keep them safe, offer opposite action: a small step toward rather than away — one text answered, a curtain opened, a short time out of the room. Only when the urge is not itself protective; if hiding is genuine safety, honor it.",
    avoidWhen: ["The urge is protective (real danger) — opposite action never overrides genuine safety"],
  },

  // ── ACT ─────────────────────────────────────────────────────────────────
  {
    id: "act-expansion",
    modality: "act",
    name: "Make room for the feeling",
    purpose: "Allow a feeling to be present rather than fighting it, reducing struggle.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["trying not to feel", "pushing it down", "fighting the feeling", "make it stop", "hate feeling this"],
    guidance:
      "When someone is exhausted from fighting a feeling, offer making room instead: locate where it sits in the body, breathe around it, and let it be there without having to like it. Struggling with a feeling often costs more than the feeling. If it intensifies, come back to grounding.",
    avoidWhen: ["High activation or dissociation — turning toward the feeling can flood; ground first"],
  },
  {
    id: "act-observer-self",
    modality: "act",
    name: "The part of you that notices",
    purpose: "Contact the steady observer that has been present through everything.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["not myself", "lost who i am", "so many feelings", "don't know who i am anymore"],
    guidance:
      "Point gently to the part of them that has been noticing all of it — the same awareness that was there in childhood and is here now, unchanged by the storms it has witnessed. Feelings and thoughts move through; the one who notices stays. A place to stand, not a concept to debate.",
    avoidWhen: ["Elevated dissociation — 'stepping back' framing can worsen depersonalization"],
  },
  {
    id: "act-willingness",
    modality: "act",
    name: "Willing to carry it toward what matters",
    purpose: "Trade avoidance for a valued step, carrying discomfort rather than waiting it out.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 3,
    signals: ["waiting until i feel ready", "when the anxiety goes", "once i'm better", "too anxious to"],
    guidance:
      "When life is on hold until a feeling leaves, offer willingness: the feeling can come along for a small valued step rather than block it. What is one thing that matters they could do with the discomfort in the passenger seat? Their choice, never a push.",
    avoidWhen: ["Low tier or high distress — willingness is not a reason to override a genuine limit"],
  },

  // ── Somatic / body-based ────────────────────────────────────────────────
  {
    id: "somatic-butterfly-hug",
    modality: "somatic",
    name: "Self-hold (butterfly)",
    purpose: "Slow self-tapping/holding for soothing — a calming resource, not processing.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 8,
    signals: ["need comfort", "want to feel held", "shaky", "self-soothe", "arms crossed"],
    guidance:
      "Offer the self-hold: arms crossed over the chest, hands on opposite shoulders, and slow alternating taps or gentle squeezes at a calming pace while they breathe. A soothing resource on its own — keep it slow and free of any distressing focus; it is comfort, not a set.",
    avoidWhen: ["Do not pair with recalling distressing material — that would cross into processing"],
  },
  {
    id: "somatic-temperature-anchor",
    modality: "somatic",
    name: "Warm and cool anchors",
    purpose: "Use temperature sensation to anchor attention in the body and present.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 9,
    signals: ["numb", "can't feel my body", "disconnected", "far away", "not in my body"],
    guidance:
      "When the body feels far away, offer a temperature anchor: a warm mug in both hands, a cool cloth on the neck, warm water over the hands — and simple attention to the sensation and where it is felt. Sensation is a short road back to the present.",
    avoidWhen: [],
  },
  {
    id: "somatic-lengthen-exhale",
    modality: "somatic",
    name: "Sigh it out",
    purpose: "A physiological sigh / long exhale to down-shift arousal quickly.",
    category: "grounding",
    minTier: AccessTier.GROUNDING_ONLY,
    maxActivation: 9,
    signals: ["wound up", "can't relax", "tight", "keyed up", "adrenaline"],
    guidance:
      "Offer a couple of physiological sighs: a normal breath in, a second small sip of air on top, then a long slow release — two or three times — and notice the shoulders. Longer out-breaths tip the nervous system toward the brake.",
    avoidWhen: ["Breath focus is a known trigger for this member — use an external-senses anchor instead"],
  },
  {
    id: "somatic-pendulation",
    modality: "somatic",
    name: "Shuttle to an easier place in the body",
    purpose: "Move attention between a tense area and a neutral/comfortable one.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["all i feel is the tension", "stuck in the discomfort", "my whole body hurts", "can't get away from it"],
    guidance:
      "If one area holds a lot, help them find a neutral or easier part of the body too — hands, feet, the breath — and let attention rock gently between the two rather than staying locked on the hard spot. The nervous system learns it can move. Keep it slow; if it floods, return to plain orientation.",
    avoidWhen: ["Elevated dissociation — interoceptive shuttling can be flooding; use external senses"],
  },

  // ── Mindfulness & self-compassion ───────────────────────────────────────
  {
    id: "msc-soften-allow",
    modality: "mindfulness_sc",
    name: "Soften, soothe, allow",
    purpose: "Meet a hard feeling with warmth rather than resistance.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["so hard right now", "hurting", "raw", "aching", "tender place"],
    guidance:
      "Offer three small moves toward a hard feeling: soften around the place it lives, bring a warm or kind hand there if that feels okay, and allow the feeling to be present without needing it gone. Gentle and optional at every step; if warmth backfires, ground instead.",
    avoidWhen: ["Self-compassion backdraft — if kindness itself brings a wave of grief, slow down and ground"],
  },
  {
    id: "msc-common-humanity",
    modality: "mindfulness_sc",
    name: "You're not the only one",
    purpose: "Counter the isolation of 'only me' with shared human experience.",
    category: "reflection",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["something wrong with me", "no one else", "only me", "everyone else is fine", "so alone in this"],
    guidance:
      "When shame says they are uniquely broken, offer common humanity plainly: struggling after hard things is part of being human, and many people carry versions of this — not to minimize theirs, but to end the solitary confinement of 'only me.'",
    avoidWhen: ["Do not use it to compare-away or minimize what they specifically went through"],
  },
  {
    id: "msc-self-compassion-break",
    modality: "mindfulness_sc",
    name: "A moment of self-kindness",
    purpose: "A three-part pause: this is hard, hard is human, may I be kind to myself.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["being so hard on myself", "self-critical", "beating myself up", "can't catch a break"],
    guidance:
      "Offer a brief self-compassion pause in their own words: naming that this is a moment of difficulty, that difficulty is part of a shared human life, and one kind wish toward themselves — 'may I be gentle with myself right now.' Small, and theirs to shape.",
    avoidWhen: [],
  },

  // ── Parts-informed language ─────────────────────────────────────────────
  {
    id: "parts-protector-thanks",
    modality: "parts_informed",
    name: "Thank the part that's working hard",
    purpose: "Reframe a difficult reaction as a part with a protective job — psychoeducation only.",
    category: "reflection",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 5,
    signals: ["why do i always", "the part of me that", "i sabotage", "inner critic", "keeps me stuck"],
    guidance:
      "When a self-critical or guarding reaction shows up, offer the framing that this part may be trying to protect them in the only way it learned — and that its effort can be acknowledged even while they outgrow the method. Stay psychoeducational: name the part's likely job, do not run a dialogue with it or give it a backstory.",
    avoidWhen: ["Elevated dissociation — parts language can amplify fragmentation; use plainer language"],
  },
  {
    id: "parts-not-all-of-you",
    modality: "parts_informed",
    name: "This feeling isn't all of you",
    purpose: "Create space between the whole person and one overwhelming part.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["i am so anxious", "consumed by", "the shame is all i am", "swallowed by", "nothing but"],
    guidance:
      "When one feeling seems to be the whole of them, offer the both-and: a part of them is flooded with this right now, and there is also more of them than this part — the one noticing it, for a start. Language of 'a part,' not 'you are,' to leave room.",
    avoidWhen: ["Elevated dissociation"],
  },

  // ── Behavioral activation & positive psychology ─────────────────────────
  {
    id: "ba-activity-menu",
    modality: "behavioral_activation",
    name: "A short menu of doable things",
    purpose: "Break the paralysis of 'nothing helps' with a tiny, concrete menu.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["nothing sounds good", "don't know what to do with myself", "flat", "empty day", "at loose ends"],
    guidance:
      "On a flat, stuck day, help them build a tiny menu of three low-effort things that once gave a flicker of something — a song, a short walk, a shower, a text to one person — and pick one to try, watching for even a small lift after rather than waiting to feel like it first.",
    avoidWhen: ["Low tier or high distress — activation pressure on an unstable day backfires"],
  },
  {
    id: "ba-mastery-moment",
    modality: "behavioral_activation",
    name: "One thing done on purpose",
    purpose: "Rebuild a sense of agency through a small completed task.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["useless", "haven't accomplished", "no motivation", "can't get anything done", "unproductive"],
    guidance:
      "When agency feels gone, help them pick one small task with a clear finish — a dish, an email, a made bed — and treat completing it as evidence of capability, not a to-do line. Mastery is built one finished small thing at a time.",
    avoidWhen: ["Do not let it become another stick to measure themselves with"],
  },
  {
    id: "pp-three-good-things",
    modality: "behavioral_activation",
    name: "Three good things",
    purpose: "Rebalance an attention bias toward threat by noticing what went okay.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["everything is bad", "nothing good", "all negative", "can't see anything positive"],
    guidance:
      "When the day reads as all bad, invite three small things that went even slightly okay and, for one, why it happened. Not to argue with the hard parts — to give the good parts a fair hearing they usually do not get.",
    avoidWhen: ["Acute distress — gratitude prompts can feel invalidating when someone is in real pain"],
  },

  // ── Interpersonal Therapy (IPT) ─────────────────────────────────────────
  {
    id: "ipt-role-transition",
    modality: "ipt",
    name: "Name the role that changed",
    purpose: "Frame distress around a life-role transition and what was lost/gained.",
    category: "reflection",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 5,
    signals: ["since i became", "new baby", "retired", "graduated", "since the diagnosis", "empty nest", "since i moved"],
    guidance:
      "When distress tracks a change of role, name it as a transition: what the old role gave that is missed, and what the new one might hold that is not visible yet. Grief for the old and unfamiliarity with the new can sit together; naming both makes the in-between less like failure.",
    avoidWhen: [],
  },
  {
    id: "ipt-support-map",
    modality: "ipt",
    name: "Map who's actually there",
    purpose: "Counter isolation by locating the real, if small, support that exists.",
    category: "reflection",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["no one", "all alone", "no support", "no one to call", "isolated"],
    guidance:
      "When isolation feels total, gently map who is actually reachable — one person, a group, a line, a neighbor — and what each is good for. The map is usually not empty, and seeing it can loosen the 'no one' before working on reaching out.",
    avoidWhen: ["Do not push contact — mapping is awareness, outreach is their choice and pace"],
  },

  // ── Psychodynamic (pattern-level) ───────────────────────────────────────
  {
    id: "psyd-recurring-relationship-echo",
    modality: "psychodynamic",
    name: "Where have I felt this before?",
    purpose: "Notice, headline level, that a current dynamic echoes an older one.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["reminds me of my", "just like when", "same as my dad", "same as my mom", "history repeating"],
    guidance:
      "When a present relationship echoes an old one, note the echo lightly — 'this pull is familiar' — and let that be enough for chat. A named echo is useful; excavating its origins belongs with a human therapist or the guided work, not here.",
    avoidWhen: ["Member begins detailed traumatic recall — slow down and ground rather than trace it"],
  },
  {
    id: "psyd-mixed-feelings-ok",
    modality: "psychodynamic",
    name: "Two true things at once",
    purpose: "Normalize holding contradictory feelings about the same person or event.",
    category: "reflection",
    minTier: AccessTier.CAUTIOUS,
    maxActivation: 5,
    signals: ["love and hate", "miss them but", "grateful but angry", "shouldn't feel both", "confusing feelings"],
    guidance:
      "When someone is unsettled by feeling two opposite things at once — love and anger, relief and grief — normalize it: the mind can hold both, and the contradiction is information, not a flaw. Let both be true without resolving them tonight.",
    avoidWhen: [],
  },

  // ── Humanistic / person-centered ────────────────────────────────────────
  {
    id: "human-unconditional-regard",
    modality: "humanistic",
    name: "Nothing here is too much",
    purpose: "Offer steady non-judgmental regard so the member can bring the hard parts.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 7,
    signals: ["you'll judge me", "ashamed to say", "you'll think i'm", "hard to admit", "never told anyone"],
    guidance:
      "When someone braces to be judged, offer steady regard in plain terms: there is nothing they could bring here that makes them less worth care, and they can share only what they choose. Warmth as a stance and a fact, never as a claimed feeling.",
    avoidWhen: [],
  },
  {
    id: "human-what-do-you-need",
    modality: "humanistic",
    name: "What do you need right now?",
    purpose: "Return agency by asking rather than prescribing.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 7,
    signals: ["don't know what i need", "tell me what to do", "what should i do", "just want it to stop"],
    guidance:
      "Rather than prescribing, sometimes simply ask what they need right now — to vent, to be heard, to problem-solve, to slow down, or just company for a minute — and follow their answer. Being asked is itself steadying; the member is the expert on their own need.",
    avoidWhen: [],
  },

  // ── Exposure-informed (avoidance work — strictly bounded) ───────────────
  {
    id: "exp-approach-ladder-everyday",
    modality: "exposure_informed",
    name: "A gentle ladder for everyday-safe things",
    purpose: "Break an avoided everyday situation into graded, self-chosen steps.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 3,
    signals: ["want to drive again", "can't go to the store", "avoid the phone", "haven't been to", "used to be able to"],
    guidance:
      "For an everyday-safe situation the member wants back (a store, a call, a road), help them sketch a few steps from easiest to hardest and choose only the first — with an exit always allowed. Trauma-reminder exposure is out of scope for chat; acknowledge it and point to the guided work or their therapist. Never assign a rung; they pick.",
    avoidWhen: ["Anything trauma-linked", "An unstable or depleted day", "Any sense of being pushed"],
  },
  {
    id: "exp-urge-surfing",
    modality: "exposure_informed",
    name: "Ride the wave of an urge",
    purpose: "Let an urge or spike crest and pass without acting or fleeing.",
    category: "stabilization",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 6,
    signals: ["the urge is so strong", "have to escape", "can't stand it", "need it to stop now", "wave of panic"],
    guidance:
      "When an urge or a spike feels unbearable, offer urge-surfing: intense feelings tend to rise, crest, and fall like a wave if not fed, usually within minutes. Help them watch it as a wave — breath and feet on the floor — rather than fight or obey it. If it climbs instead, switch to active grounding.",
    avoidWhen: ["Any self-harm urge — route to crisis resources, do not coach 'riding it out' alone"],
  },

  // ── Gestalt (here-and-now awareness) ────────────────────────────────────
  {
    id: "gestalt-body-voice",
    modality: "gestalt",
    name: "What is your body saying?",
    purpose: "Give voice to a present body sensation as information.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 5,
    signals: ["knot in my stomach", "lump in my throat", "tight shoulders", "chest is heavy", "my body feels"],
    guidance:
      "When a body sensation is present as they speak, invite curiosity about it: if that knot or that tight throat had a word, what might it be saying? Received as information, not decoded for them. If attending to it raises distress, move to grounding.",
    avoidWhen: ["Elevated dissociation — body-voicing can flood; use external senses instead"],
  },
  {
    id: "gestalt-unfinished-sentence",
    modality: "gestalt",
    name: "Finish the sentence",
    purpose: "Surface what wants saying via an open stem, in the here and now.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["there's something i can't say", "on the tip of my tongue", "don't have the words", "something stuck"],
    guidance:
      "When something is close but unspoken, offer an open stem to complete in the moment — 'right now I notice…' or 'what I most want is…' — and let whatever comes, come. The completion often names what was hovering. No enactment or chair work — awareness only.",
    avoidWhen: [],
  },

  // ── Adlerian (encouragement & capability) ───────────────────────────────
  {
    id: "adler-strengths-inventory",
    modality: "adlerian",
    name: "What's carried you this far",
    purpose: "Name the durable strengths already evidenced in the member's coping.",
    category: "reflection",
    minTier: AccessTier.STABILIZATION,
    maxActivation: 5,
    signals: ["nothing going for me", "no strengths", "weak person", "how have i survived", "don't know how i keep going"],
    guidance:
      "When a member cannot see their own resources, reflect the strengths already visible in how they have coped — persistence, honesty, reaching out, caring for others despite it all — grounded in specifics they have given, not flattery.",
    avoidWhen: ["Active crisis — save capability work for a steadier moment"],
  },
  {
    id: "adler-contribution",
    modality: "adlerian",
    name: "A small act of contribution",
    purpose: "Counter worthlessness through connection and usefulness to others.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["no point to me", "burden", "useless to everyone", "no one needs me", "take up space"],
    guidance:
      "When someone feels like a burden, gently explore one small way to contribute to another — a kind message, a tiny favor, a hello — since usefulness and connection quietly rebuild worth. Small and genuine, never a performance of okayness.",
    avoidWhen: ["Do not imply their worth is conditional on being useful — contribution supplements worth, never earns it"],
  },

  // ── Jungian (recurring themes — receive-only) ───────────────────────────
  {
    id: "jung-symbol-meaning-theirs",
    modality: "jungian",
    name: "What does this image mean to you?",
    purpose: "Let the member hold the meaning of a recurring symbol — never interpret for them.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["keeps appearing", "this symbol", "recurring image", "what does it mean", "keep drawing"],
    guidance:
      "When a recurring image or symbol matters to them, hand the meaning back: what does it bring up for them, what does it seem connected to in their own sense of it? The companion never assigns a meaning or offers a decoder — the symbol is theirs to hold.",
    avoidWhen: ["Elevated dissociation", "Content is freshly activating — ground first"],
  },

  // ── Relational (patterns between people) ────────────────────────────────
  {
    id: "rel-boundary-sentence",
    modality: "relational",
    name: "Draft one boundary",
    purpose: "Shape a single clear, kind boundary sentence to a safe person.",
    category: "activation",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["can't say no", "always give in", "walked over", "need a boundary", "let people take", "overcommitted"],
    guidance:
      "When someone struggles to hold a limit with a safe person, help them draft one clear, kind boundary sentence — what is okay, what is not, no lengthy justification — and rehearse it here. Whether and when to use it is theirs. Boundaries are only coached toward safe relationships.",
    avoidWhen: ["Unsafe relationship — boundary-setting with an abusive party can raise risk; prioritize a safety plan"],
  },
  {
    id: "rel-attachment-need",
    modality: "relational",
    name: "Name the need under the reaction",
    purpose: "Find the attachment need (safety, reassurance, closeness) beneath a big reaction.",
    category: "reflection",
    minTier: AccessTier.STEADY,
    maxActivation: 4,
    signals: ["overreacted with them", "clingy", "pushed them away", "needy", "why did i get so upset", "too much for people"],
    guidance:
      "When a relational reaction was bigger than the moment, look together for the need underneath — to feel safe, wanted, or not left — without judging the need. Named plainly, the need can often be asked for directly instead of coming out sideways.",
    avoidWhen: [],
  },
];
