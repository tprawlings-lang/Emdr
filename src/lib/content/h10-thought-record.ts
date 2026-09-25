// Handoff 10 2B: the member's thought record, as signed (CV10_D04). Every
// member-facing string is the pack's (docs/handoffs/10-content-pack.md §7);
// tests/content-approval.test.ts matches each one whole.
//
// Where the pack's line carries two things, it is split without rewording:
// "What happened? (a sentence or two)" is a question and its hint, and "How
// strong? 0 to 10" is a question and the scale it is asked on.

import { AccessTier } from "../safety/types";

export interface ThoughtRecordStep {
  /** The payload field this step fills. */
  field: "situation" | "feeling" | "thought" | "supports" | "against" | "balanced" | "strengthAfter";
  question: string;
  hint?: string;
}

export const THOUGHT_RECORD = {
  id: "thought-record",
  title: "Working with a thought",
  intro: "Pick something from the last few days. Everyday situations work best.",
  steps: [
    { field: "situation", question: "What happened?", hint: "a sentence or two" },
    { field: "feeling", question: "What did you feel?" },
    { field: "thought", question: "What went through your mind?" },
    { field: "supports", question: "What makes that thought feel true?" },
    { field: "against", question: "What doesn't fit, or what might someone else notice?" },
    { field: "balanced", question: "Is there a more balanced way to put it?", hint: "It doesn't have to be positive, just fairer." },
    { field: "strengthAfter", question: "How strong is the feeling now?" },
  ] as const satisfies readonly ThoughtRecordStep[],
  /** Step 2's second half, asked on the 0 to 10 scale. */
  strengthQuestion: "How strong?",
  feelingWordsLabel: "feeling words",
  save: "Save",
  stop: "Stop",
  privacy: "Only you can see this. You can delete it any time.",
  /** Shown when step 2's strength is this or higher. */
  strongAt: 8,
  strong: "That's a strong feeling. Would you like to try a grounding skill first?",
  strongGround: "Find the room",
  strongContinue: "Keep going",
  /** The skill "Find the room" opens (S01). */
  groundSkillId: "skill-orient-room",
  // Gate: the thinking skills it comes from (cbt-thought-noticing,
  // cbt-evidence-for-against) — the cautious tier, ceiling 6.
  minTier: AccessTier.CAUTIOUS,
  maxActivation: 6,
  signoffRowIds: ["CV10_D04"],
} as const;
