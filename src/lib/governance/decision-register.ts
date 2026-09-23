// The questions waiting on a person.
//
// NEITHER REGISTER COULD SAY THIS. The work register has `proposed` (decided,
// not built) and `held` (deliberately not finished); the failure register has
// `gap`. All three describe the STATE OF THE WORK, and none of them says "this
// is not moving because nobody has answered a question" — so a decision waiting
// on somebody looked exactly like work nobody had got to, and the difference is
// the only thing that tells you whether building harder would help.
//
// THREE THINGS EACH ENTRY HAS TO CARRY, and the third is the one usually
// missing from a list of open questions:
//
//   THE QUESTION, in words somebody outside the codebase can answer. "Should
//   `CONTACT_LEDGER_ACTIONS` include `record_thought`" is not a question a
//   clinical lead can answer; "should the product be able to record that a
//   clinician wrote a note between visits" is the same question, askable.
//
//   WHAT IT BLOCKS, by id, checked against the registers so a decision cannot
//   go on claiming to block something that shipped.
//
//   WHAT HAPPENS MEANWHILE. An unanswered question always has a current
//   behaviour, and leaving it unsaid is how a default becomes a decision
//   nobody took. Every entry below states what the product does today, so a
//   reader can decide whether the wait is costing anything.
//
// ANSWERED ONES STAY. A decision that vanishes when it is taken leaves the code
// carrying a rationale nobody can find, and the next person re-opens it. The
// answer and its date sit beside the question.

export type DecisionState =
  /** Waiting on a person. */
  | "open"
  /** Answered. The entry keeps the question, the answer and when. */
  | "answered";

/** Who the question is for. Not a name — a role, because the name changes and
 *  the accountability does not. */
export type DecisionAudience =
  | "clinical"
  | "product"
  | "operations"
  | "security"
  | "design";

export const AUDIENCE_LABEL: Record<DecisionAudience, string> = {
  clinical: "Clinical lead",
  product: "Product owner",
  operations: "Service operations",
  security: "Security and privacy",
  design: "Design",
};

export interface Decision {
  id: string;
  /** In words somebody outside the codebase can answer. */
  question: string;
  audience: DecisionAudience;
  /** Register or release-definition ids this is holding up. Checked. */
  blocks: readonly string[];
  /** What the product does while nobody has answered. Always something. */
  meanwhile: string;
  state: DecisionState;
  /** ISO date the question was first put. */
  asked: string;
  /** Set when answered: what was decided, and on what date. */
  answer?: { decided: string; on: string };
}

