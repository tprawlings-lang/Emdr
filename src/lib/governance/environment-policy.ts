// One policy that governs entry, storage, display and export.
//
// UX 008: "Pilot-account language conflicts with fabricated-only policy
// statements. Decide and enforce permitted data classes before copy changes.
// One approved environment policy governs entry, storage, display, and export."
//
// THE CONTRADICTION IS REAL AND NEITHER SIDE OF IT IS WRONG. Every screen
// carries "DEMO — FABRICATED DATA — NOT CLINICAL CARE", and the product also
// has a pilot: an enrollment gate, an access code, a consent and terms flow, a
// place limit, and `pilotTenantId` keeping enrolled people in a tenant of their
// own so no metric ever spans real and fabricated populations. Both statements
// are true of DIFFERENT STATES, and the defect is that nothing said which state
// this deployment is in. A reader had to infer it from a banner, and a banner
// is not a policy.
//
// DECIDED 19 SEPTEMBER: real consented participants are what the pilot is FOR,
// and no environment takes one until the gates that protect them pass. So this
// is two things rather than one, and keeping them apart is the point:
//
//   THE TIERS are the decision — what each state permits, per data class, for
//   each of UX 008's four verbs. Written down once, as a constant somebody can
//   review, rather than implied by scattered conditions.
//
//   THE CURRENT TIER IS READ, NOT DECLARED. A constant saying "this is the
//   demonstration environment" is the same kind of claim as the handoff
//   paragraph the work register exists to retire: true when written, unchecked
//   afterwards. It is computed from live facts — whether enrollment is open,
//   and whether every gate T1 requires has actually passed — so an environment
//   cannot be in the pilot tier because somebody set a variable.
//
// WHAT THIS MODULE MUST NEVER DO is widen what is permitted. It reports a tier
// and answers whether an action is allowed in it. Every unresolved or failing
// gate reads as T0, so the failure direction is toward fabricated-only.

/** The kinds of information that can exist in this product. */
export type DataClass =
  /** Invented by the seed. Every record carries `provenance: 'fabricated'`. */
  | "fabricated"
  /** A real person receiving care through the pilot, and everything they
   *  enter: check-ins, measures, session records, safety answers. */
  | "real_participant"
  /** A real clinician, reviewer or operator: their name, their account, the
   *  notes they sign. Distinct from participant data because the consent that
   *  covers one does not cover the other. */
  | "real_staff"
  /** Facts about the deployment itself — versions, timings, counts. Carries no
   *  person. */
  | "operational";

/** UX 008's four verbs, which is what makes this a policy rather than a label.
 *  A class can be enterable and not exportable, and the difference is where
 *  most real incidents live. */
export type Verb = "entry" | "storage" | "display" | "export";

export const VERB_LABEL: Record<Verb, string> = {
  entry: "May be entered",
  storage: "May be stored",
  display: "May be shown on a screen",
  export: "May leave the system in a file",
};

export type Tier = "T0_demonstration" | "T1_pilot";

export const TIER_LABEL: Record<Tier, string> = {
  T0_demonstration: "Demonstration",
  T1_pilot: "Pilot with real participants",
};

export interface TierPolicy {
  tier: Tier;
  /** One sentence a reader can act on without opening anything else. */
  statement: string;
  /** Per class, which verbs are permitted. A class absent from a tier permits
   *  nothing, which is the safe reading of an omission. */
  permits: Partial<Record<DataClass, readonly Verb[]>>;
}

const ALL: readonly Verb[] = ["entry", "storage", "display", "export"];

export const TIER_POLICY: Record<Tier, TierPolicy> = {
  T0_demonstration: {
    tier: "T0_demonstration",
    statement:
      "Fabricated data only. No real participant's information may be entered, stored, shown or " +
      "exported here, in any form. Real staff may hold accounts and sign what they do, because " +
      "somebody has to operate the demonstration — and that is the only real-person information " +
      "this tier permits.",
    permits: {
      fabricated: ALL,
      // THE ONE REAL-PERSON CLASS T0 PERMITS, and stating it is the point: a
      // policy that said "fabricated only" while a reviewer's real name sat in
      // the header would be a policy nobody could follow, so it would be
      // ignored rather than corrected.
      real_staff: ALL,
      operational: ALL,
    },
  },
  T1_pilot: {
    tier: "T1_pilot",
    statement:
      "Real consented participants, in the pilot tenant, under the consent and terms flow. " +
      "Fabricated records stay in their own tenant and no metric spans both. Participant data " +
      "may not leave the system in a file: export stays closed at this tier because an approved " +
      "export path for real participant data is a separate decision from admitting them.",
    permits: {
      fabricated: ALL,
      real_staff: ALL,
      operational: ALL,
      // NOT `ALL`. Admitting a real participant and permitting their record to
      // be exported are two decisions, and granting the second with the first
      // is how a consent scope quietly widens. §15.6c is already the reason a
      // whole-database snapshot cannot honour per-participant terms.
      real_participant: ["entry", "storage", "display"],
    },
  },
};

