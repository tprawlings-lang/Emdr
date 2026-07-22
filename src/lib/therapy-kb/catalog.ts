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
];
