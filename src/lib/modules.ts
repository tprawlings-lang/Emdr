// The twelve-module program from the executive plan. Modules 1–6 are mostly
// autonomous for eligible users; 7–10 unlock only after specialist review;
// 11–12 are maintenance/relapse paths. Trauma-processing content here is
// deliberately bounded: short bilateral-stimulation sets, frequent distress
// checks, and hard-stop rules enforced by the session player.

export type ModuleTier = "autonomous" | "gated" | "maintenance";

export interface SessionStep {
  kind: "instruction" | "suds" | "bls" | "grounding" | "trigger-entry";
  title: string;
  text?: string;
  /** Guided narration: the clinician-voice lines delivered one at a time as
   *  scrolling "someone is talking" text (the session talk-through). These are
   *  deterministic, authored copy — no model in the session loop — and may
   *  contain {calmPlace} / {name} slots filled from what Steady knows about the
   *  member. `text` remains as the plain fallback when a step has no beats. */
  beats?: string[];
  /** For bls steps: seconds per set. */
  durationSec?: number;
  /** For bls steps: number of sets before moving on. */
  sets?: number;
}

/** Fill narration slots from what the app knows. Missing values degrade
 *  gracefully to gentle generic phrasing — never a literal "{calmPlace}". */
export function fillNarrationSlots(
  line: string,
  ctx: { calmPlace?: string | null; name?: string | null }
): string {
  const calm = (ctx.calmPlace ?? "").trim();
  const name = (ctx.name ?? "").trim();
  return line
    .replace(/\{calmPlace\}/g, calm || "your calm place")
    .replace(/\{name\},?\s*/g, name ? `${name}, ` : "");
}

export interface TherapyModule {
  id: string;
  order: number;
  name: string;
  tier: ModuleTier;
  objective: string;
  durationLabel: string;
  prerequisiteIds: string[];
  steps: SessionStep[];
}

const CLOSING_GROUNDING: SessionStep = {
  kind: "grounding",
  title: "Return to the present",
  text: "Feel your feet on the floor. Name five things you can see, four you can hear, three you can touch. Take three slow breaths, longer out than in. We will check how you are doing next.",
};

