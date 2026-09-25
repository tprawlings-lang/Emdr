// Handoff 10's programs, as signed (review STEADY-CLINREV-2026-09-24-10).
//
// Written by hand for structure — which unit, which gate, which activity — and
// every member-facing string copied from docs/handoffs/10-content-pack.md.
// tests/content-approval.test.ts matches each string whole against the pack,
// so a reworded line fails rather than shipping unreviewed.
//
// ONE DEPARTURE, stated rather than papered over. The pack says the activity
// menu "shows items tagged to the member's chosen areas", but no item in it is
// tagged to an area. Inventing that mapping would be clinical content nobody
// reviewed, so the menu shows its four categories as written; which ones show
// depends only on the day's gate (CV10_B02: Gentle only at the stabilization
// tier). Recorded in the work register.

import { AccessTier } from "../safety/types";

export type ProgramId = "moving-toward" | "steadier-sleep" | "feeling-and-relating" | "riding-strong-feelings";

export type ActivityKind =
  | "values-pick" | "activity-plan" | "activity-reflect"
  | "sleep-window" | "wind-down-plan" | "sleep-reflect"
  | "thought-record"
  | "none";

export interface MenuCategory {
  name: string;
  /** Shown at every tier. The others need the cautious tier (CV10_B02). */
  gentle: boolean;
  items: readonly string[];
}

/** The words an activity screen shows. Only the fields its kind uses are set. */
export interface ActivityCopy {
  prompt: string;
  /** values-pick: the areas. A trailing ": ____" marks the write-your-own one. */
  options?: readonly string[];
  maxPicks?: number;
  /** activity-plan */
  categories?: readonly MenuCategory[];
  dayPrompt?: string;
  save?: string;
  /** activity-reflect */
  outcomes?: readonly string[];
  mastery?: string;
  enjoyment?: string;
  noticed?: string;
  notThisTime?: string;
  notThisTimeChoices?: readonly string[];
  /** Free text shown after the plan (unit 4). */
  remember?: string;
  completion?: string;
}

export interface ProgramUnit {
  id: string;
  title: string;
  /** Member-facing: what this unit is for, one sentence. */
  purpose: string;
  lessonId?: string;
  practiceIds: readonly string[];
  activity: ActivityKind;
  copy?: ActivityCopy;
  /** Guidance text shown in the unit, paragraph by paragraph. */
  text?: readonly string[];
  minTier: AccessTier;
  maxActivation: number;
  signoffRowIds: readonly string[];
}

export interface Program {
  id: ProgramId;
  title: string;
  blurb: string;
  phase: 1 | 2;
  units: readonly ProgramUnit[];
  entryScreenId?: string;
  /** Never shown to a member inside a program (§3.6). */
  outcomeMeasureIds: readonly string[];
  signoffRowIds: readonly string[];
}

const MENU: readonly MenuCategory[] = [
  {
    name: "Gentle", gentle: true,
    items: [
      "open a window and stand by it for two minutes", "drink a glass of water", "shower or wash your face",
      "step outside for five minutes", "listen to one song you like", "sit somewhere different",
    ],
  },
  {
    name: "Everyday", gentle: false,
    items: [
      "wash a few dishes", "put away one pile", "make something simple to eat", "pay one bill",
      "reply to one message", "change the sheets",
    ],
  },
  {
    name: "Connecting", gentle: false,
    items: ["text someone \"thinking of you\"", "call someone for five minutes", "sit with a pet", "say hello to a neighbor"],
  },
  {
    name: "Toward something I care about", gentle: false,
    items: [
      "ten minutes on a hobby", "read a few pages", "write down one idea",
      "spend five minutes outside somewhere you like", "take one step on something you've been putting off",
    ],
  },
];

const PLAN: ActivityCopy = {
  prompt: "Pick 1 to 3 things. Smaller than you think you need is fine.",
  categories: MENU,
  dayPrompt: "Want to pick a day for any of these? Optional.",
  save: "Save my plan",
};

/** 1B. Rows: B01 program and copy, B02 gating (the proposal, see
 *  content-approval.ts), B03 reflection data, F02 the program's name. */
export const MOVING_TOWARD: Program = {
  id: "moving-toward",
  title: "Moving Toward",
  blurb: "Small, doable steps toward things that matter, for low-energy stretches.",
  phase: 1,
  outcomeMeasureIds: ["phq-9"],
  signoffRowIds: ["CV10_B01", "CV10_B02", "CV10_F02"],
  units: [
    {
      id: "action-comes-first",
      title: "Action comes first",
      purpose: "Why small actions can lift mood before motivation shows up.",
      lessonId: "action-before-motivation",
      practiceIds: [],
      activity: "values-pick",
      copy: {
        prompt: "Which of these areas matter to you right now? Pick up to three.",
        options: [
          "People I care about", "Taking care of my body", "Home and daily life", "Work or learning",
          "Fun and rest", "Making or creating", "Community or helping", "Something else: ____",
        ],
        maxPicks: 3,
        completion: "Good. We'll use these to pick small steps.",
      },
      minTier: AccessTier.STABILIZATION, maxActivation: 6,
      signoffRowIds: ["CV10_B01", "CV10_B02"],
    },
    {
      id: "a-short-menu",
      title: "A short menu",
      purpose: "Pick one to three small things to try this week.",
      practiceIds: ["skill-values-check"],
      activity: "activity-plan",
      copy: PLAN,
      minTier: AccessTier.STABILIZATION, maxActivation: 6,
      signoffRowIds: ["CV10_B01", "CV10_B02"],
    },
    {
      id: "try-it-and-notice",
      title: "Try it and notice",
      purpose: "Try one thing and notice how it went, without judging.",
      practiceIds: [],
      activity: "activity-reflect",
      copy: {
        prompt: "How did it go?",
        outcomes: ["Did it", "Partly", "Not this time"],
        mastery: "How much did you feel you got something done?",
        enjoyment: "How much did you enjoy it, even a little?",
        noticed: "Anything you noticed?",
        notThisTime: "That's useful to know. It usually means the step was a bit big for today. Want to make it smaller?",
        notThisTimeChoices: ["Make it smaller", "Keep it as is", "Skip"],
      },
      minTier: AccessTier.CAUTIOUS, maxActivation: 6,
      signoffRowIds: ["CV10_B01", "CV10_B02", "CV10_B03"],
    },
    {
      id: "keep-it-going",
      title: "Keep it going",
      purpose: "Build the next small set and a plan for low days.",
      practiceIds: [],
      activity: "activity-plan",
      text: ["Low days will still come. On those days, pick from Gentle only. One small thing still counts."],
      copy: {
        ...PLAN,
        remember: "What's one thing you'd like to remember from these weeks?",
        completion: "You can come back and plan a new set any time.",
      },
      minTier: AccessTier.CAUTIOUS, maxActivation: 6,
      signoffRowIds: ["CV10_B01", "CV10_B02"],
    },
  ],
};

export const H10_PROGRAMS: readonly Program[] = [MOVING_TOWARD];