/**
 * The gates a deployment must pass before it may hold a real participant.
 *
 * NAMED HERE RATHER THAN "ALL EIGHT", because two of p99's gates are about the
 * demonstration's own honesty — that the fabricated population contains nothing
 * identifying, and that the product's public claims are supportable — and one
 * is about analytics integrity. They matter, and they are not what stands
 * between a real person and harm. The five below are: that the safety engine
 * still does what it did, that clinical language is what a clinician approved,
 * that authorization holds, that the screens can be used by the people who have
 * to use them, and that what is displayed is what the records say.
 *
 * ERRING TOWARD MORE RATHER THAN FEWER would have been the easy call and the
 * wrong one: a list nobody can justify per entry gets waved through as a block,
 * and then the gate is the waiver rather than the check.
 */
export const T1_REQUIRED_GATES: readonly string[] = [
  "safety_regression",
  "authorization",
  "accessibility",
  // BACK ON THE LIST, because a recorded result made them askable. Both read
  // `unavailable` wherever the tier is read — one needs a copy-review tally,
  // the other a ledger rebuild — so they were named as unresolvable rather
  // than required. `gate-results.ts` records what the release console resolved
  // and expires it when the inputs move, which is what a cheap reader needs.
  "clinical_language",
  "projection_parity",
];

/**
 * Gates that belong on the list above and cannot be asked where it is read.
 *
 * EMPTY NOW, AND KEPT RATHER THAN DELETED. It held `clinical_language` and
 * `projection_parity`: both resolve to `unavailable` in every deployment — not
 * because they fail, but because `resolveEvidence` does not compute either
 * unless the caller hands it in, and the tier is read on the signup page where
 * neither is affordable. Requiring them anyway would have been the same
 * one-way door as before, dressed as diligence.
 *
 * `gate-results.ts` closed that: the release console records what it resolved,
 * keyed to something cheap that identifies the inputs, and the record expires
 * when they move. The constant stays because the next gate with this shape
 * should be named here rather than quietly left off a list.
 */
export const T1_GATES_NOT_YET_RESOLVABLE: readonly string[] = [];

export interface TierFacts {
  /** Whether the deployment has an enrollment code set at all. */
  enrollmentOpen: boolean;
  /** Gate id -> whether its evidence currently passes. A gate absent from this
   *  map has not been resolved, which is not a pass. */
  gatePassed: Readonly<Record<string, boolean>>;
}

export interface TierReading {
  tier: Tier;
  policy: TierPolicy;
  /** Why it is this tier, in words, naming what is missing when something is. */
  because: string;
  /** Gates T1 needs that are not passing. Empty at T1. */
  blockedBy: readonly string[];
}

/**
 * Read the tier off the deployment.
 *
 * BOTH CONDITIONS, AND THE ORDER OF THE SENTENCE MATTERS. Enrollment being
 * open is an intention; the gates passing is the evidence. A deployment with
 * the code set and a failing safety gate is NOT in the pilot tier — it is a
 * demonstration whose operator meant to open a pilot, and saying so is more
 * useful than either a bare refusal or a tier it has not earned.
 */
export function readTier(facts: TierFacts): TierReading {
  const blockedBy = T1_REQUIRED_GATES.filter((g) => facts.gatePassed[g] !== true);

  if (!facts.enrollmentOpen) {
    return {
      tier: "T0_demonstration",
      policy: TIER_POLICY.T0_demonstration,
      because:
        "Enrollment is closed: no enrollment code is set, so nobody can create a participant " +
        "account. This is a demonstration.",
      blockedBy,
    };
  }
  if (blockedBy.length > 0) {
    return {
      tier: "T0_demonstration",
      policy: TIER_POLICY.T0_demonstration,
      because:
        `Enrollment is open, and ${blockedBy.length} gate${blockedBy.length === 1 ? "" : "s"} ` +
        `the pilot requires ${blockedBy.length === 1 ? "is" : "are"} not passing: ` +
        `${blockedBy.join(", ")}. Until they do, this deployment is a demonstration whose ` +
        "operator intends a pilot, and it may hold no real participant.",
      blockedBy,
    };
  }
  return {
    tier: "T1_pilot",
    policy: TIER_POLICY.T1_pilot,
    because:
      "Enrollment is open and every gate the pilot requires is passing, so real consented " +
      "participants may be admitted under the consent and terms flow.",
    blockedBy: [],
  };
}

/** Whether a tier permits doing this to this class of information. */
export function permits(tier: Tier, cls: DataClass, verb: Verb): boolean {
  return (TIER_POLICY[tier].permits[cls] ?? []).includes(verb);
}

/**
 * Whether a real participant may be admitted at all.
 *
 * THE ONE CALLERS SHOULD ASK, rather than reading the tier and deciding for
 * themselves. A second site that compared tiers by hand would eventually
 * compare them differently.
 */
export function mayAdmitParticipant(reading: TierReading): boolean {
  return permits(reading.tier, "real_participant", "entry");
}