export const MODULES: TherapyModule[] = [
  {
    id: "calm-place",
    order: 2,
    name: "Calm Place setup",
    tier: "autonomous",
    objective: "Build a fast regulation anchor you can return to in seconds.",
    durationLabel: "15–20 min",
    prerequisiteIds: [],
    steps: [
      {
        kind: "instruction",
        title: "What this is",
        text: "A calm place is a mental anchor — a real or imagined place where you feel settled and safe. You will picture it while following slow bilateral stimulation. If distress rises instead of falling at any point, the session stops automatically. That is the system working, not you failing.",
        beats: [
          "{name}welcome. Let's set up your calm place together — this is one of the gentlest things we do here.",
          "There are no difficult memories today. We're only building a place your mind can return to whenever things feel like too much.",
          "In a moment you'll bring that place to mind while a slow, steady rhythm plays underneath. Nothing to get right — we're just noticing.",
          "If distress ever climbs instead of easing, the session stops on its own. That's the design working for you, never a failure on your part.",
          "You can pause or stop at any point, and the Ground-me button stays right there in the corner. Take all the time you need.",
        ],
      },
      { kind: "suds", title: "Before we start, rate your distress (0–10)" },
      {
        kind: "instruction",
        title: "Choose your calm place",
        text: "Bring to mind a place where you feel calm. Notice what you see, hear, and feel there — temperature, light, sounds. Choose a single word that captures it (for example: shore, pines, kitchen).",
        beats: [
          "Let's find your place now. Bring to mind somewhere you feel calm and settled — real or imagined, anywhere at all.",
          "Notice what's there with you: what you can see, the quality of the light, any sounds, the temperature on your skin.",
          "Let yourself really arrive there for a moment. There's no rush.",
          "When it feels clear, choose one word that holds it — something like shore, pines, or kitchen. We'll call it {calmPlace} from here.",
        ],
      },
      { kind: "bls", title: "Slow bilateral sets while holding your calm place", durationSec: 30, sets: 3 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      {
        ...CLOSING_GROUNDING,
        beats: [
          "That's the work for today — gently done. Let's come back to the room together.",
          "Feel your feet on the floor and press them down softly. Notice three things you can see right now.",
          "Take one slow breath, a little longer on the way out.",
          "{calmPlace} stays yours — you can return to it any time you need it, in a session or on your own.",
          "Nicely done for showing up for yourself today.",
        ],
      },
    ],
  },
  {
    id: "containment",
    order: 3,
    name: "Containment and pause skills",
    tier: "autonomous",
    objective: "Learn to put difficult material down between sessions.",
    durationLabel: "15–20 min",
    prerequisiteIds: ["calm-place"],
    steps: [
      {
        kind: "instruction",
        title: "Why containment matters",
        text: "Containment is the skill of setting difficult material aside on purpose — not avoidance, but choosing when to work on it. You will practice a container image, a stop phrase, and the emergency exit button. You must be able to settle within a few minutes before deeper modules unlock.",
      },
      { kind: "suds", title: "Rate your distress (0–10)" },
      {
        kind: "instruction",
        title: "Build your container",
        text: "Imagine a container strong enough to hold anything: a vault, a chest, a sealed room. It has a lid you control. Practice placing one mildly stressful thought (not your worst memory) inside, closing it, and stepping back. Say your stop phrase: “Not now. I choose when.”",
      },
      { kind: "bls", title: "Short bilateral sets while picturing the closed container", durationSec: 20, sets: 2 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
  {
    id: "body-scan",
    order: 4,
    name: "Body scan and dual attention",
    tier: "autonomous",
    objective: "Build present-moment orientation under mild activation.",
    durationLabel: "10–15 min",
    prerequisiteIds: ["containment"],
    steps: [
      {
        kind: "instruction",
        title: "Dual attention",
        text: "Trauma work depends on keeping one foot in the present while a memory is active. This module practices that with neutral body awareness. If you start to feel unreal, foggy, or far away, stop and use the grounding shortcut — the session will pause automatically if distress rises.",
      },
      { kind: "suds", title: "Rate your distress (0–10)" },
      {
        kind: "instruction",
        title: "Scan",
        text: "Slowly move attention from the top of your head to your feet. Just notice: tension, warmth, numbness, nothing. No fixing. When you notice something, name it silently and keep moving.",
      },
      { kind: "bls", title: "Paced bilateral sets while keeping attention in the body", durationSec: 30, sets: 3 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
  {
    id: "trigger-map",
    order: 5,
    name: "Trigger map and target inventory",
    tier: "autonomous",
    objective: "Identify present-day triggers and possible future targets for your specialist to review.",
    durationLabel: "20–30 min",
    prerequisiteIds: ["containment"],
    steps: [
      {
        kind: "instruction",
        title: "Mapping, not processing",
        text: "Today you list triggers — situations, sensations, dates, people — without working on them. Stay at headline level: a few words each, no detail. Your specialist reviews this inventory before any processing module is unlocked. If writing an item raises distress above 6, stop and contain it.",
      },
      { kind: "suds", title: "Rate your distress (0–10)" },
      {
        kind: "trigger-entry",
        title: "Map your triggers (headline level)",
        text: "For each trigger: what sets it off, where you feel it in your body, the belief that comes with it (for example “I am not safe”, “It was my fault”), and how disruptive it is day to day. Three to six items is plenty for today. Everything you save here goes into your trigger map — it shapes your program plan, your specialist's review, and the focus choices in later sessions. If writing an item raises your distress above 6, stop and contain.",
      },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
  {
    id: "resourcing",
    order: 6,
    name: "Resource strengthening",
    tier: "autonomous",
    objective: "Install coping resources and adaptive memory networks.",
    durationLabel: "15–20 min",
    prerequisiteIds: ["calm-place"],
    steps: [
      {
        kind: "instruction",
        title: "Choose a resource",
        text: "Pick a memory or image of yourself coping well, being cared for, or being strong — or a figure (real or imagined) who embodies what you need. If a positive resource turns sour or aversive, stop the set; that is useful information for your specialist, not a failure.",
      },
      { kind: "suds", title: "Rate your distress (0–10)" },
      { kind: "bls", title: "Brief bilateral sets while holding the resource", durationSec: 20, sets: 3 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
  {
    id: "recent-trigger",
    order: 7,
    name: "Recent trigger desensitization",
    tier: "gated",
    objective: "Work on low- to medium-intensity present-day triggers.",
    durationLabel: "~20 min",
    prerequisiteIds: ["trigger-map", "resourcing"],
    steps: [
      {
        kind: "instruction",
        title: "Bounded work",
        text: "Choose ONE recent, low-to-medium trigger from your map — not a core memory. You will hold it briefly with short bilateral sets and re-rate distress between sets. The session auto-stops if distress passes the cap or does not come down.",
      },
      { kind: "suds", title: "Bring the trigger to mind lightly. Rate your distress (0–10)" },
      { kind: "bls", title: "Short set, then let it go", durationSec: 25, sets: 2 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      { kind: "bls", title: "One more short set if you are at 6 or below", durationSec: 25, sets: 2 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
  {
    id: "safe-target",
    order: 8,
    name: "Safe target processing",
    tier: "gated",
    objective: "Begin carefully bounded trauma-memory work on a specialist-approved target.",
    durationLabel: "20–30 min",
    prerequisiteIds: ["recent-trigger"],
    steps: [
      {
        kind: "instruction",
        title: "Consent reminder",
        text: "This module touches a memory your specialist approved. You can stop at any time with the exit button — stopping early is always allowed. Hold the target image, the negative belief that goes with it, and where you feel it in your body. Sets are short by design.",
      },
      { kind: "suds", title: "Bring up the approved target. Rate your distress (0–10)" },
      { kind: "bls", title: "Short set — just notice what comes", durationSec: 25, sets: 2 },
      { kind: "suds", title: "Take a breath. Rate your distress now (0–10)" },
      { kind: "bls", title: "Short set — go with whatever changed", durationSec: 25, sets: 2 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      {
        kind: "grounding",
        title: "Closure and containment",
        text: "Whatever is unfinished goes into your container until next time. Picture closing the lid. Say your stop phrase. Then: feet on floor, five things you can see, three slow breaths.",
      },
    ],
  },
  {
    id: "installation",
    order: 9,
    name: "Belief shift and installation",
    tier: "gated",
    objective: "Reinforce a more adaptive belief after distress on a target has dropped.",
    durationLabel: "10–15 min",
    prerequisiteIds: ["safe-target"],
    steps: [
      {
        kind: "instruction",
        title: "Positive cognition",
        text: "This module only runs when distress on a processed target is already low. Choose the belief you would rather hold (for example “I did the best I could”, “I am safe now”). Rate how true it feels, then strengthen it with slow sets.",
      },
      { kind: "suds", title: "Bring up the processed target. Rate your distress (0–10)" },
      { kind: "bls", title: "Slow sets while pairing the target with your new belief", durationSec: 30, sets: 3 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
  {
    id: "future-template",
    order: 10,
    name: "Future template rehearsal",
    tier: "gated",
    objective: "Strengthen your response to expected future stressors.",
    durationLabel: "15–20 min",
    prerequisiteIds: ["installation"],
    steps: [
      {
        kind: "instruction",
        title: "Rehearse coping, not catastrophe",
        text: "Pick an upcoming situation you expect to be hard. Run it as a movie where you cope — using your skills, staying present. If the scenario turns into a new unresolved trauma scene, stop and flag it for your specialist.",
      },
      { kind: "suds", title: "Rate your anticipatory distress (0–10)" },
      { kind: "bls", title: "Sets while running the coping movie", durationSec: 30, sets: 3 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
  {
    id: "relational",
    order: 11,
    name: "Relationship repair and self-concept",
    tier: "gated",
    objective: "Address negative self-concept and relational themes common in complex PTSD.",
    durationLabel: "~20 min",
    prerequisiteIds: ["resourcing"],
    steps: [
      {
        kind: "instruction",
        title: "Self-talk and boundaries",
        text: "Notice the tone you use with yourself this week. Today you track one self-attack thought, answer it the way you would answer a friend, and rehearse one small boundary. If shame spikes or self-attack escalates, stop and contain — your specialist will review.",
      },
      { kind: "suds", title: "Rate your distress (0–10)" },
      { kind: "bls", title: "Brief resourcing sets while holding the kinder answer", durationSec: 20, sets: 2 },
      { kind: "suds", title: "Rate your distress now (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
  {
    id: "maintenance",
    order: 12,
    name: "Maintenance and relapse prevention",
    tier: "maintenance",
    objective: "Keep gains, spot relapse early, and plan boosters or step-down.",
    durationLabel: "~15 min monthly",
    prerequisiteIds: [],
    steps: [
      {
        kind: "instruction",
        title: "Review and refresh",
        text: "Look at your symptom trend on the dashboard. Which skills are you actually using? Rehearse your top trigger response once, refresh your recovery plan, and note anything that is drifting. Sustained worsening routes you back to your specialist automatically.",
      },
      { kind: "suds", title: "Rate your overall distress this week (0–10)" },
      CLOSING_GROUNDING,
    ],
  },
];

export function getModule(id: string): TherapyModule | undefined {
  return MODULES.find((m) => m.id === id);
}
