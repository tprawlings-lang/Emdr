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

/**
 * One way the question could be answered.
 *
 * WRITTEN FOR THE PERSON DECIDING, NOT THE PERSON BUILDING. A choice offered as
 * "use `MINUTES` everywhere" cannot be weighed by a clinical lead, and a sheet
 * they cannot weigh comes back unsigned or, worse, signed without being read.
 * So each option carries what it MEANS in ordinary words and what would
 * actually change — and a test refuses an option that names a file, a symbol or
 * a table, because that is the tell that it was written for the author.
 */
export interface DecisionOption {
  /** The choice, in a few words. */
  label: string;
  /** What it means, to somebody who has never seen the code. */
  plainly: string;
  /** What would actually change if this is picked. Including "nothing", which
   *  is a real answer and the one most often left off a list of options. */
  then: string;
  /** Marked on the sheet. A recommendation is not a decision, and saying which
   *  way the evidence points is more useful than pretending to be neutral —
   *  but only one option may carry it, or it is not a recommendation. */
  recommended?: true;
}

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
  /** The ways it could be answered. Open decisions carry at least two —
   *  a question with one option is a notification. */
  options: readonly DecisionOption[];
  /** Set when answered: what was decided, and on what date. */
  answer?: { decided: string; on: string };
  /**
   * Still needed from a person, even though the question is answered.
   *
   * A DECISION AND AN INPUT ARE DIFFERENT THINGS, and collapsing them would
   * make this register lie in the most comfortable direction: "who signs each
   * gate" is answered — one named person each — and three names are still
   * missing, so a count of open questions reading zero would say nothing is
   * needed when something plainly is. The answer is not in doubt; the
   * information to act on it has not arrived.
   */
  outstanding?: string;
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
    options: [
      {
        label: "Name one person for each check",
        plainly:
          "You give three names and email addresses. From then on, only the named person can sign " +
          "their own check — the button refuses anybody else and tells them who to ask.",
        then:
          "Nothing in the product changes except who the button accepts. Add the three names to " +
          "the owner list; no code is written.",
        recommended: true,
      },
      {
        label: "Name one person for all three",
        plainly:
          "One person is accountable for all three checks. Simpler to arrange, and it means one " +
          "person is asserting that the screens work with a screen reader, that nobody can reach " +
          "data they should not, and that the numbers are right.",
        then: "Same as above with one name instead of three.",
      },
      {
        label: "Leave it open to any reviewer",
        plainly:
          "Anybody with review access can sign any of the three. Every signature still records who " +
          "made it, on what date, and where the evidence is — so it can be followed up afterwards, " +
          "just not directed beforehand.",
        then:
          "Nothing changes. The release screen goes on saying that no individual is named, so " +
          "nobody mistakes the absence of a rule for a rule.",
      },
    ],
    outstanding:
      "Three names and email addresses — one for each of: no role can reach data outside its " +
      "scope, no keyboard or screen-reader path is blocked, the numbers are what the records say. " +
      "No name has been invented to fill the gap, and a test keeps it that way.",
    state: "answered",
    answer: {
      decided:
        "A — one named person per check. The mechanism already enforces it: where a name is set, " +
        "only that person's signature is accepted and everybody else is told who to ask. THE THREE " +
        "NAMES ARE STILL OUTSTANDING, and no name has been invented to fill the gap; until they " +
        "are given, any reviewer can sign and the console says so.",
      on: "2026-09-23",
    },
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
    options: [
      {
        label: "Use the shorter figures everywhere",
        plainly:
          "A member is told Calm place takes about 10 minutes, on every screen, and a clinician " +
          "sees the same. The shorter numbers win.",
        then:
          "Members see no change on the screen they use most; the longer ranges disappear from the " +
          "four screens that currently show them.",
      },
      {
        label: "Use the longer ranges everywhere",
        plainly:
          "A member is told Calm place takes 15 to 20 minutes, on every screen. The longer ranges " +
          "win.",
        then:
          "Members start seeing a range where they used to see a single number, on the screen they " +
          "use most. That is a change to words a patient reads, so it would go through the clinical " +
          "copy review.",
      },
      {
        label: "Two figures that mean different things",
        plainly:
          "The guided session is 15 to 20 minutes including settling and closing; the piece " +
          "assigned for today is the 10-minute core. Both shown, each labelled so nobody reads " +
          "them as contradicting.",
        then:
          "Only honest if the assigned piece really is shorter, which nothing currently records — " +
          "somebody would have to confirm it activity by activity.",
      },
      {
        label: "Sit down with all eleven and set them",
        plainly:
          "Neither list is trusted. A clinician goes through all eleven activities and says how " +
          "long each takes, once.",
        then:
          "The most work and the only option that ends with one number nobody has to reconcile " +
          "later. Six of the eleven currently disagree.",
        recommended: true,
      },
    ],
    state: "answered",
    answer: {
      decided:
        "Shelved. The set of activities may change — modules added — so settling eleven numbers now " +
        "would be settling a list that is about to move. The two disagreeing lists stay, and a " +
        "member can still see two figures for the same activity on different screens; that is a " +
        "known cost of waiting rather than an oversight. Revisit when the module set is settled.",
      on: "2026-09-23",
    },
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
    options: [
      {
        label: "Delete the four words",
        plainly:
          "The list of things a clinician can be recorded as having done shrinks from eight to " +
          "four — the four that actually happen. Nothing is lost, because nothing ever used them.",
        then:
          "Smallest change, and nothing can be recorded in a shape no screen shows. Reversible if " +
          "you later want one back.",
      },
      {
        label: "Build all four",
        plainly:
          "Each becomes something a clinician can actually do and see: recording a thought between " +
          "visits, opening session preparation, reading a trajectory, adjusting a plan link.",
        then:
          "The largest option. I would want to know what each is FOR before starting — a feature " +
          "built from a word in a list tends to be a feature nobody uses.",
      },
      {
        label: "Leave them shelved",
        plainly:
          "Nothing happens until the current handoff is finished, then it comes back. This is what " +
          "you chose on 19 September.",
        then:
          "The four words stay in the list and read like features that exist. The seed is barred " +
          "from writing them, so nothing fabricates evidence of a workflow that is not there.",
        recommended: true,
      },
    ],
    state: "answered",
    answer: {
      decided:
        "B — build all four. A clinician should be able to record a thought between visits, that " +
        "they prepared for a session, that they read somebody's trajectory, and that they adjusted " +
        "a plan link, and each should show on the person's record. This reverses the 19 September " +
        "decision to shelf them, which is recorded rather than overwritten.",
      on: "2026-09-23",
    },
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
    options: [
      {
        label: "A named person reviews the list daily",
        plainly:
          "Nothing moves on its own. Somebody — a duty clinician, a team lead — looks at the " +
          "unclaimed list once a day and assigns what is there.",
        then:
          "No code changes; the count is already on the clinician's home screen. What it needs is " +
          "somebody whose job it is.",
        recommended: true,
      },
      {
        label: "After a set number of days it goes to a named supervisor",
        plainly:
          "Work nobody has picked up for, say, three days automatically becomes one named " +
          "person's responsibility. You choose the number of days and the person.",
        then:
          "Real work: the rule, the assignment, and a way for that person to see what landed on " +
          "them. Nobody is notified — this build has no way to send anything.",
      },
      {
        label: "After a set number of days it goes to whoever is on duty",
        plainly:
          "Same, but it lands with whoever is covering that day rather than one fixed person.",
        then:
          "More work than the above, because the product has no concept of who is on duty. That " +
          "would have to be built first.",
      },
      {
        label: "Leave it as it is",
        plainly:
          "The unclaimed count stays visible with no deadline attached, and nobody is chased.",
        then:
          "Nothing changes. The screen says plainly that nothing escalates, so the absence is " +
          "visible rather than assumed.",
      },
    ],
    outstanding:
      "Who reviews the unclaimed list each day. The product needs nothing; the rota does.",
    state: "answered",
    answer: {
      decided:
        "A — a named person reviews the unclaimed list daily and assigns what is there. Nothing " +
        "escalates automatically, which is now a chosen operating control rather than an absent " +
        "rule. No code changes: the count, the number of people behind it and the age of the oldest " +
        "are already on the clinician's home screen. WHO that person is remains an operational " +
        "appointment.",
      on: "2026-09-23",
    },
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
    options: [
      {
        label: "Anyone on the team may act",
        plainly:
          "Being somebody's clinician records who is accountable, and does not stop a colleague " +
          "from helping. If a member is in crisis and their clinician is on leave, whoever is " +
          "there can act, and the record shows it was cover.",
        then: "Nothing changes. This is how it works today.",
        recommended: true,
      },
      {
        label: "Only the assigned clinician may act",
        plainly:
          "A member's own clinician is the only person who can review or act on them. Anybody else " +
          "has to formally take the person over first.",
        then:
          "A real clinical risk to weigh: somebody in an Immediate band waits until their own " +
          "clinician is back, or until a handover is completed. That is the trade this option buys.",
      },
      {
        label: "Only the assigned clinician, with an emergency override",
        plainly:
          "As above, but anybody can step in for an urgent case by saying why, and that is recorded " +
          "and visible afterwards.",
        then:
          "The most work of the three, and the usual answer in clinical software. Needs a rule for " +
          "what counts as urgent enough.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "A — anyone on the team may act. Being somebody's clinician records who is accountable and " +
        "does not gate access, so a member in an Immediate band never waits for one person to come " +
        "back from leave, and stepping in is recorded as cover. No change: this is what the product " +
        "already does, now deliberately rather than by default.",
      on: "2026-09-23",
    },
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
    options: [
      {
        label: "Leave the screen as it is",
        plainly:
          "Opening a row shows its detail beside the list on a laptop, and as its own screen on a " +
          "phone. The one-line summary stays under the counts.",
        then: "Nothing changes.",
        recommended: true,
      },
      {
        label: "Move the detail below the list",
        plainly:
          "Opening a row pushes its detail underneath the list instead of beside it, which is how " +
          "the other work screens behave. More consistent; the list and the detail are no longer " +
          "visible at once.",
        then:
          "A rebuild of the busiest clinician screen. Worth doing only if the consistency is worth " +
          "losing the side-by-side view.",
      },
      {
        label: "Move the summary line to the top",
        plainly:
          "The sentence saying what you are looking at moves above the counts, so it is the first " +
          "thing read rather than the fourth.",
        then:
          "Small change, and it can be taken on its own without the one above.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "B — the row's detail moves below the list rather than beside it, matching every other work " +
        "screen. The list and the detail are no longer visible at once, which is the cost. The " +
        "orienting sentence stays where it is: that was a separate option and was not chosen.",
      on: "2026-09-23",
    },
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
    options: [
      {
        label: "Put a name and a date against each of the four",
        plainly:
          "For each one — the screen-reader walkthrough, the defect list, the old documents, the " +
          "final acceptance — you say who does it and by when. They are jobs, not decisions.",
        then:
          "The accessibility one is the urgent one: until somebody has operated the product with a " +
          "keyboard and a screen reader and signed that off, real participants cannot be enrolled " +
          "at all.",
        recommended: true,
      },
      {
        label: "Do the accessibility one now, the rest later",
        plainly:
          "Only the screen-reader walkthrough is scheduled, because it is the one holding " +
          "enrollment shut. The other three wait.",
        then:
          "Unblocks the pilot. The release checklist stays incomplete and says so.",
      },
      {
        label: "Tell me there is no defect register",
        plainly:
          "One of the four asks whether every confirmed serious defect has a test that reproduces " +
          "it. If defects are not tracked anywhere, that line cannot be answered and should say so " +
          "rather than sit open.",
        then:
          "I record it as not applicable with the reason, instead of it reading as a job nobody " +
          "has done.",
      },
    ],
    outstanding:
      "A name and a date for each of the four jobs. The screen-reader walkthrough is the one that " +
      "matters today: it is a gate the environment policy requires, so real enrolment stays shut " +
      "until somebody has done it and signed it off.",
    state: "answered",
    answer: {
      decided:
        "A — a name and a date against each of the four. They are jobs rather than decisions. THE " +
        "NAMES AND DATES ARE STILL OUTSTANDING. The accessibility walkthrough is the urgent one: " +
        "it is a gate the environment policy requires, so until somebody has operated the product " +
        "with a keyboard and a screen reader and signed that off, no real participant can be " +
        "enrolled at all.",
      on: "2026-09-23",
    },
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
    options: [
      { label: "Fabricated data only", plainly: "Nothing about a real person may ever be typed in, stored, shown or exported here — not even a real member of staff.", then: "Would have removed the pilot wording entirely. Not chosen." },
      { label: "Real participants, once the safety checks pass", plainly: "The pilot exists for real people with their consent, and no environment admits one until the checks that protect them have been signed off by somebody accountable.", then: "What was chosen. The environment now reports which state it is in, read from live facts rather than asserted.", recommended: true },
      { label: "Real participants now", plainly: "Open enrolment to real people immediately, without waiting for the protective checks to be signed.", then: "Not chosen. Would have needed confirmation of which checks had actually passed and who signed them." },
    ],
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
    options: [
      { label: "Build it", plainly: "A person is assigned to a named clinician, and it stays that way until somebody changes it, with a record of who held them before.", then: "What was chosen. Every screen now names the clinician, and unclaimed work fell from 34 of 39 items to 3.", recommended: true },
      { label: "Keep per-task ownership only", plainly: "Somebody owns an individual piece of work, and nobody is ever recorded as looking after a person overall.", then: "Not chosen. Nobody could have answered \"who is my clinician\"." },
      { label: "Leave it and document it", plainly: "Change nothing in the product, and write down clearly that the system cannot say who looks after whom.", then: "Not chosen. Would have left every row reading as though nobody was responsible." },
    ],
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
    options: [
      { label: "Expire when the thing checked changes", plainly: "A completed check stays valid for as long as the thing it examined has not moved, and stops counting the moment it does.", then: "What was chosen. Nobody has to remember to re-run anything, and nothing expires while nothing has changed.", recommended: true },
      { label: "Expire on a timer", plainly: "A completed check goes stale after a set number of days, whether or not anything it examined has actually changed.", then: "Not chosen. It would shut the pilot overnight with nothing having happened, teaching people to re-run checks without reading them." },
    ],
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
  /** Answered, and still waiting on information before anybody can act. */
  waitingOnInformation: number;
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
    waitingOnInformation: entries.filter((d) => d.outstanding).length,
    // A DECISION THAT BLOCKS NOTHING IS STILL WORTH ASKING and is counted
    // separately rather than hidden: "should assignment gate access" holds up
    // no filed work, and it is the kind of question that turns out to matter
    // most. What it must not do is pad a count of things that are stuck.
    blocking: open.filter((d) => d.blocks.length > 0).length,
    byAudience,
  };
}
