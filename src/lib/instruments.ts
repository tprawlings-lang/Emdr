// Validated, public-domain screening instruments per the executive plan:
// PC-PTSD-5 for triage, PCL-5 for PTSD symptom tracking, PHQ-9 and GAD-7
// for depression/anxiety context. Scoring rules follow published guidance;
// interpretation and diagnosis remain the licensed specialist's responsibility.

export type InstrumentId = "pc-ptsd-5" | "pcl-5" | "itq" | "phq-9" | "gad-7";

export interface ScaleOption {
  value: number;
  label: string;
}

export interface Instrument {
  id: InstrumentId;
  version: string;
  title: string;
  intro: string;
  options: ScaleOption[];
  items: string[];
  /** Headings rendered before the item at startIndex (multi-part instruments). */
  sections?: { startIndex: number; heading: string }[];
  /** Item indexes whose elevated answers raise a clinician risk flag. */
  riskItems?: { index: number; threshold: number; flag: string }[];
  cutoff: number;
  cutoffNote: string;
}

const YES_NO: ScaleOption[] = [
  { value: 0, label: "No" },
  { value: 1, label: "Yes" },
];

const FREQ_0_4: ScaleOption[] = [
  { value: 0, label: "Not at all" },
  { value: 1, label: "A little bit" },
  { value: 2, label: "Moderately" },
  { value: 3, label: "Quite a bit" },
  { value: 4, label: "Extremely" },
];

const FREQ_0_3: ScaleOption[] = [
  { value: 0, label: "Not at all" },
  { value: 1, label: "Several days" },
  { value: 2, label: "More than half the days" },
  { value: 3, label: "Nearly every day" },
];

export const INSTRUMENTS: Instrument[] = [
  {
    id: "pc-ptsd-5",
    version: "2021",
    title: "PC-PTSD-5 — Primary Care PTSD Screen",
    intro:
      "Sometimes things happen to people that are unusually or especially frightening, horrible, or traumatic. Have you ever experienced this kind of event? If so, in the past month, have you...",
    options: YES_NO,
    items: [
      "Had nightmares about the event(s) or thought about the event(s) when you did not want to?",
      "Tried hard not to think about the event(s) or went out of your way to avoid situations that reminded you of the event(s)?",
      "Been constantly on guard, watchful, or easily startled?",
      "Felt numb or detached from people, activities, or your surroundings?",
      "Felt guilty or unable to stop blaming yourself or others for the event(s) or any problems the event(s) may have caused?",
    ],
    cutoff: 3,
    cutoffNote: "A score of 3 or more suggests probable PTSD and supports a fuller assessment.",
  },
  {
    id: "pcl-5",
    version: "standard (past month)",
    title: "PCL-5 — PTSD Checklist for DSM-5",
    intro:
      "Below is a list of problems people sometimes have in response to a very stressful experience. In the past month, how much were you bothered by:",
    options: FREQ_0_4,
    items: [
      "Repeated, disturbing, and unwanted memories of the stressful experience?",
      "Repeated, disturbing dreams of the stressful experience?",
      "Suddenly feeling or acting as if the stressful experience were actually happening again?",
      "Feeling very upset when something reminded you of the stressful experience?",
      "Having strong physical reactions when something reminded you of the stressful experience?",
      "Avoiding memories, thoughts, or feelings related to the stressful experience?",
      "Avoiding external reminders of the stressful experience?",
      "Trouble remembering important parts of the stressful experience?",
      "Having strong negative beliefs about yourself, other people, or the world?",
      "Blaming yourself or someone else for the stressful experience or what happened after it?",
      "Having strong negative feelings such as fear, horror, anger, guilt, or shame?",
      "Loss of interest in activities that you used to enjoy?",
      "Feeling distant or cut off from other people?",
      "Trouble experiencing positive feelings?",
      "Irritable behavior, angry outbursts, or acting aggressively?",
      "Taking too many risks or doing things that could cause you harm?",
      "Being “super alert” or watchful or on guard?",
      "Feeling jumpy or easily startled?",
      "Having difficulty concentrating?",
      "Trouble falling or staying asleep?",
    ],
    riskItems: [{ index: 15, threshold: 3, flag: "elevated_risk_taking_or_self_harm_behavior" }],
    cutoff: 33,
    cutoffNote: "Scores of 31–33 or higher suggest probable PTSD; this is a screen, not a diagnosis.",
  },
  {
    id: "itq",
    version: "Cloitre et al. (ICD-11)",
    title: "ITQ — International Trauma Questionnaire",
    intro:
      "This questionnaire asks about your most troubling experience and how it affects you. The first part asks how much you have been bothered by each problem in the past month; the second part asks how you typically feel and relate to others.",
    options: FREQ_0_4,
    sections: [
      { startIndex: 0, heading: "In the past month, how much have you been bothered by:" },
      {
        startIndex: 6,
        heading: "In the past month, have the above problems:",
      },
      {
        startIndex: 9,
        heading:
          "Below are problems people who have had stressful or traumatic events sometimes experience. How true is each statement of you?",
      },
      {
        startIndex: 15,
        heading: "In the past month, have these problems (about emotions, self, and relationships):",
      },
    ],
    items: [
      "Having upsetting dreams that replay part of the experience or are clearly related to the experience?",
      "Having powerful images or memories that sometimes come into your mind in which you feel the experience is happening again in the here and now?",
      "Avoiding internal reminders of the experience (for example, thoughts, feelings, or physical sensations)?",
      "Avoiding external reminders of the experience (for example, people, places, conversations, objects, activities, or situations)?",
      "Being “super-alert”, watchful, or on guard?",
      "Feeling jumpy or easily startled?",
      "Affected your relationships or social life?",
      "Affected your work or ability to work?",
      "Affected any other important part of your life, such as parenting, school or college work, or other important activities?",
      "When I am upset, it takes me a long time to calm down.",
      "I feel numb or emotionally shut down.",
      "I feel like a failure.",
      "I feel worthless.",
      "I feel distant or cut off from people.",
      "I find it hard to stay emotionally close to people.",
      "Created concern or distress about your relationships or social life?",
      "Affected your work or ability to work?",
      "Affected any other important part of your life, such as parenting, school or college work, or other important activities?",
    ],
    cutoff: 999, // Criteria-based, not sum-based; see scoreItq.
    cutoffNote:
      "Scored against ICD-11 criteria: PTSD requires one symptom rated Moderately or above in each symptom pair plus functional impairment; complex PTSD additionally requires the self-organization (DSO) criteria.",
  },
  {
    id: "phq-9",
    version: "standard",
    title: "PHQ-9 — Depression",
    intro: "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
    options: FREQ_0_3,
    items: [
      "Little interest or pleasure in doing things",
      "Feeling down, depressed, or hopeless",
      "Trouble falling or staying asleep, or sleeping too much",
      "Feeling tired or having little energy",
      "Poor appetite or overeating",
      "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
      "Trouble concentrating on things, such as reading the newspaper or watching television",
      "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
      "Thoughts that you would be better off dead or of hurting yourself in some way",
    ],
    riskItems: [{ index: 8, threshold: 1, flag: "suicidal_ideation_screen_positive" }],
    cutoff: 10,
    cutoffNote: "10+ suggests moderate depression; item 9 above zero always routes to specialist review.",
  },
  {
    id: "gad-7",
    version: "standard",
    title: "GAD-7 — Anxiety",
    intro: "Over the last 2 weeks, how often have you been bothered by the following problems?",
    options: FREQ_0_3,
    items: [
      "Feeling nervous, anxious, or on edge",
      "Not being able to stop or control worrying",
      "Worrying too much about different things",
      "Trouble relaxing",
      "Being so restless that it is hard to sit still",
      "Becoming easily annoyed or irritable",
      "Feeling afraid, as if something awful might happen",
    ],
    cutoff: 10,
    cutoffNote: "10+ suggests moderate anxiety.",
  },
];

