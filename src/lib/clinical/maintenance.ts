// Leaving active between-visit work (17 September handoff, P5).
//
//   "Add a governed maintenance state for people leaving active between-visit
//   work. It may provide less frequent check-ins, previously permitted tools, a
//   warning-sign plan, and a path back to care. THE INTERFACE MUST NOT IMPLY
//   ACTIVE CLINICIAN MONITORING WHEN NONE EXISTS."
//
// THE LAST SENTENCE IS THE WHOLE DIFFICULTY, and it is the reason this is a
// governed state rather than a status flag. Everything a maintenance screen
// naturally wants to say — "we will be keeping an eye on things", "check in and
// we will see how you are doing" — is a promise of attention. During active
// work that promise is roughly true: somebody has a queue with this person in
// it. In maintenance nobody does, and the words that were honest last month
// become a claim about staffing that nobody made.
//
// A person who believes they are being watched behaves as though they are being
// watched: they wait rather than escalate, and they read silence as "nothing is
// wrong" rather than as "nobody is looking". That is the specific harm, and it
// is why the language here is held until somebody approves it rather than
// shipped and reviewed later.
//
// WHAT THIS MODULE IS. The five transitions the handoff names, what each must
// say, and what none of them may imply — plus the approval that gates the
// patient-facing words. It deliberately does NOT write a state: the transition
// that matters clinically ("return to active care") requires a current
// relationship, an eligibility check and a fresh care-plan decision, and
// building the write path before the language is approved would be building the
// thing the decision list says to approve first.

export const MAINTENANCE_TRANSITIONS = [
  "active_to_maintenance",
  "tool_remains_available",
  "instruction_outdated",
  "warning_sign_reported",
  "return_to_active",
] as const;

export type MaintenanceTransition = (typeof MAINTENANCE_TRANSITIONS)[number];

/** A fact a transition must state. Named so a surface can be checked against
 *  the list rather than read for tone. */
export type TransitionFact =
  | "what_ends" | "what_continues" | "who_is_responsible" | "effective_time"
  | "approved_version" | "private_or_shared"
  | "expired_not_rewritten" | "historical_assignment_kept"
  | "safety_policy_applied" | "contact_path"
  | "current_relationship" | "eligibility_checked" | "fresh_care_plan_decision";

export interface TransitionContract {
  transition: MaintenanceTransition;
  /** The handoff's "required behavior", as facts a screen must carry. */
  requires: readonly TransitionFact[];
  /** In one sentence, for a reviewer reading the contract rather than the code. */
  because: string;
}

export const MAINTENANCE_CONTRACT: Record<MaintenanceTransition, TransitionContract> = {
  active_to_maintenance: {
    transition: "active_to_maintenance",
    requires: ["what_ends", "what_continues", "who_is_responsible", "effective_time"],
    because:
      "Somebody leaving active work needs to know which half of what they had is going away, and " +
      "when. A transition that names only what continues reads as nothing changing.",
  },
  tool_remains_available: {
    transition: "tool_remains_available",
    requires: ["approved_version", "private_or_shared"],
    because:
      "A tool that stays open after the work ends is used differently if what it records is still " +
      "read by somebody. Whether it is private now is the question, and the version pins which " +
      "tool they were actually left with.",
  },
  instruction_outdated: {
    transition: "instruction_outdated",
    requires: ["expired_not_rewritten", "historical_assignment_kept"],
    because:
      "An instruction that quietly updates rewrites what somebody was told. The old one expires " +
      "and stays readable, so what they were asked to do in March is still answerable in September.",
  },
  warning_sign_reported: {
    transition: "warning_sign_reported",
    requires: ["safety_policy_applied", "contact_path"],
    because:
      "The safety policy applies in maintenance exactly as it does in active work. What changes is " +
      "that nobody is watching for the report, so the path to a person has to be on the screen.",
  },
  return_to_active: {
    transition: "return_to_active",
    requires: ["current_relationship", "eligibility_checked", "fresh_care_plan_decision"],
    because:
      "Coming back is a clinical decision, not a state change. A relationship that lapsed, an " +
      "eligibility that expired, or a plan nobody has revisited each make the return a different " +
      "decision from the one that was made before.",
  },
};

/**
 * Words a maintenance surface may never use, and what to say instead.
 *
 * NOT A STYLE GUIDE. Each of these is a specific false promise: the product
 * cannot monitor, cannot watch, cannot notice, and cannot alert anybody in
 * maintenance, because there is no queue with this person in it. A guard checks
 * the patient-facing copy against this list, which is the only way a rule about
 * tone survives contact with a hurried edit.
 */
export const FORBIDDEN_MONITORING_LANGUAGE: ReadonlyArray<{ phrase: string; instead: string }> = [
  { phrase: "we will be monitoring", instead: "Say who to contact and when somebody would read it." },
  { phrase: "we are keeping an eye", instead: "Say nobody is reading this day to day, and how to reach a person." },
  { phrase: "we will check on you", instead: "Name the actual review date, or say there is not one." },
  { phrase: "your clinician will see", instead: "Say whether anybody reads it, and when." },
  { phrase: "we are watching", instead: "Say what is recorded and who can open it, not who is looking." },
  { phrase: "we will notice", instead: "Say what happens to a report, and how long that takes." },
  { phrase: "someone is always", instead: "Name the actual coverage, which is not always." },
  { phrase: "you are being followed", instead: "Say what continues and who is accountable for it." },
];

/** Every forbidden phrase this text uses, with what to say instead. */
export function monitoringLanguageProblems(
  text: string
): Array<{ phrase: string; instead: string }> {
  const lower = text.toLowerCase();
  return FORBIDDEN_MONITORING_LANGUAGE.filter((f) => lower.includes(f.phrase));
}