export const DECISION_REGISTER: Decision[] = [
  // ---- Open ---------------------------------------------------------------
  {
    id: "gates.who-signs",
    question:
      "Who signs each of the three release gates a machine cannot check — that no role can reach " +
      "data outside its scope, that no keyboard or screen-reader path is blocked, and that the " +
      "numbers are what the records say? A name and an address for each.",
    audience: "security",
    // BLOCKS NOTHING FILED, and the check above caught that on its first run.
    // The mechanism shipped: a named owner is enforced at the door wherever one
    // is set. What is missing is three names, which is configuration a person
    // supplies rather than work anybody is waiting to do.
    blocks: [],
    meanwhile:
      "Any account with review access can sign any of the three, and the release console says so " +
      "in those words — the absence of a decision rather than a decision. Every signature records " +
      "who made it, with a date and a reference to the evidence, so it is auditable after the " +
      "fact even while anybody can make it. Naming somebody tightens it immediately; no code " +
      "changes.",
    state: "open",
    asked: "2026-09-23",
  },
  {
    id: "clinical.activity-durations",
    question:
      "How long does each activity take, and should a clinician see a different figure from the " +
      "member? Two lists disagree for six of eleven activities, and BOTH are shown to members on " +
      "different screens — Calm place reads 15–20 min on Modules and about 10 minutes on Today.",
    audience: "clinical",
    blocks: ["experience.one-duration-per-activity"],
    meanwhile:
      "A member can see two different figures for the same activity depending on which screen " +
      "they are on. Nothing crashes and nothing is unsafe; it reads as carelessness, which on a " +
      "clinical product is its own cost.",
    state: "open",
    asked: "2026-09-19",
  },
  {
    id: "clinical.unwritten-care-actions",
    question:
      "Should the product be able to record that a clinician wrote a note between visits, opened " +
      "session preparation, read a trajectory, or adjusted a plan link? Four of the eight care " +
      "actions name things nothing writes and two would show on no screen.",
    audience: "clinical",
    blocks: ["clinical.unreachable-care-actions"],
    meanwhile:
      "The four words stay in the closed vocabulary and read like built features. The seed is " +
      "forbidden from writing them, so nothing fabricates evidence of a workflow that does not " +
      "exist. Decided 19 September to shelf this until the 17 September handoff is finished.",
    state: "open",
    asked: "2026-09-19",
  },
  {
    id: "ops.unclaimed-work-escalation",
    question:
      "When work has no clinician, after how long should it escalate, and to whom? This is about " +
      "how the service is run rather than how the product is built, and a default chosen here " +
      "would be this codebase inventing a duty-of-care rule.",
    audience: "operations",
    blocks: ["presentation.unassigned-work-accumulates"],
    meanwhile:
      "Nothing escalates, and the Command Center says so beside the count: how many items are " +
      "unclaimed, across how many people, and how long the oldest has waited — with no threshold " +
      "and no caution colour, because either would imply a deadline nobody agreed.",
    state: "open",
    asked: "2026-09-19",
  },
  {
    id: "clinical.assignment-and-access",
    question:
      "Should being somebody's assigned clinician restrict who may act on them? The caseload model " +
      "is `hybrid` today: a named owner carries accountability and anyone in the tenant may still " +
      "act. Switching to `owned` would make the assignment a gate.",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Assignment records accountability and changes nothing about access, so a member in an " +
      "Immediate band never waits for one person to come back from leave. Acting on somebody " +
      "else's patient is now visible as coverage, which it could not be before, because nobody " +
      "had a patient.",
    state: "open",
    asked: "2026-09-23",
  },
  {
    id: "experience.command-center-layout",
    question:
      "On the busiest clinician screen: should a row's detail stay beside the list or move below " +
      "it, and should the one-line orienting sentence move above the counts? Both are defensible " +
      "and they produce visibly different screens.",
    audience: "design",
    blocks: ["experience.command-center-template"],
    meanwhile:
      "The Command Center keeps its own layout: detail beside the list at wide widths and a " +
      "dedicated detail view below it on a phone, with the orienting sentence after the counts.",
    state: "open",
    asked: "2026-09-19",
  },
  {
    id: "release.human-evidence",
    question:
      "Four release lines only a person can answer: has anybody operated the product with a " +
      "keyboard and a screen reader and written down what happened; is there a defect register, " +
      "and does every confirmed high-priority defect have a reproduction test; has somebody made " +
      "each superseded document point at the current record; and do the product owner and " +
      "reviewers accept the scoped release?",
    audience: "product",
    blocks: [
      "accessibility.manual-and-human-testing",
      "defects.reproduction-and-regression",
      "docs.superseded-point-here",
      "acceptance.owner-and-reviewers",
    ],
    meanwhile:
      "The release console reports each as unanswered rather than assuming it. The accessibility " +
      "one is now on the critical path for more than the checklist: it is one of the gates the " +
      "environment policy requires before a real participant may be admitted.",
    state: "open",
    asked: "2026-09-17",
  },

  // ---- Answered -----------------------------------------------------------
  {
    id: "governance.permitted-data-classes",
    question:
      "Is this a pilot with real people or a demonstration with fabricated data? Some wording says " +
      "pilot account and other wording says everything here is fabricated, and both cannot be true.",
    audience: "product",
    blocks: ["governance.environment-policy"],
    meanwhile:
      "Before the answer, nothing said which state a deployment was in and a reader inferred it " +
      "from a banner.",
    state: "answered",
    asked: "2026-09-17",
    answer: {
      decided:
        "Real consented participants are what the pilot is FOR, and no environment takes one " +
        "until the gates that protect them pass. Two tiers, with the current one read from live " +
        "facts rather than declared.",
      on: "2026-09-19",
    },
  },
  {
    id: "clinical.standing-caseload",
    question:
      "Should the system know that a person is a particular clinician's patient, as a standing " +
      "fact? The field called primary clinician was whoever last decided a module-unlock request.",
    audience: "clinical",
    blocks: ["clinical.caseload-assignment"],
    meanwhile: "Before the answer, every row read Unassigned and no caseload could be named.",
    state: "answered",
    asked: "2026-09-19",
    answer: {
      decided:
        "Build it. A person is assigned to a named clinician and it stays until somebody changes " +
        "it, with the history kept. Accountability rather than access.",
      on: "2026-09-23",
    },
  },
  {
    id: "governance.gate-result-expiry",
    question:
      "When should a recorded gate result stop counting — on a clock, or when the thing it was " +
      "measured against changes?",
    audience: "product",
    blocks: ["governance.resolved-gate-results"],
    meanwhile: "Before the answer, two gates could not be part of the pilot check at all.",
    state: "answered",
    asked: "2026-09-23",
    answer: {
      decided:
        "On change, with no time cap. A result expiring on a timer closes the pilot tier overnight " +
        "with nothing having changed, which teaches an operator to re-run a check they have no " +
        "reason to believe is stale.",
      on: "2026-09-23",
    },
  },
];

export const OPEN_DECISIONS = DECISION_REGISTER.filter((d) => d.state === "open");

export interface DecisionSummary {
  open: number;
  answered: number;
  /** Open decisions holding up at least one recorded piece of work. */
  blocking: number;
  byAudience: Record<DecisionAudience, number>;
}

export function decisionSummary(entries: readonly Decision[] = DECISION_REGISTER): DecisionSummary {
  const open = entries.filter((d) => d.state === "open");
  const byAudience = {
    clinical: 0, product: 0, operations: 0, security: 0, design: 0,
  } as Record<DecisionAudience, number>;
  for (const d of open) byAudience[d.audience]++;
  return {
    open: open.length,
    answered: entries.length - open.length,
    // A DECISION THAT BLOCKS NOTHING IS STILL WORTH ASKING and is counted
    // separately rather than hidden: "should assignment gate access" holds up
    // no filed work, and it is the kind of question that turns out to matter
    // most. What it must not do is pad a count of things that are stuck.
    blocking: open.filter((d) => d.blocks.length > 0).length,
    byAudience,
  };
}
