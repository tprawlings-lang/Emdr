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
  /** Feeling and Relating: one written answer to the unit's prompt. */
  | "reflect-text"
  /** Feeling and Relating unit 2: one or two feeling words, typed (no signed
   *  word list exists yet — decision product.feelings-word-list). */
  | "feeling-words"
  /** Feeling and Relating unit 4: pick one of the unit's own skills. */
  | "skill-pick"
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
  /** How many picks are allowed (values-pick, wind-down-plan). */
  minPicks?: number;
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
  /** sleep-window: said under the time picker. */
  note?: string;
  /** sleep-reflect: the optional free-text question. */
  keepDoing?: string;
  completion?: string;
}

export interface ProgramUnit {
  id: string;
  title: string;
  /** Member-facing: what this unit is for, one sentence. Optional because the
   *  pack gives none for Steadier Sleep's units, and one is not invented. */
  purpose?: string;
  lessonId?: string;
  practiceIds: readonly string[];
  activity: ActivityKind;
  copy?: ActivityCopy;
  /** Guidance text shown in the unit, paragraph by paragraph. */
  text?: readonly string[];
  /** A list shown after `text` (Steadier Sleep unit 2's habits). */
  list?: readonly string[];
  /** Paragraphs shown after `list`. */
  textAfter?: readonly string[];
  /** Withheld from anyone who answered yes on the program's entry screen. */
  withheldByEntryScreen?: boolean;
  minTier: AccessTier;
  maxActivation: number;
  signoffRowIds: readonly string[];
}

/** Questions asked on joining, before any unit opens (Steadier Sleep's
 *  sleep-entry-v1, CV10_C04). Any yes withholds the units marked
 *  `withheldByEntryScreen`, and only those. */
export interface EntryScreen {
  id: string;
  intro: string;
  questions: readonly string[];
  yes: string;
  no: string;
  /** Shown when any answer is yes. */
  anyYes: string;
  /** Extra lines keyed by ZERO-BASED question index, shown after `anyYes`
   *  when that question is yes (the pack's "If question 2 is Yes" is key 1). */
  ifYes: Readonly<Record<number, string>>;
  signoffRowIds: readonly string[];
}

