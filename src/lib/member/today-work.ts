// What is in front of the person today, and what they must be told about it
// (17 September handoff, P5 — the Today contract).
//
// The member's day already has a STATE: open, narrow, stabilizing, paused,
// crisis, interrupted, service_unavailable. That axis answers "how much can you
// do today", and it is a clinical answer computed from the check-in and the
// gate.
//
// THE HANDOFF ASKS A DIFFERENT QUESTION, on a different axis: what is the next
// thing, where did it come from, and what does doing it share. Its table has
// eight rows, each with a required presentation and exactly one primary action
// — and the two that matter most, "assigned item due" and "suggested item
// available", were indistinguishable on the screen. A module a clinician asked
// for and a module the day shape happened to surface were the same card, in the
// same place, with the same words. The person could not tell whether somebody
// had asked them to do this.
//
// THE REQUIRED FACTS ARE THE POINT. For an assigned item the handoff names
// five: care-team source, purpose, estimated time, sharing rule, and
// expiration. Four of those are about trust rather than about the activity —
// who asked, why, what it shares, when it stops mattering — and none of them
// was on the screen.
//
// ONE PRIMARY ACTION, ALWAYS. "A page may expose secondary actions, but it
// should not present several controls as equal next steps." That is a property
// of the state, so it lives here: each state names its action, and a surface
// that wants two has to change the contract rather than the layout.

export const TODAY_WORK_STATES = [
  "restricted",
  "write_uncertain",
  "partial_failure",
  "assigned_due",
  "checkin_due",
  "suggested",
  "recently_completed",
  "no_task",
] as const;

export type TodayWorkState = (typeof TODAY_WORK_STATES)[number];

/** A fact the member must be told in a given state. Named rather than free
 *  text, so a screen can be checked against the list instead of read. */
export type RequiredFact =
  | "care_team_source" | "purpose" | "estimated_time" | "sharing_rule" | "expiration"
  | "why_it_appears" | "optional_status" | "what_stays_private"
  | "purpose_statement" | "sharing_behaviour"
  | "acknowledgement" | "what_was_recorded" | "next_review"
  | "plain_language_reason" | "safe_alternatives" | "responsible_party"
  | "what_is_unavailable" | "safe_support_reachable"
  | "no_completion_shown";

export interface TodayWorkContract {
  state: TodayWorkState;
  /** What the screen must carry. The handoff's "required presentation". */
  requires: readonly RequiredFact[];
  /** The one action. Null only where the state's action is support itself. */
  action: string;
  /** Why this state outranks the ones after it. */
  outranks: string;
}

/**
 * The contract, in the handoff's own order of precedence.
 *
 * ORDER IS A CLINICAL DECISION, not a rendering convenience. A restriction is
 * the truth about today and must not sit under an assignment; an uncertain
 * write outranks everything below it because showing anything else would be
 * lying about what the person just did.
 */
export const TODAY_WORK_CONTRACT: Record<TodayWorkState, TodayWorkContract> = {
  restricted: {
    state: "restricted",
    requires: ["plain_language_reason", "safe_alternatives", "responsible_party"],
    action: "Use permitted support or contact path",
    outranks:
      "A restriction is the truth about today. Under anything else it reads as an aside, and the " +
      "person finds out by being refused.",
  },
  write_uncertain: {
    state: "write_uncertain",
    requires: ["no_completion_shown", "safe_support_reachable"],
    action: "Check status",
    outranks:
      "They have just done something and Steady does not know whether it landed. Showing anything " +
      "else first is a claim about their last action that nobody can stand behind.",
  },
  partial_failure: {
    state: "partial_failure",
    requires: ["what_is_unavailable", "safe_support_reachable"],
    action: "Use available support",
    outranks:
      "Part of the picture is missing. An assignment shown over an unread source may already have " +
      "been withdrawn.",
  },
  assigned_due: {
    state: "assigned_due",
    requires: ["care_team_source", "purpose", "estimated_time", "sharing_rule", "expiration"],
    action: "Start assigned support",
    outranks: "Somebody asked for this. A suggestion did not come from a person.",
  },
  checkin_due: {
    state: "checkin_due",
    requires: ["purpose_statement", "sharing_behaviour"],
    action: "Check in",
    outranks: "The check-in is what decides the rest of the day, so it comes before what it decides.",
  },
  suggested: {
    state: "suggested",
    requires: ["why_it_appears", "optional_status", "what_stays_private"],
    action: "Open suggested tool",
    outranks: "Something is available and optional, which is worth more than an empty screen.",
  },
  recently_completed: {
    state: "recently_completed",
    requires: ["acknowledgement", "what_was_recorded", "next_review"],
    action: "View what was recorded",
    outranks: "Nothing is due, and what they did should be acknowledged rather than cleared away.",
  },
  no_task: {
    state: "no_task",
    requires: [],
    action: "Browse tools",
    outranks: "The last state: nothing is asked of them today, said calmly.",
  },
};

