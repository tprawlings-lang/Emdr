// The intervention vocabulary — classes, labels and key normalization
// (expansion handoff 02 §2).
//
// Split out of interventions.ts for the same reason return-to-life-vocabulary
// was split out of return-to-life: a client component needs the labels, and the
// store reaches better-sqlite3. Importing the store into the browser bundle is
// something the build refuses, correctly.
//
// Nothing here touches a database, so nothing here can be a benefit label
// either — these are names for kinds of thing, and §6's forbidden words
// ("works", "effective treatment", "caused improvement", "contraindicated")
// appear in none of them.

// ---------------------------------------------------------------------------
// Ontology (§2)
// ---------------------------------------------------------------------------

/** The seven classes of §2. Closed, and ordered as the handoff lists them so a
 *  surface that groups by class does so in one predictable order. */
export const INTERVENTION_CLASSES = [
  "grounding",
  "resourcing",
  "structured_practice",
  "session_intervention",
  "companion_support",
  "behavioral_action",
  "external_clinician_entered",
] as const;

export type InterventionClass = (typeof INTERVENTION_CLASSES)[number];

export function isInterventionClass(v: string): v is InterventionClass {
  return (INTERVENTION_CLASSES as readonly string[]).includes(v);
}

export const CLASS_LABEL: Record<InterventionClass, string> = {
  grounding: "Grounding",
  resourcing: "Resourcing",
  structured_practice: "Structured practice",
  session_intervention: "Session intervention",
  companion_support: "Companion support",
  behavioral_action: "Real-life action",
  external_clinician_entered: "Recorded by clinician",
};

/** What a class is, in the words a clinician reading the screen needs. Kept
 *  here rather than in a component so every surface describes it identically. */
export const CLASS_NOTE: Record<InterventionClass, string> = {
  grounding: "Bringing attention back to the present — breathing, orienting, the body.",
  resourcing: "Building or returning to an internal resource: a calm place, a container.",
  structured_practice: "A practice with a shape and a duration — sleep, movement, meditation.",
  session_intervention: "A guided module or clinician intervention delivered in session.",
  companion_support: "A Companion conversation in which a defined intervention took place.",
  behavioral_action: "Something attempted in real life, recorded by the patient or clinician.",
  external_clinician_entered: "An intervention outside Steady, entered by the clinician.",
};

/** Where the instances of a definition come from. Recorded on the definition so
 *  a reader can tell a canonical Steady intervention from one a clinician
 *  named, which matters when the counts differ for reasons of coverage rather
 *  than of clinical fact. */
export type SourceScope = "steady_native" | "clinician_entered" | "mixed";

/** The source tables and streams an instance can be reconstructed from. */
export type InstanceSourceType =
  | "therapy_session"
  | "practice_completion"
  | "companion_interaction"
  | "return_goal_observation"
  | "clinician_thought"
  | "clinician_entry";


export class InterventionError extends Error {}

// ---------------------------------------------------------------------------
// Canonical keys
// ---------------------------------------------------------------------------

/**
 * A stable key from free wording.
 *
 * DETERMINISTIC AND LOSSY, on purpose. "Cold water" and "Cold  Water!" must
 * reach the same key or the registry accumulates near-duplicates that split one
 * person's evidence across two counts — and a split count is how a five-instance
 * pattern silently becomes two insufficient ones under §6's thresholds.
 *
 * It does NOT attempt synonymy: "cold water" and "ice dive" stay separate keys
 * until a person says otherwise. §8 is explicit that mapping wording to a
 * canonical intervention is a CANDIDATE the model may propose and a clinician
 * must accept; a normalizer that guessed at meaning would be doing that
 * accepting on their behalf.
 */
export function normalizeCanonicalKey(text: string): string {
  const key = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) throw new InterventionError("An intervention needs a name with letters or digits in it.");
  return key;
}

/** The key an adapter uses for a Steady-native source. Namespaced so a
 *  clinician typing "calm place" cannot collide with the calm-place MODULE —
 *  they may well be the same thing clinically, and merging them is a judgement
 *  §8 reserves for a person. */
export function nativeKey(kind: "module" | "practice", id: string): string {
  return `${kind}.${normalizeCanonicalKey(id)}`;
}