export function getInstrument(id: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.id === id);
}

export function scoreInstrument(
  instrument: Instrument,
  answers: number[]
): { total: number; positive: boolean; riskFlags: string[] } {
  const riskFlags: string[] = [];
  for (const r of instrument.riskItems ?? []) {
    if ((answers[r.index] ?? 0) >= r.threshold) riskFlags.push(r.flag);
  }
  if (instrument.id === "itq") {
    const itq = scoreItq(answers);
    return { total: itq.ptsdSum + itq.dsoSum, positive: itq.ptsdCriteria, riskFlags };
  }
  const total = answers.reduce((a, b) => a + b, 0);
  return { total, positive: total >= instrument.cutoff, riskFlags };
}

// ITQ scoring (Cloitre et al.). Item layout:
//   0–5   PTSD symptoms in pairs: re-experiencing (0,1), avoidance (2,3), threat (4,5)
//   6–8   PTSD functional impairment
//   9–14  DSO symptoms in pairs: affect dysregulation (9,10), negative
//         self-concept (11,12), disturbed relationships (13,14)
//   15–17 DSO functional impairment
// A cluster counts when at least one of its items is rated >= 2 ("Moderately").
export interface ItqResult {
  ptsdSum: number;
  dsoSum: number;
  ptsdCriteria: boolean;
  dsoCriteria: boolean;
  cptsdCriteria: boolean;
  label: string;
}

export function scoreItq(answers: number[]): ItqResult {
  const at = (i: number) => answers[i] ?? 0;
  const pairMet = (a: number, b: number) => at(a) >= 2 || at(b) >= 2;
  const sum = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i <= to; i++) s += at(i);
    return s;
  };

  const ptsdSymptoms = pairMet(0, 1) && pairMet(2, 3) && pairMet(4, 5);
  const ptsdImpairment = at(6) >= 2 || at(7) >= 2 || at(8) >= 2;
  const dsoSymptoms = pairMet(9, 10) && pairMet(11, 12) && pairMet(13, 14);
  const dsoImpairment = at(15) >= 2 || at(16) >= 2 || at(17) >= 2;

  const ptsdCriteria = ptsdSymptoms && ptsdImpairment;
  const dsoCriteria = dsoSymptoms && dsoImpairment;
  const cptsdCriteria = ptsdCriteria && dsoCriteria;

  return {
    ptsdSum: sum(0, 5),
    dsoSum: sum(9, 14),
    ptsdCriteria,
    dsoCriteria,
    cptsdCriteria,
    label: cptsdCriteria
      ? "Complex PTSD criteria met"
      : ptsdCriteria
        ? "PTSD criteria met"
        : "Criteria not met",
  };
}
