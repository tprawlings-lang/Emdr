// Creating a fabricated patient and taking them through onboarding (demo only).
//
// WHAT THIS IS FOR. The seeded population is a fixed cast: the same people, the
// same history, the same baselines, every reset. That is exactly right for a
// demonstration and wrong for testing the thing a real member does FIRST — sign
// up, answer the fitness screener, work through 59 questionnaire items, build a
// safety plan, and arrive in a clinician's caseload as somebody new. Nobody in
// the seed has ever done that, because the seed writes the outcome rather than
// the journey.
//
// SO THE DEPTH IS A CHOICE, and it is the whole design. Two people want
// different things from a new patient:
//
//   • Somebody testing the INTAKE wants an account and nothing else, so they
//     can sign in and walk the real screener and the real instruments by hand.
//     Pre-filling those would remove the only thing they came to test.
//   • Somebody testing the CLINICIAN'S side wants a patient who already has a
//     baseline, so the console has something to show without forty minutes of
//     form-filling first.
//
// Offering one and calling it "create a patient" serves whichever of the two
// the author happened to have in mind.
//
// THE STAGES ARE THE REAL GATES, not a parallel notion of "onboarded". Each one
// below names the predicate it satisfies in src/lib/gating.ts, because the
// failure this prevents is a demo patient who looks complete and is refused by
// the product — a testing surface that lies is worse than no testing surface.
//
// NO IMPORTS. Consumed by a server action, a page and tests.

/** The stages a member passes, in the order the product enforces them. */
export const ONBOARDING_STAGES = [
  "account",
  "membership",
  "consent",
  "fitness",
  "baseline",
  "profile",
  "checkin",
] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export interface StageSpec {
  stage: OnboardingStage;
  label: string;
  /** What a real member does here. */
  what: string;
  /** The predicate in src/lib/gating.ts (or profile.ts) this satisfies. Named
   *  so a reader can check the claim rather than trust it. */
  satisfies: string;
}

export const STAGE_SPECS: Record<OnboardingStage, StageSpec> = {
  account: {
    stage: "account",
    label: "Account",
    what: "A login exists, in the clinician's tenant, with the member role.",
    satisfies: "requireMember — and puts them in the caseload query, which selects members by tenant",
  },
  membership: {
    stage: "membership",
    label: "Membership",
    what: "A demo membership, so the programme is reachable at all.",
    satisfies: "subscriptionActive — and without it every member route redirects to /subscribe",
  },
  consent: {
    stage: "consent",
    label: "Informed consent",
    what: "The care-programme consent is granted. The signup wellness acknowledgement is a different scope and does not count.",
    satisfies: "hasConsent — scope 'care_program_full', not revoked",
  },
  fitness: {
    stage: "fitness",
    label: "Fitness screener",
    what: "The eight programme-fit questions are answered with no hard stop, so sessions are not held.",
    satisfies: "getFitnessState — status 'pass' rather than 'none' or 'cooldown'",
  },
  baseline: {
    stage: "baseline",
    label: "Baseline instruments",
    what: "All five instruments are scored: PC-PTSD-5, PCL-5, ITQ, PHQ-9 and GAD-7 — 59 items.",
    satisfies: "screeningComplete — every one of the five, by instrument id",
  },
  profile: {
    stage: "profile",
    label: "Profile and safety plan",
    what: "Triggers, early warning signs, a readiness assessment and a safety plan, and the profile marked complete.",
    satisfies: "profileComplete — user_profiles.profile_complete = 1",
  },
  checkin: {
    stage: "checkin",
    label: "First check-in",
    what: "One daily check-in, so the day has a state and the clinician's queue has something recent to read.",
    satisfies: "getTodayCheckin — the gate that otherwise asks for a check-in before a session",
  },
};

/**
 * How far to take a new patient.
 *
 * Three depths rather than a stage picker: the intermediate combinations are
 * not things anybody wants. "Consent but no fitness screener" is not a state a
 * member reaches by using the product, and offering it would invite testing
 * against a shape the product cannot produce.
 */
export const DEPTHS = ["intake_only", "baseline_recorded", "ready_for_session"] as const;
export type Depth = (typeof DEPTHS)[number];

export interface DepthSpec {
  depth: Depth;
  label: string;
  /** What this depth is for, in the words of the person choosing it. */
  purpose: string;
  stages: ReadonlyArray<OnboardingStage>;
  /** What the tester does next. A depth with no obvious next step is a depth
   *  nobody knows what to do with. */
  next: string;
}