export interface Program {
  id: ProgramId;
  title: string;
  blurb: string;
  phase: 1 | 2;
  units: readonly ProgramUnit[];
  entryScreen?: EntryScreen;
  /** Which care paths the program is offered on. Absent: every member. A
   *  member on a `reviewRequired` path sees it only once that path's clinician
   *  review is recorded — and that holds even if they are on an `open` path
   *  too, because the review is about them, not the path they came in by. */
  paths?: { open: readonly string[]; reviewRequired: readonly string[] };
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

/** 1C. Rows: C01 program and copy, C02 stimulus control (unit 2), C03 the
 *  exclusion of sleep restriction (nothing here computes or suggests a
 *  time-in-bed limit), C04 the entry screen, F02 the name.
 *
 *  GATES ARE THE PRODUCT OWNER'S READING, 25 September, because the pack and
 *  the worksheet give none for these units: the levels the psychologists
 *  already signed for night content (A14). Units 1, 3 and 4 as "After a bad
 *  dream" (grounding tier, any activation); unit 2, which asks a member to get
 *  up at night, as "Back to rest" (stabilization, 7 or below). Recorded in the
 *  decision register for them to confirm. */
export const STEADIER_SLEEP: Program = {
  id: "steadier-sleep",
  title: "Steadier Sleep",
  blurb: "Habits and wind-downs that make rest a bit easier after hard days.",
  phase: 1,
  outcomeMeasureIds: ["phq-9", "gad-7"],
  signoffRowIds: ["CV10_C01", "CV10_C03", "CV10_F02"],
  entryScreen: {
    id: "sleep-entry-v1",
    intro: "A few quick questions help us show the right parts of this program.",
    questions: [
      "Have you ever had several days of very little sleep but lots of energy, where others noticed a change in you?",
      "Has anyone told you that you stop breathing, gasp, or snore loudly in your sleep, or do you nod off while driving?",
      "Do you have a seizure condition, or a health reason to avoid getting up at night?",
    ],
    yes: "Yes",
    no: "No",
    anyYes: "Thanks. Some of this program is worth talking over with a doctor first, so we'll leave that part out for now. Everything else is here for you.",
    ifYes: { 1: "If you ever feel drowsy while driving, please pull over when it's safe." },
    signoffRowIds: ["CV10_C04"],
  },
  units: [
    {
      id: "stress-and-sleep",
      title: "Stress and sleep",
      lessonId: "stress-and-sleep",
      practiceIds: ["wind-down-breath", "put-the-day-down"],
      activity: "wind-down-plan",
      copy: {
        prompt: "Pick two or three things for the last 30 to 60 minutes before bed.",
        options: [
          "Dim the lights", "Put the phone across the room", "A warm shower", "Write tomorrow's to-do list",
          "A wind-down practice from Steady", "Something to read that isn't stressful", "Your own: ____",
        ],
        minPicks: 2,
        maxPicks: 3,
      },
      minTier: AccessTier.GROUNDING_ONLY, maxActivation: 10,
      signoffRowIds: ["CV10_C01"],
    },
    {
      id: "the-bed-is-for-sleep",
      title: "The bed is for sleep",
      practiceIds: [],
      activity: "sleep-window",
      text: ["These habits help your body link bed with sleep again."],
      list: [
        "Go to bed when you feel sleepy, not just tired or bored.",
        "Keep the bed for sleep and intimacy. Screens, work, and worrying go elsewhere.",
        "If you've been lying awake for what feels like about 20 minutes and you're getting frustrated, get up. Go somewhere dim and quiet and do something calm until you feel sleepy, then go back. Don't watch the clock to time it.",
        "Get up at about the same time every day, including after a bad night.",
        "If you nap, keep it short and before mid-afternoon.",
      ],
      textAfter: ["Go gently. If getting up at night doesn't feel safe, for any reason, skip that one."],
      copy: {
        prompt: "What time would you like to get up most days?",
        note: "This is your anchor. Bedtime can move around; getting-up time is the one to keep steady.",
      },
      withheldByEntryScreen: true,
      minTier: AccessTier.STABILIZATION, maxActivation: 7,
      signoffRowIds: ["CV10_C01", "CV10_C02"],
    },
    {
      id: "when-nights-are-rough",
      title: "When nights are rough",
      practiceIds: ["after-a-bad-dream", "back-to-rest", "skill-orient-room"],
      activity: "none",
      text: ["Waking from a bad dream, or at 3am with a racing mind, is common after stressful times. The goal isn't to figure anything out in the night. It's to help your body know it's safe now, and let rest come back when it can."],
      minTier: AccessTier.GROUNDING_ONLY, maxActivation: 10,
      signoffRowIds: ["CV10_C01"],
    },
    {
      id: "keeping-what-works",
      title: "Keeping what works",
      practiceIds: [],
      activity: "sleep-reflect",
      text: ["Sleep has good and bad stretches. When it slips, come back to your getting-up time and your wind-down. Those two do the most."],
      copy: {
        prompt: "Which parts helped most?",
        keepDoing: "Anything you want to keep doing?",
      },
      minTier: AccessTier.GROUNDING_ONLY, maxActivation: 10,
      signoffRowIds: ["CV10_C01"],
    },
  ],
};

/** Opening line for units 5 to 7 (CV10_D03). */
const RIGHT_NOW = "This unit is about relationships in your life right now. There's no need to go back over past events.";

const FR_EARLY = { minTier: AccessTier.STABILIZATION, maxActivation: 6 } as const;
const FR_LATE = { minTier: AccessTier.CAUTIOUS, maxActivation: 5 } as const;
const FR_ROWS = ["CV10_D02", "CV10_D03"] as const;

/** 2A. Rows: D01 structure and naming, D02 gating, D03 unit copy, F02 the
 *  name. Clinician-facing only, and never in member copy: informed by the
 *  skills phase of STAIR (Cloitre and colleagues); original content, not a
 *  STAIR implementation.
 *
 *  Offered on the trauma path, and on the complex trauma readiness path only
 *  once that path's clinician review is recorded. Nothing records one yet, so
 *  on that path it is not offered (the product owner's choice, 25 September;
 *  work register clinical.path-review-mark). Units 5 to 7 ask about
 *  relationships now, and open by saying so. */
export const FEELING_AND_RELATING: Program = {
  id: "feeling-and-relating",
  title: "Feeling and Relating",
  blurb: "Skills for understanding feelings and handling relationships, one step at a time.",
  phase: 2,
  paths: { open: ["ptsd_trauma"], reviewRequired: ["complex_readiness"] },
  // The handoff names no outcome measure for this program.
  outcomeMeasureIds: [],
  signoffRowIds: ["CV10_D01", "CV10_D02", "CV10_F02"],
  units: [
    {
      id: "noticing-feelings", title: "Noticing feelings",
      purpose: "Getting familiar with what you feel, when you feel it",
      practiceIds: ["skill-make-room", "skill-what-i-need"],
      activity: "reflect-text",
      copy: { prompt: "Three times today I noticed a feeling. What were they?" },
      ...FR_EARLY, signoffRowIds: FR_ROWS,
    },
    {
      id: "naming-feelings", title: "Naming feelings",
      purpose: "Finding words for feelings, including mixed ones",
      practiceIds: ["skill-not-all-of-you"],
      activity: "feeling-words",
      copy: { prompt: "Pick two words for how you feel right now." },
      ...FR_EARLY, signoffRowIds: FR_ROWS,
    },
    {
      id: "feelings-in-the-body", title: "Feelings in the body",
      purpose: "Where feelings show up physically",
      practiceIds: ["skill-contact-points", "gentle-body-scan"],
      activity: "reflect-text",
      copy: { prompt: "Where do you usually feel stress? Where do you feel calm?" },
      ...FR_EARLY, signoffRowIds: FR_ROWS,
    },
    {
      id: "riding-intensity", title: "Riding intensity",
      purpose: "Handling feelings when they get big",
      practiceIds: ["skill-stop", "skill-ride-the-urge", "skill-move-it-out"],
      activity: "skill-pick",
      copy: { prompt: "Which skill do you want to try first next time?" },
      ...FR_EARLY, signoffRowIds: FR_ROWS,
    },
    {
      id: "the-rules-we-learned", title: "The rules we learned",
      purpose: "Noticing expectations about people that came from the past",
      practiceIds: ["skill-catch-thought"],
      activity: "reflect-text",
      text: [RIGHT_NOW],
      copy: { prompt: "Finish the sentence: When I need something from someone, I expect ___. Does that fit the people in your life now?" },
      ...FR_LATE, signoffRowIds: FR_ROWS,
    },
    {
      id: "saying-what-you-need", title: "Saying what you need",
      purpose: "Asking for things clearly and kindly",
      practiceIds: ["skill-what-i-need"],
      activity: "reflect-text",
      text: [RIGHT_NOW],
      copy: { prompt: "Draft one small request you could make this week. Keep it low-stakes." },
      ...FR_LATE, signoffRowIds: FR_ROWS,
    },
    {
      id: "flexibility", title: "Flexibility",
      purpose: "Different relationships, different approaches",
      practiceIds: ["skill-who-is-there"],
      activity: "reflect-text",
      text: [RIGHT_NOW],
      copy: { prompt: "Think of two people. What works with each of them?" },
      ...FR_LATE, signoffRowIds: FR_ROWS,
    },
    {
      id: "kindness-toward-yourself", title: "Kindness toward yourself",
      purpose: "Bringing it together with self-compassion",
      practiceIds: ["skill-self-kindness"],
      activity: "reflect-text",
      copy: { prompt: "What's one thing you want to remember from this program?" },
      ...FR_LATE, signoffRowIds: FR_ROWS,
    },
  ],
};

export const H10_PROGRAMS: readonly Program[] = [MOVING_TOWARD, STEADIER_SLEEP, FEELING_AND_RELATING];
