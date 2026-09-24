// Name and free-text dictionaries for the demo population (handoff 07 §2.7,
// p28).
//
//   "Use separate dictionaries for supportive free text, operational notes and
//    clinician comments. NEVER ASK A LANGUAGE MODEL TO INVENT UNCONTROLLED
//    CLINICAL NARRATIVES AT RUNTIME."
//
// That last sentence is the reason this file exists rather than a prompt. A
// model asked for "a plausible clinician note" at render time produces text
// nobody approved, which cannot be reproduced by a reset, and which reads to
// an observer exactly like a real note about a real person. Fixed dictionaries
// are reproducible, reviewable, and boring in the way fabricated data should
// be.
//
// Names are drawn from these lists and every one carries "(fabricated)". p14
// requires names, emails, addresses, phones, free text and dates to be
// generated from demo dictionaries; the marker is what stops a screenshot from
// being mistaken for a record.

/** Given names, chosen to span common English-language orthographies without
 *  encoding an assumption about anybody. The generator picks by seed and NEVER
 *  by race, ethnicity or language — p28: "do not make protected status
 *  determine" an outcome, and a name assigned from a protected attribute is
 *  that inference wearing a costume. */
export const GIVEN_NAMES = [
  "Alex", "Priya", "Marcus", "Yuki", "Sofia", "Amir", "Nina", "Tobias",
  "Leilani", "Dmitri", "Grace", "Omar", "Ines", "Kofi", "Mara", "Jonas",
  "Aiko", "Rosa", "Elias", "Freya", "Hassan", "Camila", "Noor", "Bastien",
  "Thandiwe", "Rafael", "Ingrid", "Kenji", "Aurelia", "Samir", "Lourdes",
  "Anders", "Chiara", "Malik", "Solveig", "Idris", "Paloma", "Viktor",
  "Naledi", "Emiko",
] as const;

export const FAMILY_NAMES = [
  "Rivera", "Okafor", "Chen", "Idowu", "Raman", "Nakamura", "Achebe",
  "Lindqvist", "Osei", "Fontaine", "Baptiste", "Kowalski", "Moreau",
  "Ferreira", "Halvorsen", "Nakagawa", "Adeyemi", "Castellanos", "Bergström",
  "Mwangi", "Delacroix", "Petrossian", "Vasquez", "Nakashima", "Oyelaran",
  "Hartmann", "Silvestri", "Abubakar", "Lindgren", "Marchetti",
] as const;

/**
 * Supportive free text a MEMBER might write. Ordinary, undramatic, and never
 * clinical: these are the member's own words in a demo, not a symptom report.
 */
export const MEMBER_NOTES = [
  "Slept badly but did the breathing one anyway.",
  "Second week of doing this most mornings.",
  "Skipped yesterday. Back today.",
  "The grounding module is the one I actually use.",
  "Busy week at work — checking in late.",
  "Not much to say today.",
  "Felt steadier after the last one.",
  "Wanted to stop halfway and did.",
] as const;

/**
 * OPERATIONAL notes — the workflow, not the person. Kept separate from
 * clinician comments below because p28 asks for separate dictionaries, and the
 * reason is that they are different kinds of statement: one describes what the
 * system did, the other is a professional's judgement.
 */
export const OPERATIONAL_NOTES = [
  "Reminder sent; no response within the window.",
  "Rescheduled at the member's request.",
  "Interpreter requested for the next contact.",
  "Contact attempted outside preferred hours; retry scheduled.",
  "Referral packet acknowledged by the receiving site.",
  "Coverage confirmed for the current period.",
] as const;

/**
 * CLINICIAN comments. Deliberately procedural: they record that a review
 * happened and what was decided, never a diagnosis or a prediction.
 *
 * p3's boundary applies here as much as to any screen — the demo may not
 * "diagnose, prescribe, clear gates or claim causality", and a fabricated note
 * that reads like a diagnosis is a claim whatever the banner says.
 */
export const CLINICIAN_COMMENTS = [
  "Reviewed the pause; agreed with the hold and set a check for next week.",
  "Discussed pacing. Member preferred to stay on stabilization for now.",
  "Follow-up measure due; outreach queued.",
  "Reviewed session response with the member. No change to the plan.",
  "Access barrier noted — scheduling, not engagement.",
  "Re-entry after pause agreed with the member, with a shorter first session.",
] as const;

/** Deterministic pick. Seeded, so the same profile draws the same text on
 *  every rebuild — p14: re-running a version must produce the same values. */
export function pick<T>(list: readonly T[], seed: number, salt = 0): T {
  return list[(seed + salt * 7919) % list.length];
}

/** A fabricated display name. The "(fabricated)" suffix is not decoration: it
 *  is what stops a screenshot of a caseload being mistaken for a record. */
export function displayName(seed: number): string {
  return `${pick(GIVEN_NAMES, seed)} ${pick(FAMILY_NAMES, seed, 3)} (fabricated)`;
}