export const DEPTH_SPECS: Record<Depth, DepthSpec> = {
  intake_only: {
    depth: "intake_only",
    label: "Account only — walk the intake yourself",
    purpose:
      "Testing what a new member actually meets: the fitness screener, all 59 baseline items, and the eleven-step profile and safety plan. Nothing is pre-filled, because pre-filling it removes the thing being tested.",
    // MEMBERSHIP IS IN EVERY DEPTH, INCLUDING THIS ONE, and it is not a
    // shortcut. Measured: a patient created with an account and nothing else
    // signed in and landed on /subscribe, because every member route checks
    // `subscriptionActive` before anything else. "Walk the intake yourself" was
    // impossible — the intake was behind a paywall the tester had no reason to
    // expect and no way to see from here.
    stages: ["account", "membership"],
    next: "Sign in as them and start at the beginning. The product will route them through consent, the fitness screener, all five instruments and the eleven-step profile in order — none of it is pre-filled.",
  },
  baseline_recorded: {
    depth: "baseline_recorded",
    label: "Through the baseline — ready for a clinician",
    purpose:
      "Testing the clinician's side. The patient has consented, passed the screener, completed all five instruments and built a safety plan, so a caseload, a record and a session prep have something real to read.",
    stages: ["account", "membership", "consent", "fitness", "baseline", "profile"],
    next: "Open them in the clinical console. Their baseline scores are on the measures tab and their record is complete enough to prepare a session from.",
  },
  ready_for_session: {
    depth: "ready_for_session",
    label: "Through today's check-in — ready for a session",
    purpose:
      "Testing the session flow end to end. Everything above, plus today's check-in, which is the last gate before a processing session opens.",
    stages: ["account", "membership", "consent", "fitness", "baseline", "profile", "checkin"],
    next: "Sign in as them and start a session, or watch them appear in the clinician's queue with today's activity.",
  },
};

export function stagesFor(depth: Depth): ReadonlyArray<OnboardingStage> {
  return DEPTH_SPECS[depth].stages;
}

/** Whether a depth includes a stage. Used by the surface to show what will and
 *  will not be written before anybody presses the button. */
export function includes(depth: Depth, stage: OnboardingStage): boolean {
  return stagesFor(depth).includes(stage);
}

// ---------------------------------------------------------------------------
// The fabricated identity
// ---------------------------------------------------------------------------

/**
 * Every created patient is labelled fabricated, in their name.
 *
 * The demo banner says the environment is fake and the persona indicator says
 * who you are pretending to be, and both are chrome a reviewer stops seeing on
 * the third screen. The suffix travels with the person: into the caseload, the
 * record header, a session prep brief, an export. §2's rule is that any screen
 * resembling a live service carries the label, and a name is the one field that
 * is on every one of those screens.
 */
export const FABRICATED_SUFFIX = "(fabricated)";

export function fabricatedName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.endsWith(FABRICATED_SUFFIX) ? trimmed : `${trimmed} ${FABRICATED_SUFFIX}`;
}

/** The email a created patient signs in with. Confined to the demo domain so a
 *  fabricated person can never be confused with a real address, and so a search
 *  for real-looking data finds nothing. */
export const DEMO_EMAIL_DOMAIN = "steady.local";

export function demoEmailFor(handle: string): string {
  const slug = handle
    .toLowerCase()
    .replace(FABRICATED_SUFFIX, "")
    .trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  return `${slug || "patient"}.new@${DEMO_EMAIL_DOMAIN}`;
}

export class NotFabricatedError extends Error {}

/**
 * Refuse anything that looks like a real person's contact details.
 *
 * The failure this prevents is the one every handoff calls a stop condition:
 * real-person information in a T0/T1 environment. A tester creating "a patient
 * like the one I saw on Tuesday" is not trying to break anything, and typing a
 * real name into a box marked "name" is the most natural thing in the world.
 * The name is fabricated-labelled either way; what is refused here is an
 * address that could belong to somebody.
 */
export function assertFabricatedInput(input: { name: string; email?: string }): void {
  const email = input.email?.trim();
  if (email && !email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) {
    throw new NotFabricatedError(
      `a demo patient's address must end in @${DEMO_EMAIL_DOMAIN} — it cannot be an address that might belong to somebody`
    );
  }
  if (!input.name.trim()) {
    throw new NotFabricatedError("a patient needs a name");
  }
}

// ---------------------------------------------------------------------------
// Baseline answers
// ---------------------------------------------------------------------------