/** Precedence, highest first. */
export const TODAY_WORK_ORDER: readonly TodayWorkState[] = TODAY_WORK_STATES;

export interface TodayWorkInputs {
  /** A safety or gate restriction in force. */
  restricted: boolean;
  /**
   * A command the server has not reconciled.
   *
   * ALWAYS FALSE TODAY, and that is recorded rather than hidden: nothing in
   * this build stores an unreconciled command, so no screen can reach this
   * state. It is in the contract because the handoff names it and because a
   * state left out of the model is a state nobody notices is missing.
   */
  pendingWrite: boolean;
  /** Sources the day could not be read from. Empty when everything loaded. */
  missingSources: readonly string[];
  /** Live assignments a clinician has asked for. */
  assignedCount: number;
  checkinDue: boolean;
  /** Whether the day surfaced something optional. */
  hasSuggestion: boolean;
  /** Something finished today. */
  completedToday: boolean;
}

export function todayWorkState(i: TodayWorkInputs): TodayWorkState {
  if (i.restricted) return "restricted";
  if (i.pendingWrite) return "write_uncertain";
  if (i.missingSources.length > 0) return "partial_failure";
  if (i.assignedCount > 0) return "assigned_due";
  if (i.checkinDue) return "checkin_due";
  if (i.hasSuggestion) return "suggested";
  if (i.completedToday) return "recently_completed";
  return "no_task";
}

/** Nothing in this build can produce an unreconciled command, so no screen can
 *  reach `write_uncertain`. Stated as a value so a test can hold it and a
 *  later build has one line to change. */
export const PENDING_WRITE_TRACKED = false;

// ---------------------------------------------------------------------------
// The assigned item, as the member reads it
// ---------------------------------------------------------------------------

export interface AssignedPresentation {
  /** Who asked. A name, not a role: "your clinician" is not a source. */
  source: string;
  /** Why, in the words they were given. */
  purpose: string;
  /** What it costs them, before the label. */
  estimatedTime: string;
  /** What doing it shares, in plain words. */
  sharingRule: string;
  /** When it stops being asked for, or that it does not. */
  expiration: string;
}

/**
 * The sharing rule, in words the person reads.
 *
 * THE STORED FIELD IS A VERSION, NOT A SENTENCE. `share_policy` holds the
 * clinical policy version in force when the assignment was made, which is the
 * right thing to store — it binds the rule to the assignment so a later policy
 * change is visible as a difference rather than applied backwards. It is the
 * wrong thing to PRINT: the member's Today rendered "clinical-policy-2026-08-t1"
 * under the heading "What it shares", which is a policy identifier where a
 * person expected a sentence, and which the handoff rules out by name — "the
 * patient should not see queue categories, workflow priority, projection
 * versions, tenant terms, or clinician grading language".
 *
 * AND AN UNKNOWN VERSION IS NOT GUESSED AT. A rule this table does not carry
 * gets a sentence saying so and pointing at somebody who can answer, rather
 * than a plausible default — inventing what a record shares is the one mistake
 * that cannot be walked back after somebody has acted on it.
 */
export const SHARE_RULE_WORDS: Record<string, string> = {
  "clinical-policy-2026-08-t1":
    "Your care team can see that you opened this and how long you spent. Anything you write inside " +
    "it follows the same rules as the rest of your record.",
};

export function shareRuleInWords(version: string): string {
  return SHARE_RULE_WORDS[version] ??
    "Steady does not have plain words for the sharing rule recorded with this. Your care team can " +
    "tell you what opening it shares.";
}

/**
 * The five facts the handoff requires beside an assigned item.
 *
 * Every one of them comes off the assignment row rather than being composed
 * here: the patient-facing explanation and the sharing rule are stored WITH the
 * assignment precisely so the person reads what they were told at the time,
 * not what the current policy would say.
 */
export function assignedPresentation(a: {
  assignedByName: string | null;
  patientExplanation: string;
  sharePolicy: string;
  expiresAt: string | null;
  /** The member-facing minutes, from the same source every other member
   *  surface reads. An assignment that quoted a different catalogue put two
   *  durations for one activity on one screen. */
  minutes: number | null;
}): AssignedPresentation {
  return {
    source: a.assignedByName ?? "Somebody on your care team",
    purpose: a.patientExplanation,
    estimatedTime: a.minutes === null ? "No estimate recorded" : `About ${a.minutes} minutes`,
    sharingRule: shareRuleInWords(a.sharePolicy),
    expiration:
      a.expiresAt === null
        // NOT blank, and not "never". Nobody set an end date; saying it runs
        // for ever would be inventing a commitment.
        ? "No end date was set for this."
        : `Asked for until ${a.expiresAt.slice(0, 10)}.`,
  };
}