/**
 * Life goals, authored in full.
 *
 * ONE ENTRY IS A WHOLE GOAL, not a title with a ladder generated around it,
 * and that is the point. §2's ladder is five rungs describing one part of one
 * person's life, and five rungs assembled by a template read as a scale
 * somebody filled in — which is exactly what §9 forbids the FORM from doing
 * ("natural statement first"). A seed that generated them would be doing at
 * scale what the form is built to prevent.
 *
 * THE STATEMENT IS THE PERSON'S WORDS AND THE TITLE IS THE CLINICIAN'S. The
 * product renders the first to the person and the second on the record, so a
 * dictionary that supplied only one would make one of those two screens quote
 * the other's language.
 *
 * FUNCTION, NEVER SYMPTOMS. Not one of these says anything about how somebody
 * feels, what they have, or why. §1: a scale falling and a person walking back
 * into a shop are different facts, and these are the second kind.
 */
export interface LifeGoal {
  title: string;
  statement: string;
  whyItMatters: string;
  domain:
    | "daily_living" | "sleep" | "work_school" | "relationships"
    | "mobility_travel" | "self_care" | "community_recreation" | "other";
  /** Five rungs, lowest first. The lowest is where somebody is, not a failure. */
  rungs: readonly [string, string, string, string, string];
}

export const LIFE_GOALS: readonly LifeGoal[] = [
  {
    title: "The weekly shop",
    statement: "I want to do the big shop on my own again.",
    whyItMatters: "I hate having to ask someone every week.",
    domain: "daily_living",
    rungs: [
      "Someone else does the shopping for me.",
      "I go with someone and wait near the door.",
      "I do a small shop on my own on a quiet morning.",
      "I do the weekly shop on my own.",
      "I shop on a Saturday without planning around it.",
    ],
  },
  {
    title: "Buses again",
    statement: "I want to get on a bus by myself.",
    whyItMatters: "I cannot get anywhere without asking for a lift.",
    domain: "mobility_travel",
    rungs: [
      "I do not leave the house on my own.",
      "I get to the stop and come home.",
      "I take one stop with someone beside me.",
      "I take the bus into town on my own.",
      "I take buses without thinking about it.",
    ],
  },
  {
    title: "The school run",
    statement: "I want to walk my daughter to school again.",
    whyItMatters: "It was the part of the day that was ours.",
    domain: "relationships",
    rungs: [
      "Someone else takes her every day.",
      "I walk to the end of the road and turn back.",
      "I walk her most of the way with her dad.",
      "I walk her there and back on my own.",
      "I do the school run without it being a thing.",
    ],
  },
  {
    title: "Sleeping in my own room",
    statement: "I want to sleep in my own bed through the night.",
    whyItMatters: "I am tired all the time and it is making everything harder.",
    domain: "sleep",
    rungs: [
      "I sleep on the sofa with the television on.",
      "I fall asleep in my room and move in the night.",
      "I stay in my room most nights.",
      "I sleep through in my own bed most nights.",
      "I sleep in my own room and do not think about it.",
    ],
  },
  {
    title: "Back to full shifts",
    statement: "I want to get through a full shift without leaving early.",
    whyItMatters: "My team has been covering for me and I want to pull my weight.",
    domain: "work_school",
    rungs: [
      "I am signed off and not working.",
      "I do half days and go home early.",
      "I get through a full shift about once a week.",
      "I work my full shifts most weeks.",
      "I work my shifts and it is not something I count.",
    ],
  },
  {
    title: "Swimming on Thursdays",
    statement: "I want to go back to my swimming class.",
    whyItMatters: "It was the one thing in the week that was just mine.",
    domain: "community_recreation",
    rungs: [
      "I have not been back since it happened.",
      "I drive past the pool and go home.",
      "I go and sit in the cafe while the class runs.",
      "I swim the class most Thursdays.",
      "I go swimming without making a decision about it.",
    ],
  },
  {
    title: "Cooking for myself",
    statement: "I want to cook a proper meal in the evenings again.",
    whyItMatters: "I have been living on toast and I know it is not helping.",
    domain: "self_care",
    rungs: [
      "I eat whatever needs no cooking.",
      "I cook if someone else is in the house.",
      "I cook a proper meal once or twice a week.",
      "I cook most evenings.",
      "I cook without it being an effort.",
    ],
  },
  {
    title: "Seeing my brother",
    statement: "I want to see my brother and his kids again.",
    whyItMatters: "I have been making excuses for months and they have noticed.",
    domain: "relationships",
    rungs: [
      "I have not seen them and I am not answering calls.",
      "I answer the phone but do not make plans.",
      "I see them for an hour with somebody else there.",
      "I go over for the afternoon on my own.",
      "I see them the way I used to.",
    ],
  },
];

/**
 * What a clinician writes for the PERSON when they assign something.
 *
 * SEPARATE FROM THE CLINICIAN COMMENTS ABOVE, for p28's reason and one more:
 * these are the only words in an assignment that the person ever reads, so
 * they are addressed to them. A dictionary that reused the operational notes
 * would put "chased by phone, no answer" in somebody's plan as an explanation
 * of their homework.
 */
export const ASSIGNED_SUPPORT_WORDS = [
  "Ten minutes of this before Thursday, so we can use it in the session.",
  "Try this once when things are steady, not when they are difficult.",
  "Something to have ready before we do any of the harder work.",
  "A short one to keep going between now and when we next meet.",
  "This is the one you said helped. Worth doing on the days it is hard.",
  "No need to finish it. Stopping partway is a normal way to use this.",
] as const;