/**
 * The clinical shape a created patient starts in.
 *
 * NAMED PRESENTATIONS RATHER THAN A SCORE SLIDER. A number entered by hand
 * produces a person whose PHQ-9 and PCL-5 disagree about how they are, which
 * looks like data and is noise: a clinician reading the record cannot tell
 * whether they are looking at a presentation or at somebody's typo. Each
 * preset below is internally consistent across all five instruments.
 *
 * NONE OF THEM CARRIES A RISK ITEM. A fabricated patient who screens positive
 * for suicidal ideation would put a fabricated crisis into a clinician's queue
 * and route a fabricated person to the crisis page — and the product's safety
 * path is exactly where a demonstration must not manufacture a fire drill.
 * Testing that path is what the seeded population's existing hard-stop alert
 * is for, where it is deliberate and documented.
 */
export const PRESENTATIONS = ["moderate", "severe", "subthreshold"] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

export interface PresentationSpec {
  presentation: Presentation;
  label: string;
  note: string;
  /** Answer value used for most items, per instrument's own scale. */
  answers: { "pc-ptsd-5": number; "pcl-5": number; itq: number; "phq-9": number; "gad-7": number };
}

export const PRESENTATION_SPECS: Record<Presentation, PresentationSpec> = {
  moderate: {
    presentation: "moderate",
    label: "Above every cutoff (PCL-5 38, PHQ-9 16)",
    note: "Mid-scale on every item, which lands above the cutoff on all five instruments. The ordinary case and the one most worth testing against. Labelled by the totals it produces rather than by a word like 'moderate' — PHQ-9 18 is moderately severe, and a preset whose name disagrees with its own numbers is the kind of thing a clinical reviewer notices first.",
    answers: { "pc-ptsd-5": 1, "pcl-5": 2, itq: 2, "phq-9": 2, "gad-7": 2 },
  },
  severe: {
    presentation: "severe",
    label: "Top of every scale (PCL-5 57, PHQ-9 24)",
    note: "The highest answer on every item. Useful for testing how the product narrows a day and what a clinician sees at the top of a queue.",
    answers: { "pc-ptsd-5": 1, "pcl-5": 3, itq: 3, "phq-9": 3, "gad-7": 3 },
  },
  subthreshold: {
    presentation: "subthreshold",
    label: "Below every cutoff",
    note: "Under the cutoff on all five. The case that tests what the product says when somebody does not screen positive — which is a real answer and not an empty one.",
    answers: { "pc-ptsd-5": 0, "pcl-5": 0, itq: 1, "phq-9": 0, "gad-7": 0 },
  },
};

/**
 * The answers for one instrument, as a member would have submitted them.
 *
 * EVERY ITEM ANSWERED, because the real submit path refuses a partial set — and
 * a demo patient created through a path that skips that refusal would prove
 * nothing about the path a member takes.
 */
export function answersFor(
  instrumentId: keyof PresentationSpec["answers"],
  itemCount: number,
  presentation: Presentation,
  /** Item indexes that trip a risk flag, from the instrument's own
   *  `riskItems`. Passed in rather than hardcoded so this cannot drift from the
   *  instrument definitions. */
  riskItemIndexes: ReadonlyArray<number> = []
): number[] {
  const value = PRESENTATION_SPECS[presentation].answers[instrumentId];
  // THE RISK ITEMS ARE ANSWERED ZERO, WHATEVER THE PRESENTATION.
  //
  // FOUND BY A GUARD, and it was already live: PHQ-9's ninth item is the
  // suicidal-ideation question, and answering every item at mid-scale answers
  // that one at mid-scale too — which tripped
  // `suicidal_ideation_screen_positive` on every "moderate" patient created.
  // That is a fabricated emergency in a clinician's queue and a fabricated
  // person routed to the crisis page, from a button whose whole purpose is
  // making a patient to test with.
  //
  // The presentations are about how somebody is doing on the ordinary items.
  // Testing the safety path is a different job, done deliberately by the
  // seeded population's documented hard-stop alert rather than as a side
  // effect of creating a patient.
  const risk = new Set(riskItemIndexes);
  return Array.from({ length: itemCount }, (_, i) => (risk.has(i) ? 0 : value));
}

/** The fitness screener's answers. All "no": a hard stop would hold the very
 *  sessions the created patient exists to exercise, and a demo that creates a
 *  blocked patient by default teaches the wrong lesson about the block. */
export function fitnessAnswers(itemIds: ReadonlyArray<string>): Record<string, boolean> {
  return Object.fromEntries(itemIds.map((id) => [id, false]));
}
