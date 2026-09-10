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