// ---------------------------------------------------------------------------
// The approval that gates the patient-facing words
// ---------------------------------------------------------------------------
//
// The handoff's decision list is explicit: "Maintenance state — approve the
// operating and monitoring language before exposing it to patients." So the
// words exist, they are written down where a reviewer can read them, and the
// product refuses to show them to a patient until somebody has signed.
//
// HELD RATHER THAN HIDDEN. A feature built and left dark is invisible to the
// person who has to approve it; this one is readable on the clinician side and
// refused on the patient side, which is what "approve before exposing" asks
// for.

export interface MaintenanceLanguageApproval {
  id: string;
  status: "approved" | "awaiting_approval";
  /** What a reviewer would be signing. */
  scope: string;
  reviewers: ReadonlyArray<{ name: string; role: string; license: string; signedAt: string }>;
  reviewedAt: string | null;
}

export const MAINTENANCE_LANGUAGE_APPROVAL: MaintenanceLanguageApproval = {
  id: "maintenance-language-v1",
  // AWAITING, AND THE PRODUCT BEHAVES AS THOUGH IT IS. Nothing patient-facing
  // renders these words while this says awaiting_approval.
  status: "awaiting_approval",
  scope:
    "The words a person in maintenance reads about what continues, what ended, who is accountable, " +
    "and what happens if they report a warning sign — including every sentence about who is or is " +
    "not reading what they record.",
  reviewers: [],
  reviewedAt: null,
};

/** Whether maintenance words may be shown to a patient. */
export function maintenanceLanguageApproved(): boolean {
  return (
    MAINTENANCE_LANGUAGE_APPROVAL.status === "approved" &&
    MAINTENANCE_LANGUAGE_APPROVAL.reviewers.length > 0 &&
    MAINTENANCE_LANGUAGE_APPROVAL.reviewedAt !== null
  );
}

/** Why a patient-facing maintenance surface is refused, in words. */
export const MAINTENANCE_HELD_REASON =
  "The words a person in maintenance would read have not been through clinical review. They are " +
  "readable here so they can be reviewed; nothing shows them to a patient until somebody signs.";


// ---------------------------------------------------------------------------
// The words themselves
// ---------------------------------------------------------------------------
//
// WRITTEN DOWN SO THEY CAN BE REVIEWED. A language approval over copy nobody
// has seen is a signature over an intention. These are the sentences, in the
// order a person would meet them, and they are on the clinical-language review
// screen for exactly that reason.
//
// Every one of them is checked against FORBIDDEN_MONITORING_LANGUAGE by a
// guard. The rule is not "avoid over-promising"; it is that these specific
// claims are false in maintenance and a hurried edit will reintroduce one.

export interface MaintenanceCopy {
  transition: MaintenanceTransition;
  /** What the person reads. */
  member: string;
  /** The supporting lines, each answering one required fact. */
  supporting: ReadonlyArray<{ fact: TransitionFact; text: string }>;
}

export const MAINTENANCE_COPY: readonly MaintenanceCopy[] = [
  {
    transition: "active_to_maintenance",
    member:
      "Your between-visit work has finished. The tools you were using stay open, and nobody is " +
      "reading what you record in them day to day.",
    supporting: [
      { fact: "what_ends", text: "Assigned work ends. Nothing new will be asked of you here." },
      {
        fact: "what_continues",
        text: "The practices you were given stay open, and your record stays as it is.",
      },
      {
        fact: "who_is_responsible",
        text: "Your clinician remains accountable for your record. They are not reviewing it on a schedule.",
      },
      { fact: "effective_time", text: "This took effect on the date shown beside it." },
    ],
  },
  {
    transition: "tool_remains_available",
    member:
      "This practice stays open to you. What you write inside it is yours; it is part of your " +
      "record and can be opened by the people who could already see your record.",
    supporting: [
      {
        fact: "approved_version",
        text: "The version you were left with is the one recorded against it, not whichever is current.",
      },
      {
        fact: "private_or_shared",
        text: "Using it is recorded. Nobody is alerted, and nobody reads it unless they open your record.",
      },
    ],
  },
  {
    transition: "instruction_outdated",
    member:
      "Something you were asked to do has passed its date. It is kept here as it was written, " +
      "rather than changed.",
    supporting: [
      {
        fact: "expired_not_rewritten",
        text: "The instruction expired. Its words are unchanged.",
      },
      {
        fact: "historical_assignment_kept",
        text: "What you were asked to do, and when, stays readable.",
      },
    ],
  },
  {
    transition: "warning_sign_reported",
    member:
      "If one of your warning signs comes back, the safety rules apply exactly as they did before. " +
      "Nobody reads this page as it happens, so use the contact path below.",
    supporting: [
      {
        fact: "safety_policy_applied",
        text: "The same safety rules apply. They are decided by rule, not by anybody's attention.",
      },
      {
        fact: "contact_path",
        text: "The crisis line is open at any hour. Your clinician is reachable in working hours.",
      },
    ],
  },
  {
    transition: "return_to_active",
    member:
      "Coming back to active work is a decision your clinician makes with you. It is not something " +
      "this page can turn back on.",
    supporting: [
      {
        fact: "current_relationship",
        text: "It needs a clinician who currently holds your care.",
      },
      { fact: "eligibility_checked", text: "Eligibility is checked again rather than assumed." },
      {
        fact: "fresh_care_plan_decision",
        text: "A new plan decision is made. The old one is not resumed.",
      },
    ],
  },
];

/** The copy for one transition. */
export function maintenanceCopyFor(t: MaintenanceTransition): MaintenanceCopy {
  return MAINTENANCE_COPY.find((c) => c.transition === t)!;
}
